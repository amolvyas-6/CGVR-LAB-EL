import { PROGRADE_NORMAL, getPlanetState } from './ephemeris.js';
import { solveLambert } from './lambert.js';
import { SECONDS_PER_DAY } from './constants.js';

const MILLISECONDS_PER_DAY = SECONDS_PER_DAY * 1000;
const TARGETS = new Map(['Venus', 'Mars', 'Jupiter'].map((name) => [name.toLowerCase(), name]));
const NAN_VECTOR = () => [NaN, NaN, NaN];

function canonicalTarget(target) {
  if (typeof target !== 'string') return null;
  return TARGETS.get(target.trim().toLowerCase()) ?? null;
}

function finiteVector(vector) {
  if (!Array.isArray(vector) || vector.length !== 3) return false;
  for (let index = 0; index < 3; index += 1) {
    if (typeof vector[index] !== 'number' || !Number.isFinite(vector[index])) return false;
  }
  return true;
}

function validDateMs(epochMs) {
  return typeof epochMs === 'number'
    && Number.isFinite(epochMs)
    && Number.isFinite(new Date(epochMs).getTime());
}

function invalidResult(input, target, reason, arrivalMs = NaN, tofSeconds = NaN) {
  return {
    valid: false,
    target: target ?? input.target,
    departureMs: typeof input.departureMs === 'number' && Number.isFinite(input.departureMs)
      ? input.departureMs
      : NaN,
    arrivalMs,
    tofDays: typeof input.tofDays === 'number' && Number.isFinite(input.tofDays)
      ? input.tofDays
      : NaN,
    tofSeconds,
    r1: NAN_VECTOR(),
    r2: NAN_VECTOR(),
    v1: NAN_VECTOR(),
    v2: NAN_VECTOR(),
    vInfDeparture: NaN,
    vInfArrival: NaN,
    c3: NaN,
    cost: NaN,
    transferAngle: NaN,
    reason,
  };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Compute an Earth-origin, prograde transfer to Venus, Mars, or Jupiter.
 * Distances and velocities use the fixed frame and units of ephemeris.js.
 * Optional dependencies ({getPlanetState, solveLambert, departureState}) are
 * intended for deterministic tests and reuse of a cached Earth state.
 */
export function computeTransfer(input, dependencies = {}) {
  const request = input && typeof input === 'object' ? input : {};
  const target = canonicalTarget(request.target);

  if (!target) return invalidResult(request, null, `unsupported target: ${String(request.target)}`);
  if (!validDateMs(request.departureMs)) {
    return invalidResult(request, target, 'departureMs must be a valid Unix-millisecond epoch');
  }
  if (typeof request.tofDays !== 'number' || !Number.isFinite(request.tofDays) || request.tofDays <= 0) {
    return invalidResult(request, target, 'tofDays must be a positive finite number');
  }

  const tofSeconds = request.tofDays * SECONDS_PER_DAY;
  const arrivalMs = request.departureMs + request.tofDays * MILLISECONDS_PER_DAY;
  if (!Number.isFinite(tofSeconds) || !Number.isFinite(arrivalMs) || !validDateMs(arrivalMs)) {
    return invalidResult(request, target, 'arrival epoch or time of flight is outside the supported range');
  }
  if (new Date(arrivalMs).getTime() <= new Date(request.departureMs).getTime()) {
    return invalidResult(request, target, 'arrival epoch must be later than departure at Date precision', arrivalMs, tofSeconds);
  }

  try {
    if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
      throw new TypeError('dependencies must be an object');
    }

    const stateProvider = dependencies.getPlanetState ?? getPlanetState;
    const lambertSolver = dependencies.solveLambert ?? solveLambert;
    if (typeof stateProvider !== 'function') throw new TypeError('getPlanetState dependency must be a function');
    if (typeof lambertSolver !== 'function') throw new TypeError('solveLambert dependency must be a function');

    const departureState = dependencies.departureState
      ?? stateProvider('Earth', new Date(request.departureMs));
    const arrivalState = stateProvider(target, new Date(arrivalMs));
    if (!departureState || !finiteVector(departureState.r) || !finiteVector(departureState.v)) {
      throw new RangeError('Earth departure state must contain finite r and v vectors');
    }
    if (!arrivalState || !finiteVector(arrivalState.r) || !finiteVector(arrivalState.v)) {
      throw new RangeError(`${target} arrival state must contain finite r and v vectors`);
    }

    const r1 = departureState.r.slice();
    const r2 = arrivalState.r.slice();
    const lambert = lambertSolver(r1, r2, tofSeconds, { referenceNormal: PROGRADE_NORMAL });
    if (!lambert || lambert.valid !== true) {
      throw new RangeError(lambert?.reason || 'Lambert solver did not find a valid transfer');
    }
    if (!finiteVector(lambert.v1) || !finiteVector(lambert.v2) || !Number.isFinite(lambert.transferAngle)) {
      throw new RangeError('Lambert solution must contain finite velocities and transfer angle');
    }

    const v1 = lambert.v1.slice();
    const v2 = lambert.v2.slice();
    const vInfDeparture = Math.hypot(...v1.map((component, index) => component - departureState.v[index]));
    const vInfArrival = Math.hypot(...v2.map((component, index) => component - arrivalState.v[index]));
    const c3 = vInfDeparture ** 2;
    const cost = vInfDeparture + vInfArrival;
    if (![vInfDeparture, vInfArrival, c3, cost].every(Number.isFinite)) {
      throw new RangeError('transfer metrics exceeded the supported numeric range');
    }

    return {
      valid: true,
      target,
      departureMs: request.departureMs,
      arrivalMs,
      tofDays: request.tofDays,
      tofSeconds,
      r1,
      r2,
      v1,
      v2,
      vInfDeparture,
      vInfArrival,
      c3,
      cost,
      transferAngle: lambert.transferAngle,
      reason: null,
    };
  } catch (error) {
    return invalidResult(request, target, errorMessage(error), arrivalMs, tofSeconds);
  }
}
