// The final fixed-rule check of a finished plan (FR4.3, US4.4). It never trusts the scheduler or the AI: it
// recomputes every rule from the itinerary and the Boston data. Any violation means the plan is not SUCCEEDED.
import type { ItineraryItem, Itinerary, LineId, TransitLeg, TripRequest } from '@jarvel/shared';
import type { BostonData } from './data.js';
import { isOpenFor } from './hours.js';
import { serviceWindow } from './router.js';
import { resolveWishlist, tripContext, type TripContext } from './scheduler.js';
import { isValidHHMM, parseHHMM, weekdayOf } from './time.js';

export type ViolationRule =
  | 'day-count'
  | 'bad-time'
  | 'overlap'
  | 'out-of-window'
  | 'opening-hours'
  | 'service-hours'
  | 'walk-limit'
  | 'leg-time'
  | 'missing-leg'
  | 'unknown-place'
  | 'duplicate-place'
  | 'wishlist';

export interface Violation {
  rule: ViolationRule;
  date?: string;
  itemId?: string;
  message: string;
}

const isChainItem = (item: ItineraryItem): boolean => /-(arrival|departure)-/.test(item.id);

function locationKey(item: ItineraryItem): string | undefined {
  if (item.placeId) return item.placeId;
  if (item.kind === 'hotel' || item.kind === 'airport') return item.kind;
  return undefined;
}

/** Start and end minute of each step of a leg that starts at `start`. */
function stepWindows(leg: TransitLeg, start: number): { index: number; start: number; end: number }[] {
  let cursor = start;
  return leg.steps.map((step, index) => {
    const window = { index, start: cursor, end: cursor + step.minutes };
    cursor += step.minutes;
    return window;
  });
}

function checkTimes(date: string, items: ItineraryItem[], trip: TripContext, out: Violation[]): boolean {
  let valid = true;
  for (const item of items) {
    if (!isValidHHMM(item.start) || !isValidHHMM(item.end) || item.start > item.end) {
      out.push({
        rule: 'bad-time',
        date,
        itemId: item.id,
        message: `${item.title} has invalid times ${item.start}-${item.end}`,
      });
      valid = false;
    }
  }
  if (!valid) return false;
  items.forEach((item, index) => {
    const previous = items[index - 1];
    if (previous && item.start < previous.end) {
      out.push({
        rule: 'overlap',
        date,
        itemId: item.id,
        message: `${item.title} starts before ${previous.title} ends`,
      });
    }
    const start = parseHHMM(item.start);
    const end = parseHHMM(item.end);
    if (date === trip.arrival.date && start < trip.arrival.minutes) {
      out.push({ rule: 'out-of-window', date, itemId: item.id, message: `${item.title} starts before arrival` });
    }
    if (date === trip.departure.date && end > trip.departure.minutes) {
      out.push({ rule: 'out-of-window', date, itemId: item.id, message: `${item.title} ends after departure` });
    }
    if (!isChainItem(item) && (start < trip.dayStart || end > trip.dayEnd)) {
      out.push({
        rule: 'out-of-window',
        date,
        itemId: item.id,
        message: `${item.title} is outside your day (${trip.request.preferences.dayStart}-${trip.request.preferences.dayEnd})`,
      });
    }
  });
  const last = items.at(-1);
  const hasStops = items.some((item) => !isChainItem(item) && item.placeId);
  if (date !== trip.departure.date && hasStops && (last?.kind !== 'hotel' || parseHHMM(last.start) > trip.dayEnd)) {
    out.push({
      rule: 'out-of-window',
      date,
      message: 'The day does not end back at the hotel by the back-at-hotel time',
    });
  }
  return true;
}

function checkLeg(date: string, item: ItineraryItem, trip: TripContext, out: Violation[]): void {
  const leg = item.transit;
  if (!leg) {
    out.push({ rule: 'missing-leg', date, itemId: item.id, message: `${item.title} has no route` });
    return;
  }
  const start = parseHHMM(item.start);
  const stepTotal = leg.steps.reduce((sum, step) => sum + step.minutes, 0);
  if (stepTotal !== leg.durationMinutes || parseHHMM(item.end) - start !== leg.durationMinutes) {
    out.push({ rule: 'leg-time', date, itemId: item.id, message: `${item.title} times do not add up` });
  }
  const day = weekdayOf(date);
  for (const window of stepWindows(leg, start)) {
    const step = leg.steps[window.index];
    if (!step) continue;
    if (step.kind === 'walk' && step.minutes > trip.maxWalk) {
      out.push({
        rule: 'walk-limit',
        date,
        itemId: item.id,
        message: `A ${step.minutes}-minute walk is over your ${trip.maxWalk}-minute limit`,
      });
    }
    if (step.kind === 'ride' && step.line && step.line !== 'shuttle') {
      const line = trip.index.lines.get(step.line as LineId);
      const service = line ? serviceWindow(line, day) : undefined;
      if (!service || window.start < service.first || window.start > service.last) {
        out.push({
          rule: 'service-hours',
          date,
          itemId: item.id,
          message: `A ride on ${step.line} departs outside its service hours`,
        });
      }
    }
  }
}

function checkDayItems(
  date: string,
  items: ItineraryItem[],
  trip: TripContext,
  seen: Set<string>,
  out: Violation[],
): void {
  let previousLocated: ItineraryItem | undefined;
  let legSincePrevious = false;
  items.forEach((item) => {
    if (item.kind === 'transit') {
      checkLeg(date, item, trip, out);
      legSincePrevious = true;
      return;
    }
    if (item.placeId) {
      const place = trip.data.placeById.get(item.placeId);
      if (!place) {
        out.push({
          rule: 'unknown-place',
          date,
          itemId: item.id,
          message: `${item.placeId} is not in the Boston data`,
        });
      } else {
        if (seen.has(place.id))
          out.push({ rule: 'duplicate-place', date, itemId: item.id, message: `${place.name} is scheduled twice` });
        seen.add(place.id);
        const start = parseHHMM(item.start);
        const end = parseHHMM(item.end);
        // FR12: the whole stop must be inside one opening period of the place on this date.
        if (!isOpenFor(place, date, start, end)) {
          out.push({
            rule: 'opening-hours',
            date,
            itemId: item.id,
            message: `${place.name} is not open for all of ${item.start}-${item.end} on ${date}`,
          });
        }
      }
    }
    const key = locationKey(item);
    if (key !== undefined) {
      const previousKey = previousLocated ? locationKey(previousLocated) : undefined;
      if (previousKey !== undefined && previousKey !== key && !legSincePrevious) {
        out.push({
          rule: 'missing-leg',
          date,
          itemId: item.id,
          message: `No route from ${previousLocated?.title} to ${item.title}`,
        });
      }
      previousLocated = item;
      legSincePrevious = false;
    }
  });
}

function checkWishlist(itinerary: Itinerary, request: TripRequest, data: BostonData, out: Violation[]): void {
  const scheduled = new Set(
    itinerary.days.flatMap((day) => day.items.flatMap((item) => (item.placeId ? [item.placeId] : []))),
  );
  resolveWishlist(request, data).forEach((entry) => {
    const listed = itinerary.unscheduled.filter((u) => u.name === entry.original && u.reason.trim() !== '').length;
    const inTimeline =
      entry.placeId !== undefined && entry.duplicateOf === undefined && scheduled.has(entry.placeId) ? 1 : 0;
    if (listed + inTimeline !== 1) {
      out.push({
        rule: 'wishlist',
        message: `Wishlist entry "${entry.original}" appears ${listed + inTimeline} times instead of once`,
      });
    }
  });
}

/** Every rule violation in a finished plan. An empty list means the plan may be SUCCEEDED. */
export function validateItinerary(itinerary: Itinerary, request: TripRequest, data: BostonData): Violation[] {
  const trip = tripContext(request, data);
  const violations: Violation[] = [];
  const dates = itinerary.days.map((day) => day.date);
  if (dates.join(',') !== trip.dates.join(',')) {
    violations.push({
      rule: 'day-count',
      message: `Expected days ${trip.dates.join(', ')}, got ${dates.join(', ') || 'none'}`,
    });
  }
  const seen = new Set<string>();
  for (const day of itinerary.days) {
    if (checkTimes(day.date, day.items, trip, violations)) checkDayItems(day.date, day.items, trip, seen, violations);
  }
  checkWishlist(itinerary, request, data, violations);
  return violations;
}
