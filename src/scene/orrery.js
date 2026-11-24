import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BODY_ASSETS } from '../assets/bodyAssets.js';
import { AU_KM } from '../physics/constants.js';
import { getPlanetPosition } from '../physics/ephemeris.js';
import { createTrajectory } from './trajectory.js';

const DEFAULT_TARGET = 'mars';
const DEFAULT_DEPARTURE_MS = Date.UTC(2026, 6, 1);
const GUIDE_POINT_COUNT = 128;
const MAX_TEXTURE_ANISOTROPY = 8;
const ORBITAL_PERIOD_DAYS = Object.freeze({
  earth: 365.256,
  venus: 224.701,
  mars: 686.98,
  jupiter: 4332.59,
});
const ORBITAL_RADIUS_AU = Object.freeze({
  venus: 0.723,
  mars: 1.524,
  jupiter: 5.204,
});
const PHYSICAL_RADII_KM = Object.freeze({
  sun: 695700,
  earth: 6371,
  venus: 6052,
  mars: 3389.5,
  jupiter: 69911,
});
const EXAGGERATED_RADII_AU = Object.freeze({
  sun: 0.10,
  earth: 0.065,
  venus: 0.055,
  mars: 0.050,
  jupiter: 0.11,
});
const BODY_ASSET_BY_ID = new Map(BODY_ASSETS.map((asset) => [asset.id, asset]));

function canonicalTarget(target) {
  if (typeof target !== 'string') {
    throw new TypeError('target must be Venus, Mars, or Jupiter');
  }
  const normalized = target.toLowerCase();
  if (!Object.hasOwn(ORBITAL_RADIUS_AU, normalized)) {
    throw new RangeError('target must be Venus, Mars, or Jupiter');
  }
  return normalized;
}

function validEpoch(epochMs) {
  return typeof epochMs === 'number'
    && Number.isFinite(epochMs)
    && Number.isFinite(new Date(epochMs).getTime());
}

function setEclipticPosition(object, positionKm) {
  // ECL x/y/z -> Three.js Y-up x/z/-y (a proper -90 degree x rotation).
  object.position.set(
    positionKm[0] / AU_KM,
    positionKm[2] / AU_KM,
    -positionKm[1] / AU_KM,
  );
}

function makeBodyMaterial(bodyId) {
  if (bodyId === 'sun') {
    return new THREE.MeshBasicMaterial({ color: 0xffd27a, toneMapped: false });
  }
  return new THREE.MeshStandardMaterial({
    color: 0x9aa8b7,
    roughness: 0.96,
    metalness: 0,
  });
}

function makeLabel(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create a canvas context for an orrery label');

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.8, 0.2, 1);

  const update = (label) => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = '600 29px system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    context.lineWidth = 7;
    context.strokeStyle = 'rgba(255,255,255,0.94)';
    context.strokeText(label, canvas.width / 2, canvas.height / 2);
    context.fillStyle = '#243348';
    context.fillText(label, canvas.width / 2, canvas.height / 2);
    texture.needsUpdate = true;
  };
  update(text);

  return { sprite, texture, material, update };
}

/** Create the data-driven desktop orrery and its reusable trajectory layer. */
export function createOrrery({
  renderer,
  orreryViewport,
  onAssetStatus,
}) {
  const scene = new THREE.Scene();
  const cameraRigGroup = new THREE.Group();
  cameraRigGroup.name = 'Orrery camera rig';
  scene.add(cameraRigGroup);

  // This is the one real orrery model. Phase 3 reparents it into the XR scene;
  // the desktop camera remains separate so the model never inherits a camera
  // transform or creates a second set of bodies/orbit lines.
  const contentGroup = new THREE.Group();
  contentGroup.name = 'Shared ephemeris orrery content';
  scene.add(contentGroup);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.005, 120);
  camera.position.set(0, 4.2, 4.2);
  cameraRigGroup.add(camera);
  if (orreryViewport.tabIndex < 0) orreryViewport.tabIndex = 0;
  if (!orreryViewport.hasAttribute('role')) orreryViewport.setAttribute('role', 'group');
  if (!orreryViewport.hasAttribute('aria-label')) {
    orreryViewport.setAttribute(
      'aria-label',
      'Interactive ephemeris orrery. Use arrows to rotate, plus or minus to zoom, and Home to reset.',
    );
  }

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.58);
  scene.add(ambientLight);
  const sunLight = new THREE.PointLight(0xfff1d5, 3.4, 0, 2);
  sunLight.position.set(0, 0, 0);
  contentGroup.add(sunLight);

  const sphereGeometry = new THREE.SphereGeometry(1, 32, 16);
  const sunMesh = new THREE.Mesh(sphereGeometry, makeBodyMaterial('sun'));
  const earthMesh = new THREE.Mesh(sphereGeometry, makeBodyMaterial('earth'));
  const targetMesh = new THREE.Mesh(sphereGeometry, makeBodyMaterial(DEFAULT_TARGET));
  sunMesh.name = 'Sun';
  earthMesh.name = 'Earth';
  targetMesh.name = 'Selected target';
  sunMesh.userData.bodyId = 'sun';
  earthMesh.userData.bodyId = 'earth';
  targetMesh.userData.bodyId = DEFAULT_TARGET;
  contentGroup.add(sunMesh, earthMesh, targetMesh);

  const sunLabel = makeLabel('Sun');
  const earthLabel = makeLabel('Earth');
  const targetLabel = makeLabel('Mars');
  contentGroup.add(sunLabel.sprite, earthLabel.sprite, targetLabel.sprite);

  const orbitMaterials = [
    new THREE.LineBasicMaterial({ color: 0x748ba3, transparent: true, opacity: 0.5 }),
    new THREE.LineBasicMaterial({ color: 0xb17c45, transparent: true, opacity: 0.58 }),
  ];
  let orbitLines = [];

  const trajectory = createTrajectory(contentGroup);

  const controls = new OrbitControls(camera, orreryViewport);
  controls.enableDamping = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  controls.dampingFactor = 0.07;
  controls.enablePan = false;
  controls.minDistance = 0.3;
  controls.maxDistance = 50;
  controls.target.set(0, 0, 0);

  let currentTarget = DEFAULT_TARGET;
  let currentDepartureMs = DEFAULT_DEPARTURE_MS;
  let currentMissionTimeMs = DEFAULT_DEPARTURE_MS;
  let exaggeratedBodyScale = true;
  let disposed = false;
  const wantedAssetIds = new Set();
  const textureRecords = new Map();
  const disposedTextures = new WeakSet();
  const textureLoader = new THREE.TextureLoader();
  const maxAnisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), MAX_TEXTURE_ANISOTROPY);

  function disposeTextureOnce(texture) {
    if (!texture || disposedTextures.has(texture)) return;
    disposedTextures.add(texture);
    texture.dispose();
  }

  function reportAsset(asset, status, message) {
    onAssetStatus?.({
      assetId: asset.id,
      label: asset.label,
      status,
      message,
    });
  }

  function applyTextureToMesh(mesh, bodyId) {
    const record = textureRecords.get(bodyId);
    const material = mesh.material;
    material.map = record?.status === 'ready' ? record.texture : null;
    material.color.set(record?.status === 'ready'
      ? 0xffffff
      : (bodyId === 'sun' ? 0xffd27a : 0x9aa8b7));
    material.needsUpdate = true;
  }

  function syncMeshMaterials() {
    applyTextureToMesh(sunMesh, 'sun');
    applyTextureToMesh(earthMesh, 'earth');
    applyTextureToMesh(targetMesh, currentTarget);
  }

  function ensureTexture(bodyId) {
    const existing = textureRecords.get(bodyId);
    if (existing) return;
    const asset = BODY_ASSET_BY_ID.get(bodyId);
    if (!asset) return;

    const record = {
      status: 'loading',
      texture: null,
    };
    textureRecords.set(bodyId, record);
    reportAsset(asset, 'loading', `Loading the supplied ${asset.label} surface map.`);

    try {
      const texture = textureLoader.load(
        asset.url,
        (loadedTexture) => {
          if (disposed || textureRecords.get(bodyId) !== record || !wantedAssetIds.has(bodyId)) {
            disposeTextureOnce(loadedTexture);
            return;
          }

          loadedTexture.colorSpace = THREE.SRGBColorSpace;
          loadedTexture.anisotropy = maxAnisotropy;
          loadedTexture.needsUpdate = true;
          record.texture = loadedTexture;
          record.status = 'ready';
          syncMeshMaterials();
          reportAsset(asset, 'ready', `Supplied ${asset.label} surface map loaded.`);
        },
        undefined,
        () => {
          if (disposed || textureRecords.get(bodyId) !== record || !wantedAssetIds.has(bodyId)) {
            disposeTextureOnce(texture);
            return;
          }

          record.texture = null;
          record.status = 'error';
          syncMeshMaterials();
          reportAsset(asset, 'error', `The ${asset.label} map is unavailable; a neutral body surface is shown.`);
        },
      );
      record.texture = texture;
    } catch {
      record.status = 'error';
      record.texture = null;
      syncMeshMaterials();
      reportAsset(asset, 'error', `The ${asset.label} map could not be requested; a neutral body surface is shown.`);
    }
  }

  function syncVisibleTextures() {
    wantedAssetIds.clear();
    wantedAssetIds.add('sun');
    wantedAssetIds.add('earth');
    wantedAssetIds.add(currentTarget);

    for (const [bodyId, record] of textureRecords) {
      if (wantedAssetIds.has(bodyId)) continue;
      textureRecords.delete(bodyId);
      disposeTextureOnce(record.texture);
    }
    syncMeshMaterials();
    for (const bodyId of wantedAssetIds) ensureTexture(bodyId);
  }

  function setBodyRadii() {
    const displayScale = Math.max(1, ORBITAL_RADIUS_AU[currentTarget] / ORBITAL_RADIUS_AU.mars);
    const radiusFor = (bodyId) => (exaggeratedBodyScale
      ? EXAGGERATED_RADII_AU[bodyId] * displayScale
      : PHYSICAL_RADII_KM[bodyId] / AU_KM);
    for (const label of [sunLabel, earthLabel, targetLabel]) {
      label.sprite.scale.set(0.8 * displayScale, 0.2 * displayScale, 1);
    }
    sunMesh.scale.setScalar(radiusFor('sun'));
    earthMesh.scale.setScalar(radiusFor('earth'));
    targetMesh.scale.setScalar(radiusFor(currentTarget));
    updateLabelPositions();
  }

  function updateLabelPositions() {
    const displayScale = Math.max(1, ORBITAL_RADIUS_AU[currentTarget] / ORBITAL_RADIUS_AU.mars);
    sunLabel.sprite.position.set(0, sunMesh.scale.x * 1.55 + 0.025, 0);
    earthLabel.sprite.position.set(
      earthMesh.position.x,
      earthMesh.position.y + Math.max(earthMesh.scale.x * 1.6, 0.14 * displayScale),
      earthMesh.position.z,
    );
    targetLabel.sprite.position.set(
      targetMesh.position.x,
      targetMesh.position.y + Math.max(targetMesh.scale.x * 1.6, 0.14 * displayScale),
      targetMesh.position.z,
    );
  }

  function updateBodyPositions(epochMs) {
    const date = new Date(epochMs);
    setEclipticPosition(sunMesh, getPlanetPosition('Sun', date));
    setEclipticPosition(earthMesh, getPlanetPosition('Earth', date));
    setEclipticPosition(targetMesh, getPlanetPosition(currentTarget, date));
    updateLabelPositions();
  }

  function clearOrbitGuides() {
    for (const line of orbitLines) {
      contentGroup.remove(line);
      line.geometry.dispose();
    }
    orbitLines = [];
  }

  function makeOrbitGuide(bodyId, startEpochMs, periodDays, material) {
    const positions = new Float32Array(GUIDE_POINT_COUNT * 3);
    for (let index = 0; index < GUIDE_POINT_COUNT; index += 1) {
      const epochMs = startEpochMs + (periodDays * 86400000 * index) / GUIDE_POINT_COUNT;
      const point = getPlanetPosition(bodyId, new Date(epochMs));
      const offset = index * 3;
      positions[offset] = point[0] / AU_KM;
      positions[offset + 1] = point[2] / AU_KM;
      positions[offset + 2] = -point[1] / AU_KM;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return new THREE.LineLoop(geometry, material);
  }

  function rebuildOrbitGuides() {
    clearOrbitGuides();
    const earthGuide = makeOrbitGuide(
      'Earth',
      currentDepartureMs,
      ORBITAL_PERIOD_DAYS.earth,
      orbitMaterials[0],
    );
    const targetGuide = makeOrbitGuide(
      currentTarget,
      currentDepartureMs,
      ORBITAL_PERIOD_DAYS[currentTarget],
      orbitMaterials[1],
    );
    earthGuide.name = 'Ephemeris-sampled Earth orbit guide';
    targetGuide.name = `Ephemeris-sampled ${currentTarget} orbit guide`;
    orbitLines = [earthGuide, targetGuide];
    contentGroup.add(earthGuide, targetGuide);
  }

  function frameCamera() {
    const distance = Math.max(3.5, ORBITAL_RADIUS_AU[currentTarget] * 3.2);
    camera.position.set(0, distance * 0.76, distance * 0.76);
    camera.lookAt(0, 0, 0);
    controls.target.set(0, 0, 0);
    controls.update();
    controls.saveState();
  }

  function clearTransfer() {
    trajectory.clear();
  }

  function setTransfer(transfer, samples) {
    const transferTarget = typeof transfer?.target === 'string'
      ? transfer.target.toLowerCase()
      : currentTarget;
    if (
      !transfer?.valid
      || !samples?.valid
      || transferTarget !== currentTarget
    ) {
      clearTransfer();
      return;
    }
    trajectory.setTransfer(transfer, samples);
  }

  function setMissionTime(epochMs, spacecraftPosition) {
    if (!validEpoch(epochMs)) {
      throw new RangeError('mission time must be a valid Unix-millisecond epoch');
    }
    if (epochMs !== currentMissionTimeMs) {
      currentMissionTimeMs = epochMs;
      updateBodyPositions(epochMs);
    }

    trajectory.setPosition(spacecraftPosition);
  }

  function setTarget(target, departureMs) {
    const nextTarget = canonicalTarget(target);
    if (!validEpoch(departureMs)) {
      throw new RangeError('departure time must be a valid Unix-millisecond epoch');
    }
    if (nextTarget === currentTarget && departureMs === currentDepartureMs) return;

    currentTarget = nextTarget;
    currentDepartureMs = departureMs;
    currentMissionTimeMs = departureMs;
    targetMesh.userData.bodyId = currentTarget;
    targetLabel.update(currentTarget[0].toUpperCase() + currentTarget.slice(1));
    setBodyRadii();
    syncVisibleTextures();
    rebuildOrbitGuides();
    updateBodyPositions(currentMissionTimeMs);
    clearTransfer();
    frameCamera();
  }

  function setBodyScale(exaggeratedBoolean) {
    if (typeof exaggeratedBoolean !== 'boolean') {
      throw new TypeError('body scale setting must be a boolean');
    }
    exaggeratedBodyScale = exaggeratedBoolean;
    setBodyRadii();
  }

  function setWorldScale(metresPerAu) {
    if (typeof metresPerAu !== 'number' || !Number.isFinite(metresPerAu) || metresPerAu <= 0) {
      throw new RangeError('world scale must be a positive finite number of metres per AU');
    }
    if (contentGroup.scale.x !== metresPerAu
      || contentGroup.scale.y !== metresPerAu
      || contentGroup.scale.z !== metresPerAu) {
      contentGroup.scale.setScalar(metresPerAu);
    }
    // PointLight decay is inverse-square. Scale intensity with the square of
    // the model scale so moving the same AU-wide system onto a tabletop does
    // not make its planets clip white.
    sunLight.intensity = 3.4 * metresPerAu * metresPerAu;
  }

  function onOrreryKeyDown(event) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    switch (event.key) {
      case 'ArrowLeft': controls.rotateLeft(0.08); break;
      case 'ArrowRight': controls.rotateLeft(-0.08); break;
      case 'ArrowUp': controls.rotateUp(0.08); break;
      case 'ArrowDown': controls.rotateUp(-0.08); break;
      case '+':
      case '=': controls.dollyIn(0.9); break;
      case '-': controls.dollyOut(0.9); break;
      case 'Home': resetView(); break;
      default: return;
    }
    event.preventDefault();
  }

  function resetView() {
    controls.reset();
    controls.update();
  }

  orreryViewport.addEventListener('keydown', onOrreryKeyDown);
  setBodyRadii();
  syncVisibleTextures();
  rebuildOrbitGuides();
  updateBodyPositions(currentMissionTimeMs);
  frameCamera();

  return {
    scene,
    camera,
    controls,
    contentGroup,
    setTarget,
    setTransfer,
    setMissionTime,
    setBodyScale,
    setWorldScale,
    setImmersiveStyle(immersive) {
      orbitMaterials[0].opacity = immersive ? 0.74 : 0.5;
      orbitMaterials[1].opacity = immersive ? 0.73 : 0.58;
      trajectory.setImmersiveStyle(immersive);
    },
    getWorldScale: () => contentGroup.scale.x,
    getTarget: () => currentTarget,
    resetView,
    updateControls() {
      if (controls.enabled) controls.update();
    },
    setControlsEnabled(enabled) {
      controls.enabled = Boolean(enabled);
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      orreryViewport.removeEventListener('keydown', onOrreryKeyDown);
      controls.dispose();
      clearOrbitGuides();
      for (const record of textureRecords.values()) disposeTextureOnce(record.texture);
      textureRecords.clear();
      for (const mesh of [sunMesh, earthMesh, targetMesh]) mesh.material.dispose();
      for (const label of [sunLabel, earthLabel, targetLabel]) {
        label.material.dispose();
        label.texture.dispose();
      }
      for (const material of orbitMaterials) material.dispose();
      trajectory.destroy();
      sphereGeometry.dispose();
    },
  };
}
