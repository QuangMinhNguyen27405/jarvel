// Runner check (plan Step 2): proves Vitest runs in this package and can load the bundled Boston data.
import { describe, expect, it } from 'vitest';
import { loadBostonData } from '../src/lib/data.js';

describe('test runner smoke check', () => {
  it('loads the bundled Boston data and reports its version', () => {
    const data = loadBostonData();
    expect(data.dataVersion).toMatch(/^places@.+,transit@.+,safety@.+$/);
    expect(data.places.length).toBeGreaterThan(0);
  });
});
