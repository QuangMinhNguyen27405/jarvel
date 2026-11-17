// Checks the Boston data files before they are used or deployed (FR9.1, US6.4): structure, references,
// HH:MM times and unique ids. `checkBostonData` never throws on bad data; it returns every issue it finds.
import type { Place, TransitNetwork } from '@jarvel/shared';
import { z } from 'zod';
import { isValidHHMM } from './time.js';

export type DataFileName = 'places' | 'transit';

export interface DataIssue {
  file: DataFileName;
  path: string;
  message: string;
}

export interface DataFileMeta {
  version: string;
  sample: boolean;
  notice: string;
  sourceCredits: string[];
}

export interface RawBostonFiles {
  places: unknown;
  transit: unknown;
}

export interface ParsedBostonFiles {
  places: DataFileMeta & { places: Place[] };
  transit: DataFileMeta & { network: TransitNetwork };
}

const dayKey = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
const money = z.object({ low: z.number().min(0), high: z.number().min(0) });
const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

const metaShape = {
  version: z.string().min(1),
  sample: z.boolean(),
  notice: z.string(),
  sourceCredits: z.array(z.string().min(1)),
};

const placeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)).optional(),
  category: z.enum([
    'bakery',
    'coffee',
    'restaurant',
    'fine-dining',
    'attraction',
    'museum',
    'park',
    'campus',
    'neighborhood',
    'shopping',
    'viewpoint',
  ]),
  cuisine: z.string().optional(),
  neighborhood: z.string().min(1),
  address: z.string().min(1),
  lat: latitude,
  lng: longitude,
  nearestStationId: z.string().min(1),
  walkMinutesFromStation: z.number().int().min(0),
  hours: z.partialRecord(dayKey, z.array(z.tuple([z.string(), z.string()]))),
  hoursNote: z.string().optional(),
  typicalDwellMinutes: z.number().int().min(5).max(480),
  priceLevel: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  estCostPerPerson: money,
  reservation: z.enum(['none', 'recommended', 'required']),
  bookingUrl: z.string().optional(),
  userRequested: z.boolean(),
  matchedFrom: z.string().optional(),
  tags: z.array(z.string()),
  description: z.string(),
  tips: z.string().optional(),
  sourceUrls: z.array(z.string()),
  verified: z.boolean(),
  confidenceNote: z.string().optional(),
});

const serviceHours = z.object({ firstTrain: z.string(), lastTrain: z.string() });

const lineSchema = z.object({
  id: z.enum([
    'blue',
    'orange',
    'red',
    'red-ashmont',
    'red-braintree',
    'green-b',
    'green-c',
    'green-d',
    'green-e',
    'green-trunk',
    'silver-sl1',
    'silver-sl3',
    'walk-transfer',
    'shuttle',
  ]),
  name: z.string().min(1),
  color: z.string(),
  mode: z.enum(['subway', 'light-rail', 'bus-rapid-transit', 'walk', 'shuttle']),
  headwayMinutes: z.object({
    peak: z.number().int().min(1),
    offPeak: z.number().int().min(1),
    evening: z.number().int().min(1),
  }),
  firstTrain: z.string(),
  lastTrain: z.string(),
  serviceByDay: z.partialRecord(dayKey, serviceHours).optional(),
  fareUSD: z.number().min(0),
});

const networkSchema = z.object({
  lines: z.array(lineSchema).min(1),
  stations: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        lines: z.array(z.string()).min(1),
        lat: latitude,
        lng: longitude,
        accessible: z.boolean(),
      }),
    )
    .min(1),
  edges: z.array(
    z.object({ from: z.string(), to: z.string(), line: z.string(), minutes: z.number().int().min(1).max(60) }),
  ),
  transferPenaltyMinutes: z.number().int().min(0),
  airport: z
    .object({
      label: z.string().min(1),
      stationId: z.string().min(1),
      accessMinutes: z.number().int().min(0),
      lat: latitude,
      lng: longitude,
      instruction: z.string().min(1),
    })
    .optional(),
  fares: z.object({
    subwaySingle: z.number().min(0),
    busSingle: z.number().min(0),
    sl1FromAirportFree: z.boolean(),
    dayPass: z.number().min(0),
    weekPass: z.number().min(0),
    notes: z.string(),
  }),
  sourceUrls: z.array(z.string()),
});

const placesFileSchema = z.object({ ...metaShape, places: z.array(placeSchema) });
const transitFileSchema = z.object({ ...metaShape, network: networkSchema });

function structuralIssues(file: DataFileName, error: z.ZodError): DataIssue[] {
  return error.issues.map((issue) => ({ file, path: issue.path.join('.') || '(file)', message: issue.message }));
}

function duplicateIds(file: DataFileName, path: string, ids: string[]): DataIssue[] {
  const seen = new Set<string>();
  const issues: DataIssue[] = [];
  ids.forEach((id, index) => {
    if (seen.has(id)) issues.push({ file, path: `${path}.${index}.id`, message: `Duplicate id "${id}"` });
    seen.add(id);
  });
  return issues;
}

function timeIssue(file: DataFileName, path: string, value: string, maxHour = 23): DataIssue[] {
  return isValidHHMM(value, maxHour) ? [] : [{ file, path, message: `"${value}" is not a valid HH:MM time` }];
}

function checkPlaces(files: ParsedBostonFiles): DataIssue[] {
  const stationIds = new Set(files.transit.network.stations.map((s) => s.id));
  const issues = duplicateIds(
    'places',
    'places',
    files.places.places.map((p) => p.id),
  );
  files.places.places.forEach((place, index) => {
    const base = `places.${index}`;
    if (!stationIds.has(place.nearestStationId)) {
      issues.push({
        file: 'places',
        path: `${base}.nearestStationId`,
        message: `Place "${place.id}" points to station "${place.nearestStationId}", which does not exist`,
      });
    }
    for (const [day, ranges] of Object.entries(place.hours)) {
      (ranges ?? []).forEach(([open, close], rangeIndex) => {
        const path = `${base}.hours.${day}.${rangeIndex}`;
        const openIssues = timeIssue('places', `${path}.0`, open);
        const closeIssues = timeIssue('places', `${path}.1`, close, 29);
        issues.push(...openIssues, ...closeIssues);
        if (openIssues.length === 0 && closeIssues.length === 0 && open >= close) {
          issues.push({ file: 'places', path, message: `Opening time ${open} is not before closing time ${close}` });
        }
      });
    }
  });
  return issues;
}

function checkTransit(files: ParsedBostonFiles): DataIssue[] {
  const network = files.transit.network;
  const lineIds = new Set<string>(network.lines.map((l) => l.id));
  const stationsById = new Map(network.stations.map((s) => [s.id, s]));
  const issues = [
    ...duplicateIds(
      'transit',
      'network.lines',
      network.lines.map((l) => l.id),
    ),
    ...duplicateIds(
      'transit',
      'network.stations',
      network.stations.map((s) => s.id),
    ),
  ];
  network.lines.forEach((line, index) => {
    const base = `network.lines.${index}`;
    issues.push(...timeIssue('transit', `${base}.firstTrain`, line.firstTrain));
    issues.push(...timeIssue('transit', `${base}.lastTrain`, line.lastTrain));
    for (const [day, hours] of Object.entries(line.serviceByDay ?? {})) {
      issues.push(...timeIssue('transit', `${base}.serviceByDay.${day}.firstTrain`, hours.firstTrain));
      issues.push(...timeIssue('transit', `${base}.serviceByDay.${day}.lastTrain`, hours.lastTrain));
    }
  });
  network.stations.forEach((station, index) => {
    station.lines.forEach((lineId, lineIndex) => {
      if (!lineIds.has(lineId)) {
        issues.push({
          file: 'transit',
          path: `network.stations.${index}.lines.${lineIndex}`,
          message: `Station "${station.id}" lists line "${lineId}", which does not exist`,
        });
      }
    });
  });
  network.edges.forEach((edge, index) => {
    const base = `network.edges.${index}`;
    if (!lineIds.has(edge.line)) {
      issues.push({
        file: 'transit',
        path: `${base}.line`,
        message: `Edge uses line "${edge.line}", which does not exist`,
      });
    }
    for (const end of ['from', 'to'] as const) {
      const station = stationsById.get(edge[end]);
      if (!station) {
        issues.push({
          file: 'transit',
          path: `${base}.${end}`,
          message: `Edge points to station "${edge[end]}", which does not exist`,
        });
      } else if (!station.lines.includes(edge.line)) {
        issues.push({
          file: 'transit',
          path: `${base}.${end}`,
          message: `Station "${station.id}" is not on line "${edge.line}" used by this edge`,
        });
      }
    }
  });
  if (network.airport && !stationsById.has(network.airport.stationId)) {
    issues.push({
      file: 'transit',
      path: 'network.airport.stationId',
      message: `Airport access points to station "${network.airport.stationId}", which does not exist`,
    });
  }
  return issues;
}

/** Checks the two Boston data files and returns every issue; `data` is set only when there are none. */
export function checkBostonData(raw: RawBostonFiles): { issues: DataIssue[]; data?: ParsedBostonFiles } {
  const places = placesFileSchema.safeParse(raw.places);
  const transit = transitFileSchema.safeParse(raw.transit);
  const structural = [
    ...(places.success ? [] : structuralIssues('places', places.error)),
    ...(transit.success ? [] : structuralIssues('transit', transit.error)),
  ];
  if (!places.success || !transit.success) return { issues: structural };
  const files = { places: places.data, transit: transit.data } as ParsedBostonFiles;
  const issues = [...checkPlaces(files), ...checkTransit(files)];
  return issues.length === 0 ? { issues, data: files } : { issues };
}

/** One readable line per issue, for the CLI and for error messages. */
export function formatDataIssues(issues: DataIssue[]): string[] {
  return issues.map((issue) => `${issue.file}.json ${issue.path}: ${issue.message}`);
}
