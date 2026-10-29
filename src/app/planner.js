import { formatUTCDate, parseUTCDate } from '../physics/units.js';

export const TARGET_TOF_PRESETS = Object.freeze({
  Venus: Object.freeze({ min: 80, max: 220 }),
  Mars: Object.freeze({ min: 100, max: 400 }),
  Jupiter: Object.freeze({ min: 450, max: 1200 }),
});

export const DEFAULT_MISSION_INPUTS = Object.freeze({
  target: 'Mars',
  departureStart: '2026-07-01',
  departureEnd: '2027-03-01',
  tofMinDays: '100',
  tofMaxDays: '400',
  resolution: '60',
});

const TARGETS = new Set(Object.keys(TARGET_TOF_PRESETS));

function readFiniteNumber(value) {
  if (typeof value !== 'string' || value.trim() === '') return NaN;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

/** Parse and validate the mission form without relying on local time zones. */
export function validateMissionInputs(input) {
  const values = input && typeof input === 'object' ? input : {};
  const errors = {};
  const target = TARGETS.has(values.target) ? values.target : null;
  if (!target) errors.target = 'Choose Venus, Mars, or Jupiter.';

  let departureStartMs = NaN;
  let departureEndMs = NaN;
  try {
    departureStartMs = parseUTCDate(values.departureStart).getTime();
  } catch {
    errors.departureStart = 'Enter a valid UTC calendar date in YYYY-MM-DD format.';
  }
  try {
    departureEndMs = parseUTCDate(values.departureEnd).getTime();
  } catch {
    errors.departureEnd = 'Enter a valid UTC calendar date in YYYY-MM-DD format.';
  }
  if (Number.isFinite(departureStartMs) && Number.isFinite(departureEndMs)
    && departureStartMs >= departureEndMs) {
    errors.departureEnd = 'The departure end date must be later than the start date.';
  }

  const tofMinDays = readFiniteNumber(values.tofMinDays);
  const tofMaxDays = readFiniteNumber(values.tofMaxDays);
  if (!Number.isFinite(tofMinDays) || tofMinDays <= 0) {
    errors.tofMinDays = 'Minimum time of flight must be a positive number of days.';
  }
  if (!Number.isFinite(tofMaxDays) || tofMaxDays <= 0) {
    errors.tofMaxDays = 'Maximum time of flight must be a positive number of days.';
  } else if (Number.isFinite(tofMinDays) && tofMaxDays <= tofMinDays) {
    errors.tofMaxDays = 'Maximum time of flight must be greater than the minimum.';
  }

  const resolution = readFiniteNumber(values.resolution);
  if (!Number.isInteger(resolution) || resolution < 2 || resolution > 120) {
    errors.resolution = 'Grid resolution must be a whole number from 2 to 120.';
  }

  if (Object.keys(errors).length > 0) return { config: null, errors };
  return {
    config: {
      target,
      departureStartMs,
      departureEndMs,
      tofMinDays,
      tofMaxDays,
      departureCount: resolution,
      tofCount: resolution,
    },
    errors,
  };
}

export function validateBudget(type, rawLimit) {
  if (type === 'none') return { budget: { type, limit: 0 }, error: null };
  if (type !== 'cost' && type !== 'c3') {
    return { budget: null, error: 'Choose no budget, transfer-cost proxy, or departure C3.' };
  }
  const limit = readFiniteNumber(rawLimit);
  if (!Number.isFinite(limit) || limit < 0) {
    return { budget: null, error: 'Budget limit must be a non-negative number.' };
  }
  return { budget: { type, limit }, error: null };
}

export function formatUTCInstant(epochMs) {
  if (!Number.isFinite(epochMs) || !Number.isFinite(new Date(epochMs).getTime())) return '—';
  return new Date(epochMs).toISOString().replace(/\.000Z$/, 'Z');
}

export function formatUTCDateFromEpoch(epochMs) {
  if (!Number.isFinite(epochMs) || !Number.isFinite(new Date(epochMs).getTime())) return '—';
  return formatUTCDate(new Date(epochMs));
}
