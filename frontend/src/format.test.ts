import type { TransitLeg, TransitStep } from '@jarvel/shared';
import { describe, expect, it } from 'vitest';
import {
  buildProgress,
  dateRange,
  dateTime,
  dayParts,
  isSameDay,
  lineFamily,
  money,
  shortDate,
  transitSummary,
  tripLength,
  usd,
} from './format.js';

describe('dates', () => {
  it('names the day of a local Boston date', () => {
    expect(dayParts('2026-11-18')).toEqual({ weekday: 'Wed', day: '18', label: 'Wed, Nov 18' });
    expect(dayParts('2026-11-21')).toEqual({ weekday: 'Sat', day: '21', label: 'Sat, Nov 21' });
    expect(dayParts('2026-12-01')).toEqual({ weekday: 'Tue', day: '1', label: 'Tue, Dec 1' });
  });

  it('reads the date part of a date-time and never moves it, whatever the hour', () => {
    // 23:30 and 00:15 are the hours a time-zone shift would push into the next or previous day.
    expect(shortDate('2026-11-18T23:30')).toBe('Wed Nov 18');
    expect(shortDate('2026-11-19T00:15')).toBe('Thu Nov 19');
    expect(dateTime('2026-11-18T10:00')).toBe('Wed Nov 18, 10:00');
    expect(dateTime('2026-11-21T15:00')).toBe('Sat Nov 21, 15:00');
    expect(dateTime('2026-11-21')).toBe('Sat Nov 21');
  });

  it('gives back the raw string, or nothing, for a date it cannot read', () => {
    expect(dayParts('soon')).toEqual({ weekday: '', day: 'soon', label: 'soon' });
    expect(dayParts('2026-02-30')).toEqual({ weekday: '', day: '2026-02-30', label: '2026-02-30' });
    expect(shortDate('not a date')).toBe('not a date');
    expect(dateTime('2026-11-18T25:00')).toBe('2026-11-18T25:00');
    expect(dateTime(undefined as unknown as string)).toBe('');
    expect(tripLength('2026-11-18', 'later')).toBe('');
  });

  it('writes a short range within a month, across a month, and for a single day', () => {
    expect(dateRange('2026-11-18T10:00', '2026-11-21T15:00')).toBe('Nov 18–21');
    expect(dateRange('2026-11-30', '2026-12-02')).toBe('Nov 30–Dec 2');
    expect(dateRange('2026-12-30T09:00', '2027-01-02T09:00')).toBe('Dec 30–Jan 2');
    expect(dateRange('2026-11-18T09:00', '2026-11-18T20:00')).toBe('Nov 18');
    expect(dateRange('2026-11-18', 'oops')).toBe('2026-11-18–oops');
  });

  it('counts the trip in calendar days, both ends included', () => {
    expect(tripLength('2026-11-18T10:00', '2026-11-21T15:00')).toBe('4 days');
    expect(tripLength('2026-11-18T09:00', '2026-11-18T20:00')).toBe('1 day');
    expect(tripLength('2026-11-30T22:00', '2026-12-01T06:00')).toBe('2 days');
    expect(tripLength('2026-11-21', '2026-11-18')).toBe('');
  });

  it('tells whether two date-times fall on the same day', () => {
    expect(isSameDay('2026-11-18T09:00', '2026-11-18T20:00')).toBe(true);
    expect(isSameDay('2026-11-18T23:00', '2026-11-19T01:00')).toBe(false);
  });
});

describe('money', () => {
  it('writes a per-person range, once when both ends match', () => {
    expect(money({ low: 15, high: 25 })).toBe('$15–$25');
    expect(money({ low: 2.4, high: 2.4 })).toBe('$2.40');
    expect(money({ low: 0, high: 10 })).toBe('$0–$10');
    expect(money({ low: 178, high: 302.5 })).toBe('$178–$302.50');
  });

  it('is empty when there is nothing to pay or nothing to read', () => {
    expect(money({ low: 0, high: 0 })).toBe('');
    expect(money(undefined)).toBe('');
    expect(money({})).toBe('');
    expect(money({ low: Number.NaN, high: Number.NaN })).toBe('');
    expect(money({ high: 12 })).toBe('$12');
  });

  it('writes whole dollars without decimals and anything else with two', () => {
    expect(usd(15)).toBe('$15');
    expect(usd(2.4)).toBe('$2.40');
    expect(usd(0.5)).toBe('$0.50');
  });
});

describe('transit summary', () => {
  const ride = (line: TransitStep['line'], instruction = ''): TransitStep => ({
    kind: 'ride',
    line,
    minutes: 5,
    instruction,
  });
  const walk = (instruction: string): TransitStep => ({ kind: 'walk', minutes: 4, instruction });
  const leg = (steps: TransitStep[], extra: Partial<TransitLeg> = {}): TransitLeg => ({
    mode: 'subway',
    fromLabel: 'My hotel',
    toLabel: 'Giulia',
    steps,
    durationMinutes: 24,
    fareUSD: 2.4,
    ...extra,
  });

  it('names one line, with the leg minutes, the steps and the fare', () => {
    const summary = transitSummary(
      leg([
        walk('Walk 2 min from My hotel to State station'),
        ride('blue', 'Ride the Blue Line toward Wonderland'),
        walk(''),
      ]),
    );
    expect(summary).toEqual({
      kind: 'ride',
      text: 'Blue Line to Giulia',
      minutes: '24 min',
      family: 'blue',
      steps: ['Walk 2 min from My hotel to State station', 'Ride the Blue Line toward Wonderland'],
      fare: 'Fare $2.40',
    });
  });

  it('names two lines in riding order, and a branch only once', () => {
    const summary = transitSummary(leg([ride('green-trunk'), ride('green-b'), ride('red-ashmont'), ride('red')]));
    expect(summary.text).toBe('Green, then Red Line to Giulia');
    expect(summary.family).toBe('green');
  });

  it('leaves out the airport shuttle when a line is ridden too', () => {
    const summary = transitSummary(leg([ride('shuttle'), ride('blue')], { toLabel: 'My hotel' }));
    expect(summary.text).toBe('Blue Line to My hotel');
    expect(summary.family).toBe('blue');
  });

  it('names the shuttle when it is the only ride', () => {
    const summary = transitSummary(leg([ride('shuttle')], { mode: 'shuttle', toLabel: 'Logan Airport', fareUSD: 0 }));
    expect(summary).toMatchObject({ kind: 'ride', text: 'Shuttle to Logan Airport', family: 'shuttle', fare: '' });
  });

  it('shows a leg without a ride as a walk', () => {
    const summary = transitSummary(
      leg([walk('Walk 13 min from My hotel to Zhi Wei Cafe')], { mode: 'walk', durationMinutes: 13, fareUSD: 0 }),
    );
    expect(summary).toMatchObject({ kind: 'walk', text: '', minutes: '13 min', fare: '' });
  });

  it('shows a rideshare as a rideshare, whatever its steps', () => {
    const summary = transitSummary(leg([ride('red')], { mode: 'rideshare', toLabel: 'My hotel', fareUSD: 0 }));
    expect(summary).toMatchObject({ kind: 'rideshare', text: 'Rideshare to My hotel', fare: '' });
  });

  it('does not break on a leg that is missing its parts', () => {
    expect(transitSummary({})).toEqual({ kind: 'walk', text: '', minutes: '', steps: [], fare: '' });
    expect(transitSummary(leg([ride('walk-transfer')])).text).toBe('Transit to Giulia');
  });

  it('maps every line to its family', () => {
    expect(
      ['blue', 'orange', 'red', 'red-braintree', 'green-e', 'silver-sl1', 'shuttle', 'walk-transfer'].map(lineFamily),
    ).toEqual(['blue', 'orange', 'red', 'red', 'green', 'silver', 'shuttle', undefined]);
  });
});

describe('build progress', () => {
  it('lists the five steps in order and waits on every step a plan has not reported', () => {
    const { steps, reached } = buildProgress(undefined);
    expect(steps.map((step) => step.label)).toEqual(['Stops', 'Timing', 'Transit', 'Safety check', 'Final check']);
    expect(steps.every((step) => step.status === 'pending')).toBe(true);
    expect(reached).toBe(-1);
  });

  it('takes each step from the agent of the same name and runs the line to the last started step', () => {
    const { steps, reached } = buildProgress([
      { agent: 'researcher', status: 'done' },
      { agent: 'scheduler', status: 'done' },
      { agent: 'transit', status: 'running' },
      { agent: 'budget', status: 'done' },
    ]);
    expect(steps.map((step) => step.aria)).toEqual([
      'Stops: done',
      'Timing: done',
      'Transit: working',
      'Safety check: waiting',
      'Final check: waiting',
    ]);
    expect(reached).toBe(2);
  });

  it('marks where a failed plan stopped, and what it skipped', () => {
    const { steps, reached } = buildProgress([
      { agent: 'researcher', status: 'done' },
      { agent: 'scheduler', status: 'done' },
      { agent: 'transit', status: 'done' },
      { agent: 'safety', status: 'failed' },
      { agent: 'critic', status: 'skipped' },
    ]);
    expect(steps.map((step) => step.status)).toEqual(['done', 'done', 'done', 'failed', 'skipped']);
    expect(steps[3]!.aria).toBe('Safety check: stopped here');
    expect(reached).toBe(3);
  });
});
