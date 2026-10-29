import { describe, expect, it, vi } from 'vitest';
import { PROGRADE_NORMAL, getPlanetState } from '../../src/physics/ephemeris.js';
import { computeTransfer } from '../../src/physics/transfer.js';

const dayMs = 86400000;

function vectorMagnitudeDifference(left, right) {
  return Math.hypot(...left.map((value, index) => value - right[index]));
}

describe('computeTransfer', () => {
  it('returns a finite Earth-to-Mars transfer matching the NASA Table 2 reference cases', () => {
    const fixtures = [
      { departure: '2026-11-14', arrival: '2027-08-09', c3: 11.11, arrivalVInf: 2.915, type: 'I' },
      { departure: '2026-10-31', arrival: '2027-08-19', c3: 9.144, arrivalVInf: 2.729, type: 'II' },
    ];

    for (const fixture of fixtures) {
      const departureMs = Date.parse(`${fixture.departure}T00:00:00Z`);
      const arrivalMs = Date.parse(`${fixture.arrival}T00:00:00Z`);
      const tofDays = (arrivalMs - departureMs) / dayMs;
      const result = computeTransfer({ target: 'mArS', departureMs, tofDays });

      expect(result.valid).toBe(true);
      expect(result.target).toBe('Mars');
      expect(result.departureMs).toBe(departureMs);
      expect(result.arrivalMs).toBe(arrivalMs);
      expect(result.tofSeconds).toBe(tofDays * 86400);
      expect(result.r1).toEqual(getPlanetState('Earth', new Date(departureMs)).r);
      expect(result.r2).toEqual(getPlanetState('Mars', new Date(arrivalMs)).r);
      expect(result.reason).toBeNull();
      expect(result.c3 / fixture.c3).toBeGreaterThan(0.95);
      expect(result.c3 / fixture.c3).toBeLessThan(1.05);
      expect(result.vInfArrival / fixture.arrivalVInf).toBeGreaterThan(0.95);
      expect(result.vInfArrival / fixture.arrivalVInf).toBeLessThan(1.05);
      expect(result.cost / (Math.sqrt(fixture.c3) + fixture.arrivalVInf)).toBeGreaterThan(0.95);
      expect(result.cost / (Math.sqrt(fixture.c3) + fixture.arrivalVInf)).toBeLessThan(1.05);
      expect(result.transferAngle < Math.PI ? 'I' : 'II').toBe(fixture.type);
      expect([result.vInfDeparture, result.vInfArrival, result.c3, result.cost]
        .every(Number.isFinite)).toBe(true);
    }
  });

  it('uses injected states and solver with the fixed prograde reference normal', () => {
    const departureMs = Date.parse('2026-07-01T00:00:00Z');
    const getState = vi.fn((body, date) => ({
      r: body === 'Earth' ? [1, 0, 0] : [0, 2, 0],
      v: body === 'Earth' ? [0, 3, 0] : [-2, 0, 0],
      date,
    }));
    const solve = vi.fn(() => ({
      valid: true,
      v1: [0, 5, 0],
      v2: [1, 0, 0],
      transferAngle: Math.PI / 2,
    }));

    const result = computeTransfer({ target: 'VENUS', departureMs, tofDays: 10 }, {
      getPlanetState: getState,
      solveLambert: solve,
    });

    expect(result.valid).toBe(true);
    expect(result.target).toBe('Venus');
    expect(result.vInfDeparture).toBe(2);
    expect(result.vInfArrival).toBe(3);
    expect(result.c3).toBe(4);
    expect(result.cost).toBe(5);
    expect(solve).toHaveBeenCalledWith([1, 0, 0], [0, 2, 0], 864000, {
      referenceNormal: PROGRADE_NORMAL,
    });
    expect(getState.mock.calls.map(([body]) => body)).toEqual(['Earth', 'Venus']);
  });

  it('reuses an optional cached Earth departure state', () => {
    const departureState = { r: [1, 0, 0], v: [0, 1, 0] };
    const getState = vi.fn(() => ({ r: [0, 1, 0], v: [-1, 0, 0] }));
    const result = computeTransfer({
      target: 'Mars',
      departureMs: Date.parse('2026-07-01T00:00:00Z'),
      tofDays: 100,
    }, {
      departureState,
      getPlanetState: getState,
      solveLambert: () => ({ valid: true, v1: [0, 2, 0], v2: [0, 1, 0], transferAngle: 1 }),
    });

    expect(result.valid).toBe(true);
    expect(result.r1).toEqual(departureState.r);
    expect(getState).toHaveBeenCalledTimes(1);
    expect(getState).toHaveBeenCalledWith('Mars', expect.any(Date));
  });

  it('returns invalid NaN metrics and vectors for bad requests and physical failures', () => {
    const validRequest = {
      target: 'Mars',
      departureMs: Date.parse('2026-07-01T00:00:00Z'),
      tofDays: 100,
    };
    const cases = [
      [{ ...validRequest, target: 'Earth' }, undefined],
      [{ ...validRequest, departureMs: NaN }, undefined],
      [{ ...validRequest, departureMs: 8.65e15 }, undefined],
      [{ ...validRequest, tofDays: 0 }, undefined],
      [{ ...validRequest, tofDays: -1 }, undefined],
      [{ ...validRequest, tofDays: NaN }, undefined],
      [validRequest, { getPlanetState: () => { throw new Error('ephemeris broke'); } }],
      [validRequest, { getPlanetState: () => ({ r: [NaN, 0, 0], v: [0, 0, 0] }) }],
      [validRequest, { solveLambert: () => ({ valid: false, reason: 'singular geometry' }) }],
      [validRequest, { solveLambert: () => { throw new Error('solver broke'); } }],
    ];

    for (const [request, dependencies] of cases) {
      const result = computeTransfer(request, dependencies);
      expect(result.valid).toBe(false);
      expect(typeof result.reason).toBe('string');
      expect([result.r1, result.r2, result.v1, result.v2].flat().every(Number.isNaN)).toBe(true);
      expect([
        result.vInfDeparture,
        result.vInfArrival,
        result.c3,
        result.cost,
        result.transferAngle,
      ].every(Number.isNaN)).toBe(true);
    }
  });

  it('rejects an arrival outside the supported Unix Date range without calling dependencies', () => {
    const getState = vi.fn();
    const result = computeTransfer({
      target: 'Mars',
      departureMs: Date.parse('2026-07-01T00:00:00Z'),
      tofDays: 1e12,
    }, { getPlanetState: getState });

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/arrival epoch/);
    expect(getState).not.toHaveBeenCalled();
  });

  it('computes v-infinity magnitudes as Euclidean differences', () => {
    const getPlanetStateMock = vi.fn((body) => body === 'Earth'
      ? { r: [1, 0, 0], v: [3, 4, 0] }
      : { r: [0, 1, 0], v: [0, 0, 2] });
    const result = computeTransfer({
      target: 'Jupiter',
      departureMs: Date.parse('2026-07-01T00:00:00Z'),
      tofDays: 300,
    }, {
      getPlanetState: getPlanetStateMock,
      solveLambert: () => ({ valid: true, v1: [0, 0, 0], v2: [3, 4, 2], transferAngle: 2.4 }),
    });

    expect(result.valid).toBe(true);
    expect(result.vInfDeparture).toBe(Math.hypot(3, 4));
    expect(result.vInfArrival).toBe(Math.hypot(3, 4));
    expect(vectorMagnitudeDifference(result.v1, [0, 0, 0])).toBe(0);
  });
});
