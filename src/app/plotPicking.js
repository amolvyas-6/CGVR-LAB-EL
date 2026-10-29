/**
 * Convert normalized porkchop texture coordinates to a clamped grid cell.
 * u increases with departure index and v increases with time-of-flight index.
 * A coordinate on the upper/right edge belongs to the final cell.
 */
export function uvToCell(u, v, departureCount, tofCount) {
  if (
    !Number.isSafeInteger(departureCount)
    || departureCount <= 0
    || !Number.isSafeInteger(tofCount)
    || tofCount <= 0
    || !Number.isFinite(u)
    || !Number.isFinite(v)
  ) {
    return null;
  }

  const clampedU = Math.min(1, Math.max(0, u));
  const clampedV = Math.min(1, Math.max(0, v));
  const i = Math.min(departureCount - 1, Math.floor(clampedU * departureCount));
  const j = Math.min(tofCount - 1, Math.floor(clampedV * tofCount));
  const index = j * departureCount + i;

  if (!Number.isSafeInteger(index)) return null;
  return { i, j, index };
}
