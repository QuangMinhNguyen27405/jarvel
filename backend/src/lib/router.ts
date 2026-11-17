// Public-transport routing over the stored network (FR5, FR5.1, FR5.2, FR5.4). An earliest-arrival Dijkstra over
// (station, line) states. Boarding waits half a headway; changing lines costs the network's transfer penalty;
// no ride departs before a line's first train or after its last train on that weekday; no walk exceeds the limit.
// Times are minutes after midnight on the plan date and come only from the stored data (no live delays).
import type { DayKey, Line, LineId, Place, TransitLeg, TransitNetwork, TransitStep } from '@jarvel/shared';
import { stationsWithinWalk, walkMinutesBetween, type Point } from './geo.js';
import { parseHHMM, weekdayOf } from './time.js';

export interface AccessLink {
  stationId: string;
  minutes: number;
  kind: 'walk' | 'shuttle';
  instruction?: string;
}

/** A place a traveler can be: the hotel, the airport or a catalog place. */
export interface Location {
  key: string; // 'hotel', 'airport' or the place id
  label: string;
  point: Point;
  access: AccessLink[];
}

export type RouteFailure = 'outside-service-hours' | 'no-route';

export type RouteResult = { ok: true; leg: TransitLeg; arriveAt: number } | { ok: false; reason: RouteFailure };

export interface RouteQuery {
  from: Location;
  to: Location;
  departAt: number;
  date: string;
  maxWalkMinutes: number;
}

interface Neighbor {
  to: string;
  line: LineId;
  minutes: number;
}

export interface NetworkIndex {
  network: TransitNetwork;
  lines: Map<string, Line>;
  stationNames: Map<string, string>;
  neighbors: Map<string, Neighbor[]>;
  stationLines: Map<string, Set<LineId>>;
}

export function indexNetwork(network: TransitNetwork): NetworkIndex {
  const neighbors = new Map<string, Neighbor[]>();
  const stationLines = new Map<string, Set<LineId>>();
  const add = (from: string, neighbor: Neighbor) => {
    neighbors.set(from, [...(neighbors.get(from) ?? []), neighbor]);
    stationLines.set(from, (stationLines.get(from) ?? new Set()).add(neighbor.line));
  };
  for (const edge of network.edges) {
    add(edge.from, { to: edge.to, line: edge.line, minutes: edge.minutes });
    add(edge.to, { to: edge.from, line: edge.line, minutes: edge.minutes });
  }
  return {
    network,
    lines: new Map(network.lines.map((line) => [line.id, line])),
    stationNames: new Map(network.stations.map((station) => [station.id, station.name])),
    neighbors,
    stationLines,
  };
}

/** Service window of a line on a weekday, in minutes; a last train past midnight is after 24:00. */
export function serviceWindow(line: Line, day: DayKey): { first: number; last: number } {
  const hours = line.serviceByDay?.[day] ?? { firstTrain: line.firstTrain, lastTrain: line.lastTrain };
  const first = parseHHMM(hours.firstTrain);
  let last = parseHHMM(hours.lastTrain);
  if (last < first) last += 24 * 60;
  return { first, last };
}

/** Headway in force at `minute` on `day`: weekday peaks 07:00-09:30 and 16:00-18:30, evening from 20:00. */
export function headwayAt(line: Line, day: DayKey, minute: number): number {
  const weekend = day === 'sat' || day === 'sun';
  if (minute >= 20 * 60 || minute < 5 * 60) return line.headwayMinutes.evening;
  const peak = (minute >= 7 * 60 && minute < 9 * 60 + 30) || (minute >= 16 * 60 && minute < 18 * 60 + 30);
  return !weekend && peak ? line.headwayMinutes.peak : line.headwayMinutes.offPeak;
}

/** Departure time when boarding `line` at `minute`, or undefined when no train runs then (FR5.2). */
export function boardingTime(line: Line, day: DayKey, minute: number): number | undefined {
  const { first, last } = serviceWindow(line, day);
  const start = Math.max(minute, first);
  const depart = start + Math.ceil(headwayAt(line, day, start) / 2);
  return depart <= last ? depart : undefined;
}

export function placeLocation(place: Place, network: TransitNetwork, maxWalkMinutes: number): Location {
  const declared: AccessLink = {
    stationId: place.nearestStationId,
    minutes: place.walkMinutesFromStation,
    kind: 'walk',
  };
  const nearby = stationsWithinWalk(place, network.stations, maxWalkMinutes)
    .filter((candidate) => candidate.stationId !== place.nearestStationId)
    .map<AccessLink>((candidate) => ({ stationId: candidate.stationId, minutes: candidate.walkMinutes, kind: 'walk' }));
  return {
    key: place.id,
    label: place.name,
    point: { lat: place.lat, lng: place.lng },
    access: [declared, ...nearby],
  };
}

export function pointLocation(
  key: string,
  label: string,
  point: Point,
  network: TransitNetwork,
  maxWalk: number,
): Location {
  const access = stationsWithinWalk(point, network.stations, maxWalk)
    .slice(0, 3)
    .map<AccessLink>((candidate) => ({ stationId: candidate.stationId, minutes: candidate.walkMinutes, kind: 'walk' }));
  return { key, label, point, access };
}

export const AIRPORT_KEY = 'airport';

export function airportLocation(network: TransitNetwork): Location | undefined {
  const airport = network.airport;
  if (!airport) return undefined;
  return {
    key: AIRPORT_KEY,
    label: airport.label,
    point: { lat: airport.lat, lng: airport.lng },
    access: [
      {
        stationId: airport.stationId,
        minutes: airport.accessMinutes,
        kind: 'shuttle',
        instruction: airport.instruction,
      },
    ],
  };
}

type Segment =
  | { kind: 'access'; link: AccessLink }
  | { kind: 'board'; line: LineId; wait: number }
  | { kind: 'ride'; line: LineId; from: string; to: string; minutes: number }
  | { kind: 'transfer'; line: LineId; minutes: number };

interface Label {
  time: number;
  station: string;
  line: LineId | null;
  prev?: Label;
  segment?: Segment;
}

function usableLinks(location: Location, maxWalk: number): AccessLink[] {
  return location.access.filter((link) => link.kind === 'shuttle' || link.minutes <= maxWalk);
}

interface SearchResult {
  best?: { label: Label; egress: AccessLink; arrive: number };
  blockedByServiceHours: boolean;
}

function search(query: RouteQuery, index: NetworkIndex, respectServiceHours: boolean): SearchResult {
  const day = weekdayOf(query.date);
  const settled = new Map<string, number>();
  const queue: Label[] = [];
  const egress = new Map(usableLinks(query.to, query.maxWalkMinutes).map((link) => [link.stationId, link]));
  let best: SearchResult['best'];
  let blocked = false;
  const push = (label: Label) => {
    const key = `${label.station}|${label.line ?? ''}`;
    if ((settled.get(key) ?? Infinity) <= label.time) return;
    settled.set(key, label.time);
    queue.push(label);
  };
  const board = (from: Label, line: LineId, extraWait: number, segment: 'board' | 'transfer') => {
    const lineInfo = index.lines.get(line);
    if (!lineInfo) return;
    const ready = from.time + extraWait;
    const depart = respectServiceHours
      ? boardingTime(lineInfo, day, ready)
      : ready + Math.ceil(headwayAt(lineInfo, day, ready) / 2);
    if (depart === undefined) {
      blocked = true;
      return;
    }
    const seg: Segment =
      segment === 'board'
        ? { kind: 'board', line, wait: depart - from.time }
        : { kind: 'transfer', line, minutes: depart - from.time };
    push({ time: depart, station: from.station, line, prev: from, segment: seg });
  };
  for (const link of usableLinks(query.from, query.maxWalkMinutes)) {
    push({
      time: query.departAt + link.minutes,
      station: link.stationId,
      line: null,
      segment: { kind: 'access', link },
    });
  }
  while (queue.length > 0) {
    queue.sort((a, b) => a.time - b.time);
    const current = queue.shift() as Label;
    if (best && current.time >= best.arrive) break;
    if (current.line === null) {
      for (const line of index.stationLines.get(current.station) ?? []) board(current, line, 0, 'board');
      continue;
    }
    const exit = egress.get(current.station);
    if (exit && (!best || current.time + exit.minutes < best.arrive)) {
      best = { label: current, egress: exit, arrive: current.time + exit.minutes };
    }
    for (const neighbor of index.neighbors.get(current.station) ?? []) {
      if (neighbor.line !== current.line) continue;
      push({
        time: current.time + neighbor.minutes,
        station: neighbor.to,
        line: current.line,
        prev: current,
        segment: {
          kind: 'ride',
          line: current.line,
          from: current.station,
          to: neighbor.to,
          minutes: neighbor.minutes,
        },
      });
    }
    for (const line of index.stationLines.get(current.station) ?? []) {
      if (line !== current.line) board(current, line, index.network.transferPenaltyMinutes, 'transfer');
    }
  }
  return { best, blockedByServiceHours: blocked };
}

/** The terminal a train on `line` heads toward after travelling from `from` to `to`. */
export function terminalToward(index: NetworkIndex, line: LineId, from: string, to: string): string {
  let previous = from;
  let current = to;
  for (let guard = 0; guard < 500; guard += 1) {
    const next = (index.neighbors.get(current) ?? []).filter((n) => n.line === line && n.to !== previous);
    if (next.length !== 1) break;
    previous = current;
    current = (next[0] as Neighbor).to;
  }
  return index.stationNames.get(current) ?? current;
}

function segmentsOf(label: Label): Segment[] {
  const segments: Segment[] = [];
  for (let node: Label | undefined = label; node; node = node.prev) if (node.segment) segments.unshift(node.segment);
  return segments;
}

function stationName(index: NetworkIndex, id: string): string {
  return index.stationNames.get(id) ?? id;
}

function accessStep(index: NetworkIndex, link: AccessLink, location: Location, direction: 'in' | 'out'): TransitStep {
  const station = stationName(index, link.stationId);
  if (link.kind === 'shuttle') {
    return {
      kind: 'ride',
      line: 'shuttle',
      ...(direction === 'in' ? { toStationId: link.stationId } : { fromStationId: link.stationId }),
      minutes: link.minutes,
      instruction: link.instruction ?? `Shuttle between ${location.label} and ${station} station`,
    };
  }
  return direction === 'in'
    ? {
        kind: 'walk',
        toStationId: link.stationId,
        minutes: link.minutes,
        instruction: `Walk ${link.minutes} min from ${location.label} to ${station} station`,
      }
    : {
        kind: 'walk',
        fromStationId: link.stationId,
        minutes: link.minutes,
        instruction: `Walk ${link.minutes} min from ${station} station to ${location.label}`,
      };
}

function buildSteps(index: NetworkIndex, query: RouteQuery, segments: Segment[], egress: AccessLink): TransitStep[] {
  const steps: TransitStep[] = [];
  for (const segment of segments) {
    if (segment.kind === 'access') steps.push(accessStep(index, segment.link, query.from, 'in'));
    else if (segment.kind === 'board' && segment.wait > 0) {
      const lineName = index.lines.get(segment.line)?.name ?? segment.line;
      const lastStation = (steps.at(-1)?.toStationId ?? '') as string;
      steps.push({
        kind: 'wait',
        line: segment.line,
        fromStationId: lastStation,
        minutes: segment.wait,
        instruction: `Wait about ${segment.wait} min for the ${lineName}`,
      });
    } else if (segment.kind === 'transfer') {
      const previousRide = steps.at(-1);
      const at = previousRide?.toStationId ?? '';
      const lineName = index.lines.get(segment.line)?.name ?? segment.line;
      steps.push({
        kind: 'transfer',
        line: segment.line,
        fromStationId: at,
        toStationId: at,
        minutes: segment.minutes,
        instruction: `Change to the ${lineName} at ${stationName(index, at)} (about ${segment.minutes} min including the wait)`,
      });
    } else if (segment.kind === 'ride') {
      const last = steps.at(-1);
      if (last && last.kind === 'ride' && last.line === segment.line && last.toStationId === segment.from) {
        last.toStationId = segment.to;
        last.minutes += segment.minutes;
        last.stops = (last.stops ?? 0) + 1;
      } else {
        steps.push({
          kind: 'ride',
          line: segment.line,
          fromStationId: segment.from,
          toStationId: segment.to,
          stops: 1,
          minutes: segment.minutes,
          instruction: '',
        });
      }
    }
  }
  steps.push(accessStep(index, egress, query.to, 'out'));
  for (const step of steps) {
    if (step.kind !== 'ride' || step.line === 'shuttle' || !step.line || !step.fromStationId || !step.toStationId)
      continue;
    step.direction = `toward ${directionOf(index, step)}`;
    const lineName = index.lines.get(step.line)?.name ?? step.line;
    const stops = step.stops ?? 1;
    step.instruction = `Ride the ${lineName} ${step.direction} for ${stops} stop${stops === 1 ? '' : 's'} to ${stationName(index, step.toStationId)} (${step.minutes} min)`;
  }
  return steps;
}

/** Direction of a merged ride: follow the line from its first station toward its last station. */
function directionOf(index: NetworkIndex, step: TransitStep): string {
  const line = step.line as LineId;
  const from = step.fromStationId as string;
  const target = step.toStationId as string;
  // Find the neighbour of `from` on this line that lies on the path to `target`.
  for (const first of (index.neighbors.get(from) ?? []).filter((n) => n.line === line)) {
    let previous = from;
    let current = first.to;
    for (let guard = 0; guard < 500 && current !== target; guard += 1) {
      const next = (index.neighbors.get(current) ?? []).filter((n) => n.line === line && n.to !== previous);
      if (next.length !== 1) break;
      previous = current;
      current = (next[0] as Neighbor).to;
    }
    if (current === target) return terminalToward(index, line, from, first.to);
  }
  return stationName(index, target);
}

function legFrom(index: NetworkIndex, query: RouteQuery, steps: TransitStep[]): TransitLeg {
  const rides = steps.filter((step) => step.kind === 'ride' && step.line !== 'shuttle');
  const fare = rides.reduce((max, step) => Math.max(max, index.lines.get(step.line as LineId)?.fareUSD ?? 0), 0);
  return {
    mode: rides.length > 0 ? 'subway' : steps.some((s) => s.line === 'shuttle') ? 'shuttle' : 'walk',
    fromLabel: query.from.label,
    toLabel: query.to.label,
    steps,
    durationMinutes: steps.reduce((sum, step) => sum + step.minutes, 0),
    fareUSD: fare,
  };
}

/**
 * The earliest-arriving way from `query.from` to `query.to` leaving at `query.departAt`: a direct walk within the
 * walking limit, or walk/shuttle + rides + walk/shuttle. Fails with 'outside-service-hours' when only a ride
 * outside service hours would work (the last-train case), otherwise 'no-route'.
 */
export function planRoute(query: RouteQuery, index: NetworkIndex): RouteResult {
  const walk = walkMinutesBetween(query.from.point, query.to.point);
  const directWalk = walk <= query.maxWalkMinutes ? query.departAt + walk : Infinity;
  const { best, blockedByServiceHours } = search(query, index, true);
  if (best && best.arrive < directWalk) {
    const steps = buildSteps(index, query, segmentsOf(best.label), best.egress);
    return {
      ok: true,
      leg: legFrom(index, query, steps),
      arriveAt: query.departAt + steps.reduce((s, x) => s + x.minutes, 0),
    };
  }
  if (directWalk !== Infinity) {
    const steps: TransitStep[] = [
      { kind: 'walk', minutes: walk, instruction: `Walk ${walk} min from ${query.from.label} to ${query.to.label}` },
    ];
    return { ok: true, leg: legFrom(index, query, steps), arriveAt: directWalk };
  }
  if (blockedByServiceHours && search(query, index, false).best) return { ok: false, reason: 'outside-service-hours' };
  return { ok: false, reason: 'no-route' };
}
