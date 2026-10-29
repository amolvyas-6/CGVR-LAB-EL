import {
  Body,
  HelioState,
  HelioVector,
  RotateState,
  RotateVector,
  Rotation_EQJ_ECL,
} from 'astronomy-engine';
import { auPerDayToKmPerSecond, auToKm } from './units.js';

const BODY_BY_NAME = new Map(
  [
    'Sun',
    'Mercury',
    'Venus',
    'Earth',
    'Mars',
    'Jupiter',
    'Saturn',
    'Uranus',
    'Neptune',
    'Pluto',
  ].map((name) => [name.toLowerCase(), Body[name]]),
);

// This is a fixed J2000 orientation. Do not substitute ecliptic-of-date (ECT)
// rotation: all position and velocity vectors share these same inertial axes.
const J2000_EQJ_TO_ECL = Rotation_EQJ_ECL();

/** Human-readable description of the frame returned by this module. */
export const FRAME = Object.freeze({
  name: 'Heliocentric J2000 mean ecliptic',
  origin: 'Sun center',
  orientation: 'Fixed, right-handed J2000 mean ecliptic (ECL) axes',
  positionUnit: 'km',
  velocityUnit: 'km/s',
});

/** Positive angular-momentum direction for prograde motion in FRAME. */
export const PROGRADE_NORMAL = Object.freeze([0, 0, 1]);

function resolveBody(body) {
  if (typeof body !== 'string') {
    throw new TypeError('body must be a supported planet name or Sun');
  }

  const astronomyBody = BODY_BY_NAME.get(body.toLowerCase());
  if (!astronomyBody) {
    throw new RangeError(`unsupported ephemeris body: ${body}`);
  }
  return astronomyBody;
}

function requireDate(date) {
  if (!(date instanceof Date)) {
    throw new TypeError('date must be a valid Date object');
  }
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError('date must be a valid Date object');
  }
}

function requireFiniteComponents(components, name) {
  if (!components.every(Number.isFinite)) {
    throw new RangeError(`Astronomy Engine returned a non-finite ${name}`);
  }
}

/**
 * Return a heliocentric state in fixed J2000 mean-ecliptic axes.
 *
 * @param {string} body Sun or a planet name (case-insensitive).
 * @param {Date} date A valid UTC instant. Unix-millisecond numbers are rejected.
 * @returns {{r: [number, number, number], v: [number, number, number]}}
 *          Position in km and velocity in km/s.
 */
export function getPlanetState(body, date) {
  const astronomyBody = resolveBody(body);
  requireDate(date);

  const ecliptic = RotateState(
    J2000_EQJ_TO_ECL,
    HelioState(astronomyBody, date),
  );
  const positionAU = [ecliptic.x, ecliptic.y, ecliptic.z];
  const velocityAUPerDay = [ecliptic.vx, ecliptic.vy, ecliptic.vz];
  requireFiniteComponents(positionAU, 'position');
  requireFiniteComponents(velocityAUPerDay, 'velocity');

  return {
    r: positionAU.map(auToKm),
    v: velocityAUPerDay.map(auPerDayToKmPerSecond),
  };
}

/**
 * Return a heliocentric position in fixed J2000 mean-ecliptic axes.
 *
 * @param {string} body Sun or a planet name (case-insensitive).
 * @param {Date} date A valid UTC instant. Unix-millisecond numbers are rejected.
 * @returns {[number, number, number]} Position in km.
 */
export function getPlanetPosition(body, date) {
  const astronomyBody = resolveBody(body);
  requireDate(date);

  const ecliptic = RotateVector(
    J2000_EQJ_TO_ECL,
    HelioVector(astronomyBody, date),
  );
  const positionAU = [ecliptic.x, ecliptic.y, ecliptic.z];
  requireFiniteComponents(positionAU, 'position');
  return positionAU.map(auToKm);
}
