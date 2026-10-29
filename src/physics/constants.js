/** Physical constants used at the physics boundary; distances are in km. */
export const AU_KM = 149597870.7;
export const SECONDS_PER_DAY = 86400;
export const MU_SUN_KM3_S2 = 1.32712440018e11;
export const MU_EARTH_KM3_S2 = 398600.4418;
export const EARTH_RADIUS_KM = 6378;

/** Frozen collection of the project's fixed physical constants. */
export const PHYSICS = Object.freeze({
  AU_KM,
  SECONDS_PER_DAY,
  MU_SUN_KM3_S2,
  MU_EARTH_KM3_S2,
  EARTH_RADIUS_KM,
});
