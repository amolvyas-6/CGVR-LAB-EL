import { describe, expect, it } from 'vitest';
import {
  AU_KM,
  EARTH_RADIUS_KM,
  MU_EARTH_KM3_S2,
  MU_SUN_KM3_S2,
  PHYSICS,
  SECONDS_PER_DAY,
} from '../../src/physics/constants.js';

describe('physics constants', () => {
  it('exports the approved values individually and in a frozen collection', () => {
    expect(AU_KM).toBe(149597870.7);
    expect(SECONDS_PER_DAY).toBe(86400);
    expect(MU_SUN_KM3_S2).toBe(1.32712440018e11);
    expect(MU_EARTH_KM3_S2).toBe(398600.4418);
    expect(EARTH_RADIUS_KM).toBe(6378);
    expect(PHYSICS).toEqual({
      AU_KM,
      SECONDS_PER_DAY,
      MU_SUN_KM3_S2,
      MU_EARTH_KM3_S2,
      EARTH_RADIUS_KM,
    });
    expect(Object.isFrozen(PHYSICS)).toBe(true);
  });
});
