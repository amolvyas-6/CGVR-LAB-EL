import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import {
  detectInputMapping,
  isRisingEdge,
  readHorizontalAxis,
  readShortcutPressed,
  stickScrubDelta,
} from './input.js';

const IDLE_RAY_LENGTH = 1.25;
const RAY_FAR = 20;
const PROFILE_BASE_URL = import.meta.env?.BASE_URL ?? '/';

function localProfilePath(baseURL) {
  const base = typeof baseURL === 'string' && baseURL ? baseURL : '/';
  return `${base.endsWith('/') ? base : `${base}/`}xr-profiles`;
}

function noop() {}

function safeCallback(callback, ...args) {
  try {
    callback(...args);
  } catch (error) {
    // An app callback must not interrupt the renderer's XR frame/event dispatch.
    console.error('XR controller callback failed.', error);
  }
}

function finiteVector3(value) {
  return value
    && Number.isFinite(value.x)
    && Number.isFinite(value.y)
    && Number.isFinite(value.z);
}

function disposeMaterial(material, seenMaterials, seenTextures) {
  if (!material || seenMaterials.has(material)) return;
  seenMaterials.add(material);
  for (const value of Object.values(material)) {
    if (value?.isTexture && !seenTextures.has(value)) {
      seenTextures.add(value);
      value.dispose();
    }
  }
  material.dispose?.();
}

function disposeLoadedAsset(asset, seenGeometries, seenMaterials, seenTextures) {
  asset?.scene?.traverse?.((child) => {
    if (child.geometry && !seenGeometries.has(child.geometry)) {
      seenGeometries.add(child.geometry);
      child.geometry.dispose?.();
    }
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      disposeMaterial(material, seenMaterials, seenTextures);
    }
  });
}

/**
 * Three's XRControllerModelFactory supplies an error callback which throws
 * asynchronously for a missing GLB. Intercept that callback while still
 * tracking successful source assets so clones can share/dispose resources once.
 */
class NonThrowingGLTFLoader extends GLTFLoader {
  constructor() {
    super();
    this.onAssetLoad = noop;
    this.onAssetError = noop;
  }

  load(url, onLoad, onProgress, _factoryErrorCallback) {
    return super.load(
      url,
      (asset) => {
        if (this.onAssetLoad(url, asset) === false) return;
        onLoad?.(asset);
      },
      onProgress,
      (error) => {
        // Do not invoke XRControllerModelFactory's callback: it deliberately
        // throws, which would otherwise become an uncaught async exception.
        this.onAssetError(url, error);
      },
    );
  }
}

function actionSignature(value) {
  try {
    return JSON.stringify(value);
  } catch {
    // Scene actions are small JSON-safe records; a malformed custom hit must
    // nevertheless not abort the immersive animation loop.
    return 'unserializable-action';
  }
}

function hitSnapshot(hit, pointerIndex) {
  if (!hit) return null;
  return {
    pointerIndex,
    objectUuid: typeof hit.object?.uuid === 'string' ? hit.object.uuid : null,
    kind: hit.kind ?? null,
    i: Number.isFinite(hit.i) ? hit.i : null,
    j: Number.isFinite(hit.j) ? hit.j : null,
    action: typeof hit.action === 'string' ? hit.action : null,
    actionObject: actionSignature(hit.actionObject ?? (typeof hit.action === 'object' ? hit.action : null)),
  };
}

function sameHitSnapshot(left, right) {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.pointerIndex === right.pointerIndex
    && left.objectUuid === right.objectUuid
    && left.kind === right.kind
    && left.i === right.i
    && left.j === right.j
    && left.action === right.action
    && left.actionObject === right.actionObject;
}

function sourceInstructions(source, mapping) {
  if (!source) return [];
  const instructions = [];
  if (source.targetRayMode === 'tracked-pointer') {
    instructions.push('Aim with the controller ray and press its trigger to select.');
  }
  if (mapping.horizontalAxisIndex !== null) {
    instructions.push('Move a thumbstick horizontally to scrub mission progress.');
  }
  if (mapping.shortcutAvailable) {
    instructions.push(mapping.shortcut === 'snap'
      ? 'Right A: snap to the feasible optimum.'
      : 'Left X: cycle the target planet.');
  }
  if (!mapping.profileKnown) {
    instructions.push('Optional button shortcuts are unavailable for this controller profile; use the in-world ray buttons.');
  }
  return instructions;
}

/**
 * Attach ray/select/gamepad handling and optional local controller models to
 * the supplied rig. The hitTest result is borrowed: callbacks consume it
 * synchronously and this module never retains its point/UV objects.
 */
export function createXRControllers({
  renderer,
  rig,
  hitTest,
  onHover = noop,
  onActivate = noop,
  onDrag = noop,
  onScrub = noop,
  onShortcut = noop,
  onProfile = noop,
}) {
  if (!renderer?.xr || typeof renderer.xr.getController !== 'function') {
    throw new TypeError('renderer.xr.getController() is required');
  }
  if (typeof renderer.xr.getControllerGrip !== 'function') {
    throw new TypeError('renderer.xr.getControllerGrip() is required');
  }
  if (!rig || typeof rig.add !== 'function' || typeof rig.remove !== 'function') {
    throw new TypeError('rig must be a Three.js Object3D');
  }
  if (typeof hitTest !== 'function') throw new TypeError('hitTest(raycaster) is required');

  let active = true;
  let destroyed = false;
  let hoveredSourceIndex = null;
  let hoveredSnapshot = null;
  const records = [];
  const loadedAssets = new Set();
  const disposedGeometries = new WeakSet();
  const disposedMaterials = new WeakSet();
  const disposedTextures = new WeakSet();
  const raycaster = new THREE.Raycaster();
  raycaster.near = 0;
  raycaster.far = RAY_FAR;
  raycaster.params.Line.threshold = 0.015;

  // All mutable math values are shared across updates and activation events.
  const rayOrigin = new THREE.Vector3();
  const rayDirection = new THREE.Vector3();
  const reticlePoint = new THREE.Vector3();
  const worldScale = new THREE.Vector3();

  const loader = new NonThrowingGLTFLoader();
  loader.onAssetLoad = (_url, asset) => {
    if (destroyed) {
      disposeLoadedAsset(asset, disposedGeometries, disposedMaterials, disposedTextures);
      return false;
    } else {
      loadedAssets.add(asset);
    }
  };
  const profilePath = localProfilePath(PROFILE_BASE_URL);
  const modelFactory = new XRControllerModelFactory(loader)
    .setPath(profilePath);
  modelFactory.onLoad = (scene) => {
    if (destroyed) return;
    const model = scene?.parent;
    const index = model?.userData?.xrControllerIndex;
    const record = records.find((entry) => entry.index === index);
    if (!record) return;
    record.modelLoaded = true;
    model.visible = active;
    record.proceduralGrip.visible = false;
  };

  function createRayVisual(controller) {
    const positions = new Float32Array([0, 0, 0, 0, 0, -IDLE_RAY_LENGTH]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({
      color: 0x8be2db,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
    const line = new THREE.Line(geometry, material);
    line.name = 'xr-controller-ray';
    line.frustumCulled = false;
    line.visible = false;
    controller.add(line);

    const reticleGeometry = new THREE.RingGeometry(0.012, 0.019, 24);
    const reticleMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd27a,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const reticle = new THREE.Mesh(reticleGeometry, reticleMaterial);
    reticle.name = 'xr-controller-reticle';
    reticle.visible = false;
    reticle.renderOrder = 10;
    controller.add(reticle);
    return { line, geometry, material, reticle, reticleGeometry, reticleMaterial };
  }

  function createProceduralGrip(controller) {
    const group = new THREE.Group();
    group.name = 'xr-controller-procedural-grip';
    group.position.set(0, -0.045, 0.055);
    group.visible = false;

    const handleGeometry = new THREE.CylinderGeometry(0.014, 0.019, 0.12, 8, 1, false);
    const handleMaterial = new THREE.MeshStandardMaterial({
      color: 0x5d6d82,
      roughness: 0.72,
      metalness: 0.12,
    });
    const handle = new THREE.Mesh(handleGeometry, handleMaterial);
    handle.name = 'xr-controller-grip-handle';
    group.add(handle);

    const triggerGeometry = new THREE.TorusGeometry(0.019, 0.003, 5, 12);
    const triggerMaterial = new THREE.MeshStandardMaterial({
      color: 0x245da8,
      roughness: 0.55,
      metalness: 0.08,
    });
    const trigger = new THREE.Mesh(triggerGeometry, triggerMaterial);
    trigger.name = 'xr-controller-grip-trigger';
    trigger.position.set(0, 0.035, -0.006);
    trigger.rotation.x = Math.PI / 2;
    group.add(trigger);
    controller.add(group);
    return {
      group,
      geometries: [handleGeometry, triggerGeometry],
      materials: [handleMaterial, triggerMaterial],
    };
  }

  function mappingFor(source) {
    return detectInputMapping(source);
  }

  function profileState() {
    const sources = records
      .filter((record) => record.source)
      .map((record) => {
        const { source, mapping } = record;
        return {
          index: record.index,
          handedness: mapping.handedness,
          profiles: [...mapping.profiles],
          targetRayMode: typeof source.targetRayMode === 'string' ? source.targetRayMode : 'unknown',
          profileId: mapping.profileId,
          gamepadMapping: mapping.gamepadMapping,
          mapping: {
            profileKnown: mapping.profileKnown,
            horizontalAxisIndex: mapping.horizontalAxisIndex,
            axisMapping: mapping.axisMapping,
            shortcut: mapping.shortcut,
            shortcutButtonIndex: mapping.shortcutButtonIndex,
            shortcutButtonName: mapping.shortcutButtonName,
            shortcutAvailable: mapping.shortcutAvailable,
          },
          instructions: sourceInstructions(source, mapping),
        };
      });
    const instructions = sources.flatMap((source) => source.instructions);
    if (sources.length === 0) {
      instructions.push('Connect a tracked controller to aim and use trigger rays.');
    }
    return { active, sources, instructions: [...new Set(instructions)] };
  }

  function emitProfile() {
    safeCallback(onProfile, profileState());
  }

  function priority(record) {
    if (record.mapping?.handedness === 'right') return 0;
    if (record.mapping?.handedness === 'left') return 1;
    return 2;
  }

  function orderedRecords(requireRay = false) {
    return records
      .filter((record) => record.source
        && (!requireRay || record.source.targetRayMode === 'tracked-pointer'))
      .sort((left, right) => priority(left) - priority(right) || left.index - right.index);
  }

  function setRayDistance(record, distance) {
    const position = record.ray.geometry.getAttribute('position');
    const scaleZ = Math.abs(record.controller.getWorldScale(worldScale).z);
    const localDistance = Number.isFinite(distance) && distance > 0
      ? distance / Math.max(scaleZ, 1e-6)
      : IDLE_RAY_LENGTH;
    position.array[5] = -localDistance;
    position.needsUpdate = true;
  }

  function poseIsUsable(record) {
    const session = renderer.xr.getSession?.();
    if (
      !active
      || !record.source
      || record.source.targetRayMode !== 'tracked-pointer'
      || record.controller.visible !== true
      || (session?.visibilityState && session.visibilityState !== 'visible')
    ) return false;

    record.controller.updateWorldMatrix(true, false);
    const elements = record.controller.matrixWorld.elements;
    for (let index = 0; index < elements.length; index += 1) {
      if (!Number.isFinite(elements[index])) return false;
    }
    return true;
  }

  function raycast(record) {
    if (!poseIsUsable(record)) return null;
    rayOrigin.setFromMatrixPosition(record.controller.matrixWorld);
    rayDirection.set(0, 0, -1).transformDirection(record.controller.matrixWorld);
    if (!finiteVector3(rayOrigin) || !finiteVector3(rayDirection) || rayDirection.lengthSq() === 0) {
      return null;
    }
    raycaster.ray.origin.copy(rayOrigin);
    raycaster.ray.direction.copy(rayDirection).normalize();
    raycaster.near = 0;
    raycaster.far = RAY_FAR;

    let hit = null;
    try {
      hit = hitTest(raycaster) ?? null;
    } catch (error) {
      console.error('XR controller hitTest failed.', error);
    }
    if (hit && finiteVector3(hit.point)) {
      const distance = raycaster.ray.origin.distanceTo(hit.point);
      setRayDistance(record, distance);
      record.ray.material.opacity = 0.78;
      reticlePoint.copy(hit.point).addScaledVector(rayDirection, -0.004);
      record.controller.worldToLocal(reticlePoint);
      record.ray.reticle.position.copy(reticlePoint);
      record.ray.reticle.visible = true;
    } else {
      setRayDistance(record, IDLE_RAY_LENGTH);
      record.ray.material.opacity = 0.32;
      record.ray.reticle.visible = false;
    }
    return hit;
  }

  function refreshRayVisibility() {
    for (const record of records) {
      const usable = poseIsUsable(record);
      record.ray.line.visible = usable;
      if (!usable) record.ray.reticle.visible = false;
      record.proceduralGrip.visible = Boolean(
        usable && (!record.modelLoaded || record.grip.visible !== true),
      );
      if (record.model) record.model.visible = Boolean(active && record.modelLoaded);
    }
  }

  function clearHover(forceCallback = false) {
    const hadHover = hoveredSourceIndex !== null || hoveredSnapshot !== null;
    hoveredSourceIndex = null;
    hoveredSnapshot = null;
    for (const record of records) record.ray.reticle.visible = false;
    if (forceCallback || hadHover) safeCallback(onHover, null);
  }

  function refreshHover() {
    let picked = false;
    for (const record of orderedRecords(true)) {
      if (!poseIsUsable(record)) {
        record.dragTarget = null;
        continue;
      }

      // Each hand gets an independent ray and reticle. Use one readout when both hit.
      const hit = raycast(record);
      if (record.dragTarget?.userData?.disabled) record.dragTarget = null;
      if (record.dragTarget && hit?.object === record.dragTarget && hit.progress !== record.dragProgress) {
        record.dragProgress = hit.progress;
        safeCallback(onDrag, hit);
      }

      if (!picked && hit) {
        picked = true;
        const snapshot = hitSnapshot(hit, record.index);
        if (!sameHitSnapshot(hoveredSnapshot, snapshot)) {
          hoveredSourceIndex = record.index;
          hoveredSnapshot = snapshot;
          safeCallback(onHover, hit);
        }
      }
    }
    if (!picked) clearHover();
    refreshRayVisibility();
  }

  function baselineShortcut(record) {
    record.shortcutWasPressed = record.source
      ? readShortcutPressed(record.source, record.mapping)
      : false;
  }

  function handleConnected(record, event) {
    if (destroyed) return;
    record.source = event?.data ?? null;
    record.mapping = record.source ? mappingFor(record.source) : null;
    record.modelLoaded = false;
    record.dragTarget = null;
    if (record.model) record.model.visible = false;
    record.proceduralGrip.visible = false;
    baselineShortcut(record);
    emitProfile();
  }

  function handleDisconnected(record, event) {
    if (destroyed) return;
    if (record.source && event?.data && event.data !== record.source) return;
    record.source = null;
    record.mapping = null;
    record.modelLoaded = false;
    record.dragTarget = null;
    record.shortcutWasPressed = false;
    record.ray.line.visible = false;
    record.ray.reticle.visible = false;
    record.proceduralGrip.visible = false;
    if (record.model) record.model.visible = false;
    if (hoveredSourceIndex === record.index) clearHover(true);
    emitProfile();
  }

  function handleSelectStart(record) {
    if (!active || destroyed || !poseIsUsable(record)) return;
    // Never use the stored hover: selectstart raycasts with the current XR pose.
    const hit = raycast(record);
    if (!hit) return;
    if (hit.kind === 'time') {
      record.dragTarget = hit.object;
      record.dragProgress = hit.progress;
    }
    safeCallback(onActivate, hit);
  }

  for (let index = 0; index < 2; index += 1) {
    const controller = renderer.xr.getController(index);
    const grip = renderer.xr.getControllerGrip(index);
    if (!controller || typeof controller.addEventListener !== 'function') {
      throw new TypeError(`renderer.xr.getController(${index}) must return an Object3D`);
    }
    if (!grip || typeof grip.addEventListener !== 'function') {
      throw new TypeError(`renderer.xr.getControllerGrip(${index}) must return an Object3D`);
    }

    const ray = createRayVisual(controller);
    const procedural = createProceduralGrip(controller);
    // The factory's anonymous listeners cannot be removed from renderer-owned
    // spaces. Keep them on an owned event proxy and forward grip events instead.
    const modelEvents = new THREE.Group();
    const model = modelFactory.createControllerModel(modelEvents);
    model.name = `xr-controller-model-${index}`;
    model.userData.xrControllerIndex = index;
    model.visible = false;
    grip.add(model);
    rig.add(controller, grip);

    const record = {
      index,
      controller,
      grip,
      ray,
      proceduralGrip: procedural.group,
      proceduralResources: procedural,
      model,
      modelEvents,
      modelLoaded: false,
      source: null,
      mapping: null,
      shortcutWasPressed: false,
      dragTarget: null,
      dragProgress: null,
      onConnected: null,
      onDisconnected: null,
      onSelectStart: null,
      onSelectEnd: null,
      onGripConnected: null,
      onGripDisconnected: null,
    };
    record.onConnected = (event) => handleConnected(record, event);
    record.onDisconnected = (event) => handleDisconnected(record, event);
    record.onSelectStart = () => handleSelectStart(record);
    record.onSelectEnd = () => { record.dragTarget = null; };
    record.onGripConnected = (event) => modelEvents.dispatchEvent({ type: 'connected', data: event.data });
    record.onGripDisconnected = (event) => modelEvents.dispatchEvent({ type: 'disconnected', data: event.data });
    controller.addEventListener('connected', record.onConnected);
    controller.addEventListener('disconnected', record.onDisconnected);
    controller.addEventListener('selectstart', record.onSelectStart);
    controller.addEventListener('selectend', record.onSelectEnd);
    grip.addEventListener('connected', record.onGripConnected);
    grip.addEventListener('disconnected', record.onGripDisconnected);
    records.push(record);
  }

  function pollOptionalInputs(deltaSeconds) {
    let selectedAxis = 0;
    let strongestAxis = 0;
    const candidates = orderedRecords();
    for (const record of candidates) {
      if (!poseIsUsable(record)) {
        // Tracking/focus loss must not replay held buttons when pose returns.
        baselineShortcut(record);
        continue;
      }
      const mapping = record.mapping;
      const pressed = readShortcutPressed(record.source, mapping);
      if (mapping?.shortcut && isRisingEdge(record.shortcutWasPressed, pressed)) {
        safeCallback(onShortcut, mapping.shortcut);
      }
      record.shortcutWasPressed = pressed;

      const axis = readHorizontalAxis(record.source, mapping);
      if (mapping?.horizontalAxisIndex !== null && mapping?.horizontalAxisIndex !== undefined) {
        if (Math.abs(axis) > Math.abs(strongestAxis)) {
          selectedAxis = axis;
          strongestAxis = axis;
        }
      }
    }

    const delta = stickScrubDelta(selectedAxis, deltaSeconds);
    if (delta !== 0) safeCallback(onScrub, delta);
  }

  function setActive(value) {
    if (destroyed) return;
    const nextActive = Boolean(value);
    if (nextActive === active) return;
    active = nextActive;
    for (const record of records) {
      baselineShortcut(record);
      if (!active) {
        record.dragTarget = null;
        record.ray.line.visible = false;
        record.ray.reticle.visible = false;
        record.proceduralGrip.visible = false;
        if (record.model) record.model.visible = false;
      }
    }
    if (!active) clearHover(true);
    emitProfile();
  }

  function update(_nowMs, deltaSeconds) {
    if (destroyed) return;
    if (!active) {
      refreshRayVisibility();
      return;
    }
    pollOptionalInputs(deltaSeconds);
    refreshHover();
  }

  function getDiagnostics() {
    return {
      active,
      hoveredHit: hoveredSnapshot ? { ...hoveredSnapshot } : null,
      sources: records
        .filter((record) => record.source)
        .map((record) => ({
          index: record.index,
          connected: true,
          handedness: record.mapping.handedness,
          targetRayMode: typeof record.source.targetRayMode === 'string'
            ? record.source.targetRayMode
            : 'unknown',
          profiles: [...record.mapping.profiles],
          profileId: record.mapping.profileId,
          gamepadMapping: record.mapping.gamepadMapping,
          horizontalAxisIndex: record.mapping.horizontalAxisIndex,
          axisMapping: record.mapping.axisMapping,
          shortcut: record.mapping.shortcut,
          shortcutButtonIndex: record.mapping.shortcutButtonIndex,
          shortcutButtonName: record.mapping.shortcutButtonName,
          shortcutAvailable: record.mapping.shortcutAvailable,
          rayOrigin: Array.from(record.controller.matrixWorld.elements.slice(12, 15)),
          rayDirection: [-record.controller.matrixWorld.elements[8], -record.controller.matrixWorld.elements[9], -record.controller.matrixWorld.elements[10]],
        })),
    };
  }

  function destroy() {
    if (destroyed) return;
    active = false;
    clearHover(true);
    destroyed = true;

    for (const record of records) {
      record.modelEvents.dispatchEvent({ type: 'disconnected', data: record.source });
      record.controller.removeEventListener('connected', record.onConnected);
      record.controller.removeEventListener('disconnected', record.onDisconnected);
      record.controller.removeEventListener('selectstart', record.onSelectStart);
      record.controller.removeEventListener('selectend', record.onSelectEnd);
      record.grip.removeEventListener('connected', record.onGripConnected);
      record.grip.removeEventListener('disconnected', record.onGripDisconnected);
      record.controller.remove(record.ray.line, record.ray.reticle, record.proceduralGrip);
      record.grip.remove(record.model);
      rig.remove(record.controller, record.grip);

      record.ray.geometry.dispose();
      record.ray.material.dispose();
      record.ray.reticleGeometry.dispose();
      record.ray.reticleMaterial.dispose();
      for (const geometry of record.proceduralResources.geometries) geometry.dispose();
      for (const material of record.proceduralResources.materials) material.dispose();
      record.source = null;
      record.mapping = null;
    }

    for (const asset of loadedAssets) {
      disposeLoadedAsset(asset, disposedGeometries, disposedMaterials, disposedTextures);
    }
    loadedAssets.clear();
    // The factory cache references the same source assets already disposed.
    modelFactory._assetCache = {};
  }

  emitProfile();
  return { update, setActive, destroy, getDiagnostics };
}
