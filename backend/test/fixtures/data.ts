// Fresh, mutable copies of the bundled sample data files, so a test can break one field without touching others.
import type { DayKey } from '@jarvel/shared';
import placesFile from '../../src/data/places.json' with { type: 'json' };
import transitFile from '../../src/data/transit.json' with { type: 'json' };
import { buildBostonData, type BostonData } from '../../src/lib/data.js';

type RawLine = MutableRawFiles['transit']['network']['lines'][number];

/** The named sample line, with every weekday override removed so first/last train apply all week. */
export function line(files: MutableRawFiles, id: string): RawLine {
  const found = files.transit.network.lines.find((l) => l.id === id);
  if (!found) throw new Error(`no sample line ${id}`);
  delete (found as { serviceByDay?: unknown }).serviceByDay;
  return found;
}

/**
 * The named sample place's opening hours, so a test may give it made-up hours: `[]` closes a weekday and deleting
 * the key makes that weekday's hours unknown. Tests change the made-up "Sample ..." places and the sights, not the
 * hours of the real businesses from the traveler's list.
 */
export function hoursOf(files: MutableRawFiles, id: string): Partial<Record<DayKey, [string, string][]>> {
  const found = files.places.places.find((p) => p.id === id);
  if (!found) throw new Error(`no sample place ${id}`);
  return found.hours as Partial<Record<DayKey, [string, string][]>>;
}

export interface MutableRawFiles {
  places: typeof placesFile;
  transit: typeof transitFile;
}

/** Checked BostonData built from the sample files after `change` edits a fresh copy. */
export function sampleDataWith(change: (files: MutableRawFiles) => void): BostonData {
  const files = rawSampleFiles();
  change(files);
  return buildBostonData(files);
}

export function rawSampleFiles(): MutableRawFiles {
  return {
    places: structuredClone(placesFile),
    transit: structuredClone(transitFile),
  };
}
