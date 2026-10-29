import { describe, expect, it } from 'vitest';
import { applyMissionAction } from '../../src/app/missionActions.js';
import { DEFAULT_MISSION_INPUTS } from '../../src/app/planner.js';

const DEFAULT_BUDGET = Object.freeze({ type: 'none', limit: '0' });

function inputs(overrides = {}) {
  return { ...DEFAULT_MISSION_INPUTS, ...overrides };
}

describe('applyMissionAction', () => {
  it('applies target presets without changing departure dates, resolution, or budget', () => {
    const original = inputs({ departureStart: '2024-02-28', departureEnd: '2024-03-12', resolution: '24' });
    const budget = { type: 'cost', limit: '8.25' };
    const result = applyMissionAction(original, budget, { type: 'target', target: 'Jupiter' });

    expect(result.inputs).toEqual({
      ...original,
      target: 'Jupiter',
      tofMinDays: '450',
      tofMaxDays: '1200',
    });
    expect(result.budgetInput).toEqual(budget);
    expect(result).toMatchObject({ missionChanged: true, budgetChanged: false, computeRequested: false });
    expect(original).toEqual(inputs({ departureStart: '2024-02-28', departureEnd: '2024-03-12', resolution: '24' }));
    expect(result.inputs).not.toBe(original);
    expect(result.budgetInput).not.toBe(budget);
  });

  it('steps dates by UTC calendar days over leap days and preserves an increasing range', () => {
    const original = inputs({ departureStart: '2024-02-28', departureEnd: '2024-03-03' });
    const leapDay = applyMissionAction(original, DEFAULT_BUDGET, {
      type: 'step', field: 'departureStart', delta: 1,
    });
    expect(leapDay.inputs.departureStart).toBe('2024-02-29');

    const rolledForward = applyMissionAction(leapDay.inputs, DEFAULT_BUDGET, {
      type: 'step', field: 'departureStart', delta: 1,
    });
    expect(rolledForward.inputs.departureStart).toBe('2024-03-01');

    const rolledBack = applyMissionAction(rolledForward.inputs, DEFAULT_BUDGET, {
      type: 'step', field: 'departureEnd', delta: -1,
    });
    expect(rolledBack.inputs.departureEnd).toBe('2024-03-02');
    expect(Date.parse(`${rolledBack.inputs.departureEnd}T00:00:00Z`)
      - Date.parse(`${rolledBack.inputs.departureStart}T00:00:00Z`)).toBeGreaterThanOrEqual(86_400_000);
  });

  it('clamps date, TOF, resolution, and budget steps without breaking range invariants', () => {
    const base = inputs({
      departureStart: '0000-01-01',
      departureEnd: '0000-01-03',
      tofMinDays: '0.001',
      tofMaxDays: '2',
      resolution: '120',
    });
    const startClamped = applyMissionAction(base, DEFAULT_BUDGET, {
      type: 'step', field: 'departureStart', delta: 100,
    });
    expect(startClamped.inputs.departureStart).toBe('0000-01-02');
    const endClamped = applyMissionAction(base, DEFAULT_BUDGET, {
      type: 'step', field: 'departureEnd', delta: -100,
    });
    expect(endClamped.inputs.departureEnd).toBe('0000-01-02');

    const minAtGap = applyMissionAction(base, DEFAULT_BUDGET, {
      type: 'step', field: 'tofMinDays', delta: 10,
    });
    expect(minAtGap.inputs.tofMinDays).toBe('1');
    const maxAtGap = applyMissionAction(base, DEFAULT_BUDGET, {
      type: 'step', field: 'tofMaxDays', delta: -10,
    });
    expect(Number(maxAtGap.inputs.tofMaxDays) - 0.001).toBeGreaterThanOrEqual(1);
    const resolutionAtLimit = applyMissionAction(base, DEFAULT_BUDGET, {
      type: 'step', field: 'resolution', delta: 1,
    });
    expect(resolutionAtLimit.inputs.resolution).toBe('120');

    const budgetAtZero = applyMissionAction(base, { type: 'cost', limit: '1.25' }, {
      type: 'budgetStep', delta: -3,
    });
    expect(budgetAtZero.budgetInput).toEqual({ type: 'cost', limit: '0' });
    const budgetAtMax = applyMissionAction(base, { type: 'c3', limit: String(Number.MAX_VALUE) }, {
      type: 'budgetStep', delta: 1,
    });
    expect(budgetAtMax.budgetInput.limit).toBe(String(Number.MAX_VALUE));

    const largeTofRange = inputs({
      tofMinDays: '10000000000000000',
      tofMaxDays: '10000000000000002',
    });
    const largeMinStep = applyMissionAction(largeTofRange, DEFAULT_BUDGET, {
      type: 'step', field: 'tofMinDays', delta: 100,
    });
    const largeMaxStep = applyMissionAction(largeTofRange, DEFAULT_BUDGET, {
      type: 'step', field: 'tofMaxDays', delta: -100,
    });
    expect(largeMinStep.inputs.tofMaxDays - largeMinStep.inputs.tofMinDays).toBeGreaterThanOrEqual(1);
    expect(largeMaxStep.inputs.tofMaxDays - largeMaxStep.inputs.tofMinDays).toBeGreaterThanOrEqual(1);
  });

  it('uses cost and C3 defaults in their own units and never carries a threshold across modes', () => {
    const currentCost = { type: 'cost', limit: '9.5' };
    const asC3 = applyMissionAction(inputs(), currentCost, { type: 'budgetType', value: 'c3' });
    expect(asC3.budgetInput).toEqual({ type: 'c3', limit: '15' });
    expect(asC3.budgetChanged).toBe(true);

    const stillC3 = applyMissionAction(inputs(), asC3.budgetInput, { type: 'budgetType', value: 'c3' });
    expect(stillC3.budgetInput).toEqual({ type: 'c3', limit: '15' });
    expect(stillC3.budgetChanged).toBe(false);

    const asCost = applyMissionAction(inputs(), asC3.budgetInput, { type: 'budgetType', value: 'cost' });
    expect(asCost.budgetInput).toEqual({ type: 'cost', limit: '6' });
    const noBudget = applyMissionAction(inputs(), asCost.budgetInput, { type: 'budgetType', value: 'none' });
    expect(noBudget.budgetInput).toEqual({ type: 'none', limit: '0' });
  });

  it('marks compute separately and leaves the mission and budget values unchanged', () => {
    const mission = inputs();
    const budget = { type: 'c3', limit: '15' };
    const result = applyMissionAction(mission, budget, { type: 'compute' });

    expect(result).toMatchObject({ missionChanged: false, budgetChanged: false, computeRequested: true });
    expect(result.inputs).toEqual(mission);
    expect(result.budgetInput).toEqual(budget);
    expect(result.inputs).not.toBe(mission);
    expect(result.budgetInput).not.toBe(budget);
  });

  it('allows in-world mode buttons to repair invalid thresholds without changing units silently', () => {
    for (const limit of ['NaN', '', '-1']) {
      const cleared = applyMissionAction(inputs(), { type: 'cost', limit }, { type: 'budgetType', value: 'none' });
      expect(cleared.budgetInput).toEqual({ type: 'none', limit: '0' });
      const repaired = applyMissionAction(inputs(), { type: 'cost', limit }, { type: 'budgetType', value: 'cost' });
      expect(repaired.budgetInput).toEqual({ type: 'cost', limit: '6' });
      expect(repaired.budgetChanged).toBe(true);
    }
    expect(applyMissionAction(inputs(), { type: 'none', limit: '' }, { type: 'compute' }).computeRequested).toBe(true);
  });

  it('rejects unsupported actions, fields, non-finite deltas, and invalid initial state explicitly', () => {
    const invalidActions = [
      { type: 'step', field: 'target', delta: 1 },
      { type: 'step', field: 'resolution', delta: NaN },
      { type: 'step', field: 'departureStart', delta: 0.5 },
      { type: 'step', field: 'departureEnd', delta: Infinity },
      { type: 'budgetStep', delta: NaN },
      { type: 'target', target: 'Earth' },
      { type: 'target', target: 'toString' },
      { type: 'mystery' },
      { type: 'compute', extra: true },
    ];
    for (const action of invalidActions) {
      expect(() => applyMissionAction(inputs(), DEFAULT_BUDGET, action)).toThrow();
    }

    for (const invalidInputs of [
      inputs({ departureStart: '2026-02-30' }),
      inputs({ departureEnd: '2026-07-01' }),
      inputs({ tofMinDays: 'not a number' }),
      inputs({ tofMaxDays: '100' }),
      inputs({ resolution: '121' }),
      { ...inputs(), unsupported: 'field' },
    ]) {
      expect(() => applyMissionAction(invalidInputs, DEFAULT_BUDGET, { type: 'compute' })).toThrow();
    }

    expect(() => applyMissionAction(inputs(), { type: 'cost', limit: 'NaN' }, { type: 'compute' }))
      .toThrow('must be finite');
  });
});
