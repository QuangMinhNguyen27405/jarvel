import { describe, expect, it } from 'vitest';
import { checkBostonData, formatDataIssues } from '../src/lib/data-check.js';
import { DEFAULT_DATA_DIR, validateDataDirectory, type ValidateDataIo } from '../scripts/validate-data.js';
import { rawSampleFiles } from './fixtures/data.js';

function paths(files: ReturnType<typeof rawSampleFiles>): string[] {
  return checkBostonData(files).issues.map((issue) => `${issue.file}:${issue.path}`);
}

describe('checkBostonData (FR9.1, US6.4)', () => {
  it('accepts the bundled sample data', () => {
    const result = checkBostonData(rawSampleFiles());
    expect(result.issues).toEqual([]);
    expect(result.data?.places.places.length).toBe(18);
  });

  it('accepts a list of other spellings on a place and refuses anything else (Step 15)', () => {
    const accepted = rawSampleFiles() as unknown as { places: { places: Record<string, unknown>[] } };
    accepted.places.places[0]!.aliases = ['The Common'];
    const checked = checkBostonData(accepted as unknown as ReturnType<typeof rawSampleFiles>);
    expect(checked.issues).toEqual([]);
    expect(checked.data?.places.places[0]?.aliases).toEqual(['The Common']);

    const notAList = rawSampleFiles() as unknown as { places: { places: Record<string, unknown>[] } };
    notAList.places.places[0]!.aliases = 'The Common';
    notAList.places.places[1]!.aliases = ['', 'Garden'];
    expect(paths(notAList as unknown as ReturnType<typeof rawSampleFiles>)).toEqual([
      'places:places.0.aliases',
      'places:places.1.aliases.0',
    ]);
  });

  it('keeps the six traveler-requested places unverified and tied to the traveler’s wording (Step 15)', () => {
    const requested = checkBostonData(rawSampleFiles()).data!.places.places.filter((place) => place.userRequested);
    expect(requested.map((place) => place.id)).toEqual([
      'saltie-girl',
      'blank-street-back-bay',
      'giulia',
      'boston-sail-loft',
      'mikes-pastry',
      'zhi-wei-cafe',
    ]);
    for (const place of requested) {
      expect(place.verified).toBe(false);
      expect(place.matchedFrom).toBeTruthy();
      expect(place.confidenceNote).toContain('web search on 2026-11-12');
    }
  });

  it('fails when a place points to a missing station (AC6.4.1)', () => {
    const files = rawSampleFiles();
    files.places.places[1]!.nearestStationId = 'nowhere';
    expect(paths(files)).toEqual(['places:places.1.nearestStationId']);
  });

  it('checks two files, places and transit: there is no safety file in this version', () => {
    const { issues, data } = checkBostonData(rawSampleFiles());
    expect(issues).toEqual([]);
    expect(Object.keys(data ?? {}).sort()).toEqual(['places', 'transit']);
    expect(JSON.stringify(data)).not.toContain('safetyAreaId');
  });

  it('fails on times that are not valid HH:MM (AC6.4.2)', () => {
    const files = rawSampleFiles();
    files.transit.network.lines[0]!.lastTrain = '25:00';
    files.places.places[0]!.hours.mon = [['9am', '17:00']];
    expect(paths(files)).toEqual(['places:places.0.hours.mon.0.0', 'transit:network.lines.0.lastTrain']);
  });

  it('fails on opening hours that close before they open', () => {
    const files = rawSampleFiles();
    files.places.places[0]!.hours.tue = [['18:00', '09:00']];
    expect(paths(files)).toEqual(['places:places.0.hours.tue.0']);
  });

  it('fails on duplicate ids and broken edges', () => {
    const files = rawSampleFiles();
    files.places.places[1]!.id = files.places.places[0]!.id;
    files.transit.network.edges[0]!.to = 'missing-station';
    files.transit.network.edges[1]!.line = 'red'; // airport-maverick is not on the Red Line
    files.transit.network.stations[0]!.lines = ['purple'];
    const issuePaths = paths(files);
    expect(issuePaths).toContain('places:places.1.id');
    expect(issuePaths).toContain('transit:network.edges.0.to');
    expect(issuePaths).toContain('transit:network.edges.1.from');
    expect(issuePaths).toContain('transit:network.stations.0.lines.0');
  });

  it('reports structural problems such as a missing version', () => {
    const files = rawSampleFiles() as unknown as { places: unknown; transit: Record<string, unknown> };
    delete files.transit.version;
    const { issues, data } = checkBostonData(files);
    expect(data).toBeUndefined();
    expect(formatDataIssues(issues)[0]).toMatch(/^transit\.json version: /);
  });
});

function captureIo(texts: Record<string, string> = {}): ValidateDataIo & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    readText: async (filePath) => {
      const name = Object.keys(texts).find((key) => filePath.endsWith(key));
      if (name === undefined) throw new Error(`ENOENT: ${filePath}`);
      return texts[name]!;
    },
    log: (line) => out.push(line),
    error: (line) => err.push(line),
  };
}

describe('validate-data script', () => {
  it('exits 0 for the bundled data and warns that it is sample data', async () => {
    const out: string[] = [];
    const code = await validateDataDirectory(DEFAULT_DATA_DIR, {
      readText: (await import('node:fs/promises')).readFile.bind(null) as never,
      log: (line) => out.push(line),
      error: (line) => out.push(line),
    });
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('SAMPLE data');
  });

  it('exits 1 and lists every error for a broken file (AC6.4.1)', async () => {
    const files = rawSampleFiles();
    files.places.places[0]!.nearestStationId = 'nowhere';
    const io = captureIo({
      'places.json': JSON.stringify(files.places),
      'transit.json': JSON.stringify(files.transit),
    });
    expect(await validateDataDirectory('/data', io)).toBe(1);
    expect(io.err.join('\n')).toContain('places.0.nearestStationId');
  });

  it('exits 1 when a file is missing or is not JSON', async () => {
    const io = captureIo({ 'places.json': '{ not json' }); // and there is no transit.json
    expect(await validateDataDirectory('/data', io)).toBe(1);
    expect(io.err).toHaveLength(2);
    expect(io.err.join('\n')).toMatch(/places\.json: could not be read as JSON[\s\S]*transit\.json: could not be read/);
  });
});
