import {
  DEFAULT_MISSION_INPUTS,
  TARGET_TOF_PRESETS,
} from './planner.js';
import { formatUTCDate, parseUTCDate } from '../physics/units.js';

const DAY_MS = 86_400_000;
const MIN_TOF_DAYS = 0.001;
const MIN_DATE_MS = parseUTCDate('0000-01-01').getTime();
const MAX_DATE_MS = parseUTCDate('9999-12-31').getTime();
const INPUT_FIELDS = Object.keys(DEFAULT_MISSION_INPUTS);
const STEP_FIELDS = new Set([
  'departureStart',
  'departureEnd',
  'tofMinDays',
  'tofMaxDays',
  'resolution',
]);
const BUDGET_TYPES = new Set(['none', 'cost', 'c3']);
const BUDGET_DEFAULTS = Object.freeze({ none: '0', cost: '6', c3: '15' });

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, keys, label) {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be a plain object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, i) => key !== expected[i])) {
    throw new TypeError(`${label} must contain exactly: ${expected.join(', ')}.`);
  }
}

function parseNumberString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${name} must be a numeric string.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw new RangeError(`${name} must be finite.`);
  return number;
}

function validateInputs(inputs) {
  hasExactKeys(inputs, INPUT_FIELDS, 'inputs');
  for (const field of INPUT_FIELDS) {
    if (typeof inputs[field] !== 'string') {
      throw new TypeError(`inputs.${field} must be a string.`);
    }
  }
  if (!Object.hasOwn(TARGET_TOF_PRESETS, inputs.target)) {
    throw new RangeError('inputs.target must be Venus, Mars, or Jupiter.');
  }

  const startMs = parseUTCDate(inputs.departureStart).getTime();
  const endMs = parseUTCDate(inputs.departureEnd).getTime();
  if (endMs - startMs < DAY_MS) {
    throw new RangeError('Departure dates must be increasing with at least one day between them.');
  }
  const tofMin = parseNumberString(inputs.tofMinDays, 'inputs.tofMinDays');
  const tofMax = parseNumberString(inputs.tofMaxDays, 'inputs.tofMaxDays');
  if (tofMin < MIN_TOF_DAYS || tofMax - tofMin < 1) {
    throw new RangeError('TOF values must be positive and increasing with at least one day between them.');
  }
  const resolution = parseNumberString(inputs.resolution, 'inputs.resolution');
  if (!Number.isInteger(resolution) || resolution < 2 || resolution > 120) {
    throw new RangeError('inputs.resolution must be a whole number from 2 to 120.');
  }
  return { startMs, endMs, tofMin, tofMax, resolution };
}

function validateBudgetInput(budgetInput, allowInvalidLimit = false) {
  hasExactKeys(budgetInput, ['type', 'limit'], 'budgetInput');
  if (!BUDGET_TYPES.has(budgetInput.type)) {
    throw new RangeError('budgetInput.type must be none, cost, or c3.');
  }
  if (budgetInput.type === 'none') return 0;
  try {
    const limit = parseNumberString(budgetInput.limit, 'budgetInput.limit');
    if (limit < 0) throw new RangeError('budgetInput.limit must be non-negative.');
    return limit;
  } catch (error) {
    // Mode buttons must remain a way to repair a malformed desktop threshold
    // after entering VR. They supply a new, explicitly unit-labelled default.
    if (allowInvalidLimit) return NaN;
    throw error;
  }
}

function requireFiniteDelta(delta) {
  if (typeof delta !== 'number' || !Number.isFinite(delta)) {
    throw new TypeError('action.delta must be a finite number.');
  }
}

function boundedSum(current, delta, minimum, maximum) {
  const requested = current + delta;
  return Math.min(maximum, Math.max(minimum, requested));
}

function dayAfter(value) {
  let result = value + 1;
  while (result - value < 1) {
    result += Math.max(Number.EPSILON, Math.abs(result) * Number.EPSILON);
  }
  return result;
}

function dayBefore(value) {
  let result = value - 1;
  while (value - result < 1) {
    result -= Math.max(Number.EPSILON, Math.abs(result) * Number.EPSILON);
  }
  return result;
}

function stepMission(inputs, values, field, delta) {
  const next = { ...inputs };
  if (field === 'departureStart' || field === 'departureEnd') {
    if (!Number.isInteger(delta)) throw new TypeError('Date step delta must be a whole number of days.');
    const lower = field === 'departureStart' ? MIN_DATE_MS : values.startMs + DAY_MS;
    const upper = field === 'departureStart' ? values.endMs - DAY_MS : MAX_DATE_MS;
    const current = field === 'departureStart' ? values.startMs : values.endMs;
    const requested = current + delta * DAY_MS;
    const stepped = Math.min(upper, Math.max(lower, requested));
    next[field] = formatUTCDate(new Date(stepped));
    return next;
  }

  if (field === 'tofMinDays') {
    const maximum = dayBefore(values.tofMax);
    let stepped = boundedSum(values.tofMin, delta, MIN_TOF_DAYS, maximum);
    if (values.tofMax - stepped < 1) stepped = values.tofMin;
    next.tofMinDays = String(stepped);
    return next;
  }
  if (field === 'tofMaxDays') {
    const minimum = dayAfter(values.tofMin);
    let stepped = boundedSum(values.tofMax, delta, minimum, Number.MAX_VALUE);
    if (stepped - values.tofMin < 1) stepped = values.tofMax;
    next.tofMaxDays = String(stepped);
    return next;
  }

  if (!Number.isInteger(delta)) throw new TypeError('Resolution step delta must be a whole number.');
  const stepped = boundedSum(values.resolution, delta, 2, 120);
  next.resolution = String(stepped);
  return next;
}

function actionResult(inputs, budgetInput, overrides = {}) {
  return {
    inputs,
    budgetInput,
    missionChanged: false,
    budgetChanged: false,
    computeRequested: false,
    ...overrides,
  };
}

/** Apply one supported VR workbench action without mutating either input. */
export function applyMissionAction(inputs, budgetInput, action) {
  const values = validateInputs(inputs);
  const budgetLimit = validateBudgetInput(budgetInput, action?.type === 'budgetType');
  if (!isPlainObject(action) || typeof action.type !== 'string') {
    throw new TypeError('action must be an object with a supported type.');
  }

  if (action.type === 'target') {
    hasExactKeys(action, ['type', 'target'], 'target action');
    const preset = typeof action.target === 'string' && Object.hasOwn(TARGET_TOF_PRESETS, action.target)
      ? TARGET_TOF_PRESETS[action.target]
      : null;
    if (!preset) throw new RangeError('Target action must choose Venus, Mars, or Jupiter.');
    const nextInputs = {
      ...inputs,
      target: action.target,
      tofMinDays: String(preset.min),
      tofMaxDays: String(preset.max),
    };
    const missionChanged = INPUT_FIELDS.some((field) => nextInputs[field] !== inputs[field]);
    return actionResult(nextInputs, { ...budgetInput }, { missionChanged });
  }

  if (action.type === 'step') {
    hasExactKeys(action, ['type', 'field', 'delta'], 'step action');
    if (typeof action.field !== 'string' || !STEP_FIELDS.has(action.field)) {
      throw new RangeError(`Unsupported mission step field: ${String(action.field)}.`);
    }
    requireFiniteDelta(action.delta);
    const nextInputs = stepMission(inputs, values, action.field, action.delta);
    const missionChanged = INPUT_FIELDS.some((field) => nextInputs[field] !== inputs[field]);
    return actionResult(nextInputs, { ...budgetInput }, { missionChanged });
  }

  if (action.type === 'budgetType') {
    hasExactKeys(action, ['type', 'value'], 'budget type action');
    if (!BUDGET_TYPES.has(action.value)) {
      throw new RangeError('Budget type action must choose none, cost, or c3.');
    }
    if (action.value === budgetInput.type && Number.isFinite(budgetLimit)) {
      return actionResult({ ...inputs }, { ...budgetInput });
    }
    const nextBudget = {
      type: action.value,
      limit: BUDGET_DEFAULTS[action.value],
    };
    return actionResult({ ...inputs }, nextBudget, { budgetChanged: true });
  }

  if (action.type === 'budgetStep') {
    hasExactKeys(action, ['type', 'delta'], 'budget step action');
    requireFiniteDelta(action.delta);
    const nextLimit = boundedSum(budgetLimit, action.delta, 0, Number.MAX_VALUE);
    const nextBudget = { ...budgetInput, limit: String(nextLimit) };
    return actionResult({ ...inputs }, nextBudget, {
      budgetChanged: nextBudget.limit !== budgetInput.limit,
    });
  }

  if (action.type === 'compute') {
    hasExactKeys(action, ['type'], 'compute action');
    return actionResult({ ...inputs }, { ...budgetInput }, { computeRequested: true });
  }

  throw new RangeError(`Unsupported mission action: ${action.type}.`);
}
