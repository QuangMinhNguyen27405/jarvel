// Opening hours of a place on one date (FR12, US7.3). Pure functions over a place and a date; times are minutes
// after midnight, Boston local. The scheduler uses them to place a visit and the validator to recheck it.
//   - A weekday that is missing from `hours` means the hours are unknown: nothing is limited on that day.
//   - An empty list means the place is closed all that day.
//   - A closing time past midnight ("26:00") counts up to 24:00 on that date, because no plan item crosses midnight.
import type { Place } from '@jarvel/shared';
import { parseHHMM, weekdayOf } from './time.js';

const END_OF_DAY = 24 * 60;

export interface OpenRange {
  open: number;
  close: number;
}

type PlaceHours = Pick<Place, 'hours'>;
type PlaceVisit = Pick<Place, 'hours' | 'typicalDwellMinutes'>;

/**
 * The periods a place is open on `date`, earliest first, or undefined when its hours for that weekday are unknown.
 * Ranges that touch or overlap are joined, since the place is open without a break across them.
 */
export function openRanges(place: PlaceHours, date: string): OpenRange[] | undefined {
  const listed = place.hours[weekdayOf(date)];
  if (listed === undefined) return undefined;
  const ranges = listed
    .map(([open, close]) => ({ open: parseHHMM(open), close: Math.min(parseHHMM(close), END_OF_DAY) }))
    .filter((range) => range.open < range.close)
    .sort((a, b) => a.open - b.open);
  const joined: OpenRange[] = [];
  for (const range of ranges) {
    const last = joined.at(-1);
    if (last && range.open <= last.close) last.close = Math.max(last.close, range.close);
    else joined.push({ ...range });
  }
  return joined;
}

/** True when the place is known to be closed for the whole of `date`. Unknown hours are not "closed". */
export function isClosedOn(place: PlaceHours, date: string): boolean {
  return openRanges(place, date)?.length === 0;
}

/**
 * The earliest minute at or after `earliestStart` at which a whole visit (`typicalDwellMinutes`) fits inside one
 * opening period of `date`, or undefined when there is none. With unknown hours the visit can start at once.
 */
export function visitWindow(place: PlaceVisit, date: string, earliestStart: number): number | undefined {
  const ranges = openRanges(place, date);
  if (ranges === undefined) return earliestStart;
  for (const range of ranges) {
    const start = Math.max(earliestStart, range.open);
    if (start + place.typicalDwellMinutes <= range.close) return start;
  }
  return undefined;
}

/** True when `[start, end]` lies inside one opening period of `date`, or the hours for that weekday are unknown. */
export function isOpenFor(place: PlaceHours, date: string, start: number, end: number): boolean {
  const ranges = openRanges(place, date);
  if (ranges === undefined) return true;
  return ranges.some((range) => range.open <= start && end <= range.close);
}
