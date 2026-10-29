const SERIES_LIMIT = 0.5;
const MAX_HYPERBOLIC_ROOT = 700;

/**
 * Evaluate the universal-variable Stumpff functions C(z) and S(z).
 * Non-finite input or an unrepresentable hyperbolic result is reported as NaN
 * values so callers can turn it into their normal invalid-result record.
 */
export function stumpff(z) {
  if (typeof z !== 'number' || !Number.isFinite(z)) {
    return { C: NaN, S: NaN };
  }

  if (Math.abs(z) <= SERIES_LIMIT) {
    let cTerm = 0.5;
    let sTerm = 1 / 6;
    let C = cTerm;
    let S = sTerm;

    for (let k = 0; k < 100; k += 1) {
      cTerm *= -z / ((2 * k + 3) * (2 * k + 4));
      sTerm *= -z / ((2 * k + 4) * (2 * k + 5));
      C += cTerm;
      S += sTerm;
      if (Math.abs(cTerm) <= Number.EPSILON * Math.abs(C)
        && Math.abs(sTerm) <= Number.EPSILON * Math.abs(S)) {
        break;
      }
    }
    return { C, S };
  }

  if (z > 0) {
    const root = Math.sqrt(z);
    const halfSine = Math.sin(root / 2);
    const C = (2 * halfSine * halfSine) / z;
    const S = (root - Math.sin(root)) / (root * root * root);
    return Number.isFinite(C) && Number.isFinite(S)
      ? { C, S }
      : { C: NaN, S: NaN };
  }

  const root = Math.sqrt(-z);
  if (!Number.isFinite(root) || root > MAX_HYPERBOLIC_ROOT) {
    return { C: NaN, S: NaN };
  }

  const C = (Math.cosh(root) - 1) / (-z);
  const S = (Math.sinh(root) - root) / (root * root * root);
  return Number.isFinite(C) && Number.isFinite(S)
    ? { C, S }
    : { C: NaN, S: NaN };
}
