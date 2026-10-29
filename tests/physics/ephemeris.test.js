import { describe, expect, it } from 'vitest';
import {
  Body,
  BaryState,
  HelioVector,
  RotateState,
  RotateVector,
  Rotation_EQJ_ECL,
  StateVector,
} from 'astronomy-engine';
import { dot, cross, magnitude } from '../../src/physics/vector.js';
import { AU_KM } from '../../src/physics/constants.js';
import { formatUTCDate, parseUTCDate } from '../../src/physics/units.js';
import {
  FRAME,
  getPlanetPosition,
  getPlanetState,
  PROGRADE_NORMAL,
} from '../../src/physics/ephemeris.js';

const SAMPLE_DATE = new Date('2026-07-01T00:00:00.000Z');
const EQJ_TO_ECL = Rotation_EQJ_ECL();

function expectedHeliocentricState(body, date) {
  const planet = BaryState(body, date);
  const sun = BaryState(Body.Sun, date);
  const relativeEQJ = new StateVector(
    planet.x - sun.x,
    planet.y - sun.y,
    planet.z - sun.z,
    planet.vx - sun.vx,
    planet.vy - sun.vy,
    planet.vz - sun.vz,
    planet.t,
  );
  const ecliptic = RotateState(EQJ_TO_ECL, relativeEQJ);
  const distanceScale = AU_KM;
  const speedScale = AU_KM / 86400;

  return {
    r: [ecliptic.x, ecliptic.y, ecliptic.z].map((value) => value * distanceScale),
    v: [ecliptic.vx, ecliptic.vy, ecliptic.vz].map((value) => value * speedScale),
  };
}

function expectVectorsClose(actual, expected, digits = 8) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => {
    expect(value).toBeCloseTo(expected[index], digits);
  });
}

describe('ephemeris boundary', () => {
  it('declares a fixed J2000 mean-ecliptic frame and prograde normal', () => {
    expect(FRAME.name).toContain('J2000 mean ecliptic');
    expect(FRAME.orientation).toContain('Fixed');
    expect(FRAME.positionUnit).toBe('km');
    expect(FRAME.velocityUnit).toBe('km/s');
    expect(PROGRADE_NORMAL).toEqual([0, 0, 1]);
    expect(Object.isFrozen(FRAME)).toBe(true);
    expect(Object.isFrozen(PROGRADE_NORMAL)).toBe(true);
  });

  it('returns Sun and all eight scene planets with finite states and positions', () => {
    for (const name of [
      'Sun',
      'Mercury',
      'Venus',
      'Earth',
      'Mars',
      'Jupiter',
      'Saturn',
      'Uranus',
      'Neptune',
    ]) {
      const state = getPlanetState(name, SAMPLE_DATE);
      const position = getPlanetPosition(name, SAMPLE_DATE);

      expect(state.r).toHaveLength(3);
      expect(state.v).toHaveLength(3);
      expect(position).toHaveLength(3);
      expect([...state.r, ...state.v, ...position].every(Number.isFinite)).toBe(true);
    }
  });

  it('uses the barycentric planet-minus-Sun state, rotated and converted at the boundary', () => {
    const actual = getPlanetState('Earth', SAMPLE_DATE);
    const expected = expectedHeliocentricState(Body.Earth, SAMPLE_DATE);

    expectVectorsClose(actual.r, expected.r, 8);
    expectVectorsClose(actual.v, expected.v, 10);
  });

  it('returns a zero heliocentric state for the Sun', () => {
    expect(getPlanetState('Sun', SAMPLE_DATE)).toEqual({
      r: [0, 0, 0],
      v: [0, 0, 0],
    });
    expect(getPlanetPosition('Sun', SAMPLE_DATE)).toEqual([0, 0, 0]);
  });

  it('matches the position-only HelioVector path in the same fixed frame', () => {
    const eqj = HelioVector(Body.Earth, SAMPLE_DATE);
    const ecliptic = RotateVector(EQJ_TO_ECL, eqj);
    const expected = [ecliptic.x, ecliptic.y, ecliptic.z].map((value) => value * AU_KM);
    const position = getPlanetPosition('Earth', SAMPLE_DATE);

    expectVectorsClose(position, expected, 8);
    expectVectorsClose(position, getPlanetState('Earth', SAMPLE_DATE).r, 8);
  });

  it('has plausible Earth distance and speed with prograde angular momentum', () => {
    const { r, v } = getPlanetState('Earth', SAMPLE_DATE);
    const distanceAU = magnitude(r) / AU_KM;
    const speed = magnitude(v);
    const angularMomentum = cross(r, v);

    expect(distanceAU).toBeGreaterThan(0.95);
    expect(distanceAU).toBeLessThan(1.05);
    expect(speed).toBeGreaterThan(28);
    expect(speed).toBeLessThan(31);
    expect(dot(angularMomentum, PROGRADE_NORMAL)).toBeGreaterThan(0);
  });

  it('agrees with a central finite-difference velocity over plus/minus 60 seconds', () => {
    const offsetMs = 60 * 1000;
    const before = getPlanetPosition('Earth', new Date(SAMPLE_DATE.getTime() - offsetMs));
    const after = getPlanetPosition('Earth', new Date(SAMPLE_DATE.getTime() + offsetMs));
    const velocity = getPlanetState('Earth', SAMPLE_DATE).v;
    const finiteDifference = after.map((component, index) =>
      (component - before[index]) / (2 * 60),
    );

    expect(magnitude(finiteDifference.map((component, index) => component - velocity[index])))
      .toBeLessThan(1e-4);
  });

  it('preserves a selected UTC date through the ephemeris call', () => {
    const selectedDate = parseUTCDate('2026-07-01');
    const selectedTime = selectedDate.getTime();

    expect(formatUTCDate(selectedDate)).toBe('2026-07-01');
    expect(getPlanetState('Mars', selectedDate).r.every(Number.isFinite)).toBe(true);
    expect(selectedDate.getTime()).toBe(selectedTime);
    expect(selectedDate.toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });

  it('accepts planet names case-insensitively', () => {
    expectVectorsClose(
      getPlanetPosition('earth', SAMPLE_DATE),
      getPlanetPosition('Earth', SAMPLE_DATE),
      12,
    );
  });

  it('rejects unsupported bodies and non-Date or invalid Date inputs clearly', () => {
    for (const getEphemerisValue of [getPlanetState, getPlanetPosition]) {
      expect(() => getEphemerisValue('Vulcan', SAMPLE_DATE)).toThrow(RangeError);
      expect(() => getEphemerisValue(null, SAMPLE_DATE)).toThrow(TypeError);
      expect(() => getEphemerisValue('Earth', 1798761600000)).toThrow(TypeError);
      expect(() => getEphemerisValue('Earth', '2026-07-01')).toThrow(TypeError);
      expect(() => getEphemerisValue('Earth', new Date(NaN))).toThrow(RangeError);
    }
  });
});
