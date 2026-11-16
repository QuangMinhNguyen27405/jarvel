// Sunset in Boston for a calendar date (D11, A-3), from the standard NOAA/Meeus solar position approximation
// (the "sunrise equation"). Accuracy is about one to two minutes, which is enough for "after dark" (FR4.2).
import { bostonLocalDateTime, isValidDate, splitLocalDateTime } from './time.js';

export interface Coordinates {
  lat: number;
  lng: number; // east positive, so Boston is negative
}

/** Boston City Hall, used for every sunset in the plan. */
export const BOSTON_COORDINATES: Coordinates = { lat: 42.3601, lng: -71.0589 };

const J2000 = 2451545.0;
const UNIX_EPOCH_JULIAN = 2440587.5;
const MS_PER_DAY = 86_400_000;
const DEG = Math.PI / 180;

/** The real instant of sunset on `date` ("YYYY-MM-DD") at `coordinates`. */
export function sunsetInstant(date: string, coordinates: Coordinates = BOSTON_COORDINATES): Date {
  if (!isValidDate(date)) throw new RangeError(`Not a valid date: ${JSON.stringify(date)}`);
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const julianMidnight = Date.UTC(year, month - 1, day) / MS_PER_DAY + UNIX_EPOCH_JULIAN;
  const dayNumber = Math.ceil(julianMidnight - J2000 + 0.0008);
  const meanSolarNoon = dayNumber - coordinates.lng / 360;
  const meanAnomaly = (357.5291 + 0.98560028 * meanSolarNoon) % 360;
  const m = meanAnomaly * DEG;
  const center = 1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m);
  const eclipticLongitude = ((meanAnomaly + center + 180 + 102.9372) % 360) * DEG;
  const solarTransit = J2000 + meanSolarNoon + 0.0053 * Math.sin(m) - 0.0069 * Math.sin(2 * eclipticLongitude);
  const sinDeclination = Math.sin(eclipticLongitude) * Math.sin(23.4397 * DEG);
  const cosDeclination = Math.cos(Math.asin(sinDeclination));
  const latitude = coordinates.lat * DEG;
  const cosHourAngle =
    (Math.sin(-0.833 * DEG) - Math.sin(latitude) * sinDeclination) / (Math.cos(latitude) * cosDeclination);
  if (cosHourAngle < -1 || cosHourAngle > 1) {
    throw new RangeError(`The sun does not set on ${date} at latitude ${coordinates.lat}`);
  }
  const hourAngleDegrees = Math.acos(cosHourAngle) / DEG;
  const julianSunset = solarTransit + hourAngleDegrees / 360;
  return new Date(Math.round((julianSunset - UNIX_EPOCH_JULIAN) * MS_PER_DAY));
}

/** Boston local sunset on `date`, in minutes after midnight. */
export function sunsetMinutes(date: string, coordinates: Coordinates = BOSTON_COORDINATES): number {
  const local = splitLocalDateTime(bostonLocalDateTime(sunsetInstant(date, coordinates)));
  return local.minutes;
}

/** Boston local sunset on `date`, as "HH:MM". */
export function sunsetHHMM(date: string, coordinates: Coordinates = BOSTON_COORDINATES): string {
  return bostonLocalDateTime(sunsetInstant(date, coordinates)).slice(11);
}
