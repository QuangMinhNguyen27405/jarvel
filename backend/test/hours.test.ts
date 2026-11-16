import type { DayKey } from '@jarvel/shared';
import { describe, expect, it } from 'vitest';
import { loadBostonData } from '../src/lib/data.js';
import { isClosedOn, isOpenFor, openRanges, visitWindow } from '../src/lib/hours.js';
import { parseHHMM } from '../src/lib/time.js';

const WEDNESDAY = '2026-11-18';
const SUNDAY = '2026-11-22';
const at = (hhmm: string) => parseHHMM(hhmm);

/** A made-up place that stays `dwell` minutes, with the given hours. */
function place(hours: Partial<Record<DayKey, [string, string][]>>, dwell = 60) {
  return { hours, typicalDwellMinutes: dwell };
}

describe('visitWindow (FR12, US7.3)', () => {
  const cafe = place({ wed: [['11:00', '15:00']] });

  it('starts a visit at opening when the traveler is there before the place opens', () => {
    expect(visitWindow(cafe, WEDNESDAY, at('09:20'))).toBe(at('11:00'));
  });

  it('starts at once when the place is open and the whole visit fits', () => {
    expect(visitWindow(cafe, WEDNESDAY, at('12:10'))).toBe(at('12:10'));
    expect(visitWindow(cafe, WEDNESDAY, at('14:00'))).toBe(at('14:00')); // ends exactly at closing
  });

  it('finds no start when the visit cannot be finished before closing', () => {
    expect(visitWindow(cafe, WEDNESDAY, at('14:01'))).toBeUndefined();
    expect(visitWindow(cafe, WEDNESDAY, at('16:00'))).toBeUndefined();
    expect(visitWindow(place({ wed: [['11:00', '11:30']] }), WEDNESDAY, at('09:00'))).toBeUndefined(); // never fits
  });

  it('finds no start on a day the place is closed', () => {
    const closedSunday = place({ wed: [['11:00', '15:00']], sun: [] });
    expect(visitWindow(closedSunday, SUNDAY, at('12:00'))).toBeUndefined();
    expect(isClosedOn(closedSunday, SUNDAY)).toBe(true);
    expect(isClosedOn(closedSunday, WEDNESDAY)).toBe(false);
  });

  it('limits nothing on a weekday whose hours are unknown', () => {
    expect(visitWindow(cafe, SUNDAY, at('06:15'))).toBe(at('06:15'));
    expect(isClosedOn(cafe, SUNDAY)).toBe(false);
    expect(isOpenFor(cafe, SUNDAY, at('02:00'), at('23:00'))).toBe(true);
    expect(openRanges(cafe, SUNDAY)).toBeUndefined();
  });

  it('counts a closing time past midnight up to 24:00 on that date', () => {
    const bar = place({ wed: [['11:30', '26:00']] }, 75);
    expect(openRanges(bar, WEDNESDAY)).toEqual([{ open: at('11:30'), close: 24 * 60 }]);
    expect(visitWindow(bar, WEDNESDAY, at('22:45'))).toBe(at('22:45')); // ends at 24:00
    expect(visitWindow(bar, WEDNESDAY, at('22:46'))).toBeUndefined(); // would cross midnight
    expect(isOpenFor(bar, WEDNESDAY, at('23:00'), at('23:59'))).toBe(true);
  });

  it('uses the first of two opening periods in which the whole visit fits', () => {
    const lunchAndDinner = place({
      wed: [
        ['17:00', '22:00'],
        ['11:30', '14:00'],
      ],
    });
    expect(visitWindow(lunchAndDinner, WEDNESDAY, at('10:00'))).toBe(at('11:30'));
    expect(visitWindow(lunchAndDinner, WEDNESDAY, at('13:00'))).toBe(at('13:00'));
    expect(visitWindow(lunchAndDinner, WEDNESDAY, at('13:30'))).toBe(at('17:00')); // lunch is too short now
    expect(visitWindow(lunchAndDinner, WEDNESDAY, at('21:30'))).toBeUndefined();
    expect(isOpenFor(lunchAndDinner, WEDNESDAY, at('13:30'), at('17:30'))).toBe(false); // spans the break
  });
});

describe('isOpenFor and openRanges', () => {
  it('needs the whole interval inside one opening period', () => {
    const shop = place({ wed: [['10:00', '18:00']] });
    expect(isOpenFor(shop, WEDNESDAY, at('10:00'), at('18:00'))).toBe(true);
    expect(isOpenFor(shop, WEDNESDAY, at('09:59'), at('11:00'))).toBe(false);
    expect(isOpenFor(shop, WEDNESDAY, at('17:30'), at('18:01'))).toBe(false);
  });

  it('joins periods that touch or overlap, because the place is open without a break', () => {
    const split = place({
      wed: [
        ['09:00', '12:00'],
        ['12:00', '17:00'],
        ['16:00', '19:00'],
      ],
    });
    expect(openRanges(split, WEDNESDAY)).toEqual([{ open: at('09:00'), close: at('19:00') }]);
    expect(isOpenFor(split, WEDNESDAY, at('11:30'), at('12:30'))).toBe(true);
  });

  it('reads the hours of the six places from the traveler’s list', () => {
    const data = loadBostonData();
    const giulia = data.placeById.get('giulia')!;
    expect(isClosedOn(giulia, SUNDAY)).toBe(true);
    expect(visitWindow(giulia, WEDNESDAY, at('09:20'))).toBe(at('17:30')); // dinner only
    expect(visitWindow(giulia, WEDNESDAY, at('19:31'))).toBeUndefined(); // 90 minutes no longer fit before 21:00
    const sailLoft = data.placeById.get('boston-sail-loft')!;
    expect(visitWindow(sailLoft, SUNDAY, at('09:00'))).toBe(at('11:00'));
    expect(visitWindow(sailLoft, WEDNESDAY, at('09:00'))).toBe(at('11:30'));
  });
});
