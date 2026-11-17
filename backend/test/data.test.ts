import { describe, expect, it } from 'vitest';
import { buildBostonData, DataCheckError, loadBostonData, matchWishlistEntry } from '../src/lib/data.js';
import { rawSampleFiles } from './fixtures/data.js';

describe('loadBostonData (FR9, FR9.2)', () => {
  it('exposes the data version, source credits and lookups', () => {
    const data = loadBostonData();
    expect(data.dataVersion).toBe('places@sample-2026-11-12,transit@sample-2026-10-23');
    expect(data.sourceCredits.length).toBeGreaterThan(0);
    expect(data.placeById.get('boston-public-library')?.nearestStationId).toBe('copley');
    expect(data.stationById.get('state')?.lines).toEqual(['blue', 'orange']);
    expect(data.lineById.get('blue')?.lastTrain).toBe('00:30');
  });

  it('marks the bundled dataset as sample data with every place unverified (D10)', () => {
    const data = loadBostonData();
    expect(data.isSample).toBe(true);
    expect(data.places.every((place) => place.verified === false)).toBe(true);
  });

  it('caches the bundled data after the first load', () => {
    expect(loadBostonData()).toBe(loadBostonData());
  });

  it('refuses to build from broken files and lists the issues', () => {
    const files = rawSampleFiles();
    files.places.places[0]!.nearestStationId = 'no-such-station';
    expect(() => buildBostonData(files)).toThrow(DataCheckError);
    try {
      buildBostonData(files);
    } catch (error) {
      expect((error as DataCheckError).issues[0]?.path).toBe('places.0.nearestStationId');
      expect((error as Error).message).toContain('no-such-station');
    }
  });

  it('builds a new dataset with a new version when the files change (AC6.4.3)', () => {
    const files = rawSampleFiles();
    files.places.version = 'checked-2026-11-01';
    expect(buildBostonData(files).dataVersion).toContain('places@checked-2026-11-01');
  });
});

describe('matchWishlistEntry (FR3.1, FR3.5)', () => {
  const data = loadBostonData();

  it('matches by id, by name in any case, and by the name without its parenthesised part', () => {
    expect(matchWishlistEntry('revere-beach', data)?.id).toBe('revere-beach');
    expect(matchWishlistEntry('NEW ENGLAND AQUARIUM', data)?.id).toBe('new-england-aquarium');
    expect(matchWishlistEntry('Boston Public Library', data)?.id).toBe('boston-public-library');
  });

  it('matches a whole-word part of a name', () => {
    expect(matchWishlistEntry('the Chinatown Gate please', data)?.id).toBe('chinatown-gate');
    expect(matchWishlistEntry('Faneuil Hall', data)?.id).toBe('faneuil-hall-marketplace');
  });

  it('returns nothing for places outside the Boston data and for blank entries', () => {
    expect(matchWishlistEntry('Tatte Bakery', data)).toBeUndefined();
    expect(matchWishlistEntry('   ', data)).toBeUndefined();
    expect(matchWishlistEntry('park', data)).toBeUndefined(); // too short and not a whole name
  });
});

describe('matchWishlistEntry: other spellings (Step 15, FR3.1, FR3.5)', () => {
  const data = loadBostonData();

  /** The sample data with `aliases` set on the place `id`. */
  const withAliases = (id: string, aliases: string[]) =>
    buildBostonData({
      ...rawSampleFiles(),
      places: {
        ...rawSampleFiles().places,
        places: rawSampleFiles().places.places.map((place) => (place.id === id ? { ...place, aliases } : place)),
      },
    });

  it('matches six of the traveler’s seven entries, exactly as written, to their places', () => {
    const matches = (entry: string) => matchWishlistEntry(entry, data)?.id;
    expect(matches('Saltie Girl - Lobster Roll')).toBe('saltie-girl');
    expect(matches('Blank Street - Coffee/Matcha')).toBe('blank-street-back-bay');
    expect(matches('Guilia - Italian')).toBe('giulia');
    expect(matches('Sail Loft - Lobster Roll, seafood portofino')).toBe('boston-sail-loft');
    expect(matches('Mike’s Pastry')).toBe('mikes-pastry'); // a curly apostrophe, as the traveler typed it
    expect(matches('Zei Wei - Taiwan noodle')).toBe('zhi-wei-cafe');
  });

  it('matches nothing for the entry that is not in the Boston data', () => {
    expect(matchWishlistEntry('Quin Long - Malatang Hotpot', data)).toBeUndefined();
  });

  it('matches an alias on its own and the spelling without an apostrophe', () => {
    expect(matchWishlistEntry('guilia', data)?.id).toBe('giulia');
    expect(matchWishlistEntry('Mikes Pastry', data)?.id).toBe('mikes-pastry');
    expect(matchWishlistEntry('zhi wei', data)?.id).toBe('zhi-wei-cafe');
  });

  it('matches an alias shorter than five characters only when the entry is exactly the alias', () => {
    const short = withAliases('new-england-aquarium', ['NEAq']);
    expect(matchWishlistEntry('neaq', short)?.id).toBe('new-england-aquarium');
    expect(matchWishlistEntry('NEAq with the kids', short)).toBeUndefined();
  });

  it('never matches an alias because the alias contains the entry', () => {
    // "Mikes" is inside the alias "Mikes Pastry", but an alias only matches an entry that contains all of it.
    expect(matchWishlistEntry('Mikes', data)).toBeUndefined();
    expect(matchWishlistEntry('Street', data)?.id).toBe('newbury-street'); // a name still matches the other way
  });

  it('lets an existing name win over an alias of an earlier place', () => {
    // Boston Common is first in the file; giving it another place's name as an alias must not steal that place.
    const stolen = withAliases('boston-common', ['Revere Beach', 'Harvard Yard']);
    expect(matchWishlistEntry('Revere Beach', stolen)?.id).toBe('revere-beach');
    expect(matchWishlistEntry('a walk in Harvard Yard', stolen)?.id).toBe('harvard-yard');
  });

  it('keeps file order among aliases: the first place with a matching alias wins', () => {
    const both = buildBostonData({
      ...rawSampleFiles(),
      places: {
        ...rawSampleFiles().places,
        places: rawSampleFiles().places.places.map((place) =>
          place.id === 'boston-common' || place.id === 'public-garden' ? { ...place, aliases: ['The Green'] } : place,
        ),
      },
    });
    expect(matchWishlistEntry('the green', both)?.id).toBe('boston-common');
  });
});
