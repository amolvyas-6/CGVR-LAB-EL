import { EARTH_RADIUS_KM, MU_EARTH_KM3_S2 } from './constants.js';

export const DEFAULT_PROPELLANT_SETTINGS = Object.freeze({
  dryMassKg: 1000,
  specificImpulseSeconds: 320,
  pricePerKgUsd: 10,
});

const STANDARD_GRAVITY_M_S2 = 9.80665;
const EARTH_ORBIT_ALTITUDE_KM = 300;

// JPL planetary radii and DE440 GM values. For Mars and Jupiter, the
// published system GM approximates the planet GM in this estimate.
const CAPTURE_ORBITS = Object.freeze({
  Venus: Object.freeze({ radiusKm: 6051.8, gm: 324858.592, altitudeKm: 300 }),
  Mars: Object.freeze({ radiusKm: 3389.5, gm: 42828.375816, altitudeKm: 300 }),
  Jupiter: Object.freeze({ radiusKm: 69911, gm: 126712764.1, altitudeKm: 10000 }),
});

function circularOrbitBurn(excessSpeed, gm, orbitRadius) {
  const circularSpeed = Math.sqrt(gm / orbitRadius);
  const periapsisSpeed = Math.hypot(excessSpeed, Math.SQRT2 * circularSpeed);
  return periapsisSpeed - circularSpeed;
}

/** Estimate two ideal tangential burns between circular orbits for one transfer. */
export function estimatePropellant(transfer, settings = DEFAULT_PROPELLANT_SETTINGS) {
  if (!transfer?.valid || !Object.hasOwn(CAPTURE_ORBITS, transfer.target)) return null;
  const { vInfDeparture, vInfArrival } = transfer;
  if (!Number.isFinite(vInfDeparture) || vInfDeparture < 0 ||
      !Number.isFinite(vInfArrival) || vInfArrival < 0) return null;

  const { dryMassKg, specificImpulseSeconds, pricePerKgUsd } = settings ?? {};
  if (!Number.isFinite(dryMassKg) || dryMassKg <= 0 ||
      !Number.isFinite(specificImpulseSeconds) || specificImpulseSeconds <= 0) return null;

  const capture = CAPTURE_ORBITS[transfer.target];
  const departureDeltaVKmPerSec = circularOrbitBurn(
    vInfDeparture, MU_EARTH_KM3_S2, EARTH_RADIUS_KM + EARTH_ORBIT_ALTITUDE_KM,
  );
  const captureDeltaVKmPerSec = circularOrbitBurn(
    vInfArrival, capture.gm, capture.radiusKm + capture.altitudeKm,
  );
  const totalDeltaVKmPerSec = departureDeltaVKmPerSec + captureDeltaVKmPerSec;
  const massRatioExponent = (totalDeltaVKmPerSec * 1000) / STANDARD_GRAVITY_M_S2 / specificImpulseSeconds;
  const propellantKg = dryMassKg * Math.expm1(massRatioExponent);
  if (!Number.isFinite(propellantKg)) return null;

  const unitPrice = Number.isFinite(pricePerKgUsd) && pricePerKgUsd >= 0 ? pricePerKgUsd : null;
  const cost = unitPrice === null ? null : propellantKg * unitPrice;
  return {
    target: transfer.target,
    departureAltitudeKm: EARTH_ORBIT_ALTITUDE_KM,
    captureAltitudeKm: capture.altitudeKm,
    departureDeltaVKmPerSec,
    captureDeltaVKmPerSec,
    totalDeltaVKmPerSec,
    propellantKg,
    propellantCostUsd: Number.isFinite(cost) ? cost : null,
    dryMassKg,
    specificImpulseSeconds,
    pricePerKgUsd: unitPrice,
  };
}
