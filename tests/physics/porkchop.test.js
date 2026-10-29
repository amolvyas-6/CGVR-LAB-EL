import { describe, expect, it, vi } from 'vitest';
import {
  findGridMinimum,
  generatePorkchop,
  getGridCell,
  isCellFeasible,
} from '../../src/physics/porkchop.js';

const DAY_MS = 86400000;
const BASE_MS = Date.parse('2026-07-01T00:00:00Z');

function config(overrides = {}) {
  return {
    target: 'Mars',
    departureStartMs: BASE_MS,
    departureEndMs: BASE_MS + 2 * DAY_MS,
    tofMinDays: 2,
    tofMaxDays: 4,
    departureCount: 3,
    tofCount: 3,
    ...overrides,
  };
}

function syntheticDependencies(metricForCell, options = {}) {
  const calls = { earth: 0, target: 0, solve: 0 };
  return {
    calls,
    dependencies: {
      getPlanetState(body, date) {
        if (body === 'Earth') calls.earth += 1;
        else calls.target += 1;
        return {
          r: [date.getTime(), body === 'Earth' ? 0 : 1, 0],
          v: [0, 0, 0],
        };
      },
      solveLambert(r1, r2, tofSeconds) {
        calls.solve += 1;
        const departureMs = r1[0];
        const tofDays = tofSeconds / 86400;
        if (options.throwFor?.(departureMs, tofDays)) throw new Error('injected solver exception');
        if (options.invalidFor?.(departureMs, tofDays)) {
          return { valid: false, reason: 'injected invalid solve' };
        }
        const [departureVInf, arrivalVInf] = metricForCell(departureMs, tofDays, r2[0]);
        return {
          valid: true,
          v1: [departureVInf, 0, 0],
          v2: [arrivalVInf, 0, 0],
          transferAngle: 1,
        };
      },
    },
  };
}

describe('generatePorkchop', () => {
  it('builds inclusive endpoints and maps x=departure, y=TOF with index j*departureCount+i', () => {
    const { dependencies } = syntheticDependencies(() => [1, 1]);
    const grid = generatePorkchop(config({ departureCount: 2, tofCount: 2 }), dependencies);

    expect(grid.config).toEqual(config({ departureCount: 2, tofCount: 2 }));
    expect(grid.costs).toBeInstanceOf(Float32Array);
    expect(grid.c3).toBeInstanceOf(Float32Array);
    expect(grid.departureEpochs).toBeInstanceOf(Float64Array);
    expect(grid.tofDays).toBeInstanceOf(Float64Array);
    expect([...grid.departureEpochs]).toEqual([BASE_MS, BASE_MS + 2 * DAY_MS]);
    expect([...grid.tofDays]).toEqual([2, 4]);
    expect([...grid.costs]).toEqual([2, 2, 2, 2]);
    expect(getGridCell(grid, 0, 0)).toMatchObject({ i: 0, j: 0, index: 0, tofDays: 2, valid: true });
    expect(getGridCell(grid, 1, 0)).toMatchObject({ i: 1, j: 0, index: 1, departureMs: BASE_MS + 2 * DAY_MS });
    expect(getGridCell(grid, 0, 1)).toMatchObject({ i: 0, j: 1, index: 2, tofDays: 4 });
    expect(getGridCell(grid, 1, 1)).toMatchObject({ i: 1, j: 1, index: 3, arrivalMs: BASE_MS + 6 * DAY_MS });
    expect(grid.validCount).toBe(4);
    expect(grid.invalidCount).toBe(0);
    expect(grid.computeMs).toBeGreaterThanOrEqual(0);
  });

  it('uses two-point ranges exactly and caches one Earth state per departure column', () => {
    const { dependencies, calls } = syntheticDependencies(() => [1, 2]);
    const grid = generatePorkchop(config({ departureCount: 2, tofCount: 2 }), dependencies);

    expect(grid.departureEpochs[0]).toBe(config().departureStartMs);
    expect(grid.departureEpochs[1]).toBe(config().departureEndMs);
    expect(grid.tofDays[0]).toBe(config().tofMinDays);
    expect(grid.tofDays[1]).toBe(config().tofMaxDays);
    expect(calls.earth).toBe(2);
    expect(calls.target).toBe(4);
    expect(calls.solve).toBe(4);
  });

  it('linearly interpolates interior axes and stores cost with bounded Float32 rounding', () => {
    const { dependencies } = syntheticDependencies((departureMs, tofDays) => {
      const departureOffsetDays = (departureMs - BASE_MS) / DAY_MS;
      const cost = 1.23456789 + departureOffsetDays / 10 + (tofDays - 2) / 100;
      return [cost / 2, cost / 2];
    });
    const grid = generatePorkchop(config(), dependencies);
    let maximumStorageError = 0;

    expect(grid.departureEpochs[1]).toBe(BASE_MS + DAY_MS);
    expect(grid.tofDays[1]).toBe(3);
    for (let j = 0; j < grid.tofCount; j += 1) {
      for (let i = 0; i < grid.departureCount; i += 1) {
        const expected = 1.23456789 + i / 10 + j / 100;
        maximumStorageError = Math.max(maximumStorageError, Math.abs(grid.costs[j * grid.departureCount + i] - expected));
      }
    }
    expect(maximumStorageError).toBeLessThan(1e-6);
  });

  it('keeps mixed invalid, thrown, and Float32-overflow cells masked without aborting', () => {
    const { dependencies } = syntheticDependencies((departureMs) => (
      departureMs === BASE_MS ? [1e20, 1] : [1, 1]
    ), {
      invalidFor: (departureMs, tofDays) => departureMs === BASE_MS + DAY_MS && tofDays === 2,
      throwFor: (departureMs, tofDays) => departureMs === BASE_MS + 2 * DAY_MS && tofDays === 4,
    });
    const grid = generatePorkchop(config(), dependencies);

    expect(grid.validCount).toBe(4);
    expect(grid.invalidCount).toBe(5);
    expect(Number.isNaN(grid.costs[0])).toBe(true);
    expect(Number.isNaN(grid.c3[0])).toBe(true);
    expect(Number.isNaN(grid.costs[1])).toBe(true);
    expect(Number.isNaN(grid.costs[2 * grid.departureCount + 2])).toBe(true);
    expect(getGridCell(grid, 0, 0).valid).toBe(false);
    expect(getGridCell(grid, 1, 0).valid).toBe(false);
    expect(getGridCell(grid, 2, 2).valid).toBe(false);
    expect(findGridMinimum(grid)).not.toBeNull();
  });

  it('returns all-NaN grids and null minimum when every solve fails', () => {
    const { dependencies } = syntheticDependencies(() => [1, 1], {
      invalidFor: () => true,
    });
    const grid = generatePorkchop(config({ departureCount: 2, tofCount: 2 }), dependencies);

    expect(grid.validCount).toBe(0);
    expect(grid.invalidCount).toBe(4);
    expect([...grid.costs].every(Number.isNaN)).toBe(true);
    expect([...grid.c3].every(Number.isNaN)).toBe(true);
    expect(findGridMinimum(grid)).toBeNull();
  });

  it('produces a real 12x12 Earth-Mars grid with finite plausible costs and a discrete minimum', () => {
    const grid = generatePorkchop({
      target: 'mars',
      departureStartMs: Date.parse('2026-07-01T00:00:00Z'),
      departureEndMs: Date.parse('2027-03-01T00:00:00Z'),
      tofMinDays: 100,
      tofMaxDays: 400,
      departureCount: 12,
      tofCount: 12,
    });
    const finiteCosts = [...grid.costs].filter(Number.isFinite);
    const minimum = findGridMinimum(grid);

    expect(grid.validCount).toBeGreaterThan(100);
    expect(grid.invalidCount + grid.validCount).toBe(144);
    expect(finiteCosts.length).toBe(grid.validCount);
    expect(Math.min(...finiteCosts)).toBeGreaterThan(0);
    expect(Math.min(...finiteCosts)).toBeLessThan(15);
    expect(minimum).not.toBeNull();
    expect(minimum.tofDays).toBeGreaterThanOrEqual(100);
    expect(minimum.tofDays).toBeLessThanOrEqual(400);
    expect(minimum.cost).toBe(Math.min(...finiteCosts));
  });

  it('rejects invalid grid configurations before running any ephemeris calls', () => {
    const cases = [
      { target: 'Earth' },
      { departureStartMs: NaN },
      { departureEndMs: 8.65e15 },
      { departureStartMs: BASE_MS + 2 * DAY_MS },
      { tofMinDays: 0 },
      { tofMaxDays: 2 },
      { departureCount: 1 },
      { departureCount: 121 },
      { tofCount: 2.5 },
    ];
    const getState = vi.fn();

    for (const overrides of cases) {
      expect(() => generatePorkchop(config(overrides), { getPlanetState: getState })).toThrow(RangeError);
    }
    expect(getState).not.toHaveBeenCalled();
  });
});

describe('porkchop grid lookup and budgets', () => {
  function budgetGrid() {
    const { dependencies } = syntheticDependencies((departureMs, tofDays) => {
      const column = Math.round((departureMs - BASE_MS) / (2 * DAY_MS));
      if (tofDays === 2 && column === 0) return [4, 1]; // cost 5, C3 16
      if (tofDays === 2 && column === 1) return [2, 4]; // cost 6, C3 4
      if (tofDays === 4 && column === 0) return [1, 9]; // cost 10, C3 1
      return [3, 8]; // cost 11, C3 9
    });
    return generatePorkchop(config({ departureCount: 2, tofCount: 2 }), dependencies);
  }

  it('uses transfer cost as the objective and applies cost/C3 budgets in their own units', () => {
    const grid = budgetGrid();
    const unconstrained = findGridMinimum(grid);
    const costLimited = findGridMinimum(grid, { type: 'cost', limit: 5 });
    const c3Limited = findGridMinimum(grid, { type: 'c3', limit: 5 });

    expect(unconstrained).toMatchObject({ index: 0, cost: 5, c3: 16 });
    expect(costLimited).toMatchObject({ index: 0, cost: 5, c3: 16 });
    expect(c3Limited).toMatchObject({ index: 1, cost: 6, c3: 4 });
    expect(findGridMinimum(grid, { type: 'c3', limit: 0.5 })).toBeNull();
    expect(isCellFeasible(unconstrained, { type: 'cost', limit: 5 })).toBe(true);
    expect(isCellFeasible(unconstrained, { type: 'c3', limit: 5 })).toBe(false);
    expect(isCellFeasible(getGridCell(grid, 0, 1), { type: 'none' })).toBe(true);
  });

  it('keeps the first lowest-index cell on a tie', () => {
    const { dependencies } = syntheticDependencies(() => [2, 3]);
    const grid = generatePorkchop(config({ departureCount: 2, tofCount: 2 }), dependencies);

    expect(findGridMinimum(grid)).toMatchObject({ i: 0, j: 0, index: 0, cost: 5 });
  });

  it('throws RangeError for invalid budgets instead of treating them as no budget', () => {
    const grid = budgetGrid();
    const validCell = getGridCell(grid, 0, 0);
    const invalidBudgets = [
      { type: 'unknown', limit: 1 },
      { type: 'cost', limit: -1 },
      { type: 'c3', limit: NaN },
      { type: 'cost', limit: Infinity },
      { type: 'none', limit: -1 },
      { type: 'none', limit: NaN },
    ];

    for (const budget of invalidBudgets) {
      expect(() => findGridMinimum(grid, budget)).toThrow(RangeError);
      expect(() => isCellFeasible(validCell, budget)).toThrow(RangeError);
    }
    expect(findGridMinimum(grid, { type: 'none' })).toMatchObject({ index: 0 });
  });

  it('throws clear RangeErrors for non-integral and out-of-range cell indices', () => {
    const { dependencies } = syntheticDependencies(() => [1, 1]);
    const grid = generatePorkchop(config({ departureCount: 2, tofCount: 2 }), dependencies);

    for (const [i, j] of [[-1, 0], [2, 0], [0, -1], [0, 2], [0.5, 0], [0, NaN]]) {
      expect(() => getGridCell(grid, i, j)).toThrow(RangeError);
    }
  });
});
