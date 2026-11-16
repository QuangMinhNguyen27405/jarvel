import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  bostonLocalDateTime,
  bostonLocalToInstant,
  bostonMonthKey,
  bostonOffsetMinutes,
  firstOfNextMonth,
  formatHHMM,
  isValidDate,
  isValidHHMM,
  isValidLocalDateTime,
  listDates,
  parseHHMM,
  splitLocalDateTime,
  weekdayOf,
} from '../src/lib/time.js';

describe('HH:MM helpers', () => {
  it('parses and formats times both ways', () => {
    expect(parseHHMM('09:30')).toBe(570);
    expect(formatHHMM(570)).toBe('09:30');
    expect(parseHHMM('26:00')).toBe(1560); // past-midnight closing time
  });

  it('rejects malformed or out-of-range times', () => {
    expect(isValidHHMM('24:00')).toBe(false);
    expect(isValidHHMM('9:30')).toBe(false);
    expect(isValidHHMM('12:60')).toBe(false);
    expect(isValidHHMM(930)).toBe(false);
    expect(() => parseHHMM('ab:cd')).toThrow(RangeError);
    expect(() => formatHHMM(1440)).toThrow(RangeError);
    expect(() => formatHHMM(-1)).toThrow(RangeError);
  });
});

describe('calendar dates', () => {
  it('validates real dates only', () => {
    expect(isValidDate('2026-11-18')).toBe(true);
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('2026-11-18T10:00')).toBe(false);
    expect(isValidLocalDateTime('2026-11-18T10:00')).toBe(true);
    expect(isValidLocalDateTime('2026-11-18 10:00')).toBe(false);
    expect(splitLocalDateTime('2026-11-18T10:00')).toEqual({ date: '2026-11-18', minutes: 600 });
    expect(() => splitLocalDateTime('soon')).toThrow(RangeError);
  });

  it('lists every date and weekday across the daylight-saving change (AC4.1.5)', () => {
    // DST ends in Boston on Sunday 2026-11-01.
    expect(listDates('2026-10-31', '2026-11-02')).toEqual(['2026-10-31', '2026-11-01', '2026-11-02']);
    expect(['2026-10-31', '2026-11-01', '2026-11-02'].map(weekdayOf)).toEqual(['sat', 'sun', 'mon']);
    expect(listDates('2026-11-21', '2026-11-18')).toEqual([]);
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
  });

  it('adds months and clamps to the end of a short month', () => {
    expect(addMonths('2026-10-23', 12)).toBe('2027-10-23');
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(() => addMonths('not-a-date', 1)).toThrow(RangeError);
  });
});

describe('Boston time zone conversions', () => {
  it('converts wall-clock times to instants on both sides of the DST change (AC4.1.5)', () => {
    expect(bostonLocalToInstant('2026-10-31T12:00').toISOString()).toBe('2026-10-31T16:00:00.000Z'); // EDT
    expect(bostonLocalToInstant('2026-11-02T12:00').toISOString()).toBe('2026-11-02T17:00:00.000Z'); // EST
    expect(bostonOffsetMinutes(new Date('2026-10-31T16:00:00Z'))).toBe(-240);
    expect(bostonOffsetMinutes(new Date('2026-11-02T17:00:00Z'))).toBe(-300);
    expect(bostonLocalDateTime(new Date('2026-11-02T17:00:00Z'))).toBe('2026-11-02T12:00');
  });

  it('puts an instant in the Boston month, not the UTC month', () => {
    expect(bostonMonthKey(new Date('2026-12-01T04:59:00Z'))).toBe('2026-11'); // 23:59 Nov 30 EST
    expect(bostonMonthKey(new Date('2026-12-01T05:00:00Z'))).toBe('2026-12'); // 00:00 Dec 1 EST
    expect(bostonMonthKey(new Date('2026-11-01T03:59:00Z'))).toBe('2026-10'); // 23:59 Oct 31 EDT
    expect(bostonMonthKey(new Date('2026-11-01T04:00:00Z'))).toBe('2026-11'); // 00:00 Nov 1 EDT
  });

  it('computes the reset date of a month and rejects a bad month key', () => {
    expect(firstOfNextMonth('2026-11')).toBe('2026-12-01');
    expect(firstOfNextMonth('2026-12')).toBe('2027-01-01');
    expect(() => firstOfNextMonth('2026-1')).toThrow(RangeError);
  });
});
