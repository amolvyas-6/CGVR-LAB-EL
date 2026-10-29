import { describe, expect, it } from 'vitest';
import { uvToCell } from '../../src/app/plotPicking.js';

describe('uvToCell', () => {
  it('maps all four texture corners to the matching edge cells', () => {
    expect(uvToCell(0, 0, 60, 40)).toEqual({ i: 0, j: 0, index: 0 });
    expect(uvToCell(1, 0, 60, 40)).toEqual({ i: 59, j: 0, index: 59 });
    expect(uvToCell(0, 1, 60, 40)).toEqual({ i: 0, j: 39, index: 2340 });
    expect(uvToCell(1, 1, 60, 40)).toEqual({ i: 59, j: 39, index: 2399 });
  });

  it('maps interior UV values by floor into row-major cells', () => {
    expect(uvToCell(0.5, 0.5, 8, 6)).toEqual({ i: 4, j: 3, index: 28 });
    expect(uvToCell(0.249, 0.499, 8, 6)).toEqual({ i: 1, j: 2, index: 17 });
  });

  it('clamps coordinates outside the plane to its edge cells', () => {
    expect(uvToCell(-2, 0.2, 4, 5)).toEqual({ i: 0, j: 1, index: 4 });
    expect(uvToCell(2, 3, 4, 5)).toEqual({ i: 3, j: 4, index: 19 });
  });

  it('returns null for non-finite coordinates', () => {
    expect(uvToCell(Number.NaN, 0.5, 4, 5)).toBeNull();
    expect(uvToCell(0.5, Number.POSITIVE_INFINITY, 4, 5)).toBeNull();
    expect(uvToCell(Number.NEGATIVE_INFINITY, 0.5, 4, 5)).toBeNull();
  });

  it('rejects invalid or unsafe grid dimensions', () => {
    expect(uvToCell(0.5, 0.5, 0, 5)).toBeNull();
    expect(uvToCell(0.5, 0.5, 4.5, 5)).toBeNull();
    expect(uvToCell(0.5, 0.5, Number.MAX_SAFE_INTEGER, 2)).toBeNull();
  });
});
