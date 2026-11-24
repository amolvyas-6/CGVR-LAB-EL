import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createXRControllers } from '../../src/xr/controllers.js';

function fakeRenderer() {
  const controllers = [new THREE.Group(), new THREE.Group()];
  const grips = [new THREE.Group(), new THREE.Group()];
  return {
    controllers,
    grips,
    renderer: {
      xr: {
        getController: (index) => controllers[index],
        getControllerGrip: (index) => grips[index],
      },
    },
  };
}

function source(handedness, { profiles = ['generic-trigger'], gamepad = null } = {}) {
  return { handedness, profiles, targetRayMode: 'tracked-pointer', gamepad };
}

function pointOneMeterAlongRay(raycaster) {
  return raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction, 1);
}

describe('createXRControllers', () => {
  it('adds renderer controller and grip groups to the rig with serializable profile status', () => {
    const { renderer, controllers, grips } = fakeRenderer();
    const rig = new THREE.Group();
    const onProfile = vi.fn();
    const xrControllers = createXRControllers({
      renderer,
      rig,
      hitTest: () => null,
      onProfile,
    });

    expect(rig.children).toEqual(expect.arrayContaining([...controllers, ...grips]));
    expect(controllers[0].children.map((child) => child.name)).toContain('xr-controller-ray');
    expect(controllers[0].children.map((child) => child.name)).toContain('xr-controller-reticle');
    expect(onProfile).toHaveBeenCalledWith(expect.objectContaining({ active: true, sources: [] }));

    controllers[0].dispatchEvent({ type: 'connected', data: source('right', {
      profiles: ['generic-trigger', 'oculus-touch-v2'],
      gamepad: { mapping: 'xr-standard', axes: [0, 0, 0, 0], buttons: Array(5).fill(0) },
    }) });
    expect(() => JSON.stringify(onProfile.mock.lastCall[0])).not.toThrow();
    expect(onProfile.mock.lastCall[0].sources[0]).toMatchObject({
      handedness: 'right',
      profileId: 'oculus-touch-v2',
      gamepadMapping: 'xr-standard',
      mapping: { shortcut: 'snap', shortcutButtonIndex: 4 },
    });
    expect(xrControllers.getDiagnostics().sources[0]).toMatchObject({
      handedness: 'right',
      horizontalAxisIndex: 2,
      shortcut: 'snap',
    });
    expect(() => JSON.stringify(xrControllers.getDiagnostics())).not.toThrow();

    xrControllers.destroy();
    expect(rig.children).toHaveLength(0);
    expect(xrControllers.getDiagnostics().sources).toEqual([]);
  });

  it('shows both reticles and uses the left hover when the right ray misses', () => {
    const { renderer, controllers } = fakeRenderer();
    const rig = new THREE.Group();
    const hoverKinds = [];
    const hits = [];
    let rightMisses = false;
    const xrControllers = createXRControllers({
      renderer,
      rig,
      hitTest: (raycaster) => {
        hits.push({
          direction: raycaster.ray.direction.clone(),
          originX: raycaster.ray.origin.x,
        });
        if (rightMisses && raycaster.ray.origin.x > 0) return null;
        return {
          object: raycaster.ray.direction,
          point: pointOneMeterAlongRay(raycaster),
          uv: { x: 0.4, y: 0.6 },
          kind: 'plot',
          i: hits.length,
          j: 2,
        };
      },
      onHover: (hit) => hoverKinds.push(hit?.kind ?? null),
    });

    controllers[0].position.x = -0.2;
    controllers[0].visible = true;
    const leftSource = source('left');
    controllers[0].dispatchEvent({ type: 'connected', data: leftSource });
    controllers[1].position.x = 0.2;
    controllers[1].visible = true;
    const rightSource = source('right');
    controllers[1].dispatchEvent({ type: 'connected', data: rightSource });

    xrControllers.update(10_000, 1 / 90);
    expect(hits).toHaveLength(2);
    expect(hits[0].originX).toBeCloseTo(0.2);
    expect(hits[0].direction.z).toBeCloseTo(-1);
    expect(controllers[1].children.find((child) => child.name === 'xr-controller-ray').visible).toBe(true);
    expect(controllers[1].children.find((child) => child.name === 'xr-controller-reticle').visible).toBe(true);

    expect(controllers[0].getObjectByName('xr-controller-reticle').visible).toBe(true);
    expect(xrControllers.getDiagnostics().hoveredHit.pointerIndex).toBe(1);

    rightMisses = true;
    xrControllers.update(10_020, 1 / 90);
    expect(hits).toHaveLength(4);
    expect(hits[3].originX).toBeCloseTo(-0.2);
    expect(xrControllers.getDiagnostics().hoveredHit.pointerIndex).toBe(0);
    expect(controllers[1].getObjectByName('xr-controller-reticle').visible).toBe(false);

    controllers[0].dispatchEvent({ type: 'disconnected', data: leftSource });
    expect(hoverKinds.at(-1)).toBeNull();

    xrControllers.destroy();
  });

  it('does not flicker the right hover when the unused left source disconnects', () => {
    const { renderer, controllers } = fakeRenderer();
    const rig = new THREE.Group();
    const onHover = vi.fn();
    const target = { uuid: 'stable-plot-target' };
    const xrControllers = createXRControllers({
      renderer,
      rig,
      hitTest: (raycaster) => ({
        object: target,
        point: pointOneMeterAlongRay(raycaster),
        uv: { x: 0.5, y: 0.5 },
        kind: 'plot',
        i: 4,
        j: 5,
      }),
      onHover,
    });
    controllers[0].visible = true;
    const leftSource = source('left');
    controllers[0].dispatchEvent({ type: 'connected', data: leftSource });
    controllers[1].visible = true;
    controllers[1].dispatchEvent({ type: 'connected', data: source('right') });
    xrControllers.update(1_000, 1 / 90);
    expect(onHover).toHaveBeenCalledTimes(1);

    controllers[0].dispatchEvent({ type: 'disconnected', data: leftSource });
    xrControllers.update(1_010, 1 / 90);
    expect(onHover).toHaveBeenCalledTimes(1);
    expect(onHover.mock.calls[0][0]).toMatchObject({ kind: 'plot', i: 4, j: 5 });
    xrControllers.destroy();
  });

  it('uses a fresh raycast on selectstart and never activates again on select', () => {
    const { renderer, controllers } = fakeRenderer();
    const rig = new THREE.Group();
    const onActivate = vi.fn();
    let nextHit = null;
    const hitTest = vi.fn((raycaster) => {
      if (!nextHit) return null;
      return {
        ...nextHit,
        point: pointOneMeterAlongRay(raycaster),
        uv: { x: 0.5, y: 0.5 },
      };
    });
    const xrControllers = createXRControllers({ renderer, rig, hitTest, onActivate });
    const rightController = controllers[1];
    rightController.visible = true;
    rightController.dispatchEvent({ type: 'connected', data: source('right') });

    nextHit = { object: {}, kind: 'plot', i: 3, j: 4 };
    xrControllers.update(100, 1 / 90);
    expect(hitTest).toHaveBeenCalledTimes(1);

    // The hover result is now gone; activation must not use that cached hit.
    nextHit = null;
    rightController.dispatchEvent({ type: 'selectstart' });
    expect(onActivate).not.toHaveBeenCalled();

    nextHit = { object: {}, kind: 'action', action: 'compute' };
    rightController.dispatchEvent({ type: 'selectstart' });
    rightController.dispatchEvent({ type: 'select' });
    expect(hitTest).toHaveBeenCalledTimes(3);
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate.mock.calls[0][0]).toMatchObject({ kind: 'action', action: 'compute' });

    xrControllers.destroy();
  });

  it('drags only the captured timeline and cancels on release or tracking loss', () => {
    const { renderer, controllers } = fakeRenderer();
    const timeline = new THREE.Object3D();
    const pause = new THREE.Object3D();
    const onActivate = vi.fn();
    const onDrag = vi.fn();
    let current = { object: timeline, kind: 'time', progress: 20 };
    const controls = createXRControllers({
      renderer,
      rig: new THREE.Group(),
      hitTest: (raycaster) => ({ ...current, point: pointOneMeterAlongRay(raycaster) }),
      onActivate,
      onDrag,
    });
    const controller = controllers[0];
    controller.visible = true;
    controller.dispatchEvent({ type: 'connected', data: source('left') });
    controller.dispatchEvent({ type: 'selectstart' });
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ progress: 20 }));

    current = { object: timeline, kind: 'time', progress: 55 };
    controls.update(100, 1 / 90);
    expect(onDrag).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ progress: 55 }));
    controls.update(110, 1 / 90);
    current = { object: pause, kind: 'action', action: 'pause' };
    controls.update(120, 1 / 90);
    controller.dispatchEvent({ type: 'selectend' });
    current = { object: timeline, kind: 'time', progress: 85 };
    controls.update(130, 1 / 90);
    expect(onDrag).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledTimes(1);

    controller.dispatchEvent({ type: 'selectstart' });
    controller.visible = false;
    controls.update(140, 1 / 90);
    controller.visible = true;
    current = { object: timeline, kind: 'time', progress: 100 };
    controls.update(150, 1 / 90);
    expect(onDrag).toHaveBeenCalledTimes(1);
    controls.destroy();
  });

  it('does not keep hover/input active outside immersive mode and re-baselines held buttons', () => {
    const { renderer, controllers } = fakeRenderer();
    const rig = new THREE.Group();
    const onHover = vi.fn();
    const onScrub = vi.fn();
    const onShortcut = vi.fn();
    const buttons = Array.from({ length: 5 }, () => ({ pressed: false, value: 0 }));
    const gamepad = { mapping: 'xr-standard', axes: [0, 0, 1, 0], buttons };
    const xrControllers = createXRControllers({
      renderer,
      rig,
      hitTest: (raycaster) => ({
        object: {},
        point: pointOneMeterAlongRay(raycaster),
        uv: { x: 0.2, y: 0.2 },
        kind: 'action',
        action: 'compute',
      }),
      onHover,
      onScrub,
      onShortcut,
    });
    controllers[1].visible = true;
    controllers[1].dispatchEvent({
      type: 'connected',
      data: source('right', { profiles: ['oculus-touch-v3'], gamepad }),
    });

    xrControllers.update(1_000, 0.05);
    expect(onScrub).toHaveBeenCalledTimes(1);
    expect(onScrub.mock.calls[0][0]).toBeCloseTo(25 * 0.05);
    buttons[4].pressed = true;
    xrControllers.setActive(false);
    const scrubCalls = onScrub.mock.calls.length;
    xrControllers.update(50_000, 5);
    controllers[1].dispatchEvent({ type: 'selectstart' });
    expect(onScrub).toHaveBeenCalledTimes(scrubCalls);
    expect(onShortcut).not.toHaveBeenCalled();
    expect(onHover.mock.calls.at(-1)[0]).toBeNull();

    xrControllers.setActive(true);
    xrControllers.update(50_010, 0.05);
    expect(onShortcut).not.toHaveBeenCalled();
    buttons[4].pressed = false;
    xrControllers.update(50_020, 0.01);
    buttons[4].pressed = true;
    xrControllers.update(50_030, 0.01);
    expect(onShortcut).toHaveBeenCalledTimes(1);
    expect(onShortcut).toHaveBeenCalledWith('snap');

    xrControllers.destroy();
  });

  it('clears held shortcut edges across source disconnect and reentry', () => {
    const { renderer, controllers } = fakeRenderer();
    const rig = new THREE.Group();
    const onShortcut = vi.fn();
    const buttons = Array.from({ length: 5 }, () => ({ pressed: false, value: 0 }));
    buttons[4].pressed = true;
    const gamepad = { mapping: 'xr-standard', axes: [0, 0, 0, 0], buttons };
    const right = controllers[1];
    const xrControllers = createXRControllers({
      renderer,
      rig,
      hitTest: () => null,
      onShortcut,
    });
    const firstSource = source('right', { profiles: ['meta-quest-touch-plus'], gamepad });
    right.dispatchEvent({
      type: 'connected',
      data: firstSource,
    });
    xrControllers.update(0, 0.01);
    expect(onShortcut).not.toHaveBeenCalled();

    right.dispatchEvent({ type: 'disconnected', data: firstSource });
    right.dispatchEvent({
      type: 'connected',
      data: source('right', { profiles: ['meta-quest-touch-plus'], gamepad }),
    });
    xrControllers.update(10, 0.01);
    expect(onShortcut).not.toHaveBeenCalled();

    buttons[4].pressed = false;
    xrControllers.update(20, 0.01);
    buttons[4].pressed = true;
    xrControllers.update(30, 0.01);
    expect(onShortcut).toHaveBeenCalledTimes(1);
    expect(onShortcut).toHaveBeenCalledWith('snap');
    xrControllers.destroy();
  });

  it('clears pose-invalid hover and sends a final null on teardown', () => {
    const { renderer, controllers } = fakeRenderer();
    const rig = new THREE.Group();
    const onHover = vi.fn();
    const xrControllers = createXRControllers({
      renderer,
      rig,
      hitTest: (raycaster) => ({
        object: {},
        point: pointOneMeterAlongRay(raycaster),
        kind: 'plot',
      }),
      onHover,
    });
    controllers[0].visible = true;
    controllers[0].dispatchEvent({ type: 'connected', data: source('left') });
    xrControllers.update(0, 0.01);
    expect(onHover).toHaveBeenCalledTimes(1);

    controllers[0].visible = false;
    xrControllers.update(10, 0.01);
    expect(onHover.mock.calls.at(-1)[0]).toBeNull();
    xrControllers.destroy();
    expect(onHover.mock.calls.at(-1)[0]).toBeNull();
  });

  it('ignores optional input during tracking/focus loss and does not replay a held shortcut', () => {
    const { renderer, controllers } = fakeRenderer();
    const session = { visibilityState: 'visible' };
    renderer.xr.getSession = () => session;
    const onScrub = vi.fn();
    const onShortcut = vi.fn();
    const gamepad = { mapping: 'xr-standard', axes: [0, 0, 1, 0], buttons: Array.from({ length: 5 }, () => ({ pressed: false })) };
    const controls = createXRControllers({ renderer, rig: new THREE.Group(), hitTest: () => null, onScrub, onShortcut });
    controllers[1].dispatchEvent({ type: 'connected', data: source('right', { profiles: ['meta-quest-touch-plus'], gamepad }) });
    controllers[1].visible = false;
    gamepad.buttons[4].pressed = true;
    controls.update(0, 0.1);
    expect(onScrub).not.toHaveBeenCalled();
    expect(onShortcut).not.toHaveBeenCalled();
    controllers[1].visible = true;
    session.visibilityState = 'visible-blurred';
    controls.update(10, 0.1);
    expect(onScrub).not.toHaveBeenCalled();
    session.visibilityState = 'visible';
    controls.update(20, 0.1);
    expect(onScrub).toHaveBeenCalledOnce();
    expect(onShortcut).not.toHaveBeenCalled();
    gamepad.buttons[4].pressed = false;
    controls.update(30, 0.1);
    gamepad.buttons[4].pressed = true;
    controls.update(40, 0.1);
    expect(onShortcut).toHaveBeenCalledOnce();
    controls.destroy();
  });

  it('deduplicates within-cell UV movement but notices action payload changes', () => {
    const { renderer, controllers } = fakeRenderer();
    const onHover = vi.fn();
    const hit = { object: { uuid: 'panel' }, kind: 'plot', i: 2, j: 3, uv: { x: 0.2, y: 0.3 } };
    const controls = createXRControllers({ renderer, rig: new THREE.Group(), hitTest: raycaster => ({ ...hit, point: pointOneMeterAlongRay(raycaster) }), onHover });
    controllers[1].dispatchEvent({ type: 'connected', data: source('right') });
    controls.update(0, 0.01);
    hit.uv.x = 0.21;
    controls.update(10, 0.01);
    expect(onHover).toHaveBeenCalledOnce();
    hit.kind = 'action';
    hit.actionObject = { type: 'snap' };
    controls.update(20, 0.01);
    hit.actionObject = { type: 'play' };
    controls.update(30, 0.01);
    expect(onHover).toHaveBeenCalledTimes(3);
    hit.actionObject = {};
    hit.actionObject.circular = hit.actionObject;
    expect(() => controls.update(40, 0.01)).not.toThrow();
    controls.destroy();
  });

  it('removes all owned listeners from renderer grips before a new controller manager is created', () => {
    const { renderer, controllers, grips } = fakeRenderer();
    const rig = new THREE.Group();
    const create = () => createXRControllers({ renderer, rig, hitTest: () => null });
    const first = create();
    first.destroy();
    for (const group of [...controllers, ...grips]) {
      for (const listeners of Object.values(group._listeners ?? {})) expect(listeners).toHaveLength(0);
    }
    const second = create();
    for (const grip of grips) expect(grip._listeners.connected).toHaveLength(1);
    second.destroy();
  });
});
