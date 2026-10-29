export const JUPITER_FIT_RADIUS_METRES = 0.68;
export const JUPITER_ORBIT_RADIUS_AU = 5.204;
export const XR_LARGER_SCALE_FACTOR = 1.35;

// Positions are measured from a local-floor origin. They intentionally keep
// the chart upright and the shared orrery low/left, rather than enclosing the
// viewer in a desktop-sized floating window.
export const XR_LAYOUT = Object.freeze({
  plot: Object.freeze({ center: Object.freeze([0.60, 2.02, -1.82]), width: 1.42, height: 0.90 }),
  results: Object.freeze({ center: Object.freeze([0.60, 1.25, -1.80]), width: 1.42, height: 0.62 }),
  controls: Object.freeze({
    center: Object.freeze([0.60, 0.53, -1.76]),
    width: 1.42,
    height: 0.82,
    tiltRadians: -Math.PI / 10,
  }),
  orrery: Object.freeze({ center: Object.freeze([-0.85, 0.73, -1.50]), tableRadius: 0.96 }),
});

export const XR_PLOT_CANVAS = Object.freeze({
  width: 1440,
  height: 1000,
  // The rest of the face carries dates, flight-time ticks and the cost legend.
  chart: Object.freeze({ x: 178, y: 190, width: 1160, height: 620 }),
});

export const XR_RESULTS_CANVAS = Object.freeze({ width: 1440, height: 700 });
export const XR_CONTROLS_CANVAS = Object.freeze({ width: 1440, height: 960 });

/** Return the actual tabletop mapping from AU to metres for this target. */
export function getModelScale(target, larger = false) {
  if (typeof target !== 'string') throw new TypeError('target must be a planet name');
  const normalized = target.toLowerCase();
  if (!['venus', 'mars', 'jupiter'].includes(normalized)) {
    throw new RangeError('target must be Venus, Mars, or Jupiter');
  }
  const base = normalized === 'jupiter'
    ? JUPITER_FIT_RADIUS_METRES / JUPITER_ORBIT_RADIUS_AU
    : 0.3;
  const metresPerAu = base * (larger ? XR_LARGER_SCALE_FACTOR : 1);
  return {
    metresPerAu,
    fit: normalized === 'jupiter',
    orbitRadiusMetres: JUPITER_ORBIT_RADIUS_AU * metresPerAu,
  };
}

/** Convert a plane UV into its local XY coordinate (Three plane UVs are Y-up). */
export function panelLocalPointFromUV(u, v, width, height) {
  if (![u, v, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return { x: (u - 0.5) * width, y: (v - 0.5) * height };
}

/** A controller ray can hit a FrontSide plane only when it faces the ray. */
export function isFrontFacingRay(direction, normal) {
  if (!Array.isArray(direction) || !Array.isArray(normal)
    || direction.length !== 3 || normal.length !== 3
    || !direction.every(Number.isFinite) || !normal.every(Number.isFinite)) return false;
  return direction[0] * normal[0] + direction[1] * normal[1] + direction[2] * normal[2] < 0;
}

export function panelFrontNormal(tiltRadians = 0) {
  if (!Number.isFinite(tiltRadians)) return null;
  return [0, -Math.sin(tiltRadians), Math.cos(tiltRadians)];
}

export function progressFromUV(u) {
  if (!Number.isFinite(u)) return null;
  return Math.min(100, Math.max(0, u * 100));
}

export function angularSizeDegrees(sizeMetres, distanceMetres) {
  if (!Number.isFinite(sizeMetres) || !Number.isFinite(distanceMetres)
    || sizeMetres < 0 || distanceMetres <= 0) return null;
  return (2 * Math.atan(sizeMetres / (2 * distanceMetres)) * 180) / Math.PI;
}
