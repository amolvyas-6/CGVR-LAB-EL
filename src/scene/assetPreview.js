import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PREVIEW_BODIES } from '../assets/bodyAssets.js';

const DEFAULT_BODY_ID = 'earth';
const MAX_PIXEL_RATIO = 2;
const MAX_ANISOTROPY = 8;

function surfaceMaterial(body) {
  if (body.selfLit) {
    return new THREE.MeshBasicMaterial({
      color: 0xffffff,
      toneMapped: false,
    });
  }

  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0,
  });
}

export function createAssetPreview({ canvasHost, state }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  renderer.xr.enabled = false;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', 'Static material preview, not ephemeris');
  renderer.domElement.setAttribute('aria-describedby', 'preview-help');
  canvasHost.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#dce4ed');

  const cameraRig = new THREE.Group();
  cameraRig.name = 'Camera rig';
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
  camera.position.set(0, 0, 3.5);
  cameraRig.add(camera);
  scene.add(cameraRig);

  const hemisphereLight = new THREE.HemisphereLight(0xf8fbff, 0x647287, 1.65);
  scene.add(hemisphereLight);
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
  keyLight.position.set(-3, 2.5, 4);
  scene.add(keyLight);

  const geometry = new THREE.SphereGeometry(1, 80, 64);
  let currentBody = PREVIEW_BODIES.find(({ id }) => id === DEFAULT_BODY_ID);
  const bodyMesh = new THREE.Mesh(geometry, surfaceMaterial(currentBody));
  scene.add(bodyMesh);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  controls.dampingFactor = 0.065;
  controls.minDistance = 1.35;
  controls.maxDistance = 7;
  controls.target.set(0, 0, 0);
  controls.saveState();

  // Only consume keys while the preview itself has focus, not in page controls.
  const onPreviewKey = (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    switch (event.key) {
      case 'ArrowLeft': controls.rotateLeft(0.08); break;
      case 'ArrowRight': controls.rotateLeft(-0.08); break;
      case 'ArrowUp': controls.rotateUp(0.08); break;
      case 'ArrowDown': controls.rotateUp(-0.08); break;
      case '+':
      case '=': controls.dollyIn(0.9); break;
      case '-': controls.dollyOut(0.9); break;
      case 'Home': controls.reset(); break;
      default: return;
    }
    event.preventDefault();
  };
  renderer.domElement.addEventListener('keydown', onPreviewKey);

  const textureLoader = new THREE.TextureLoader();
  let activeTexture = null;
  let requestId = 0;
  let disposed = false;

  const setStatus = (status, message) => {
    state.update({ previewStatus: status, previewMessage: message });
  };

  const setBody = (bodyId) => {
    const body = PREVIEW_BODIES.find(({ id }) => id === bodyId);
    if (!body) {
      setStatus('error', 'That supplied texture is not available for preview.');
      return;
    }

    currentBody = body;
    renderer.domElement.setAttribute('aria-label', `Static ${body.label} material preview, not ephemeris`);
    requestId += 1;
    const thisRequest = requestId;

    if (activeTexture) {
      activeTexture.dispose();
      activeTexture = null;
    }

    bodyMesh.material.dispose();
    bodyMesh.material = surfaceMaterial(body);
    bodyMesh.material.color.set(0x98a5b4);
    setStatus('loading', `Loading the supplied ${body.label} texture.`);

    let texture;
    try {
      texture = textureLoader.load(
        body.url,
        (loadedTexture) => {
          if (disposed || thisRequest !== requestId) {
            loadedTexture.dispose();
            return;
          }

          loadedTexture.colorSpace = THREE.SRGBColorSpace;
          loadedTexture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), MAX_ANISOTROPY);
          loadedTexture.needsUpdate = true;
          bodyMesh.material.color.set(0xffffff);
          bodyMesh.material.map = loadedTexture;
          bodyMesh.material.needsUpdate = true;
          activeTexture = loadedTexture;
          setStatus('ready', `Supplied ${body.label} texture loaded. This is a material preview only.`);
        },
        undefined,
        () => {
          texture?.dispose();
          if (disposed || thisRequest !== requestId) return;

          bodyMesh.material.map = null;
          bodyMesh.material.color.set(0x98a5b4);
          bodyMesh.material.needsUpdate = true;
          setStatus('error', `The supplied ${body.label} texture could not be loaded; showing a neutral material.`);
        },
      );
    } catch {
      if (thisRequest === requestId) {
        bodyMesh.material.color.set(0x98a5b4);
        setStatus('error', `The supplied ${body.label} texture could not be loaded; showing a neutral material.`);
      }
    }
  };

  const resize = () => {
    if (disposed) return;
    const { width, height } = canvasHost.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  const resizeObserver = typeof ResizeObserver === 'undefined'
    ? null
    : new ResizeObserver(resize);
  resizeObserver?.observe(canvasHost);
  window.addEventListener('resize', resize);
  resize();

  const unsubscribe = state.subscribe((snapshot) => {
    if (snapshot.previewBodyId !== currentBody?.id) {
      setBody(snapshot.previewBodyId);
    }
  });

  setBody(state.getSnapshot().previewBodyId ?? DEFAULT_BODY_ID);

  return {
    renderer,
    scene,
    camera,
    controls,
    resetView() {
      controls.reset();
      controls.update();
    },
    updateControls() {
      controls.update();
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      requestId += 1;
      unsubscribe();
      resizeObserver?.disconnect();
      window.removeEventListener('resize', resize);
      renderer.domElement.removeEventListener('keydown', onPreviewKey);
      controls.dispose();
      if (activeTexture) activeTexture.dispose();
      bodyMesh.material.dispose();
      geometry.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
