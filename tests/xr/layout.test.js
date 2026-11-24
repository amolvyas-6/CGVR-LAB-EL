import { describe, expect, it } from 'vitest';
import { uvToCell } from '../../src/app/plotPicking.js';
import {
  angularSizeDegrees,
  getModelScale,
  isFrontFacingRay,
  panelFrontNormal,
  panelLocalPointFromUV,
  progressFromUV,
  viewerHeading,
  XR_LAYOUT,
} from '../../src/xr/layout.js';

describe('VR workbench layout helpers', () => {
  it('gives the closer Venus and Mars missions larger display scales', () => {
    expect(getModelScale('Mars').metresPerAu).toBe(0.46);
    expect(getModelScale('Venus').metresPerAu).toBe(0.57);
    expect(getModelScale('Mars', true).metresPerAu).toBeGreaterThan(0.46);
  });

  it('fits Jupiter while disclosing a coherent, larger whole-model scale', () => {
    const normal = getModelScale('Jupiter');
    const larger = getModelScale('Jupiter', true);
    expect(normal.fit).toBe(true);
    expect(normal.orbitRadiusMetres).toBeCloseTo(0.76, 12);
    expect(larger.orbitRadiusMetres).toBeGreaterThan(normal.orbitRadiusMetres);
    expect(getModelScale('Mars').fit).toBe(false);
  });

  it('maps plane corners and timebar endpoints without leaking out of bounds', () => {
    expect(panelLocalPointFromUV(0, 0, 2, 1)).toEqual({ x: -1, y: -0.5 });
    expect(panelLocalPointFromUV(1, 1, 2, 1)).toEqual({ x: 1, y: 0.5 });
    expect(panelLocalPointFromUV(-0.01, 0.5, 2, 1)).toBeNull();
    expect(progressFromUV(0)).toBe(0);
    expect(progressFromUV(1)).toBe(100);
    expect(progressFromUV(1.4)).toBe(100);
  });

  it('maps plot UV corners and interior to clamped grid cells', () => {
    expect(uvToCell(0, 0, 60, 40)).toMatchObject({ i: 0, j: 0 });
    expect(uvToCell(1, 1, 60, 40)).toMatchObject({ i: 59, j: 39 });
    expect(uvToCell(0.51, 0.26, 60, 40)).toMatchObject({ i: 30, j: 10 });
  });

  it('only accepts rays approaching the opaque front faces', () => {
    expect(isFrontFacingRay([0, 0, -1], [0, 0, 1])).toBe(true);
    expect(isFrontFacingRay([0, 0, 1], [0, 0, 1])).toBe(false);
    expect(isFrontFacingRay([0, 0, -1], [0, 0, -1])).toBe(false);
    expect(isFrontFacingRay([0, -0.5, -0.866], panelFrontNormal(XR_LAYOUT.controls.tiltRadians))).toBe(true);
    expect(isFrontFacingRay([0, -0.5, 0.866], panelFrontNormal(XR_LAYOUT.controls.tiltRadians))).toBe(false);
  });

  it('centers along headset yaw while ignoring pitch and near-vertical gaze', () => {
    const sin = Math.sin(Math.PI / 4);
    const cos = Math.cos(Math.PI / 4);
    expect(viewerHeading({ x: 0, y: sin, z: 0, w: cos })).toBeCloseTo(Math.PI / 2);
    expect(viewerHeading({ x: sin, y: 0, z: 0, w: cos }, 0.7)).toBe(0.7);
    expect(viewerHeading({ x: 0.2, y: 0, z: 0, w: Math.sqrt(0.96) })).toBeCloseTo(0);
  });

  it('keeps the plot large enough to read at the intended stand-off distance', () => {
    const { plot, controls, orrery, eyeHeight } = XR_LAYOUT;
    const angle = angularSizeDegrees(plot.width, Math.hypot(plot.center[0], plot.center[1] - eyeHeight, plot.center[2]));
    expect(angle).toBeGreaterThan(27);
    expect(angle).toBeLessThan(35);
    expect(orrery.center[0]).toBe(0);
    expect(orrery.center[1]).toBeLessThan(eyeHeight);
    expect(plot.center[0] + plot.width / 2).toBeLessThan(orrery.center[0]);
    expect(controls.center[0] - controls.width / 2).toBeGreaterThan(orrery.center[0]);
  });
});
