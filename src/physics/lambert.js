import { MU_SUN_KM3_S2 } from './constants.js';
import { stumpff } from './stumpff.js';
import { propagateState } from './propagate.js';

const TWO_PI_SQUARED = (2 * Math.PI) ** 2;
const MAX_BRACKET_EVALUATIONS = 80;
const MAX_BISECTION_ITERATIONS = 120;
// f/g reconstruction becomes ill-conditioned as A approaches zero. Mask
// geometry within approximately 1e-7 radians of collinearity rather than
// reporting a finite-looking velocity that misses the endpoint.
const COLLINEAR_TOLERANCE = 1e-7;

function invalid(reason, transferAngle = NaN, iterations = 0, z = NaN) {
  return {
    valid: false,
    v1: [NaN, NaN, NaN],
    v2: [NaN, NaN, NaN],
    transferAngle,
    z,
    iterations,
    reason,
  };
}

function vector3(value) {
  return Array.isArray(value)
    && value.length === 3
    && [0, 1, 2].every((index) => typeof value[index] === 'number' && Number.isFinite(value[index]));
}

function norm(vector) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function normalized(vector, magnitude) {
  return [vector[0] / magnitude, vector[1] / magnitude, vector[2] / magnitude];
}

function unitDirection(vector) {
  const scale = Math.max(Math.abs(vector[0]), Math.abs(vector[1]), Math.abs(vector[2]));
  if (!(scale > 0)) return null;
  const scaled = vector.map((component) => component / scale);
  const scaledMagnitude = norm(scaled);
  return scaled.map((component) => component / scaledMagnitude);
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
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

function makeTimeEvaluator(r1, r2, A, targetTime) {
  return (z) => {
    const { C, S } = stumpff(z);
    if (!(C > 0) || !Number.isFinite(S)) return null;

    const sqrtC = Math.sqrt(C);
    const y = r1 + r2 + A * (z * S - 1) / sqrtC;
    if (!(y > 0) || !Number.isFinite(y)) return null;

    const yOverC = y / C;
    if (!(yOverC > 0) || !Number.isFinite(yOverC)) return null;
    const transferTime = (yOverC * Math.sqrt(yOverC)) * S + A * Math.sqrt(y);
    if (!Number.isFinite(transferTime)) return null;
    return { y, transferTime, residual: transferTime - targetTime };
  };
}

function residualTolerance(value, target) {
  return 8 * Number.EPSILON * Math.max(Math.abs(value), Math.abs(target), Number.MIN_VALUE);
}

/** Solve Lambert's problem on the zero-revolution universal-variable branch. */
export function solveLambert(r1, r2, tofSeconds, options = {}) {
  let iterations = 0;
  let transferAngle = NaN;
  try {
    if (!vector3(r1) || !vector3(r2)) return invalid('r1 and r2 must be finite three-number vectors');
    if (typeof tofSeconds !== 'number' || !Number.isFinite(tofSeconds) || tofSeconds <= 0) {
      return invalid('time of flight must be a positive finite number');
    }
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      return invalid('options must be an object');
    }

    const mu = options.mu ?? MU_SUN_KM3_S2;
    const prograde = options.prograde ?? true;
    const referenceNormal = options.referenceNormal ?? [0, 0, 1];
    if (typeof mu !== 'number' || !Number.isFinite(mu) || mu <= 0) {
      return invalid('mu must be a positive finite number');
    }
    if (typeof prograde !== 'boolean') return invalid('prograde must be a boolean');
    if (!vector3(referenceNormal)) return invalid('referenceNormal must be a finite three-number vector');

    const r1Magnitude = norm(r1);
    const r2Magnitude = norm(r2);
    if (!(r1Magnitude > 0) || !(r2Magnitude > 0)) {
      return invalid('position vectors and referenceNormal must be nonzero');
    }

    const u1 = normalized(r1, r1Magnitude);
    const u2 = normalized(r2, r2Magnitude);
    const unitNormal = unitDirection(referenceNormal);
    if (!unitNormal) return invalid('position vectors and referenceNormal must be nonzero');
    const cosine = Math.max(-1, Math.min(1, dot(u1, u2)));
    const positionCross = cross(u1, u2);
    const sineMagnitude = norm(positionCross);
    if (!(sineMagnitude > COLLINEAR_TOLERANCE)) {
      return invalid('collinear and exact-180-degree transfers are singular');
    }

    const orientation = dot(positionCross, unitNormal);
    const minorAngle = Math.atan2(sineMagnitude, cosine);
    const isLongWay = prograde ? orientation < 0 : orientation >= 0;
    transferAngle = isLongWay ? 2 * Math.PI - minorAngle : minorAngle;
    const signedSine = isLongWay ? -sineMagnitude : sineMagnitude;
    const oneMinusCosine = cosine > 0
      ? (sineMagnitude * sineMagnitude) / (1 + cosine)
      : 1 - cosine;
    if (!(oneMinusCosine > 0) || !Number.isFinite(oneMinusCosine)) {
      return invalid('transfer angle is numerically singular', transferAngle);
    }

    const lengthScale = Math.max(r1Magnitude, r2Magnitude);
    const unitScales = scales(lengthScale, mu);
    if (!unitScales) return invalid('input scales are outside the supported numeric range', transferAngle);

    const r1Dimensionless = r1Magnitude / lengthScale;
    const r2Dimensionless = r2Magnitude / lengthScale;
    const targetTime = tofSeconds / unitScales.time;
    if (!(targetTime > 0) || !Number.isFinite(targetTime)) {
      return invalid('time of flight is outside the supported numeric range', transferAngle);
    }

    const A = signedSine * Math.sqrt(
      (r1Dimensionless * r2Dimensionless) / oneMinusCosine,
    );
    if (!Number.isFinite(A) || A === 0) return invalid('transfer geometry is numerically singular', transferAngle);

    const evaluate = makeTimeEvaluator(r1Dimensionless, r2Dimensionless, A, targetTime);
    const atZero = evaluate(0);
    iterations += 1;
    if (!atZero) return invalid('Lambert time equation is not finite', transferAngle, iterations);

    let low;
    let high;
    let lowValue;
    let highValue;
    let rootZ = 0;
    if (Math.abs(atZero.residual) <= residualTolerance(atZero.transferTime, targetTime)) {
      low = 0;
      high = 0;
      lowValue = atZero;
      highValue = atZero;
    } else if (atZero.residual < 0) {
      low = 0;
      lowValue = atZero;
      high = NaN;
      highValue = null;
      const singularCap = TWO_PI_SQUARED - Math.max(1e-12, 32 * Number.EPSILON * TWO_PI_SQUARED);
      let trial = 1;
      for (let index = 0; index < MAX_BRACKET_EVALUATIONS; index += 1) {
        if (iterations >= MAX_BRACKET_EVALUATIONS) break;
        const z = Math.min(trial, singularCap);
        const value = evaluate(z);
        iterations += 1;
        if (value && value.residual >= 0) {
          high = z;
          highValue = value;
          break;
        }
        if (!value) {
          let invalidZ = z;
          let validZ = low;
          let validValue = lowValue;
          for (let search = 0; search < 64; search += 1) {
            const mid = (validZ + invalidZ) / 2;
            if (mid === validZ || mid === invalidZ) break;
            const midValue = evaluate(mid);
            iterations += 1;
            if (midValue && midValue.residual >= 0) {
              high = mid;
              highValue = midValue;
              break;
            }
            if (midValue) {
              validZ = mid;
              validValue = midValue;
            } else {
              invalidZ = mid;
            }
          }
          if (highValue) break;
          low = validZ;
          lowValue = validValue;
          break;
        }
        low = z;
        lowValue = value;
        if (z >= singularCap) break;
        trial *= 2;
      }
    } else {
      high = 0;
      highValue = atZero;
      low = NaN;
      lowValue = null;
      let trial = -1;
      for (let index = 0; index < MAX_BRACKET_EVALUATIONS; index += 1) {
        if (iterations >= MAX_BRACKET_EVALUATIONS) break;
        const value = evaluate(trial);
        iterations += 1;
        if (value && value.residual <= 0) {
          low = trial;
          lowValue = value;
          break;
        }
        if (!value) {
          let invalidZ = trial;
          let validZ = high;
          let validValue = highValue;
          for (let search = 0; search < 64; search += 1) {
            const mid = (invalidZ + validZ) / 2;
            if (mid === invalidZ || mid === validZ) break;
            const midValue = evaluate(mid);
            iterations += 1;
            if (midValue && midValue.residual <= 0) {
              low = mid;
              lowValue = midValue;
              break;
            }
            if (midValue) {
              validZ = mid;
              validValue = midValue;
            } else {
              invalidZ = mid;
            }
          }
          if (lowValue && lowValue.residual <= 0) break;
          high = validZ;
          highValue = validValue;
          break;
        }
        high = trial;
        highValue = value;
        if (trial <= -8192) break;
        trial *= 2;
      }
    }

    if (!lowValue || !highValue || lowValue.residual > 0 || highValue.residual < 0) {
      return invalid('could not bracket a finite zero-revolution Lambert solution', transferAngle, iterations);
    }

    if (low === high) {
      rootZ = low;
    } else {
      let bestZ = Math.abs(lowValue.residual) <= Math.abs(highValue.residual) ? low : high;
      let bestValue = bestZ === low ? lowValue : highValue;
      for (let index = 0; index < MAX_BISECTION_ITERATIONS; index += 1) {
        if (iterations >= MAX_BRACKET_EVALUATIONS + MAX_BISECTION_ITERATIONS) break;
        const mid = low + (high - low) / 2;
        if (mid === low || mid === high) break;
        const value = evaluate(mid);
        iterations += 1;
        if (!value) return invalid('Lambert bisection reached a non-finite state', transferAngle, iterations);
        if (Math.abs(value.residual) < Math.abs(bestValue.residual)) {
          bestZ = mid;
          bestValue = value;
        }
        if (Math.abs(value.residual) <= residualTolerance(value.transferTime, targetTime)) {
          bestZ = mid;
          break;
        }
        if (value.residual < 0) {
          low = mid;
          lowValue = value;
        } else {
          high = mid;
          highValue = value;
        }
        if (high - low <= 4 * Number.EPSILON * Math.max(1, Math.abs(mid))) break;
      }
      rootZ = bestZ;
    }

    const rootState = evaluate(rootZ);
    iterations += 1;
    if (!rootState) return invalid('Lambert solution is not finite', transferAngle, iterations, rootZ);
    const y = rootState.y;
    const f = 1 - y / r1Dimensionless;
    const g = A * Math.sqrt(y);
    const gDot = 1 - y / r2Dimensionless;
    if (!Number.isFinite(g) || g === 0) {
      return invalid('Lambert velocity denominator is singular', transferAngle, iterations, rootZ);
    }

    const r1Scaled = r1.map((component) => component / lengthScale);
    const r2Scaled = r2.map((component) => component / lengthScale);
    const v1 = r2Scaled.map((component, index) => (
      (component - f * r1Scaled[index]) / g * unitScales.velocity
    ));
    const v2 = r2Scaled.map((component, index) => (
      (gDot * component - r1Scaled[index]) / g * unitScales.velocity
    ));
    if (!finiteVector(v1) || !finiteVector(v2)) {
      return invalid('Lambert velocities exceed the supported numeric range', transferAngle, iterations, rootZ);
    }

    // A small time-equation residual alone cannot establish endpoint accuracy
    // when f/g reconstruction is ill-conditioned (particularly near pi).
    const endpoint = propagateState(r1, v1, tofSeconds, { mu });
    const closureKm = endpoint.valid
      ? Math.hypot(...endpoint.r.map((component, index) => component - r2[index]))
      : Infinity;
    if (!(closureKm <= 1)) {
      return invalid('Lambert reconstruction does not close the endpoint within 1 km', transferAngle, iterations, rootZ);
    }

    return {
      valid: true,
      v1,
      v2,
      transferAngle,
      z: rootZ,
      iterations,
      reason: null,
    };
  } catch {
    return invalid('invalid Lambert input or numerical failure', transferAngle, iterations);
  }
}
