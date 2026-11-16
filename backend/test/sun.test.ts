import { describe, expect, it } from 'vitest';
import { parseHHMM } from '../src/lib/time.js';
import { sunsetHHMM, sunsetInstant, sunsetMinutes } from '../src/lib/sun.js';

describe('Boston sunset (D11)', () => {
  it('is within 5 minutes of 16:16 on Nov 18 2026', () => {
    expect(Math.abs(sunsetMinutes('2026-11-18') - parseHHMM('16:16'))).toBeLessThanOrEqual(5);
    // The full NOAA solar calculator gives 16:20 for this date; allow its 1-2 minute tolerance.
    expect(['16:19', '16:20', '16:21']).toContain(sunsetHHMM('2026-11-18'));
  });

  it('is late on the summer solstice (about 20:25 EDT)', () => {
    expect(Math.abs(sunsetMinutes('2026-06-21') - parseHHMM('20:25'))).toBeLessThanOrEqual(5);
  });

  it('jumps about an hour earlier in local time when DST ends (AC4.1.5)', () => {
    const before = sunsetMinutes('2026-10-31'); // EDT, about 17:36
    const after = sunsetMinutes('2026-11-01'); // EST, about 16:35
    expect(before - after).toBeGreaterThanOrEqual(59);
    expect(before - after).toBeLessThanOrEqual(63);
  });

  it('rejects an invalid date', () => {
    expect(() => sunsetInstant('2026-13-01')).toThrow(RangeError);
  });

  it('refuses a place and date where the sun never sets', () => {
    expect(() => sunsetInstant('2026-06-21', { lat: 80, lng: 0 })).toThrow(/does not set/);
  });
});
