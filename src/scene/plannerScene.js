import * as THREE from 'three';
import { createOrrery } from './orrery.js';
import { createPorkchop } from './porkchop.js';
import { createXRWorkbench } from '../xr/workbench.js';

const MAX_DEVICE_PIXEL_RATIO = 1.5;

function requireElement(value, name) {
  if (!value || typeof value.getBoundingClientRect !== 'function') {
    throw new TypeError(`${name} must be a DOM element with layout bounds`);
  }
}

function clippedViewportRect(viewport, surfaceBounds) {
  const bounds = viewport.getBoundingClientRect();
  const left = Math.max(bounds.left, surfaceBounds.left);
  const right = Math.min(bounds.right, surfaceBounds.right);
  const top = Math.max(bounds.top, surfaceBounds.top);
  const bottom = Math.min(bounds.bottom, surfaceBounds.bottom);
  const width = right - left;
  const height = bottom - top;
  if (!(width > 0 && height > 0)) return null;
  return {
    x: left - surfaceBounds.left,
    y: surfaceBounds.bottom - bottom,
    width,
    height,
  };
}

/**
 * Build the single-renderer desktop planner. The caller owns the animation loop.
 */
export function createPlannerScene({
  surface,
  orreryViewport,
  plotViewport,
  onSelect,
  onHover,
  onXRAction,
  onAssetStatus,
  textureFormat = 'red',
}) {
  requireElement(surface, 'surface');
  requireElement(orreryViewport, 'orreryViewport');
  requireElement(plotViewport, 'plotViewport');
  if (
    typeof surface.contains === 'function'
    && (!surface.contains(orreryViewport) || !surface.contains(plotViewport))
  ) {
    throw new RangeError('both viewports must be descendants of the shared surface');
  }

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  if (!renderer.capabilities.isWebGL2) {
    renderer.dispose();
    throw new Error('The Phase 2 planner requires WebGL2 for float porkchop textures');
  }

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false;
  renderer.xr.enabled = true;
  renderer.info.autoReset = false;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  renderer.domElement.style.position = 'absolute';
  renderer.domElement.style.inset = '0';
  renderer.domElement.style.zIndex = '0';
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.pointerEvents = 'none';
  surface.appendChild(renderer.domElement);

  let orrery = null;
  let plot = null;
  let workbench = null;
  let immersive = false;
  let latestAssetStatus = null;
  let latestXRState = null;
  let disposed = false;
  let lastWidth = -1;
  let lastHeight = -1;
  let lastPixelRatio = -1;
  let orreryCameraWidth = -1;
  let orreryCameraHeight = -1;
  let layoutDirty = true;
  const markLayoutDirty = () => { layoutDirty = true; };
  let resizeObserver = null;

  try {
    orrery = createOrrery({
      renderer,
      orreryViewport,
      onAssetStatus: (status) => {
        latestAssetStatus = status;
        onAssetStatus?.(status);
        workbench?.setAssetStatus(status);
      },
    });
    plot = createPorkchop({
      renderer,
      plotViewport,
      textureFormat,
      onSelect,
      onHover,
    });
    workbench = createXRWorkbench({
      renderer,
      plot,
      orrery,
      onSelect,
      onHover,
      onXRAction,
    });
    if (latestAssetStatus) workbench.setAssetStatus(latestAssetStatus);
    renderer.xr.addEventListener?.('sessionstart', onXRSessionStart);
    renderer.xr.addEventListener?.('sessionend', onXRSessionEnd);

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(markLayoutDirty);
      resizeObserver.observe(surface);
      resizeObserver.observe(orreryViewport);
      resizeObserver.observe(plotViewport);
    }
    window.addEventListener('resize', markLayoutDirty);
  } catch (error) {
    renderer.xr.removeEventListener?.('sessionstart', onXRSessionStart);
    renderer.xr.removeEventListener?.('sessionend', onXRSessionEnd);
    resizeObserver?.disconnect();
    workbench?.destroy();
    plot?.destroy();
    orrery?.destroy();
    renderer.dispose();
    renderer.domElement.remove();
    throw error;
  }

  function renderView(scene, camera, bounds) {
    if (!bounds) return;
    renderer.setViewport(bounds.x, bounds.y, bounds.width, bounds.height);
    renderer.setScissor(bounds.x, bounds.y, bounds.width, bounds.height);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
  }

  function setImmersive(active) {
    if (disposed) return;
    immersive = Boolean(active);
    workbench.setImmersive(immersive);
  }

  function onXRSessionStart() {
    setImmersive(true);
  }

  function onXRSessionEnd() {
    setImmersive(false);
  }

  function render() {
    if (disposed) return;
    renderer.info.reset();

    if (renderer.xr.isPresenting) {
      if (!immersive) setImmersive(true);
      renderer.setScissorTest(false);
      const previousAutoClear = renderer.autoClear;
      renderer.autoClear = true;
      try {
        renderer.render(workbench.xrScene, workbench.xrCamera);
      } finally {
        renderer.autoClear = previousAutoClear;
      }
      return;
    }

    // Local bounds are independent of page scroll; measuring here also catches
    // position-only layout changes not reported by ResizeObserver.
    const surfaceBounds = surface.getBoundingClientRect();
    const width = surfaceBounds.width;
    const height = surfaceBounds.height;
    if (!(width > 0 && height > 0)) return;

    const pixelRatio = Math.min(Math.max(window.devicePixelRatio || 1, 1), MAX_DEVICE_PIXEL_RATIO);
    if (
      layoutDirty
      || width !== lastWidth
      || height !== lastHeight
      || pixelRatio !== lastPixelRatio
    ) {
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
      lastWidth = width;
      lastHeight = height;
      lastPixelRatio = pixelRatio;
      layoutDirty = false;
    }

    const surfaceRect = {
      left: surfaceBounds.left,
      right: surfaceBounds.right,
      top: surfaceBounds.top,
      bottom: surfaceBounds.bottom,
    };
    const orreryBounds = clippedViewportRect(orreryViewport, surfaceRect);
    const plotBounds = clippedViewportRect(plotViewport, surfaceRect);

    if (orreryBounds && (orreryBounds.width !== orreryCameraWidth || orreryBounds.height !== orreryCameraHeight)) {
      orrery.camera.aspect = orreryBounds.width / orreryBounds.height;
      orrery.camera.updateProjectionMatrix();
      orreryCameraWidth = orreryBounds.width;
      orreryCameraHeight = orreryBounds.height;
    }

    // Erase previous viewport footprints before rendering the current layout.
    renderer.setScissorTest(false);
    renderer.clear(true, true, true);
    renderer.setScissorTest(true);
    orrery.updateControls();
    renderView(orrery.scene, orrery.camera, orreryBounds);
    renderView(plot.scene, plot.camera, plotBounds);
    renderer.setScissorTest(false);
  }

  function destroy() {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('resize', markLayoutDirty);
    renderer.xr.removeEventListener?.('sessionstart', onXRSessionStart);
    renderer.xr.removeEventListener?.('sessionend', onXRSessionEnd);
    resizeObserver?.disconnect();
    workbench.destroy();
    plot.destroy();
    orrery.destroy();
    renderer.dispose();
    renderer.domElement.remove();
  }

  return {
    renderer,
    render,
    setGrid(grid) {
      plot.setGrid(grid);
      workbench.setState(latestXRState);
    },
    setBudget: (budget) => plot.setBudget(budget),
    setSelection: (cell) => plot.setSelection(cell),
    setHover: (cell) => plot.setHover(cell),
    setTransfer: (transfer, samples) => orrery.setTransfer(transfer, samples),
    setMissionTime: (epochMs, spacecraftPosition) => orrery.setMissionTime(epochMs, spacecraftPosition),
    setTarget: (target, departureMs) => orrery.setTarget(target, departureMs),
    setBodyScale: (exaggeratedBoolean) => orrery.setBodyScale(exaggeratedBoolean),
    resetView: () => orrery.resetView(),
    getColorRange: () => plot.getColorRange(),
    xrScene: workbench.xrScene,
    xrCamera: workbench.xrCamera,
    xrRig: workbench.xrRig,
    setImmersive,
    updateXR(deltaSeconds, nowMs) {
      workbench.updateXR(deltaSeconds, nowMs);
    },
    setXRState(snapshot) {
      latestXRState = snapshot ?? null;
      workbench.setState(latestXRState);
    },
    getXRDiagnostics: () => workbench.getDiagnostics(),
    destroy,
  };
}
