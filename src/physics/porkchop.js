import { SECONDS_PER_DAY } from './constants.js';
import { getPlanetState } from './ephemeris.js';
import { computeTransfer } from './transfer.js';

const MAX_AXIS_COUNT = 120;
const MILLISECONDS_PER_DAY = SECONDS_PER_DAY * 1000;
const TARGETS = new Map(['Venus', 'Mars', 'Jupiter'].map((name) => [name.toLowerCase(), name]));
const INVALID_STATE = Object.freeze({
  r: Object.freeze([NaN, NaN, NaN]),
  v: Object.freeze([NaN, NaN, NaN]),
});
const DEFAULT_BUDGET = Object.freeze({ type: 'none', limit: 0 });

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalTarget(target) {
  if (typeof target !== 'string') return null;
  return TARGETS.get(target.trim().toLowerCase()) ?? null;
}

function validDateMs(epochMs) {
  return typeof epochMs === 'number'
    && Number.isFinite(epochMs)
    && Number.isFinite(new Date(epochMs).getTime());
}

function requireFiniteNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number`);
  }
}

function validateConfig(config) {
  if (!isObject(config)) throw new RangeError('config must be an object');
  const target = canonicalTarget(config.target);
  if (!target) throw new RangeError(`unsupported target: ${String(config.target)}`);

  requireFiniteNumber(config.departureStartMs, 'departureStartMs');
  requireFiniteNumber(config.departureEndMs, 'departureEndMs');
  if (!validDateMs(config.departureStartMs) || !validDateMs(config.departureEndMs)) {
    throw new RangeError('departure range must contain valid Unix-millisecond epochs');
  }
  if (!(config.departureStartMs < config.departureEndMs)) {
    throw new RangeError('departureStartMs must be earlier than departureEndMs');
  }

  requireFiniteNumber(config.tofMinDays, 'tofMinDays');
  requireFiniteNumber(config.tofMaxDays, 'tofMaxDays');
  if (!(config.tofMinDays > 0) || !(config.tofMinDays < config.tofMaxDays)) {
    throw new RangeError('TOF range must be positive and strictly increasing');
  }

  for (const name of ['departureCount', 'tofCount']) {
    const count = config[name];
    if (!Number.isInteger(count) || count < 2 || count > MAX_AXIS_COUNT) {
      throw new RangeError(`${name} must be an integer between 2 and ${MAX_AXIS_COUNT}`);
    }
  }

  return {
    target,
    departureStartMs: config.departureStartMs,
    departureEndMs: config.departureEndMs,
    tofMinDays: config.tofMinDays,
    tofMaxDays: config.tofMaxDays,
    departureCount: config.departureCount,
    tofCount: config.tofCount,
  };
}

function now() {
  return typeof globalThis.performance?.now === 'function'
    ? globalThis.performance.now()
    : Date.now();
}

function interpolateInclusive(start, end, index, count) {
  if (index === 0) return start;
  if (index === count - 1) return end;
  return start + ((end - start) * index) / (count - 1);
}

/**
 * Build a CPU porkchop grid. Cell index is j * departureCount + i, with
 * departures increasing left-to-right and TOF increasing bottom-to-top.
 */
export function generatePorkchop(config, dependencies = {}) {
  const normalizedConfig = validateConfig(config);
  const { departureCount, tofCount, target } = normalizedConfig;
  const cellCount = departureCount * tofCount;
  const costs = new Float32Array(cellCount);
  const c3 = new Float32Array(cellCount);
  costs.fill(NaN);
  c3.fill(NaN);

  const departureEpochs = new Float64Array(departureCount);
  const tofDays = new Float64Array(tofCount);
  for (let i = 0; i < departureCount; i += 1) {
    departureEpochs[i] = interpolateInclusive(
      normalizedConfig.departureStartMs,
      normalizedConfig.departureEndMs,
      i,
      departureCount,
    );
  }
  for (let j = 0; j < tofCount; j += 1) {
    tofDays[j] = interpolateInclusive(
      normalizedConfig.tofMinDays,
      normalizedConfig.tofMaxDays,
      j,
      tofCount,
    );
  }

  const startedAt = now();
  let validCount = 0;
  let invalidCount = 0;
  const providedStateProvider = isObject(dependencies) ? dependencies.getPlanetState : undefined;
  const stateProvider = providedStateProvider ?? getPlanetState;

  for (let i = 0; i < departureCount; i += 1) {
    let departureState = INVALID_STATE;
    try {
      if (typeof stateProvider !== 'function') throw new TypeError('getPlanetState dependency must be a function');
      departureState = stateProvider('Earth', new Date(departureEpochs[i]));
    } catch {
      // A failed departure ephemeris invalidates this whole column; the cell
      // calls below still produce ordinary masked records without throwing.
    }

    for (let j = 0; j < tofCount; j += 1) {
      const index = j * departureCount + i;
      try {
        const cellDependencies = {
          ...(isObject(dependencies) ? dependencies : {}),
          getPlanetState: stateProvider,
          departureState,
        };
        const result = computeTransfer({
          target,
          departureMs: departureEpochs[i],
          tofDays: tofDays[j],
        }, cellDependencies);

        if (!result?.valid || !Number.isFinite(result.cost) || result.cost < 0
          || !Number.isFinite(result.c3) || result.c3 < 0) {
          invalidCount += 1;
          continue;
        }

        const cost32 = Math.fround(result.cost);
        const c332 = Math.fround(result.c3);
        if (!Number.isFinite(cost32) || !Number.isFinite(c332)) {
          invalidCount += 1;
          continue;
        }

        costs[index] = cost32;
        c3[index] = c332;
        validCount += 1;
      } catch {
        // Preserve NaN for any unexpected per-cell error, including injected
        // solver failures; one cell must never abort the grid computation.
        invalidCount += 1;
      }
    }
  }

  const elapsed = now() - startedAt;
  return {
    config: Object.freeze(normalizedConfig),
    departureCount,
    tofCount,
    costs,
    c3,
    departureEpochs,
    tofDays,
    validCount,
    invalidCount,
    computeMs: Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0,
  };
}

function validateGrid(grid) {
  if (!isObject(grid)
    || !isObject(grid.config)
    || !Number.isInteger(grid.departureCount)
    || !Number.isInteger(grid.tofCount)
    || !(grid.costs instanceof Float32Array)
    || !(grid.c3 instanceof Float32Array)
    || !(grid.departureEpochs instanceof Float64Array)
    || !(grid.tofDays instanceof Float64Array)
    || grid.costs.length !== grid.departureCount * grid.tofCount
    || grid.c3.length !== grid.costs.length
    || grid.departureEpochs.length !== grid.departureCount
    || grid.tofDays.length !== grid.tofCount) {
    throw new TypeError('grid must be a valid porkchop grid returned by generatePorkchop');
  }
}

function validateIndices(grid, i, j) {
  validateGrid(grid);
  if (!Number.isInteger(i) || i < 0 || i >= grid.departureCount) {
    throw new RangeError(`departure index i must be an integer in [0, ${grid.departureCount - 1}]`);
  }
  if (!Number.isInteger(j) || j < 0 || j >= grid.tofCount) {
    throw new RangeError(`TOF index j must be an integer in [0, ${grid.tofCount - 1}]`);
  }
}

/** Return the transfer metadata for grid cell (i, j); out-of-range indices throw. */
export function getGridCell(grid, i, j) {
  validateIndices(grid, i, j);
  const index = j * grid.departureCount + i;
  const departureMs = grid.departureEpochs[i];
  const cellTofDays = grid.tofDays[j];
  const candidateArrivalMs = departureMs + cellTofDays * MILLISECONDS_PER_DAY;
  const arrivalMs = validDateMs(candidateArrivalMs) ? candidateArrivalMs : NaN;
  const cost = grid.costs[index];
  const cellC3 = grid.c3[index];
  const valid = validDateMs(departureMs)
    && Number.isFinite(arrivalMs)
    && Number.isFinite(cellTofDays)
    && cellTofDays > 0
    && Number.isFinite(cost)
    && cost >= 0
    && Number.isFinite(cellC3)
    && cellC3 >= 0;

  return {
    i,
    j,
    index,
    target: grid.config.target,
    departureMs,
    arrivalMs,
    tofDays: cellTofDays,
    cost,
    c3: cellC3,
    valid,
  };
}

function normalizeBudget(budget = DEFAULT_BUDGET) {
  if (!isObject(budget) || !['none', 'cost', 'c3'].includes(budget.type)) {
    throw new RangeError('budget type must be one of: none, cost, c3');
  }
  const limit = budget.limit === undefined && budget.type === 'none' ? 0 : budget.limit;
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 0) {
    throw new RangeError('budget limit must be a finite non-negative number');
  }
  return { type: budget.type, limit };
}

function feasibleForCell(cell, budget) {
  if (!cell?.valid || !Number.isFinite(cell.cost) || cell.cost < 0
    || !Number.isFinite(cell.c3) || cell.c3 < 0) return false;
  if (budget.type === 'none') return true;
  return budget.type === 'cost' ? cell.cost <= budget.limit : cell.c3 <= budget.limit;
}

/** Check whether a valid cell passes the optional transfer-cost/C3 budget. */
export function isCellFeasible(cell, budget = DEFAULT_BUDGET) {
  return feasibleForCell(cell, normalizeBudget(budget));
}

/** Return the first lowest-cost feasible grid cell, or null when none qualifies. */
export function findGridMinimum(grid, budget = DEFAULT_BUDGET) {
  validateGrid(grid);
  const normalizedBudget = normalizeBudget(budget);
  let bestIndex = -1;
  let bestCost = Infinity;

  for (let index = 0; index < grid.costs.length; index += 1) {
    const i = index % grid.departureCount;
    const j = Math.floor(index / grid.departureCount);
    const cell = getGridCell(grid, i, j);
    if (feasibleForCell(cell, normalizedBudget) && cell.cost < bestCost) {
      bestCost = cell.cost;
      bestIndex = index;
    }
  }

  return bestIndex < 0
    ? null
    : getGridCell(grid, bestIndex % grid.departureCount, Math.floor(bestIndex / grid.departureCount));
}
