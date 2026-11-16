// Validation of a trip request at the API boundary (FR2, FR2.1, FR2.2, FR2.7, US2.2). Every invalid field is
// reported in one answer. Unknown fields are refused, so a stored request is exactly what was sent plus the
// documented defaults for omitted optional fields (AC2.1.2, AC2.1.3).
import type { ApiFieldError, HotelInfo, TripPreferences, TripRequest } from '@jarvel/shared';
import { z } from 'zod';
import type { BostonData } from './data.js';
import { stationsWithinWalk, walkMinutesBetween } from './geo.js';
import {
  addMonths,
  bostonDate,
  bostonLocalDateTime,
  isValidHHMM,
  isValidLocalDateTime,
  listDates,
  splitLocalDateTime,
} from './time.js';

export const REQUEST_LIMITS = {
  maxTripDays: 7,
  minTravelers: 1,
  maxTravelers: 6,
  maxWishlistEntries: 15,
  maxWishlistEntryLength: 100,
  maxNotesLength: 1000,
  maxTitleLength: 120,
  maxMonthsAhead: 12,
  hotelMaxWalkMinutes: 30,
  minWalkSetting: 1,
  maxWalkSetting: 30,
} as const;

/** Documented defaults for every omitted preference (AC2.1.3). */
export const DEFAULT_PREFERENCES: TripPreferences = {
  pace: 'moderate',
  safety: 'standard',
  budgetLevel: 'moderate',
  transport: 'subway-first',
  maxWalkMinutes: 15,
  dayStart: '09:00',
  dayEnd: '21:30',
  includeMichelin: false,
};

const L = REQUEST_LIMITS;
const hhmm = z.string().refine((v) => isValidHHMM(v), 'must be a time written HH:MM (24-hour)');
const localDateTime = z
  .string()
  .refine((v) => isValidLocalDateTime(v), 'must be a Boston local date-time written YYYY-MM-DDTHH:MM');
const nonBlank = (max: number) =>
  z
    .string()
    .max(max, `must be at most ${max} characters`)
    .refine((v) => v.trim().length > 0, 'must not be empty');

const hotelSchema = z.strictObject({
  name: nonBlank(200),
  address: nonBlank(300),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  nearestStationId: z.string().max(100).optional(),
  walkMinutesToStation: z.number().int().min(0).max(120).optional(),
  shuttleNote: z.string().max(300).optional(),
});

const preferencesSchema = z.strictObject({
  pace: z.enum(['relaxed', 'moderate', 'packed']).optional(),
  safety: z.enum(['standard', 'strict']).optional(),
  budgetLevel: z.enum(['budget', 'moderate', 'splurge']).optional(),
  transport: z.enum(['subway-first', 'mixed']).optional(),
  maxWalkMinutes: z
    .number()
    .int('must be a whole number of minutes')
    .min(L.minWalkSetting, `must be at least ${L.minWalkSetting}`)
    .max(L.maxWalkSetting, `must be at most ${L.maxWalkSetting}`)
    .optional(),
  dayStart: hhmm.optional(),
  dayEnd: hhmm.optional(),
  dietary: z.string().max(200, 'must be at most 200 characters').optional(),
  includeMichelin: z.boolean().optional(),
});

const tripRequestSchema = z.strictObject({
  title: nonBlank(L.maxTitleLength).optional(),
  arrival: localDateTime,
  departure: localDateTime,
  travelers: z
    .number()
    .int('must be a whole number')
    .min(L.minTravelers, `must be at least ${L.minTravelers}`)
    .max(L.maxTravelers, `must be at most ${L.maxTravelers}`),
  hotel: hotelSchema,
  wishlist: z
    .array(nonBlank(L.maxWishlistEntryLength))
    .max(L.maxWishlistEntries, `must have at most ${L.maxWishlistEntries} places`),
  notes: z.string().max(L.maxNotesLength, `must be at most ${L.maxNotesLength} characters`).optional(),
  preferences: preferencesSchema.optional(),
});

export type ValidationResult = { ok: true; value: TripRequest } | { ok: false; fields: ApiFieldError[] };

export interface ValidationContext {
  now: Date;
  data: BostonData;
}

function zodFieldErrors(error: z.ZodError): ApiFieldError[] {
  const fields: ApiFieldError[] = [];
  for (const issue of error.issues) {
    const path = issue.path.map(String).join('.');
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys)
        fields.push({ field: path ? `${path}.${key}` : key, message: 'is not a known field' });
      continue;
    }
    const message = issue.message.includes('received undefined') ? 'is required' : issue.message;
    fields.push({ field: path || '(body)', message });
  }
  return fields;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function checkDates(input: Record<string, unknown>, now: Date, bad: Set<string>): ApiFieldError[] {
  const { arrival, departure } = input;
  if (!isValidLocalDateTime(arrival) || !isValidLocalDateTime(departure) || bad.has('arrival')) return [];
  const errors: ApiFieldError[] = [];
  if (arrival <= bostonLocalDateTime(now)) errors.push({ field: 'arrival', message: 'must be in the future' });
  const latest = addMonths(bostonDate(now), L.maxMonthsAhead);
  if (splitLocalDateTime(arrival).date > latest) {
    errors.push({
      field: 'arrival',
      message: `must be no more than ${L.maxMonthsAhead} months ahead (latest ${latest})`,
    });
  }
  if (bad.has('departure')) return errors;
  if (departure <= arrival) {
    errors.push({ field: 'departure', message: 'must be after arrival' });
    return errors;
  }
  const days = listDates(splitLocalDateTime(arrival).date, splitLocalDateTime(departure).date).length;
  if (days > L.maxTripDays) {
    errors.push({ field: 'departure', message: `trip must be 1 to ${L.maxTripDays} days long (this one is ${days})` });
  }
  return errors;
}

function checkHotel(input: Record<string, unknown>, data: BostonData, bad: Set<string>): ApiFieldError[] {
  const hotel = asRecord(input.hotel);
  const errors: ApiFieldError[] = [];
  if (
    typeof hotel.lat === 'number' &&
    typeof hotel.lng === 'number' &&
    !bad.has('hotel.lat') &&
    !bad.has('hotel.lng')
  ) {
    const reachable = stationsWithinWalk(
      { lat: hotel.lat, lng: hotel.lng },
      data.network.stations,
      L.hotelMaxWalkMinutes,
    );
    if (reachable.length === 0) {
      errors.push({
        field: 'hotel',
        message: `is outside the area the planner covers (more than a ${L.hotelMaxWalkMinutes}-minute walk from every station in the Boston data)`,
      });
    }
  }
  if (typeof hotel.nearestStationId === 'string' && !data.stationById.has(hotel.nearestStationId)) {
    errors.push({ field: 'hotel.nearestStationId', message: 'is not a station in the Boston data' });
  }
  return errors;
}

function checkDayWindow(input: Record<string, unknown>, bad: Set<string>): ApiFieldError[] {
  const prefs = asRecord(input.preferences);
  const dayStart = prefs.dayStart ?? DEFAULT_PREFERENCES.dayStart;
  const dayEnd = prefs.dayEnd ?? DEFAULT_PREFERENCES.dayEnd;
  if (!isValidHHMM(dayStart) || !isValidHHMM(dayEnd) || bad.has('preferences.dayEnd')) return [];
  return dayStart < dayEnd ? [] : [{ field: 'preferences.dayEnd', message: 'must be later than dayStart' }];
}

type ParsedRequest = z.infer<typeof tripRequestSchema>;

function withDefaults(parsed: ParsedRequest, data: BostonData): TripRequest {
  const preferences: TripPreferences = { ...DEFAULT_PREFERENCES };
  for (const [key, value] of Object.entries(parsed.preferences ?? {})) {
    if (value !== undefined) (preferences as unknown as Record<string, unknown>)[key] = value;
  }
  const nearest = stationsWithinWalk(parsed.hotel, data.network.stations, L.hotelMaxWalkMinutes)[0];
  // A station the traveler named is used as given; its walk time, when not given, is the walk to that station,
  // not to whichever station happens to be nearest.
  const named =
    parsed.hotel.nearestStationId === undefined ? undefined : data.stationById.get(parsed.hotel.nearestStationId);
  const hotel: HotelInfo = {
    ...parsed.hotel,
    nearestStationId: parsed.hotel.nearestStationId ?? nearest?.stationId ?? '',
    walkMinutesToStation:
      parsed.hotel.walkMinutesToStation ??
      (named ? walkMinutesBetween(parsed.hotel, named) : (nearest?.walkMinutes ?? 0)),
  };
  const request: TripRequest = { ...parsed, hotel, preferences };
  return request;
}

/** Validates a raw request body; on success returns it with documented defaults filled in. */
export function validateTripRequest(input: unknown, context: ValidationContext): ValidationResult {
  const parsed = tripRequestSchema.safeParse(input);
  const fields = parsed.success ? [] : zodFieldErrors(parsed.error);
  const bad = new Set(fields.map((f) => f.field));
  const record = asRecord(input);
  fields.push(...checkDates(record, context.now, bad));
  fields.push(...checkHotel(record, context.data, bad));
  fields.push(...checkDayWindow(record, bad));
  if (!parsed.success || fields.length > 0) return { ok: false, fields };
  return { ok: true, value: withDefaults(parsed.data, context.data) };
}

/** The plan title used when the request has none: "Boston trip 2026-11-18 to 2026-11-21". */
export function defaultTitle(request: TripRequest): string {
  return request.title ?? `Boston trip ${request.arrival.slice(0, 10)} to ${request.departure.slice(0, 10)}`;
}

const renameSchema = z.strictObject({ title: nonBlank(L.maxTitleLength) });

/** Validates the body of PATCH /plans/{planId}: only a new title, 1 to 120 characters. */
export function validateRenameRequest(
  body: unknown,
): { ok: true; title: string } | { ok: false; fields: ApiFieldError[] } {
  const parsed = renameSchema.safeParse(body);
  if (parsed.success) return { ok: true, title: parsed.data.title.trim() };
  // Name each field the caller cannot edit (for example `notes`), so the error says which one to drop.
  const fields = zodFieldErrors(parsed.error).map((field) =>
    field.message === 'is not a known field' ? { ...field, message: 'is not an editable field' } : field,
  );
  return { ok: false, fields };
}
