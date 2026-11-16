import type { AgentName, AgentProgress, AgentStatus, LineId, Money, TransitLeg } from '@jarvel/shared';

// Pure display helpers. Dates in a plan are local Boston strings ("2026-11-18", "2026-11-18T10:00"): they are read
// part by part and formatted as UTC, so the browser's own time zone can never move a day. Anything that cannot be
// read comes back as the raw string or ''; nothing here throws.

interface LocalDate {
  year: number;
  month: number; // 1-12
  day: number;
  time?: string; // "HH:MM"
}

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/;

function parse(value: unknown): LocalDate | undefined {
  if (typeof value !== 'string') return undefined;
  const match = LOCAL_DATE.exec(value.trim());
  if (!match) return undefined;
  const [, y, m, d, hh, mm] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day)
    return undefined;
  if (hh !== undefined && mm !== undefined) {
    if (Number(hh) > 23 || Number(mm) > 59) return undefined;
    return { year, month, day, time: `${hh}:${mm}` };
  }
  return { year, month, day };
}

const utc = (date: LocalDate) => new Date(Date.UTC(date.year, date.month - 1, date.day));
const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' });
const MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });
const weekday = (date: LocalDate) => WEEKDAY.format(utc(date));
const month = (date: LocalDate) => MONTH.format(utc(date));
const raw = (value: unknown) => (typeof value === 'string' ? value : '');

export interface DayParts {
  /** "Wed" ('' when the date cannot be read) */
  weekday: string;
  /** "18" (the raw string when the date cannot be read) */
  day: string;
  /** "Wed, Nov 18" (the raw string when the date cannot be read) */
  label: string;
}

/** The parts of a day tab and its label: "Wed", "18", "Wed, Nov 18". */
export function dayParts(date: string): DayParts {
  const parsed = parse(date);
  if (!parsed) return { weekday: '', day: raw(date), label: raw(date) };
  return {
    weekday: weekday(parsed),
    day: String(parsed.day),
    label: `${weekday(parsed)}, ${month(parsed)} ${parsed.day}`,
  };
}

/** "Wed Nov 18" from a date or a date-time. */
export function shortDate(value: string): string {
  const parsed = parse(value);
  return parsed ? `${weekday(parsed)} ${month(parsed)} ${parsed.day}` : raw(value);
}

/** "Wed Nov 18, 10:00" from a date-time; "Wed Nov 18" when there is no time. */
export function dateTime(value: string): string {
  const parsed = parse(value);
  if (!parsed) return raw(value);
  const date = `${weekday(parsed)} ${month(parsed)} ${parsed.day}`;
  return parsed.time ? `${date}, ${parsed.time}` : date;
}

const sameDay = (a: LocalDate, b: LocalDate) => a.year === b.year && a.month === b.month && a.day === b.day;

/** True when both values fall on the same calendar day (or cannot be told apart). */
export function isSameDay(from: string, to: string): boolean {
  const a = parse(from);
  const b = parse(to);
  return a && b ? sameDay(a, b) : raw(from) === raw(to);
}

/** "Nov 18–21", "Nov 30–Dec 2", or "Nov 18" when both fall on the same day. */
export function dateRange(from: string, to: string): string {
  const a = parse(from);
  const b = parse(to);
  if (!a || !b) return [raw(from), raw(to)].filter(Boolean).join('–');
  if (sameDay(a, b)) return `${month(a)} ${a.day}`;
  if (a.year === b.year && a.month === b.month) return `${month(a)} ${a.day}–${b.day}`;
  return `${month(a)} ${a.day}–${month(b)} ${b.day}`;
}

/** The trip's length in calendar days, counting both ends: "4 days", "1 day". '' when it cannot be worked out. */
export function tripLength(from: string, to: string): string {
  const a = parse(from);
  const b = parse(to);
  if (!a || !b) return '';
  const days = Math.round((utc(b).getTime() - utc(a).getTime()) / 86_400_000) + 1;
  if (days < 1) return '';
  return days === 1 ? '1 day' : `${days} days`;
}

/** "$15" or "$2.40": whole dollars without decimals, anything else with two. */
export function usd(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

const amount = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

/** A per-person range: "$15–$25", "$15" when both ends are equal, '' when both are zero or missing. */
export function money(range: Partial<Money> | undefined | null): string {
  const low = amount(range?.low);
  const high = amount(range?.high);
  const a = low ?? high;
  const b = high ?? low;
  if (a === undefined || b === undefined || (a === 0 && b === 0)) return '';
  return a === b ? usd(a) : `${usd(a)}–${usd(b)}`;
}

// ---------------------------------------------------------------------------
// Transit
// ---------------------------------------------------------------------------

export type LineFamily = 'blue' | 'orange' | 'red' | 'green' | 'silver' | 'shuttle';

const FAMILY_NAME: Record<LineFamily, string> = {
  blue: 'Blue',
  orange: 'Orange',
  red: 'Red',
  green: 'Green',
  silver: 'Silver',
  shuttle: 'Shuttle',
};

/** The subway line family a line belongs to, or undefined for anything that is not a line (a walking transfer). */
export function lineFamily(line: LineId | string | undefined): LineFamily | undefined {
  if (line === 'blue' || line === 'orange' || line === 'shuttle') return line;
  if (line === 'red' || line === 'red-ashmont' || line === 'red-braintree') return 'red';
  if (line?.startsWith('green-')) return 'green';
  if (line?.startsWith('silver-')) return 'silver';
  return undefined;
}

export interface TransitSummary {
  kind: 'walk' | 'ride' | 'rideshare';
  /** "Blue Line to My hotel", "Green, then Red Line to Giulia", "Rideshare to My hotel" ('' for a walk) */
  text: string;
  /** "13 min" ('' when the leg has no usable duration) */
  minutes: string;
  /** The first line family ridden: the colour of the row's bar. */
  family?: LineFamily;
  /** The step instructions, without empty ones. */
  steps: string[];
  /** "Fare $2.40", or '' when the leg is free. */
  fare: string;
}

/** How a transit leg is shown in a day's timeline. */
export function transitSummary(leg: Partial<TransitLeg>): TransitSummary {
  const steps = Array.isArray(leg.steps) ? leg.steps : [];
  const duration = amount(leg.durationMinutes);
  const minutes = duration === undefined ? '' : `${duration} min`;
  const fareAmount = amount(leg.fareUSD);
  const fare = fareAmount !== undefined && fareAmount > 0 ? `Fare ${usd(fareAmount)}` : '';
  const instructions = steps
    .map((step) => (typeof step?.instruction === 'string' ? step.instruction.trim() : ''))
    .filter(Boolean);
  const to = typeof leg.toLabel === 'string' ? leg.toLabel : '';
  const toText = (what: string) => (to ? `${what} to ${to}` : what);
  if (leg.mode === 'rideshare') {
    return { kind: 'rideshare', text: toText('Rideshare'), minutes, steps: instructions, fare };
  }
  const rides = steps.filter((step) => step?.kind === 'ride');
  if (rides.length === 0) return { kind: 'walk', text: '', minutes, steps: instructions, fare };
  let families: LineFamily[] = [];
  for (const ride of rides) {
    const family = lineFamily(ride.line);
    if (family && !families.includes(family)) families.push(family);
  }
  if (families.length > 1) families = families.filter((family) => family !== 'shuttle');
  const names = families.map((family) => FAMILY_NAME[family]);
  let what: string;
  if (names.length === 0) what = 'Transit';
  else if (families.length === 1 && families[0] === 'shuttle') what = 'Shuttle';
  else if (names.length === 1) what = `${names[0]} Line`;
  else what = `${names.slice(0, -1).join(', ')}, then ${names.at(-1)} Line`;
  return { kind: 'ride', text: toText(what), minutes, family: families[0], steps: instructions, fare };
}

// ---------------------------------------------------------------------------
// Build progress
// ---------------------------------------------------------------------------

/** The five build steps, in the order the planner runs them. */
export const BUILD_STEPS: readonly { agent: AgentName; label: string }[] = [
  { agent: 'researcher', label: 'Stops' },
  { agent: 'scheduler', label: 'Timing' },
  { agent: 'transit', label: 'Transit' },
  { agent: 'safety', label: 'Safety check' },
  { agent: 'critic', label: 'Final check' },
];

const STATUS_WORD: Record<AgentStatus, string> = {
  done: 'done',
  running: 'working',
  pending: 'waiting',
  skipped: 'skipped',
  failed: 'stopped here',
};

const KNOWN_STATUS = new Set<string>(Object.keys(STATUS_WORD));

export interface BuildStep {
  agent: AgentName;
  label: string;
  status: AgentStatus;
  /** "Transit: working" */
  aria: string;
}

export interface BuildProgress {
  steps: BuildStep[];
  /** Index of the last step that is done, running or failed; -1 when none has started. */
  reached: number;
}

/** The five build steps with their status from a plan's progress (a step with no entry is waiting). */
export function buildProgress(progress: readonly Partial<AgentProgress>[] | undefined | null): BuildProgress {
  const entries = Array.isArray(progress) ? progress : [];
  const steps = BUILD_STEPS.map(({ agent, label }): BuildStep => {
    const entry = entries.filter((item) => item?.agent === agent).at(-1);
    const status: AgentStatus =
      typeof entry?.status === 'string' && KNOWN_STATUS.has(entry.status) ? entry.status : 'pending';
    return { agent, label, status, aria: `${label}: ${STATUS_WORD[status]}` };
  });
  let reached = -1;
  steps.forEach((step, index) => {
    if (step.status === 'done' || step.status === 'running' || step.status === 'failed') reached = index;
  });
  return { steps, reached };
}
