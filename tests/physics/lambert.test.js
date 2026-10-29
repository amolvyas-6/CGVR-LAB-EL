import { describe, expect, it } from 'vitest';
import { AU_KM, MU_EARTH_KM3_S2, MU_SUN_KM3_S2, SECONDS_PER_DAY } from '../../src/physics/constants.js';
import { solveLambert } from '../../src/physics/lambert.js';
import { propagateState } from '../../src/physics/propagate.js';

function magnitude(vector) {
  return Math.hypot(...vector);
}

function relativeError(actual, expected) {
  return Math.abs(actual - expected) / Math.max(Math.abs(expected), Number.MIN_VALUE);
}

describe('zero-revolution universal-variable Lambert solver', () => {
  it('matches the textbook Curtis Earth example', () => {
    const result = solveLambert(
      [5000, 10000, 2100],
      [-14600, 2500, 7000],
      3600,
      { mu: MU_EARTH_KM3_S2 },
    );

    expect(result.valid).toBe(true);
    expect(result.v1[0]).toBeCloseTo(-5.9925, 3);
    expect(result.v1[1]).toBeCloseTo(1.9254, 3);
    expect(result.v1[2]).toBeCloseTo(3.2456, 3);
    expect(result.v2[0]).toBeCloseTo(-3.3125, 3);
    expect(result.v2[1]).toBeCloseTo(-4.1966, 3);
    expect(result.v2[2]).toBeCloseTo(-0.38529, 3);
    expect(result.iterations).toBeLessThanOrEqual(200);

    const end = propagateState([5000, 10000, 2100], result.v1, 3600, { mu: MU_EARTH_KM3_S2 });
    expect(end.valid).toBe(true);
    expect(magnitude(end.r.map((value, index) => value - [-14600, 2500, 7000][index]))).toBeLessThan(0.01);
  });

  it('uses analytic circular-orbit Hohmann values as a reference', () => {
    const rEarth = AU_KM;
    const rMars = 1.524 * AU_KM;
    const transferSemiMajorAxis = (rEarth + rMars) / 2;
    const tof = Math.PI * Math.sqrt(transferSemiMajorAxis ** 3 / MU_SUN_KM3_S2);
    const transferSpeedDeparture = Math.sqrt(
      MU_SUN_KM3_S2 * (2 / rEarth - 1 / transferSemiMajorAxis),
    );
    const transferSpeedArrival = Math.sqrt(
      MU_SUN_KM3_S2 * (2 / rMars - 1 / transferSemiMajorAxis),
    );
    const expectedDepartureVInf = transferSpeedDeparture - Math.sqrt(MU_SUN_KM3_S2 / rEarth);
    const expectedArrivalVInf = Math.sqrt(MU_SUN_KM3_S2 / rMars) - transferSpeedArrival;

    expect(tof / SECONDS_PER_DAY).toBeCloseTo(258.915, 2);
    expect(expectedDepartureVInf).toBeCloseTo(2.946, 2);
    expect(expectedArrivalVInf).toBeCloseTo(2.650, 2);
  });

  it('solves near-Hohmann transfers on both sides of pi without nudging exact pi', () => {
    const rEarth = AU_KM;
    const rMars = 1.524 * AU_KM;
    const tof = Math.PI * Math.sqrt(((rEarth + rMars) / 2) ** 3 / MU_SUN_KM3_S2);
    for (const offset of [-1e-4, 1e-4]) {
      const angle = Math.PI + offset;
      const result = solveLambert(
        [rEarth, 0, 0],
        [rMars * Math.cos(angle), rMars * Math.sin(angle), 0],
        tof,
      );
      expect(result.valid).toBe(true);
      expect(result.transferAngle).toBeCloseTo(Math.PI + offset, 7);
      expect(result.z).toBeGreaterThan(-1e6);
      expect(result.z).toBeLessThan((2 * Math.PI) ** 2);
      expect(result.v1.every(Number.isFinite)).toBe(true);
      expect(result.v2.every(Number.isFinite)).toBe(true);
      expect(result.iterations).toBeLessThanOrEqual(200);
      const end = propagateState([rEarth, 0, 0], result.v1, tof);
      expect(end.valid).toBe(true);
      const endpoint = [rMars * Math.cos(angle), rMars * Math.sin(angle), 0];
      expect(magnitude(end.r.map((value, index) => value - endpoint[index]))).toBeLessThan(0.01);
      const departureVInf = magnitude(result.v1.map((value, index) => value - [0, Math.sqrt(MU_SUN_KM3_S2 / rEarth), 0][index]));
      const marsVelocity = [
        -Math.sqrt(MU_SUN_KM3_S2 / rMars) * Math.sin(angle),
        Math.sqrt(MU_SUN_KM3_S2 / rMars) * Math.cos(angle),
        0,
      ];
      const arrivalVInf = magnitude(result.v2.map((value, index) => value - marsVelocity[index]));
      expect(departureVInf).toBeCloseTo(2.946, 2);
      expect(arrivalVInf).toBeCloseTo(2.650, 2);
    }
  });

  it('honours prograde orientation with an inclined reference normal', () => {
    const referenceNormal = [0, 1, 1];
    const result = solveLambert([7000, 0, 0], [0, 7000, 0], 1200, {
      mu: MU_EARTH_KM3_S2,
      prograde: true,
      referenceNormal,
    });
    expect(result.valid).toBe(true);
    expect(result.transferAngle).toBeCloseTo(Math.PI / 2, 14);
    const retrograde = solveLambert([7000, 0, 0], [0, 7000, 0], 1200, {
      mu: MU_EARTH_KM3_S2,
      prograde: false,
      referenceNormal: [0, 0, 1],
    });
    expect(retrograde.valid).toBe(true);
    expect(retrograde.transferAngle).toBeCloseTo(3 * Math.PI / 2, 14);
    const opposite = solveLambert([7000, 0, 0], [0, 7000, 0], 1200, {
      mu: MU_EARTH_KM3_S2,
      prograde: true,
      referenceNormal: [0, 1e308, -1e308],
    });
    expect(opposite.valid).toBe(true);
    expect(opposite.transferAngle).toBeCloseTo(3 * Math.PI / 2, 14);
  });

  it('returns invalid NaN-vector records at singular and invalid boundaries', () => {
    const cases = [
      [[1, 0, 0], [-1, 0, 0], 10, {}],
      [[1, 0, 0], [2, 0, 0], 10, {}],
      [[0, 0, 0], [1, 0, 0], 10, {}],
      [[1, 0, 0], [0, 1, 0], 0, {}],
      [[1, 0, 0], [0, 1, 0], 10, { mu: 0 }],
      [[1, 0, 0], [0, 1, 0], 10, { referenceNormal: [0, 0, 0] }],
      [[1, 0], [0, 1, 0], 10, {}],
    ];
    for (const [r1, r2, tof, options] of cases) {
      const result = solveLambert(r1, r2, tof, options);
      expect(result.valid).toBe(false);
      expect(result.v1.every(Number.isNaN)).toBe(true);
      expect(result.v2.every(Number.isNaN)).toBe(true);
      expect(typeof result.reason).toBe('string');
    }
  });

  it('rejects exact pi even when the endpoint was formed trigonometrically', () => {
    const result = solveLambert(
      [AU_KM, 0, 0],
      [1.524 * AU_KM * Math.cos(Math.PI), 1.524 * AU_KM * Math.sin(Math.PI), 0],
      258.9 * SECONDS_PER_DAY,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/collinear|180/);
  });

  it('masks ill-conditioned nearly collinear inputs instead of returning a false success', () => {
    for (const offset of [-1.01e-12, 1.01e-12, 1e-8]) {
      const angle = Math.PI + offset;
      const result = solveLambert(
        [AU_KM, 0, 0],
        [1.524 * AU_KM * Math.cos(angle), 1.524 * AU_KM * Math.sin(angle), 0],
        259 * SECONDS_PER_DAY,
      );
      expect(result.valid).toBe(false);
      expect(result.v1.every(Number.isNaN)).toBe(true);
    }
    const angle = Math.PI - 1.1e-7;
    const r2 = [1.524 * AU_KM * Math.cos(angle), 1.524 * AU_KM * Math.sin(angle), 0];
    const result = solveLambert([AU_KM, 0, 0], r2, 259 * SECONDS_PER_DAY);
    expect(result.valid).toBe(true);
    const end = propagateState([AU_KM, 0, 0], result.v1, 259 * SECONDS_PER_DAY);
    expect(magnitude(end.r.map((x, i) => x - r2[i]))).toBeLessThan(1);
  });

  it('rejects finite-looking near-collinear solutions that fail long-TOF endpoint closure', () => {
    const angle = Math.PI - 1.01e-7;
    const r2 = [1.524 * AU_KM * Math.cos(angle), 1.524 * AU_KM * Math.sin(angle), 0];
    const result = solveLambert([AU_KM, 0, 0], r2, 1200 * SECONDS_PER_DAY);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/close the endpoint/);
  });
});
