import { describe, expect, it } from 'vitest';
import { stumpff } from '../../src/physics/stumpff.js';

describe('universal-variable Stumpff functions', () => {
  it('returns the exact parabolic-limit values at zero', () => {
    expect(stumpff(0)).toEqual({ C: 0.5, S: 1 / 6 });
  });

  it('uses a stable series on either side of zero', () => {
    for (const z of [-1e-12, -1e-8, 1e-12, 1e-8]) {
      const { C, S } = stumpff(z);
      expect(C).toBeCloseTo(0.5 - z / 24 + z * z / 720, 15);
      expect(S).toBeCloseTo(1 / 6 - z / 120 + z * z / 5040, 15);
    }
  });

  it('matches the trigonometric and hyperbolic definitions away from zero', () => {
    for (const z of [1, 20]) {
      const root = Math.sqrt(z);
      const result = stumpff(z);
      expect(result.C).toBeCloseTo((1 - Math.cos(root)) / z, 14);
      expect(result.S).toBeCloseTo((root - Math.sin(root)) / root ** 3, 14);
    }
    for (const z of [-1, -20]) {
      const root = Math.sqrt(-z);
      const result = stumpff(z);
      expect(result.C).toBeCloseTo((Math.cosh(root) - 1) / (-z), 14);
      expect(result.S).toBeCloseTo((Math.sinh(root) - root) / root ** 3, 14);
    }
  });

  it('reports non-finite input and hyperbolic overflow without throwing', () => {
    expect(stumpff(NaN)).toEqual({ C: NaN, S: NaN });
    expect(stumpff(Infinity)).toEqual({ C: NaN, S: NaN });
    expect(stumpff(-1e6)).toEqual({ C: NaN, S: NaN });
  });
});
