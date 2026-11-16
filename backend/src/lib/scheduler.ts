// Turns the AI's ordered stops into timed days (FR3, FR3.2, FR3.3) with transit legs between every change of
// location (FR5). Any stop that would break a safety or last-train rule is moved to another position or day, or
// listed as unscheduled with a fixed reason (FR4.3, FR5.3). Wishlist entries not in the Boston data are listed as
// unscheduled (FR3.1, FR3.5). Each day carries its safety guidance and the plan carries the disclaimer (FR4.4).
// Every stop is inside its place's opening hours on that date (FR12, US7.3): a visit starts when the place is open,
// and within a day the AI's order is kept unless it would leave the traveler waiting for a place to open.
import type {
  CostBreakdown,
  DayPlan,
  Itinerary,
  ItineraryItem,
  LineId,
  Money,
  Place,
  TransitLeg,
  TripRequest,
} from '@jarvel/shared';
import type { AiSelection } from './ai.js';
import { matchWishlistEntry, type BostonData } from './data.js';
import { isClosedOn, visitWindow } from './hours.js';
import {
  airportLocation,
  indexNetwork,
  placeLocation,
  planRoute,
  pointLocation,
  type Location,
  type NetworkIndex,
  type RouteFailure,
  type RouteResult,
} from './router.js';
import { areaAtPoint, checkAreaAtTime, checkLegSafety, type SafetyContext } from './safety.js';
import { sunsetMinutes } from './sun.js';
import { formatHHMM, listDates, parseHHMM, splitLocalDateTime, weekdayOf } from './time.js';

export const UNSCHEDULED_REASONS = {
  notInData: 'not in the Boston data',
  unsafe: 'unsafe at the only possible time',
  lastTrain: 'would miss the last train',
  noFit: 'does not fit in your days',
  noRoute: 'no public transport route within your walking limit',
  duplicate: 'listed more than once in your wishlist',
  closed: 'closed on your dates',
} as const;

export type UnscheduledReason = (typeof UNSCHEDULED_REASONS)[keyof typeof UNSCHEDULED_REASONS];

export const DISCLAIMER =
  'Safety information in this plan is guidance, not a guarantee. It comes from a curated dataset and cannot ' +
  'predict events. Use your own judgement, watch your surroundings and follow local advice.';

export const SAMPLE_DATA_WARNING =
  'This plan was built from SAMPLE data that has not been hand-checked. Do not rely on it for real travel.';

/** Arriving passengers get this long at the airport; departing ones must be there this long before departure. */
export const ARRIVAL_MINUTES = 30;
export const DEPARTURE_BUFFER_MINUTES = 90;
export const CHECK_IN_MINUTES = 30;
export const COLLECT_BAGS_MINUTES = 15;

/** A stop that could start within this many minutes of arriving keeps its place in the AI's order (FR12). */
export const MAX_WAIT_FOR_OPENING_MINUTES = 30;
/** Leaving later for a place that is not open yet is accepted when it starts the visit at most this late. */
export const LATE_START_TOLERANCE_MINUTES = 15;

export class NoSafePlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoSafePlanError';
  }
}

export interface WishlistResolution {
  original: string;
  placeId?: string;
  duplicateOf?: number;
}

/** Matches each wishlist entry to a catalog place; entries for an already-listed place are marked duplicates. */
export function resolveWishlist(request: TripRequest, data: BostonData): WishlistResolution[] {
  const firstIndex = new Map<string, number>();
  return request.wishlist.map((original, index) => {
    const placeId = matchWishlistEntry(original, data)?.id;
    if (placeId === undefined) return { original };
    const earlier = firstIndex.get(placeId);
    if (earlier !== undefined) return { original, placeId, duplicateOf: earlier };
    firstIndex.set(placeId, index);
    return { original, placeId };
  });
}

/** Everything the scheduler and the validator need about the trip, computed once. */
export interface TripContext {
  request: TripRequest;
  data: BostonData;
  index: NetworkIndex;
  hotel: Location;
  airport?: Location;
  dates: string[];
  arrival: { date: string; minutes: number };
  departure: { date: string; minutes: number };
  dayStart: number;
  dayEnd: number;
  maxWalk: number;
  /** Routes already planned for this trip, so trying a stop at several positions does not plan the same leg twice. */
  routes: Map<string, RouteResult>;
}

export function tripContext(request: TripRequest, data: BostonData): TripContext {
  const maxWalk = request.preferences.maxWalkMinutes;
  const hotelPoint = { lat: request.hotel.lat, lng: request.hotel.lng };
  const arrival = splitLocalDateTime(request.arrival);
  const departure = splitLocalDateTime(request.departure);
  const airport = data.network.airport;
  return {
    request,
    data,
    index: indexNetwork(data.network),
    hotel: pointLocation('hotel', request.hotel.name, hotelPoint, data.network, maxWalk, areaAtPoint(hotelPoint, data)),
    airport: airport ? airportLocation(data.network, areaAtPoint(airport, data)) : undefined,
    dates: listDates(arrival.date, departure.date),
    arrival,
    departure,
    dayStart: parseHHMM(request.preferences.dayStart),
    dayEnd: parseHHMM(request.preferences.dayEnd),
    maxWalk,
    routes: new Map(),
  };
}

export function safetyContextFor(trip: TripContext, date: string): SafetyContext {
  return { areaById: trip.data.areaById, sunset: sunsetMinutes(date), strictness: trip.request.preferences.safety };
}

/** A timed entry before ids are assigned. */
interface Slot {
  item: Omit<ItineraryItem, 'id'>;
  chain: 'arrival' | 'departure' | 'stop';
}

interface DayState {
  cursor: number;
  location: Location;
  slots: Slot[];
}

type Step<T> = { ok: true; value: T } | { ok: false; reason: UnscheduledReason };

const MEAL_CATEGORIES = new Set(['bakery', 'coffee', 'restaurant', 'fine-dining']);
const ZERO: Money = { low: 0, high: 0 };

function failureReason(reason: RouteFailure): UnscheduledReason {
  return reason === 'outside-service-hours' ? UNSCHEDULED_REASONS.lastTrain : UNSCHEDULED_REASONS.noRoute;
}

function transitSlot(
  trip: TripContext,
  date: string,
  leg: TransitLeg,
  start: number,
  chain: Slot['chain'],
  from: Location,
  to: Location,
): Step<Slot> {
  const end = start + leg.durationMinutes;
  if (end >= 24 * 60) return { ok: false, reason: UNSCHEDULED_REASONS.noFit };
  const verdict = checkLegSafety(
    leg,
    start,
    { fromAreaId: from.areaId, toAreaId: to.areaId },
    trip.data,
    safetyContextFor(trip, date),
  );
  if (!verdict.allowed) return { ok: false, reason: UNSCHEDULED_REASONS.unsafe };
  return {
    ok: true,
    value: {
      chain,
      item: {
        kind: 'transit',
        start: formatHHMM(start),
        end: formatHHMM(end),
        title: `${leg.fromLabel} to ${leg.toLabel}`,
        // Some data instructions end in a full stop already; drop it so joining them never gives "..".
        description: leg.steps.map((step) => step.instruction.replace(/\.+$/, '')).join('. '),
        transit: leg,
        cost: { low: leg.fareUSD, high: leg.fareUSD },
        safety: { level: verdict.level, note: verdict.note },
      },
    },
  };
}

/**
 * The route between two locations leaving at `departAt`, planned once per trip. The scheduler tries the same stop
 * from the same place at the same minute many times (each position of each day), and the answer never changes.
 */
function routeBetween(trip: TripContext, date: string, from: Location, to: Location, departAt: number): RouteResult {
  const key = `${date}|${from.key}|${to.key}|${departAt}`;
  let route = trip.routes.get(key);
  if (!route) {
    route = planRoute({ from, to, departAt, date, maxWalkMinutes: trip.maxWalk }, trip.index);
    trip.routes.set(key, route);
  }
  return route;
}

/** Moves from the current location to `to`, appending the leg. Same location: nothing to add. */
function travel(trip: TripContext, date: string, state: DayState, to: Location, chain: Slot['chain']): Step<DayState> {
  if (state.location.key === to.key) return { ok: true, value: { ...state, location: to } };
  const route = routeBetween(trip, date, state.location, to, state.cursor);
  if (!route.ok) return { ok: false, reason: failureReason(route.reason) };
  const slot = transitSlot(trip, date, route.leg, state.cursor, chain, state.location, to);
  if (!slot.ok) return slot;
  return { ok: true, value: { cursor: route.arriveAt, location: to, slots: [...state.slots, slot.value] } };
}

function fixedSlot(
  kind: 'hotel' | 'airport',
  start: number,
  minutes: number,
  title: string,
  description: string,
  chain: Slot['chain'],
  location?: ItineraryItem['location'],
): Slot {
  return {
    chain,
    item: {
      kind,
      start: formatHHMM(start),
      end: formatHHMM(start + minutes),
      title,
      description,
      cost: ZERO,
      ...(location ? { location } : {}),
    },
  };
}

/** Where the trip's hotel is, for the map on hotel items. */
function hotelPoint(trip: TripContext): ItineraryItem['location'] {
  return { lat: trip.request.hotel.lat, lng: trip.request.hotel.lng };
}

/** A stop placed after `state`: the day so far with the stop added, when it starts and how long it made you wait. */
interface Visited {
  state: DayState;
  start: number;
  /** Minutes between the earliest possible arrival and the start: the time the place was not open yet. */
  idle: number;
}

/**
 * Travels to `place` and visits it inside its opening hours on `date` (FR12). When the traveler would arrive before
 * it opens, the leg is planned again to leave that much later, so the free time is spent before leaving and not at
 * a closed door. That later leg is used only when it is allowed and still starts the visit close to opening;
 * otherwise the first leg is kept and the visit waits for the place to open.
 */
function visit(
  trip: TripContext,
  date: string,
  state: DayState,
  place: Place,
  wishlistIds: Set<string>,
): Step<Visited> {
  if (isClosedOn(place, date)) return { ok: false, reason: UNSCHEDULED_REASONS.closed };
  const location = placeLocation(place, trip.data.network, trip.maxWalk);
  const direct = travel(trip, date, state, location, 'stop');
  if (!direct.ok) return direct;
  const earliest = Math.max(direct.value.cursor, trip.dayStart);
  const opening = visitWindow(place, date, earliest);
  if (opening === undefined) return { ok: false, reason: UNSCHEDULED_REASONS.noFit };
  const idle = opening - earliest;
  let moved = direct.value;
  let start = opening;
  if (idle > 0 && state.location.key !== location.key) {
    const later = travel(trip, date, { ...state, cursor: state.cursor + idle }, location, 'stop');
    const laterStart = later.ok ? visitWindow(place, date, Math.max(later.value.cursor, trip.dayStart)) : undefined;
    if (later.ok && laterStart !== undefined && laterStart <= opening + LATE_START_TOLERANCE_MINUTES) {
      moved = later.value;
      start = laterStart;
    }
  }
  const end = start + place.typicalDwellMinutes;
  if (end >= 24 * 60) return { ok: false, reason: UNSCHEDULED_REASONS.noFit };
  const verdict = checkAreaAtTime(place.safetyAreaId, start, end, safetyContextFor(trip, date));
  if (!verdict.allowed) return { ok: false, reason: UNSCHEDULED_REASONS.unsafe };
  const slot: Slot = {
    chain: 'stop',
    item: {
      kind: MEAL_CATEGORIES.has(place.category) ? 'meal' : 'visit',
      start: formatHHMM(start),
      end: formatHHMM(end),
      title: place.name,
      placeId: place.id,
      description: place.description,
      cost: place.estCostPerPerson,
      safety: { level: verdict.level, note: verdict.note },
      ...(place.reservation !== 'none' ? { bookingTip: `Reservation ${place.reservation}.` } : {}),
      isWishlist: wishlistIds.has(place.id),
      location: { lat: place.lat, lng: place.lng },
    },
  };
  return { ok: true, value: { state: { cursor: end, location, slots: [...moved.slots, slot] }, start, idle } };
}

function openDay(trip: TripContext, date: string): DayState {
  const isFirst = date === trip.arrival.date;
  if (!isFirst || !trip.airport) {
    return {
      cursor: isFirst ? Math.max(trip.dayStart, trip.arrival.minutes) : trip.dayStart,
      location: trip.hotel,
      slots: [],
    };
  }
  const land = trip.arrival.minutes;
  const arrive = fixedSlot(
    'airport',
    land,
    ARRIVAL_MINUTES,
    `Arrive at ${trip.airport.label}`,
    'Leave the plane and collect your bags.',
    'arrival',
  );
  const atAirport: DayState = { cursor: land + ARRIVAL_MINUTES, location: trip.airport, slots: [arrive] };
  const toHotel = travel(trip, date, atAirport, trip.hotel, 'arrival');
  if (!toHotel.ok)
    throw new NoSafePlanError(
      `There is no public transport route from the airport to your hotel after you land (${toHotel.reason}).`,
    );
  const checkIn = fixedSlot(
    'hotel',
    toHotel.value.cursor,
    CHECK_IN_MINUTES,
    `Check in at ${trip.hotel.label}`,
    'Check in or leave your bags at the hotel.',
    'arrival',
    hotelPoint(trip),
  );
  const ready = toHotel.value.cursor + CHECK_IN_MINUTES;
  return { cursor: Math.max(ready, trip.dayStart), location: trip.hotel, slots: [...toHotel.value.slots, checkIn] };
}

/**
 * Ends a day: back to the hotel by the back-at-hotel time; on the last day, on to the airport in time.
 * Returns the whole day's slots (everything in `state` plus the closing ones).
 */
function closeDay(trip: TripContext, date: string, state: DayState): Step<Slot[]> {
  const isLast = date === trip.departure.date;
  const home = travel(trip, date, state, trip.hotel, isLast ? 'departure' : 'stop');
  if (!home.ok) return home;
  const hasStops = state.slots.some((slot) => slot.chain === 'stop');
  if (hasStops && home.value.cursor > trip.dayEnd) return { ok: false, reason: UNSCHEDULED_REASONS.noFit };
  if (!isLast || !trip.airport) {
    if (isLast && home.value.cursor > trip.departure.minutes) return { ok: false, reason: UNSCHEDULED_REASONS.noFit };
    const marker = fixedSlot(
      'hotel',
      home.value.cursor,
      0,
      `Back at ${trip.hotel.label}`,
      'End of the day at your hotel.',
      isLast ? 'departure' : 'stop',
      hotelPoint(trip),
    );
    return { ok: true, value: [...home.value.slots, marker] };
  }
  const latestAtAirport = trip.departure.minutes - DEPARTURE_BUFFER_MINUTES;
  const bags = fixedSlot(
    'hotel',
    home.value.cursor,
    COLLECT_BAGS_MINUTES,
    `Collect your bags at ${trip.hotel.label}`,
    'Pick up your luggage before heading to the airport.',
    'departure',
    hotelPoint(trip),
  );
  const atHotel: DayState = {
    cursor: home.value.cursor + COLLECT_BAGS_MINUTES,
    location: trip.hotel,
    slots: [...home.value.slots, bags],
  };
  const toAirport = travel(trip, date, atHotel, trip.airport, 'departure');
  if (!toAirport.ok) return toAirport;
  if (toAirport.value.cursor > latestAtAirport) return { ok: false, reason: UNSCHEDULED_REASONS.noFit };
  const minutes = trip.departure.minutes - toAirport.value.cursor;
  const final = fixedSlot(
    'airport',
    toAirport.value.cursor,
    minutes,
    `At ${trip.airport.label}: check in and security`,
    'Check in, go through security and board your flight.',
    'departure',
  );
  return { ok: true, value: [...toAirport.value.slots, final] };
}

/**
 * A last day with no stops: leave the hotel at the latest time (in 5-minute steps) that still reaches the airport
 * in time, never before the end of anything already on the day (a same-day arrival).
 */
function closeAtLatestDeparture(trip: TripContext, date: string, opened: DayState): Slot[] | undefined {
  const lastSlot = opened.slots.at(-1);
  const earliest = lastSlot ? parseHHMM(lastSlot.item.end) : 0;
  for (let leave = trip.departure.minutes - DEPARTURE_BUFFER_MINUTES; leave >= earliest; leave -= 5) {
    const closed = closeDay(trip, date, { ...opened, cursor: leave });
    if (closed.ok) return closed.value;
  }
  return undefined;
}

interface DayResult {
  slots: Slot[];
  accepted: string[];
  rejected: { placeId: string; reason: UnscheduledReason }[];
}

interface Candidate extends Visited {
  placeId: string;
}

/**
 * The next stop of a day (FR12): the first remaining one, in the AI's order, that can start within
 * MAX_WAIT_FOR_OPENING_MINUTES of the earliest possible arrival and still lets the day end on time; when none can,
 * the remaining one that starts earliest (ties: the AI's order). `reasons` gets the reason of each stop that cannot
 * follow `state`. Stops after the first one that needs no long wait are not tried, so nothing is routed needlessly.
 */
function nextStop(
  trip: TripContext,
  date: string,
  state: DayState,
  remaining: string[],
  wishlistIds: Set<string>,
  reasons: Map<string, UnscheduledReason>,
): Candidate | undefined {
  let earliest: Candidate | undefined;
  for (const placeId of remaining) {
    const place = trip.data.placeById.get(placeId);
    if (!place) continue;
    const visited = visit(trip, date, state, place, wishlistIds);
    if (!visited.ok) {
      reasons.set(placeId, visited.reason);
      continue;
    }
    const closable = closeDay(trip, date, visited.value.state);
    if (!closable.ok) {
      reasons.set(placeId, closable.reason);
      continue;
    }
    const candidate = { placeId, ...visited.value };
    if (candidate.idle <= MAX_WAIT_FOR_OPENING_MINUTES) return candidate;
    if (!earliest || candidate.start < earliest.start) earliest = candidate;
  }
  return earliest;
}

/**
 * Times one day. A stop that cannot be placed at one step is tried again after each later stop, because a place
 * that was not open yet may be open by then; it is rejected, with its last reason, only when the day ends without it.
 * When every place is open on arrival this keeps the AI's order exactly.
 */
function scheduleDay(trip: TripContext, date: string, order: string[], wishlistIds: Set<string>): DayResult {
  let state = openDay(trip, date);
  const opened = state;
  const accepted: string[] = [];
  const reasons = new Map<string, UnscheduledReason>();
  let remaining = [...new Set(order)].filter((placeId) => trip.data.placeById.has(placeId));
  while (remaining.length > 0) {
    const next = nextStop(trip, date, state, remaining, wishlistIds, reasons);
    if (!next) break;
    state = next.state;
    accepted.push(next.placeId);
    remaining = remaining.filter((placeId) => placeId !== next.placeId);
  }
  const rejected = remaining.map((placeId) => ({ placeId, reason: reasons.get(placeId) ?? UNSCHEDULED_REASONS.noFit }));
  const lastDayWithoutStops = accepted.length === 0 && date === trip.departure.date && trip.airport !== undefined;
  if (lastDayWithoutStops) {
    const latest = closeAtLatestDeparture(trip, date, opened);
    if (latest) return { slots: latest, accepted, rejected };
  } else {
    const closed = closeDay(trip, date, state);
    if (closed.ok) return { slots: closed.value, accepted, rejected };
  }
  throw new NoSafePlanError(`Day ${date} cannot end at your hotel or the airport in time by public transport.`);
}

/** Tries to place `placeId` into some day at some position without losing any stop already accepted there. */
function relocate(
  trip: TripContext,
  orders: Map<string, string[]>,
  placeId: string,
  wishlistIds: Set<string>,
): boolean {
  for (const date of trip.dates) {
    const current = orders.get(date) ?? [];
    for (let position = 0; position <= current.length; position += 1) {
      const candidate = [...current.slice(0, position), placeId, ...current.slice(position)];
      const result = scheduleDay(trip, date, candidate, wishlistIds);
      if (result.rejected.length === 0) {
        // Keep the intended order, not the visited one: opening hours may reorder a day, and a later insertion
        // can make the intended order possible again.
        orders.set(date, candidate);
        return true;
      }
    }
  }
  return false;
}

function sumMoney(values: Money[]): Money {
  return values.reduce((total, value) => ({ low: total.low + value.low, high: total.high + value.high }), ZERO);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundMoney(value: Money): Money {
  return { low: round2(value.low), high: round2(value.high) };
}

function walkingMinutes(items: ItineraryItem[]): number {
  return items.reduce(
    (total, item) =>
      total + (item.transit?.steps ?? []).filter((s) => s.kind === 'walk').reduce((sum, s) => sum + s.minutes, 0),
    0,
  );
}

function dayGuidance(trip: TripContext, date: string, items: ItineraryItem[]): string[] {
  const context = safetyContextFor(trip, date);
  const strict = trip.request.preferences.safety === 'strict';
  const guidance = [
    `Sunset is at ${formatHHMM(context.sunset)}. After dark this plan keeps you out of areas with high night risk` +
      (strict ? ' and, because you chose strict safety, areas with moderate night risk.' : '.'),
  ];
  const areaIds = new Set<string>();
  let unknown = false;
  for (const item of items) {
    if (!item.placeId) continue;
    const place = trip.data.placeById.get(item.placeId);
    const area = place ? trip.data.areaById.get(place.safetyAreaId) : undefined;
    if (area) areaIds.add(area.id);
    else unknown = true;
  }
  for (const id of areaIds) {
    const area = trip.data.areaById.get(id);
    if (area) guidance.push(`${area.name}: ${area.notes}`);
  }
  if (unknown) guidance.push('Places without safety information are visited in daylight only.');
  if (trip.data.isSample) guidance.push(SAMPLE_DATA_WARNING);
  return guidance;
}

function dayTheme(trip: TripContext, date: string, items: ItineraryItem[]): string {
  const neighborhoods = [
    ...new Set(
      items.flatMap((item) => (item.placeId ? [trip.data.placeById.get(item.placeId)?.neighborhood ?? ''] : [])),
    ),
  ].filter(Boolean);
  const prefix = date === trip.arrival.date ? 'Arrival' : date === trip.departure.date ? 'Departure' : '';
  const places = neighborhoods.join(' & ');
  if (prefix && places) return `${prefix} + ${places}`;
  return prefix || places || 'Free day';
}

function buildDay(trip: TripContext, date: string, slots: Slot[]): DayPlan {
  const items: ItineraryItem[] = slots.map((slot, index) => ({
    id: `${date}-${slot.chain === 'stop' ? '' : `${slot.chain}-`}${String(index + 1).padStart(2, '0')}`,
    ...slot.item,
  }));
  const stops = items.filter((item) => item.placeId).length;
  return {
    date,
    weekday: weekdayOf(date),
    theme: dayTheme(trip, date, items),
    items,
    cost: roundMoney(sumMoney(items.map((item) => item.cost))),
    walkingMinutes: walkingMinutes(items),
    paceNote: `${trip.request.preferences.pace} pace: ${stops} stop${stops === 1 ? '' : 's'} with transit time between them.`,
    safetyGuidance: dayGuidance(trip, date, items),
  };
}

function costBreakdown(trip: TripContext, days: DayPlan[]): CostBreakdown {
  const items = days.flatMap((day) => day.items);
  const food = sumMoney(items.filter((item) => item.kind === 'meal').map((item) => item.cost));
  const attractions = sumMoney(items.filter((item) => item.kind === 'visit').map((item) => item.cost));
  const transit = sumMoney(items.filter((item) => item.kind === 'transit').map((item) => item.cost));
  const rides = items.filter((item) => (item.transit?.fareUSD ?? 0) > 0).length;
  const fares = trip.data.network.fares;
  const advice =
    rides * fares.subwaySingle > fares.weekPass && days.length > 2
      ? `You take about ${rides} paid rides; a 7-day pass ($${fares.weekPass.toFixed(2)}) costs less than single fares.`
      : `You take about ${rides} paid rides; single fares are cheaper than a pass.`;
  return {
    food: roundMoney(food),
    attractions: roundMoney(attractions),
    transit: roundMoney(transit),
    other: ZERO,
    total: roundMoney(sumMoney([food, attractions, transit])),
    transitPassAdvice: advice,
    notes: ['All amounts are estimates in US dollars per person.'],
  };
}

function transitBrief(trip: TripContext, days: DayPlan[]): string[] {
  const lines = new Set<LineId>();
  for (const step of days.flatMap((day) => day.items).flatMap((item) => item.transit?.steps ?? [])) {
    if (step.kind === 'ride' && step.line && step.line !== 'shuttle') lines.add(step.line);
  }
  const brief = [...lines].map((id) => {
    const line = trip.index.lines.get(id);
    return line ? `${line.name}: first train about ${line.firstTrain}, last train about ${line.lastTrain}.` : id;
  });
  brief.push(
    `A single subway ride costs about $${trip.data.network.fares.subwaySingle.toFixed(2)}; changing lines is free.`,
  );
  brief.push('Times come from stored timetables and do not include live delays.');
  return brief;
}

export interface ScheduleInput {
  request: TripRequest;
  data: BostonData;
  selection: AiSelection;
  modelId: string;
  generatedAt: string;
}

/** Builds the full itinerary. Throws NoSafePlanError when a day cannot be made safe at all. */
export function buildItinerary(input: ScheduleInput): Itinerary {
  const trip = tripContext(input.request, input.data);
  const wishlist = resolveWishlist(input.request, input.data);
  const wishlistIds = new Set(
    wishlist.flatMap((entry) => (entry.placeId && entry.duplicateOf === undefined ? [entry.placeId] : [])),
  );
  const orders = new Map(trip.dates.map((date) => [date, [] as string[]]));
  for (const day of input.selection.days) if (orders.has(day.date)) orders.set(day.date, [...day.placeIds]);
  const chosen = new Set([...orders.values()].flat());
  const reasons = new Map<string, UnscheduledReason>();
  for (const date of trip.dates) {
    const order = orders.get(date) ?? [];
    const result = scheduleDay(trip, date, order, wishlistIds);
    // Drop what could not be placed, but keep the AI's order for the rest: opening hours may change the order a
    // day is visited in, and the AI's order should come back whenever a later change makes it possible.
    const kept = new Set(result.accepted);
    const stillPlanned = [...new Set(order)].filter((placeId) => kept.has(placeId));
    orders.set(date, stillPlanned);
    for (const rejection of result.rejected) reasons.set(rejection.placeId, rejection.reason);
  }
  for (const id of wishlistIds) if (!chosen.has(id)) reasons.set(id, UNSCHEDULED_REASONS.noFit);
  for (const [placeId] of reasons) {
    if (!wishlistIds.has(placeId) || relocate(trip, orders, placeId, wishlistIds)) reasons.delete(placeId);
  }
  // "closed on your dates" is said only of a place closed on every trip date (AC7.3.2). One that was closed on the
  // AI's date but is open on another, and still could not be placed there, did not fit.
  for (const [placeId, reason] of reasons) {
    const place = trip.data.placeById.get(placeId);
    if (place && trip.dates.every((date) => isClosedOn(place, date))) reasons.set(placeId, UNSCHEDULED_REASONS.closed);
    else if (reason === UNSCHEDULED_REASONS.closed) reasons.set(placeId, UNSCHEDULED_REASONS.noFit);
  }
  const days = trip.dates.map((date) =>
    buildDay(trip, date, scheduleDay(trip, date, orders.get(date) ?? [], wishlistIds).slots),
  );
  const unscheduled = wishlist.flatMap((entry): Itinerary['unscheduled'] => {
    if (entry.placeId === undefined) return [{ name: entry.original, reason: UNSCHEDULED_REASONS.notInData }];
    if (entry.duplicateOf !== undefined)
      return [{ placeId: entry.placeId, name: entry.original, reason: UNSCHEDULED_REASONS.duplicate }];
    const reason = reasons.get(entry.placeId);
    return reason ? [{ placeId: entry.placeId, name: entry.original, reason }] : [];
  });
  const scheduled = days.flatMap((day) => day.items).filter((item) => item.placeId).length;
  return {
    summary:
      `${days.length}-day Boston plan with ${scheduled} scheduled stop${scheduled === 1 ? '' : 's'}` +
      (unscheduled.length > 0
        ? `; ${unscheduled.length} wishlist entr${unscheduled.length === 1 ? 'y' : 'ies'} could not be scheduled.`
        : '.'),
    days,
    costs: costBreakdown(trip, days),
    safetyBrief: [...input.data.safety.generalTips, ...(input.data.isSample ? [SAMPLE_DATA_WARNING] : [])],
    transitBrief: transitBrief(trip, days),
    unscheduled,
    criticIssues: [],
    disclaimer: input.data.isSample ? `${DISCLAIMER} ${SAMPLE_DATA_WARNING}` : DISCLAIMER,
    generatedAt: input.generatedAt,
    modelId: input.modelId,
  };
}
