import * as THREE from 'three';
import fragmentShader from '../shaders/porkchop.frag.glsl?raw';
import vertexShader from '../shaders/porkchop.vert.glsl?raw';
import { uvToCell } from '../app/plotPicking.js';

export const PORKCHOP_COST_UNIT = 'km/s';
export const PORKCHOP_COLOUR_STOPS = Object.freeze([
  Object.freeze({ at: 0, color: '#315f86' }),
  Object.freeze({ at: 1 / 3, color: '#83adbf' }),
  Object.freeze({ at: 2 / 3, color: '#e8cc88' }),
  Object.freeze({ at: 1, color: '#c77e39' }),
]);

const NO_CELL = Object.freeze({ i: -1, j: -1 });
const POINTER_DRAG_THRESHOLD_PX = 5;

function assertGrid(grid, maxTextureSize) {
  if (!grid || typeof grid !== 'object') throw new TypeError('grid must be a porkchop grid');
  const { departureCount, tofCount } = grid;
  if (!Number.isSafeInteger(departureCount) || departureCount < 1) {
    throw new RangeError('grid.departureCount must be a positive safe integer');
  }
  if (!Number.isSafeInteger(tofCount) || tofCount < 1) {
    throw new RangeError('grid.tofCount must be a positive safe integer');
  }
  if (departureCount > maxTextureSize || tofCount > maxTextureSize) {
    throw new RangeError(`grid dimensions cannot exceed this device texture limit (${maxTextureSize})`);
  }
  const count = departureCount * tofCount;
  if (!Number.isSafeInteger(count)) throw new RangeError('grid cell count exceeds the safe integer range');
  if (!(grid.costs instanceof Float32Array) || grid.costs.length !== count) {
    throw new TypeError('grid.costs must be a Float32Array with one value per row-major cell');
  }
  if (!(grid.c3 instanceof Float32Array) || grid.c3.length !== count) {
    throw new TypeError('grid.c3 must be a Float32Array with one value per row-major cell');
  }
  const departureEpochs = grid.departureEpochs ?? grid.epochs;
  if (!departureEpochs || departureEpochs.length !== departureCount) {
    throw new TypeError('grid.departureEpochs (or grid.epochs) must match departureCount');
  }
  if (!grid.tofDays || grid.tofDays.length !== tofCount) {
    throw new TypeError('grid.tofDays must match tofCount');
  }
  return count;
}

function colorRangeFor(costs) {
  const finiteCosts = [];
  for (const cost of costs) {
    if (Number.isFinite(cost) && cost >= 0) finiteCosts.push(cost);
  }
  if (finiteCosts.length === 0) return { min: 0, max: 1 };

  finiteCosts.sort((left, right) => left - right);
  const min = finiteCosts[0];
  const trueMax = finiteCosts[finiteCosts.length - 1];
  let max = finiteCosts[Math.floor((finiteCosts.length - 1) * 0.95)];
  if (!(max > min)) max = trueMax;
  if (!(max > min)) max = min + Math.max(Math.abs(min) * 0.02, 0.5);
  return { min, max };
}

function makeDataTexture(values, width, height, format) {
  const channels = format === 'rgba' ? 4 : 1;
  const uploaded = new Float32Array(values.length * channels);
  if (channels === 1) {
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index];
      uploaded[index] = Number.isFinite(value) && value >= 0 ? value : -1;
    }
  } else {
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index];
      const offset = index * 4;
      uploaded[offset] = Number.isFinite(value) && value >= 0 ? value : -1;
      uploaded[offset + 1] = 0;
      uploaded[offset + 2] = 0;
      uploaded[offset + 3] = 1;
    }
  }

  const texture = new THREE.DataTexture(
    uploaded,
    width,
    height,
    format === 'rgba' ? THREE.RGBAFormat : THREE.RedFormat,
    THREE.FloatType,
  );
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

function sameCell(left, right) {
  return left === right || (left !== null && right !== null && left.i === right.i && left.j === right.j);
}

/** Create the float-DataTexture plot, shader and desktop pointer/keyboard picking. */
export function createPorkchop({
  renderer,
  plotViewport,
  textureFormat = 'red',
  onSelect,
  onHover,
}) {
  if (textureFormat !== 'red' && textureFormat !== 'rgba') {
    throw new RangeError("textureFormat must be 'red' or 'rgba'");
  }
  if (!renderer.capabilities.isWebGL2) {
    throw new Error('The scientific plot requires a WebGL2 renderer for nearest-sampled float textures');
  }

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 10);
  camera.position.set(0, 0, 2);
  scene.add(camera);

  const colorValues = PORKCHOP_COLOUR_STOPS.map(({ color }) => new THREE.Color(color));
  const uniforms = {
    costTexture: { value: null },
    c3Texture: { value: null },
    gridResolution: { value: new THREE.Vector2(1, 1) },
    colorRange: { value: new THREE.Vector2(0, 1) },
    selectedCell: { value: new THREE.Vector2(NO_CELL.i, NO_CELL.j) },
    hoveredCell: { value: new THREE.Vector2(NO_CELL.i, NO_CELL.j) },
    budgetLimit: { value: 0 },
    budgetType: { value: 0 },
    color0: { value: colorValues[0] },
    color1: { value: colorValues[1] },
    color2: { value: colorValues[2] },
    color3: { value: colorValues[3] },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  plane.name = 'Porkchop cost plot';
  plane.visible = false;
  scene.add(plane);
  if (!plotViewport.hasAttribute('role')) plotViewport.setAttribute('role', 'group');
  if (!plotViewport.hasAttribute('aria-label')) {
    plotViewport.setAttribute(
      'aria-label',
      'Porkchop plot. Use arrow keys to move the hover cell and Enter to select it.',
    );
  }

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  let grid = null;
  let costTexture = null;
  let c3Texture = null;
  let selectedCell = null;
  let hoveredCell = null;
  let colorRange = null;
  let pointerDown = null;
  let disposed = false;

  if (plotViewport.tabIndex < 0) plotViewport.tabIndex = 0;

  function normalizedCell(cell) {
    if (cell === null || cell === undefined) return null;
    if (
      !grid
      || !Number.isInteger(cell.i)
      || !Number.isInteger(cell.j)
      || cell.i < 0
      || cell.i >= grid.departureCount
      || cell.j < 0
      || cell.j >= grid.tofCount
    ) {
      return null;
    }
    return { i: cell.i, j: cell.j };
  }

  function setSelection(cell) {
    selectedCell = normalizedCell(cell);
    uniforms.selectedCell.value.set(selectedCell?.i ?? NO_CELL.i, selectedCell?.j ?? NO_CELL.j);
  }

  function setHover(cell) {
    hoveredCell = normalizedCell(cell);
    uniforms.hoveredCell.value.set(hoveredCell?.i ?? NO_CELL.i, hoveredCell?.j ?? NO_CELL.j);
  }

  function getColorRange() {
    return colorRange ? { ...colorRange } : null;
  }

  function getCellAtUV(u, v, reusableCell = null) {
    if (!grid) return null;
    if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
    const i = Math.min(grid.departureCount - 1, Math.floor(Math.min(1, Math.max(0, u)) * grid.departureCount));
    const j = Math.min(grid.tofCount - 1, Math.floor(Math.min(1, Math.max(0, v)) * grid.tofCount));
    if (reusableCell && typeof reusableCell === 'object') {
      reusableCell.i = i;
      reusableCell.j = j;
      return reusableCell;
    }
    return { i, j };
  }

  function setGrid(nextGrid) {
    if (nextGrid === grid) return;
    if (nextGrid === null) {
      costTexture?.dispose();
      c3Texture?.dispose();
      costTexture = null;
      c3Texture = null;
      grid = null;
      colorRange = null;
      uniforms.costTexture.value = null;
      uniforms.c3Texture.value = null;
      plane.visible = false;
      setSelection(null);
      const hadHover = hoveredCell !== null;
      setHover(null);
      if (hadHover) onHover?.(null);
      return;
    }

    const cellCount = assertGrid(nextGrid, renderer.capabilities.maxTextureSize);
    const nextCostTexture = makeDataTexture(
      nextGrid.costs,
      nextGrid.departureCount,
      nextGrid.tofCount,
      textureFormat,
    );
    let nextC3Texture;
    try {
      nextC3Texture = makeDataTexture(
        nextGrid.c3,
        nextGrid.departureCount,
        nextGrid.tofCount,
        textureFormat,
      );
    } catch (error) {
      nextCostTexture.dispose();
      throw error;
    }

    costTexture?.dispose();
    c3Texture?.dispose();
    costTexture = nextCostTexture;
    c3Texture = nextC3Texture;
    grid = nextGrid;
    colorRange = colorRangeFor(nextGrid.costs);
    uniforms.costTexture.value = costTexture;
    uniforms.c3Texture.value = c3Texture;
    uniforms.gridResolution.value.set(nextGrid.departureCount, nextGrid.tofCount);
    uniforms.colorRange.value.set(colorRange.min, colorRange.max);
    plane.visible = cellCount > 0;

    setSelection(null);
    const hadHover = hoveredCell !== null;
    setHover(null);
    if (hadHover) onHover?.(null);
  }

  function setBudget(nextBudget = { type: 'none', limit: 0 }) {
    const type = nextBudget?.type ?? 'none';
    if (type !== 'none' && type !== 'cost' && type !== 'c3') {
      throw new RangeError("budget.type must be 'none', 'cost', or 'c3'");
    }
    const limit = type === 'none' ? 0 : nextBudget.limit;
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 0) {
      throw new RangeError('an active budget limit must be a non-negative finite number');
    }
    uniforms.budgetType.value = type === 'none' ? 0 : (type === 'cost' ? 1 : 2);
    uniforms.budgetLimit.value = limit;
  }

  function cellAtPointer(event) {
    if (!grid) return null;
    const bounds = plotViewport.getBoundingClientRect();
    if (!(bounds.width > 0 && bounds.height > 0)) return null;
    pointerNdc.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      1 - ((event.clientY - bounds.top) / bounds.height) * 2,
    );
    raycaster.setFromCamera(pointerNdc, camera);
    const hit = raycaster.intersectObject(plane, false)[0];
    if (!hit?.uv) return null;
    const mapped = uvToCell(hit.uv.x, hit.uv.y, grid.departureCount, grid.tofCount);
    return mapped ? { i: mapped.i, j: mapped.j } : null;
  }

  function updateHover(nextCell, notify = true) {
    const next = normalizedCell(nextCell);
    if (sameCell(hoveredCell, next)) return;
    setHover(next);
    if (notify) onHover?.(next ? { i: next.i, j: next.j } : null);
  }

  function onPointerMove(event) {
    updateHover(cellAtPointer(event));
  }

  function onPointerLeave() {
    updateHover(null);
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    pointerDown = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    try {
      plotViewport.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is an enhancement; the pointer-up handler remains safe without it.
    }
  }

  function onPointerUp(event) {
    if (!pointerDown || pointerDown.pointerId !== event.pointerId) return;
    const start = pointerDown;
    pointerDown = null;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (moved > POINTER_DRAG_THRESHOLD_PX) return;
    const cell = cellAtPointer(event);
    if (!cell) return;
    updateHover(cell);
    onSelect?.({ i: cell.i, j: cell.j });
  }

  function onPointerCancel() {
    pointerDown = null;
  }

  function onKeyDown(event) {
    if (event.altKey || event.ctrlKey || event.metaKey || !grid) return;
    if (event.key === 'Enter') {
      if (hoveredCell) {
        event.preventDefault();
        onSelect?.({ i: hoveredCell.i, j: hoveredCell.j });
      }
      return;
    }

    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const base = hoveredCell ?? selectedCell ?? {
      i: Math.floor((grid.departureCount - 1) / 2),
      j: Math.floor((grid.tofCount - 1) / 2),
    };
    let i = base.i;
    let j = base.j;
    if (event.key === 'ArrowLeft') i -= 1;
    if (event.key === 'ArrowRight') i += 1;
    if (event.key === 'ArrowUp') j += 1;
    if (event.key === 'ArrowDown') j -= 1;
    i = Math.min(grid.departureCount - 1, Math.max(0, i));
    j = Math.min(grid.tofCount - 1, Math.max(0, j));
    event.preventDefault();
    updateHover({ i, j });
  }

  plotViewport.addEventListener('pointermove', onPointerMove);
  plotViewport.addEventListener('pointerleave', onPointerLeave);
  plotViewport.addEventListener('pointerdown', onPointerDown);
  plotViewport.addEventListener('pointerup', onPointerUp);
  plotViewport.addEventListener('pointercancel', onPointerCancel);
  plotViewport.addEventListener('keydown', onKeyDown);

  return {
    scene,
    camera,
    // The same shader plane is used by desktop ray picking and the in-world
    // workbench. Do not clone it or its float textures for XR.
    mesh: plane,
    plane,
    setGrid,
    setBudget,
    setSelection,
    setHover,
    getColorRange,
    getCellAtUV,
    getGrid: () => grid,
    destroy() {
      if (disposed) return;
      disposed = true;
      plotViewport.removeEventListener('pointermove', onPointerMove);
      plotViewport.removeEventListener('pointerleave', onPointerLeave);
      plotViewport.removeEventListener('pointerdown', onPointerDown);
      plotViewport.removeEventListener('pointerup', onPointerUp);
      plotViewport.removeEventListener('pointercancel', onPointerCancel);
      plotViewport.removeEventListener('keydown', onKeyDown);
      costTexture?.dispose();
      c3Texture?.dispose();
      plane.geometry.dispose();
      material.dispose();
    },
  };
}
