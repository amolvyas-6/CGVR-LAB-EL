export const JUPITER_FIT_RADIUS_METRES = 0.76;
export const JUPITER_ORBIT_RADIUS_AU = 5.204;
export const XR_LARGER_SCALE_FACTOR = 1.25;

const MODEL_SCALE_BY_TARGET = Object.freeze({
  venus: 0.57,
  mars: 0.46,
  jupiter: JUPITER_FIT_RADIUS_METRES / JUPITER_ORBIT_RADIUS_AU,
});

const CHART_WING = Object.freeze({ width: 1.10, yawRadians: 0.49 });

export const XR_LAYOUT = Object.freeze({
  eyeHeight: 1.6,
  orrery: Object.freeze({ center: Object.freeze([0, 0.96, -1.69]) }),
  plot: Object.freeze({ ...CHART_WING, center: Object.freeze([-1.14, 1.98, -1.80]), height: 0.74 }),
  playback: Object.freeze({ ...CHART_WING, center: Object.freeze([-1.14, 1.51, -1.80]), height: 0.17 }),
  results: Object.freeze({ ...CHART_WING, center: Object.freeze([-1.14, 1.175, -1.80]), height: 0.46 }),
  controls: Object.freeze({
    center: Object.freeze([1.17, 1.58, -1.79]),
    width: 1.10,
    height: 0.73,
    yawRadians: -0.49,
    tiltRadians: -0.10,
  }),
});

export const XR_PLOT_CANVAS = Object.freeze({
  width: 1440,
  height: 1000,
  chart: Object.freeze({ x: 178, y: 156, width: 1160, height: 650 }),
});

export const XR_RESULTS_CANVAS = Object.freeze({ width: 1440, height: 650 });
export const XR_CONTROLS_CANVAS = Object.freeze({ width: 1440, height: 960 });
export const XR_PLAYBACK_CANVAS = Object.freeze({ width: 1440, height: 220 });
export const XR_TIMELINE = Object.freeze({ left: 314, right: 1384, y: 140, height: 122, inset: 17 });

/** Keep the workbench upright even when the viewer is looking up or down. */
export function viewerHeading({ x, y, z, w }, fallback = 0) {
  const forwardX = -2 * (x * z + w * y);
  const forwardZ = 2 * (x * x + y * y) - 1;
  return Math.hypot(forwardX, forwardZ) > 0.1 ? Math.atan2(-forwardX, -forwardZ) : fallback;
}

/** Return the display mapping from AU to metres for this target. */
export function getModelScale(target, larger = false) {
  if (typeof target !== 'string') throw new TypeError('target must be a planet name');
  const normalized = target.toLowerCase();
  if (!Object.hasOwn(MODEL_SCALE_BY_TARGET, normalized)) {
    throw new RangeError('target must be Venus, Mars, or Jupiter');
  }
  const metresPerAu = MODEL_SCALE_BY_TARGET[normalized] * (larger ? XR_LARGER_SCALE_FACTOR : 1);
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
