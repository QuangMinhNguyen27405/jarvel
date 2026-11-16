// Loads the hand-checked Boston data that ships with each deploy (FR9) and exposes lookups, the data
// version and the source credits (FR9.2). Bad data fails fast at load time; it is never used.
import type { Line, Place, SafetyArea, SafetyKnowledge, Station, TransitNetwork } from '@jarvel/shared';
import placesFile from '../data/places.json' with { type: 'json' };
import safetyFile from '../data/safety.json' with { type: 'json' };
import transitFile from '../data/transit.json' with { type: 'json' };
import { checkBostonData, formatDataIssues, type DataIssue, type RawBostonFiles } from './data-check.js';

export interface BostonData {
  places: Place[];
  network: TransitNetwork;
  safety: SafetyKnowledge;
  placeById: ReadonlyMap<string, Place>;
  stationById: ReadonlyMap<string, Station>;
  lineById: ReadonlyMap<string, Line>;
  areaById: ReadonlyMap<string, SafetyArea>;
  dataVersion: string;
  sourceCredits: string[];
  /** True when any file is marked as sample data that has not been hand-checked. */
  isSample: boolean;
}

export class DataCheckError extends Error {
  constructor(readonly issues: DataIssue[]) {
    super(`Boston data failed its check:\n${formatDataIssues(issues).join('\n')}`);
    this.name = 'DataCheckError';
  }
}

/** Builds lookups over the three data files after checking them. Throws DataCheckError on any issue. */
export function buildBostonData(raw: RawBostonFiles): BostonData {
  const { issues, data } = checkBostonData(raw);
  if (!data) throw new DataCheckError(issues);
  const credits = [...data.places.sourceCredits, ...data.transit.sourceCredits, ...data.safety.sourceCredits];
  return {
    places: data.places.places,
    network: data.transit.network,
    safety: data.safety.safety,
    placeById: new Map(data.places.places.map((p) => [p.id, p])),
    stationById: new Map(data.transit.network.stations.map((s) => [s.id, s])),
    lineById: new Map(data.transit.network.lines.map((l) => [l.id, l])),
    areaById: new Map(data.safety.safety.areas.map((a) => [a.id, a])),
    dataVersion: `places@${data.places.version},transit@${data.transit.version},safety@${data.safety.version}`,
    sourceCredits: [...new Set(credits)],
    isSample: data.places.sample || data.transit.sample || data.safety.sample,
  };
}

let bundled: BostonData | undefined;

/** The Boston data bundled with this deploy, checked once and cached. */
export function loadBostonData(): BostonData {
  bundled ??= buildBostonData({ places: placesFile, transit: transitFile, safety: safetyFile });
  return bundled;
}

function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function containsWords(haystack: string, needle: string): boolean {
  return ` ${haystack} `.includes(` ${needle} `);
}

/** An alias shorter than this only matches an entry that is exactly the alias, never a longer entry containing it. */
const MIN_CONTAINED_ALIAS_LENGTH = 5;

/**
 * Finds the catalog place a wishlist entry refers to, or undefined when it is not in the Boston data.
 * Matches, in order: the place id, the full name, the name without its parenthesised part, then a whole-word
 * containment either way for names of at least five characters, then a place's aliases (other spellings): an alias
 * equal to the entry, or one of at least five characters contained in the entry as whole words. Names and ids are
 * tried on every place before any alias, so an existing name always wins. The first place in file order wins.
 */
export function matchWishlistEntry(entry: string, data: BostonData): Place | undefined {
  const raw = entry.trim().toLowerCase();
  const wanted = normalize(entry);
  if (wanted.length === 0) return undefined;
  const byId = data.placeById.get(raw);
  if (byId) return byId;
  const candidates = data.places.map((place) => ({
    place,
    full: normalize(place.name),
    core: normalize(place.name.replace(/\(.*?\)/g, '')),
    id: normalize(place.id),
  }));
  const exact = candidates.find((c) => c.full === wanted || c.core === wanted || c.id === wanted);
  if (exact) return exact.place;
  const partial = candidates.find(
    (c) =>
      (c.core.length >= 5 && containsWords(wanted, c.core)) || (wanted.length >= 5 && containsWords(c.core, wanted)),
  );
  if (partial) return partial.place;
  // Aliases match one way only: the entry may contain the alias, but an alias never matches because it happens to
  // contain a short entry.
  return data.places.find((place) =>
    (place.aliases ?? []).some((alias) => {
      const spelling = normalize(alias);
      if (spelling.length === 0) return false;
      return spelling === wanted || (spelling.length >= MIN_CONTAINED_ALIAS_LENGTH && containsWords(wanted, spelling));
    }),
  );
}
