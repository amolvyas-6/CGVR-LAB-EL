import { MU_SUN_KM3_S2 } from './constants.js';
import { stumpff } from './stumpff.js';

const MAX_BRACKET_EXPANSIONS = 64;
const MAX_BISECTION_ITERATIONS = 120;
const MAX_TRAJECTORY_POINTS = 10000;

function invalidState(reason) {
  return { valid: false, r: [NaN, NaN, NaN], v: [NaN, NaN, NaN], reason };
}

function invalidTrajectory(reason) {
  return { valid: false, points: [], timesSeconds: [], reason };
}

function vector3(value) {
  return Array.isArray(value)
    && value.length === 3
    && [0, 1, 2].every((index) => typeof value[index] === 'number' && Number.isFinite(value[index]));
}

function norm(vector) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function finiteVector(vector) {
  return vector.length === 3 && vector.every(Number.isFinite);
}

function scales(length, mu) {
  const logLength = Math.log(length);
  const logMu = Math.log(mu);
  const time = Math.exp(1.5 * logLength - 0.5 * logMu);
  const velocity = Math.exp(0.5 * (logMu - logLength));
  return Number.isFinite(time) && time > 0 && Number.isFinite(velocity) && velocity > 0
    ? { time, velocity }
    : null;
}

function residualTolerance(value, target) {
  return 8 * Number.EPSILON * Math.max(Math.abs(value), Math.abs(target), Number.MIN_VALUE);
}

function universalTimeEquation(x, alpha, radius, radialProduct, elapsedTime) {
  const z = alpha * x * x;
  if (!Number.isFinite(z)) return null;
  const { C, S } = stumpff(z);
  if (!Number.isFinite(C) || !Number.isFinite(S)) return null;
  const x2 = x * x;
  const x3 = x2 * x;
  const value = radialProduct * x2 * C
    + (1 - alpha * radius) * x3 * S
    + radius * x
    - elapsedTime;
  if (!Number.isFinite(value)) return null;
  return { value, z, C, S };
}

/** Propagate a two-body state with the independent universal f/g equations. */
export function propagateState(r0, v0, seconds, options = {}) {
  try {
    if (!vector3(r0) || !vector3(v0)) return invalidState('r0 and v0 must be finite three-number vectors');
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
      return invalidState('elapsed time must be a finite number');
    }
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      return invalidState('options must be an object');
    }
    const mu = options.mu ?? MU_SUN_KM3_S2;
    if (typeof mu !== 'number' || !Number.isFinite(mu) || mu <= 0) {
      return invalidState('mu must be a positive finite number');
    }

    const radius = norm(r0);
    if (!(radius > 0)) return invalidState('initial position must be nonzero');
    const unitScales = scales(radius, mu);
    if (!unitScales) return invalidState('input scales are outside the supported numeric range');
    if (seconds === 0) return { valid: true, r: [...r0], v: [...v0], reason: null };

    const position = r0.map((component) => component / radius);
    const velocity = v0.map((component) => component / unitScales.velocity);
    const elapsedTime = seconds / unitScales.time;
    if (!finiteVector(velocity) || !Number.isFinite(elapsedTime) || elapsedTime === 0) {
      return invalidState('elapsed time or velocity is outside the supported numeric range');
    }

    const speedSquared = velocity[0] ** 2 + velocity[1] ** 2 + velocity[2] ** 2;
    const radialProduct = position[0] * velocity[0]
      + position[1] * velocity[1]
      + position[2] * velocity[2];
    const alpha = 2 - speedSquared;
    if (!Number.isFinite(alpha) || !Number.isFinite(radialProduct)) {
      return invalidState('initial orbital state is outside the supported numeric range');
    }

    const evaluate = (x) => universalTimeEquation(x, alpha, 1, radialProduct, elapsedTime);
    const direction = Math.sign(elapsedTime);
    const wantedSign = direction > 0 ? 1 : -1;
    let step = Math.max(1, Math.abs(elapsedTime));
    let edge = 0;
    let edgeValue = evaluate(0);
    if (!edgeValue) return invalidState('universal time equation is not finite');
    let low;
    let high;
    let lowValue;
    let highValue;
    let bracketed = false;
    let iterations = 0;

    for (let expansion = 0; expansion < MAX_BRACKET_EXPANSIONS; expansion += 1) {
      const trial = direction * step;
      const value = evaluate(trial);
      iterations += 1;
      if (value && (value.value === 0 || Math.sign(value.value) === wantedSign)) {
        if (direction > 0) {
          low = edge;
          lowValue = edgeValue;
          high = trial;
          highValue = value;
        } else {
          low = trial;
          lowValue = value;
          high = edge;
          highValue = edgeValue;
        }
        if (value.value === 0) {
          low = trial;
          high = trial;
          lowValue = value;
          highValue = value;
        }
        bracketed = true;
        break;
      }

      if (!value) {
        let invalidEdge = trial;
        let validEdge = edge;
        let validValue = edgeValue;
        for (let search = 0; search < 64; search += 1) {
          const mid = (validEdge + invalidEdge) / 2;
          if (mid === validEdge || mid === invalidEdge) break;
          const midValue = evaluate(mid);
          iterations += 1;
          if (midValue && (midValue.value === 0 || Math.sign(midValue.value) === wantedSign)) {
            if (direction > 0) {
              low = validEdge;
              lowValue = validValue;
              high = mid;
              highValue = midValue;
            } else {
              low = mid;
              lowValue = midValue;
              high = validEdge;
              highValue = validValue;
            }
            if (midValue.value === 0) {
              low = mid;
              high = mid;
              lowValue = midValue;
              highValue = midValue;
            }
            bracketed = true;
            break;
          }
          if (midValue) {
            validEdge = mid;
            validValue = midValue;
          } else {
            invalidEdge = mid;
          }
        }
        if (bracketed) break;
        return invalidState('could not bracket a finite universal-variable solution');
      }

      edge = trial;
      edgeValue = value;
      step *= 2;
      if (!Number.isFinite(step)) break;
    }

    if (!bracketed || !lowValue || !highValue) {
      return invalidState('could not bracket a finite universal-variable solution');
    }

    let root = low + (high - low) / 2;
    let rootValue = evaluate(root);
    if (!rootValue) return invalidState('universal-variable root is not finite');
    for (let index = 0; index < MAX_BISECTION_ITERATIONS; index += 1) {
      iterations += 1;
      if (Math.abs(rootValue.value) <= residualTolerance(rootValue.value, elapsedTime)) {
        break;
      }
      if (Math.sign(rootValue.value) === wantedSign) {
        if (direction > 0) high = root;
        else low = root;
      } else if (direction > 0) {
        low = root;
      } else {
        high = root;
      }
      const mid = low + (high - low) / 2;
      if (mid === low || mid === high) break;
      root = mid;
      rootValue = evaluate(root);
      if (!rootValue) return invalidState('universal-variable bisection became non-finite');
    }

    const { C, S } = rootValue;
    const x2 = root * root;
    const x3 = x2 * root;
    const f = 1 - (x2 * C);
    const g = elapsedTime - x3 * S;
    const propagatedPosition = position.map((component, index) => f * component + g * velocity[index]);
    const propagatedRadius = norm(propagatedPosition);
    if (!(propagatedRadius > 0) || !Number.isFinite(propagatedRadius)) {
      return invalidState('propagated position is singular or non-finite');
    }

    const fDot = (alpha * x3 * S - root) / propagatedRadius;
    const gDot = 1 - (x2 * C) / propagatedRadius;
    const propagatedVelocity = position.map((component, index) => (
      fDot * component + gDot * velocity[index]
    ));
    const r = propagatedPosition.map((component) => component * radius);
    const v = propagatedVelocity.map((component) => component * unitScales.velocity);
    if (!finiteVector(r) || !finiteVector(v)) {
      return invalidState('propagated state exceeds the supported numeric range');
    }

    return { valid: true, r, v, reason: null };
  } catch {
    return invalidState('invalid propagation input or numerical failure');
  }
}

/** Sample an actual two-body conic by independently propagating each epoch. */
function sampleTrajectoryImpl(r0, v0, tofSeconds, count, options) {
  if (!Number.isInteger(count) || count < 2 || count > MAX_TRAJECTORY_POINTS) {
    return invalidTrajectory(`count must be an integer from 2 to ${MAX_TRAJECTORY_POINTS}`);
  }
  if (typeof tofSeconds !== 'number' || !Number.isFinite(tofSeconds)) {
    return invalidTrajectory('time of flight must be finite');
  }
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    return invalidTrajectory('options must be an object');
  }

  const points = [];
  const timesSeconds = [];
  for (let index = 0; index < count; index += 1) {
    const seconds = index === count - 1 ? tofSeconds : tofSeconds * (index / (count - 1));
    const state = propagateState(r0, v0, seconds, options);
    if (!state.valid) return invalidTrajectory(`trajectory propagation failed: ${state.reason}`);
    points.push(state.r);
    timesSeconds.push(seconds);
  }
  return { valid: true, points, timesSeconds, reason: null };
}

export function sampleTrajectory(r0, v0, tofSeconds, count = 128, options = {}) {
  try {
    return sampleTrajectoryImpl(r0, v0, tofSeconds, count, options);
  } catch {
    return invalidTrajectory('invalid trajectory input or numerical failure');
  }
}
