import { describe, expect, it } from 'vitest';
import {
  add,
  cross,
  dot,
  magnitude,
  normalize,
  scale,
  subtract,
} from '../../src/physics/vector.js';

describe('plain-array vector helpers', () => {
  it('performs generic three-dimensional vector operations', () => {
    const a = [1, 2, 3];
    const b = [4, -5, 6];
    expect(add(a, b)).toEqual([5, -3, 9]);
    expect(subtract(a, b)).toEqual([-3, 7, -3]);
    expect(scale(a, 2)).toEqual([2, 4, 6]);
    expect(dot(a, b)).toBe(12);
    expect(cross(a, b)).toEqual([27, 6, -13]);
    expect(magnitude([3, 4, 0])).toBe(5);
    const direction = normalize([0, 3, 4]);
    expect(direction[0]).toBe(0);
    expect(direction[1]).toBeCloseTo(0.6, 14);
    expect(direction[2]).toBeCloseTo(0.8, 14);
    expect(a).toEqual([1, 2, 3]);
  });

  it('rejects malformed vectors, non-finite values, and invalid scalars', () => {
    for (const invalid of [null, [1, 2], [1, 2, 3, 4], new Float64Array([1, 2, 3]), [1, NaN, 3]]) {
      expect(() => magnitude(invalid)).toThrow(TypeError);
    }
    expect(() => scale([1, 2, 3], Infinity)).toThrow(TypeError);
  });

  it('rejects zero normalization and arithmetic overflow', () => {
    expect(() => normalize([0, 0, 0])).toThrow(RangeError);
    expect(() => scale([Number.MAX_VALUE, 0, 0], 2)).toThrow(RangeError);
  });

  it('normalizes representable directions with huge or subnormal components', () => {
    for (const component of [Number.MAX_VALUE, Number.MIN_VALUE]) {
      const direction = normalize([component, component, 0]);
      expect(direction[0]).toBeCloseTo(Math.SQRT1_2, 14);
      expect(direction[1]).toBeCloseTo(Math.SQRT1_2, 14);
      expect(direction[2]).toBe(0);
      expect(magnitude(direction)).toBeCloseTo(1, 14);
    }
  });
});
