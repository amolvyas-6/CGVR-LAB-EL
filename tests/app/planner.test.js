import { describe, expect, it } from 'vitest';
import { DEFAULT_MISSION_INPUTS, TARGET_TOF_PRESETS, validateMissionInputs, validateBudget, formatUTCInstant } from '../../src/app/planner.js';

describe('desktop mission inputs', () => {
  it('converts defaults to UTC epochs and the numerical grid configuration', () => {
    const { config, errors } = validateMissionInputs(DEFAULT_MISSION_INPUTS);
    expect(errors).toEqual({});
    expect(config.target).toBe('Mars');
    expect(config.departureStartMs).toBe(Date.UTC(2026, 6, 1));
    expect(config.departureCount).toBe(60);
    expect(config.tofCount).toBe(60);
    expect(TARGET_TOF_PRESETS.Jupiter).toEqual({ min: 450, max: 1200 });
  });

  it.each([
    [{ target: 'Earth' }, 'target'],
    [{ departureStart: '2026-02-30' }, 'departureStart'],
    [{ departureEnd: '2026-07-01' }, 'departureEnd'],
    [{ tofMinDays: '' }, 'tofMinDays'],
    [{ tofMinDays: '-1' }, 'tofMinDays'],
    [{ tofMaxDays: '100' }, 'tofMaxDays'],
    [{ resolution: '121' }, 'resolution'],
    [{ resolution: '3.5' }, 'resolution'],
  ])('rejects invalid form values %j', (patch, field) => {
    const result = validateMissionInputs({ ...DEFAULT_MISSION_INPUTS, ...patch });
    expect(result.config).toBeNull();
    expect(result.errors[field]).toBeTruthy();
  });

  it('validates budget modes and finite limits without inventing a default threshold', () => {
    expect(validateBudget('none', '').budget).toEqual({ type: 'none', limit: 0 });
    expect(validateBudget('cost', '6').budget).toEqual({ type: 'cost', limit: 6 });
    expect(validateBudget('c3', '15').budget).toEqual({ type: 'c3', limit: 15 });
    for (const bad of ['', '-1', 'NaN', 'Infinity']) {
      expect(validateBudget('cost', bad).budget).toBeNull();
    }
    expect(validateBudget('unknown', '10').budget).toBeNull();
  });

  it('formats selected mission instants in UTC and masks invalid epochs', () => {
    expect(formatUTCInstant(Date.UTC(2026, 10, 1))).toBe('2026-11-01T00:00:00Z');
    expect(formatUTCInstant(NaN)).toBe('—');
  });
});
