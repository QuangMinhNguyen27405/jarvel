// Hour-by-hour safety rules (FR4, FR4.1, FR4.2, FR4.5). An item occupying [start, end] minutes in an area is
// refused when it ends after the area's avoid-after time; after that date's Boston sunset it is refused in an
// area with elevated night risk, in a moderate one under strict safety, and anywhere without safety information.
// The same functions are used to build the plan and to check the finished plan (validator.ts).
import {
  UNKNOWN_SAFETY_AREA_ID,
  type RiskLevel,
  type SafetyArea,
  type SafetyStrictness,
  type TransitLeg,
} from '@jarvel/shared';
import type { BostonData } from './data.js';
import { haversineKm, type Point } from './geo.js';
import { formatHHMM, parseHHMM } from './time.js';

export type SafetyRule = 'avoid-after' | 'elevated-after-dark' | 'moderate-after-dark-strict' | 'unknown-after-dark';

export interface SafetyContext {
  areaById: ReadonlyMap<string, SafetyArea>;
  sunset: number; // minutes after midnight, Boston local, on the plan date
  strictness: SafetyStrictness;
}

export type SafetyVerdict =
  | { allowed: true; level: RiskLevel; note: string; known: boolean }
  | { allowed: false; rule: SafetyRule; message: string };

export const UNKNOWN_AREA_NOTE = 'No safety information for this area, so it is only visited in daylight.';

/** The safety area containing a point (the nearest one whose radius covers it), if any. */
export function areaAtPoint(point: Point, data: BostonData): string | undefined {
  let best: { id: string; km: number } | undefined;
  for (const area of data.safety.areas) {
    const km = haversineKm(point, area.center);
    if (km <= area.radiusKm && (!best || km < best.km)) best = { id: area.id, km };
  }
  return best?.id;
}

/** The safety area of a station, or undefined when no area covers it. */
export function stationAreaId(stationId: string, data: BostonData): string | undefined {
  const station = data.stationById.get(stationId);
  return station ? areaAtPoint(station, data) : undefined;
}

/** Applies the rules to one interval in one area. */
export function checkAreaAtTime(
  areaId: string | undefined,
  start: number,
  end: number,
  context: SafetyContext,
): SafetyVerdict {
  const afterDark = end > context.sunset;
  const area = areaId && areaId !== UNKNOWN_SAFETY_AREA_ID ? context.areaById.get(areaId) : undefined;
  const window = `${formatClock(start)}-${formatClock(end)}`;
  if (!area) {
    if (afterDark) {
      return {
        allowed: false,
        rule: 'unknown-after-dark',
        message: `${window} is after sunset (${formatClock(context.sunset)}) in a place with no safety information`,
      };
    }
    return { allowed: true, level: 'moderate', note: UNKNOWN_AREA_NOTE, known: false };
  }
  if (area.avoidAfter !== undefined && end > parseHHMM(area.avoidAfter)) {
    return { allowed: false, rule: 'avoid-after', message: `${window} is after ${area.avoidAfter} in ${area.name}` };
  }
  if (afterDark && area.nightRisk === 'elevated') {
    return {
      allowed: false,
      rule: 'elevated-after-dark',
      message: `${window} is after sunset in ${area.name} (high night risk)`,
    };
  }
  if (afterDark && area.nightRisk === 'moderate' && context.strictness === 'strict') {
    return {
      allowed: false,
      rule: 'moderate-after-dark-strict',
      message: `${window} is after sunset in ${area.name} (moderate night risk, strict safety)`,
    };
  }
  return { allowed: true, level: afterDark ? area.nightRisk : area.dayRisk, note: area.notes, known: true };
}

function formatClock(minutes: number): string {
  return formatHHMM(Math.min(Math.max(minutes, 0), 24 * 60 - 1));
}

export interface StepWindow {
  index: number;
  start: number;
  end: number;
}

/** Start and end minute of each step of a leg that starts at `start`. */
export function stepWindows(leg: TransitLeg, start: number): StepWindow[] {
  let cursor = start;
  return leg.steps.map((step, index) => {
    const window = { index, start: cursor, end: cursor + step.minutes };
    cursor += step.minutes;
    return window;
  });
}

const RISK_ORDER: RiskLevel[] = ['low', 'moderate', 'elevated'];

/**
 * Checks every walk, wait and transfer of a leg (rides are inside a vehicle). A walk touches the station at one
 * end and the origin or destination area at the other; a direct walk touches both locations.
 */
export function checkLegSafety(
  leg: TransitLeg,
  start: number,
  ends: { fromAreaId?: string; toAreaId?: string },
  data: BostonData,
  context: SafetyContext,
): SafetyVerdict {
  let worst: RiskLevel = 'low';
  let unknown = false;
  const windows = stepWindows(leg, start);
  for (const window of windows) {
    const step = leg.steps[window.index];
    if (!step || step.kind === 'ride') continue;
    const areas: (string | undefined)[] = [];
    if (step.kind === 'walk') {
      if (step.toStationId) areas.push(ends.fromAreaId, stationAreaId(step.toStationId, data));
      else if (step.fromStationId) areas.push(stationAreaId(step.fromStationId, data), ends.toAreaId);
      else areas.push(ends.fromAreaId, ends.toAreaId);
    } else {
      areas.push(stationAreaId(step.fromStationId ?? step.toStationId ?? '', data));
    }
    for (const areaId of areas) {
      const verdict = checkAreaAtTime(areaId, window.start, window.end, context);
      if (!verdict.allowed) return verdict;
      if (!verdict.known) unknown = true;
      if (RISK_ORDER.indexOf(verdict.level) > RISK_ORDER.indexOf(worst)) worst = verdict.level;
    }
  }
  const note = unknown
    ? `Walks and station waits checked; part of this route has no safety information and is in daylight.`
    : `Walks and station waits checked against the safety data.`;
  return { allowed: true, level: worst, note, known: !unknown };
}
