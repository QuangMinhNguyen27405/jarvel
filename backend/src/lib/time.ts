// Boston-local date and time helpers (FR3.4). Every date is "YYYY-MM-DD" and every time "HH:MM" (24 h),
// local to America/New_York. Calendar arithmetic is done on plain dates, so a daylight-saving change never
// shifts a wall-clock time; only conversions to and from real instants consult the time zone.
import { BOSTON_TIME_ZONE, type DayKey } from '@jarvel/shared';

const HHMM_PATTERN = /^(\d{2}):(\d{2})$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATE_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;
const MINUTES_PER_DAY = 24 * 60;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const WEEKDAYS: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** True when `value` is "HH:MM" with minutes 00-59 and hours 00-`maxHour` (29 allows past-midnight closing times). */
export function isValidHHMM(value: unknown, maxHour = 23): value is string {
  if (typeof value !== 'string') return false;
  const match = HHMM_PATTERN.exec(value);
  if (!match) return false;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= maxHour && minutes <= 59;
}

/** "HH:MM" -> minutes after midnight. Accepts hours up to 29 for past-midnight values. */
export function parseHHMM(value: string): number {
  if (!isValidHHMM(value, 29)) throw new RangeError(`Not a valid HH:MM time: ${JSON.stringify(value)}`);
  const [hours, minutes] = value.split(':').map(Number) as [number, number];
  return hours * 60 + minutes;
}

/** Minutes after midnight -> "HH:MM". Values of a day or more are refused rather than wrapped silently. */
export function formatHHMM(totalMinutes: number): string {
  if (!Number.isInteger(totalMinutes) || totalMinutes < 0 || totalMinutes >= MINUTES_PER_DAY) {
    throw new RangeError(`Minutes out of range for one day: ${totalMinutes}`);
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** True for a real calendar date written "YYYY-MM-DD" (rejects 2026-02-30). */
export function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/** True for "YYYY-MM-DDTHH:MM" with a real date and a valid time. */
export function isValidLocalDateTime(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = LOCAL_DATE_TIME_PATTERN.exec(value);
  return match !== null && isValidDate(match[1]) && isValidHHMM(match[2]);
}

/** Splits "YYYY-MM-DDTHH:MM" into its date and minutes after midnight. */
export function splitLocalDateTime(value: string): { date: string; minutes: number } {
  if (!isValidLocalDateTime(value)) throw new RangeError(`Not a valid local date-time: ${JSON.stringify(value)}`);
  const [date, time] = value.split('T') as [string, string];
  return { date, minutes: parseHHMM(time) };
}

function dateToUtcMs(date: string): number {
  if (!isValidDate(date)) throw new RangeError(`Not a valid date: ${JSON.stringify(date)}`);
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day);
}

function utcMsToDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Calendar date plus `days` (may be negative). */
export function addDays(date: string, days: number): string {
  return utcMsToDate(dateToUtcMs(date) + days * MS_PER_DAY);
}

/** Calendar date plus `months`, clamped to the last day of the target month (Jan 31 + 1 month = Feb 28). */
export function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  if (!isValidDate(date)) throw new RangeError(`Not a valid date: ${JSON.stringify(date)}`);
  const targetMonthIndex = month - 1 + months;
  const lastDay = new Date(Date.UTC(year, targetMonthIndex + 1, 0)).getUTCDate();
  return utcMsToDate(Date.UTC(year, targetMonthIndex, Math.min(day, lastDay)));
}

/** Every calendar date from `from` to `to`, both included. Empty when `to` is before `from`. */
export function listDates(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let ms = dateToUtcMs(from); ms <= dateToUtcMs(to); ms += MS_PER_DAY) dates.push(utcMsToDate(ms));
  return dates;
}

/** Weekday key of a calendar date. */
export function weekdayOf(date: string): DayKey {
  return WEEKDAYS[new Date(dateToUtcMs(date)).getUTCDay()] as DayKey;
}

const bostonFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BOSTON_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

interface BostonParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function bostonParts(instant: Date): BostonParts {
  const parts: Record<string, number> = {};
  for (const part of bostonFormatter.formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year ?? 0,
    month: parts.month ?? 0,
    day: parts.day ?? 0,
    hour: (parts.hour ?? 0) % 24,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

/** Boston local date-time of an instant, as "YYYY-MM-DDTHH:MM". */
export function bostonLocalDateTime(instant: Date): string {
  const p = bostonParts(instant);
  const date = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  return `${date}T${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** Boston local calendar date of an instant. */
export function bostonDate(instant: Date): string {
  return bostonLocalDateTime(instant).slice(0, 10);
}

/** Boston's offset from UTC at an instant, in minutes (-240 in summer, -300 in winter). */
export function bostonOffsetMinutes(instant: Date): number {
  const p = bostonParts(instant);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const wholeSeconds = Math.floor(instant.getTime() / 1000) * 1000;
  return Math.round((asUtc - wholeSeconds) / 60000);
}

/** The real instant of a Boston wall-clock time "YYYY-MM-DDTHH:MM", correct on both sides of a DST change. */
export function bostonLocalToInstant(localDateTime: string): Date {
  const { date, minutes } = splitLocalDateTime(localDateTime);
  const guess = dateToUtcMs(date) + minutes * 60000;
  const firstOffset = bostonOffsetMinutes(new Date(guess));
  let instant = guess - firstOffset * 60000;
  const secondOffset = bostonOffsetMinutes(new Date(instant));
  if (secondOffset !== firstOffset) instant = guess - secondOffset * 60000;
  return new Date(instant);
}

/** The Boston calendar month of an instant, "YYYY-MM" (FR6: the count resets at Boston midnight on the 1st). */
export function bostonMonthKey(instant: Date): string {
  return bostonDate(instant).slice(0, 7);
}

/** The date the count of month `monthKey` ("YYYY-MM") resets: the 1st of the next month, "YYYY-MM-DD". */
export function firstOfNextMonth(monthKey: string): string {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) throw new RangeError(`Not a month key: ${JSON.stringify(monthKey)}`);
  return addMonths(`${monthKey}-01`, 1);
}
