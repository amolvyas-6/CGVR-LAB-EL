import { describe, expect, it } from 'vitest';
import { MU_EARTH_KM3_S2 } from '../../src/physics/constants.js';
import { solveLambert } from '../../src/physics/lambert.js';
import { propagateState, sampleTrajectory } from '../../src/physics/propagate.js';

function magnitude(vector) {
  return Math.hypot(...vector);
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function orbitalInvariants(r, v, mu) {
  return {
    energy: dot(v, v) / 2 - mu / magnitude(r),
    angularMomentum: magnitude(cross(r, v)),
  };
}

describe('independent universal-variable propagation', () => {
  it('propagates the textbook Lambert departure state to its endpoint and preserves invariants', () => {
    const r0 = [5000, 10000, 2100];
    const r1 = [-14600, 2500, 7000];
    const transfer = solveLambert(r0, r1, 3600, { mu: MU_EARTH_KM3_S2 });
    const before = orbitalInvariants(r0, transfer.v1, MU_EARTH_KM3_S2);
    const after = propagateState(r0, transfer.v1, 3600, { mu: MU_EARTH_KM3_S2 });
    expect(after.valid).toBe(true);
    expect(magnitude(after.r.map((value, index) => value - r1[index]))).toBeLessThan(0.01);

    const afterInvariants = orbitalInvariants(after.r, after.v, MU_EARTH_KM3_S2);
    expect(Math.abs(afterInvariants.energy - before.energy) / Math.abs(before.energy)).toBeLessThan(1e-9);
    expect(Math.abs(afterInvariants.angularMomentum - before.angularMomentum)
      / before.angularMomentum).toBeLessThan(1e-9);
  });

  it('supports zero time, negative time, and forward/backward reversibility', () => {
    const r0 = [7000, 0, 0];
    const v0 = [0, 7.5, 1];
    expect(propagateState(r0, v0, 0, { mu: MU_EARTH_KM3_S2 })).toEqual({
      valid: true,
      r: r0,
      v: v0,
      reason: null,
    });

    const forward = propagateState(r0, v0, 2400, { mu: MU_EARTH_KM3_S2 });
    expect(forward.valid).toBe(true);
    const backward = propagateState(forward.r, forward.v, -2400, { mu: MU_EARTH_KM3_S2 });
    expect(backward.valid).toBe(true);
    expect(magnitude(backward.r.map((value, index) => value - r0[index]))).toBeLessThan(1e-7);
    expect(magnitude(backward.v.map((value, index) => value - v0[index]))).toBeLessThan(1e-10);
  });

  it('handles elliptic, near-parabolic, and hyperbolic states', () => {
    const escapeSpeed = Math.sqrt(2 * MU_EARTH_KM3_S2 / 7000);
    const states = [
      [7000, [0, 7.5, 0]],
      [7000, [0, escapeSpeed * (1 - 1e-12), 0]],
      [7000, [0, escapeSpeed, 0]],
      [7000, [0, escapeSpeed * (1 + 1e-12), 0]],
      [7000, [0, 12, 0]],
    ];
    for (const [radius, velocity] of states) {
      const state = propagateState([radius, 0, 0], velocity, 1200, { mu: MU_EARTH_KM3_S2 });
      expect(state.valid).toBe(true);
      expect(state.r.every(Number.isFinite)).toBe(true);
      expect(state.v.every(Number.isFinite)).toBe(true);
      const reverse = propagateState(state.r, state.v, -1200, { mu: MU_EARTH_KM3_S2 });
      expect(reverse.valid).toBe(true);
      expect(magnitude(reverse.r.map((value, index) => value - [radius, 0, 0][index])))
        .toBeLessThan(1e-6);
      expect(magnitude(reverse.v.map((value, index) => value - velocity[index])))
        .toBeLessThan(1e-9);
    }
  });

  it('samples a propagated conic, including exact departure and arrival epochs', () => {
    const samples = sampleTrajectory([7000, 0, 0], [0, 7.5, 1], 2400, 5, { mu: MU_EARTH_KM3_S2 });
    expect(samples.valid).toBe(true);
    expect(samples.points).toHaveLength(5);
    expect(samples.timesSeconds).toEqual([0, 600, 1200, 1800, 2400]);
    expect(samples.points[0]).toEqual([7000, 0, 0]);
    expect(samples.points[4]).toEqual(propagateState(
      [7000, 0, 0], [0, 7.5, 1], 2400, { mu: MU_EARTH_KM3_S2 },
    ).r);
    expect(samples.points[2]).not.toEqual([3500, 0, 0]);
  });

  it('returns empty failure samples and invalid state records for bad inputs', () => {
    for (const result of [
      propagateState([0, 0, 0], [0, 1, 0], 1),
      propagateState([1, 0, 0], [0, 1, 0], Infinity),
      propagateState([1, 0, 0], [0, 1, 0], 1, { mu: -1 }),
      propagateState([7000, 0, 0], [, 7.5, 0], 0),
      propagateState([7000, 0, 0], new Array(3), 0),
    ]) {
      expect(result.valid).toBe(false);
      expect(result.r.every(Number.isNaN)).toBe(true);
      expect(result.v.every(Number.isNaN)).toBe(true);
      expect(typeof result.reason).toBe('string');
    }

    for (const result of [
      sampleTrajectory([7000, 0, 0], [0, 7.5, 0], 1000, 1, { mu: MU_EARTH_KM3_S2 }),
      sampleTrajectory([7000, 0, 0], [0, 7.5, 0], NaN, 10, { mu: MU_EARTH_KM3_S2 }),
      sampleTrajectory([7000, 0, 0], [0, 7.5, 0], 1000, 10, { mu: 0 }),
    ]) {
      expect(result.valid).toBe(false);
      expect(result.points).toEqual([]);
      expect(result.timesSeconds).toEqual([]);
    }
  });
});
