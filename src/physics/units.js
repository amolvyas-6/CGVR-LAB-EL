import { AU_KM, SECONDS_PER_DAY } from './constants.js';

function requireFiniteNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
}

function requireFiniteResult(value) {
  if (!Number.isFinite(value)) {
    throw new RangeError('unit conversion produced a non-finite result');
  }
  return value;
}

/** Convert days to seconds. Inputs must be finite numbers. */
export function daysToSeconds(days) {
  requireFiniteNumber(days, 'days');
  return requireFiniteResult(days * SECONDS_PER_DAY);
}

/** Convert seconds to days. Inputs must be finite numbers. */
export function secondsToDays(seconds) {
  requireFiniteNumber(seconds, 'seconds');
  return requireFiniteResult(seconds / SECONDS_PER_DAY);
}

/** Convert astronomical units to kilometres. Inputs must be finite numbers. */
export function auToKm(au) {
  requireFiniteNumber(au, 'au');
  return requireFiniteResult(au * AU_KM);
}

/** Convert astronomical units per day to kilometres per second. */
export function auPerDayToKmPerSecond(auPerDay) {
  requireFiniteNumber(auPerDay, 'auPerDay');
  return requireFiniteResult(auPerDay * (AU_KM / SECONDS_PER_DAY));
}

/**
 * Parse a date-only ISO string as UTC midnight. Only exact YYYY-MM-DD input
 * is accepted; malformed and calendar-rollover dates throw RangeError.
 */
export function parseUTCDate(dateText) {
  if (typeof dateText !== 'string') {
    throw new TypeError('dateText must be a YYYY-MM-DD string');
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
  if (!match || dateText.length !== 10) {
    throw new RangeError('dateText must use the exact YYYY-MM-DD format');
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  // setUTCFullYear avoids Date.UTC's special handling of years 00–99.
  date.setUTCFullYear(year, month - 1, day);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError(`Invalid calendar date: ${dateText}`);
  }

  return date;
}

/** Format a valid Date as its UTC calendar date, restricted to four digits. */
export function formatUTCDate(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new TypeError('date must be a valid Date');
  }

  const year = date.getUTCFullYear();
  if (year < 0 || year > 9999) {
    throw new RangeError('date year must fit the four-digit YYYY format');
  }

  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${String(year).padStart(4, '0')}-${month}-${day}`;
}
