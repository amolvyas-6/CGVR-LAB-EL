import * as THREE from 'three';
import { createXRControllers } from './controllers.js';
import { PORKCHOP_COLOUR_STOPS } from '../scene/porkchop.js';
import { validateMissionInputs } from '../app/planner.js';
import {
  getModelScale,
  panelLocalPointFromUV,
  progressFromUV,
  XR_CONTROLS_CANVAS,
  XR_LAYOUT,
  XR_PLOT_CANVAS,
  XR_RESULTS_CANVAS,
} from './layout.js';
import {
  createTextPanel,
  drawFittedText,
  drawRoundedRect,
  formatDate,
  formatNumber,
} from './textPanel.js';

const PALETTE = Object.freeze({
  paper: '#f5f7fa',
  white: '#ffffff',
  ink: '#243348',
  steel: '#5d6d82',
  blue: '#245da8',
  amber: '#b17c45',
  border: '#b8c4d1',
  muted: '#e7edf3',
  disabled: '#edf0f3',
  error: '#973d34',
  success: '#23684e',
});

const CONTROL_ROWS = Object.freeze({
  target: 150,
  departure: 285,
  tof: 410,
  resolution: 535,
  budget: 665,
  actions: 805,
});

function canvasFont(context, size, weight = 500) {
  context.font = `${weight} ${size}px system-ui, sans-serif`;
  context.textBaseline = 'middle';
}

function canvasLine(context, x1, y1, x2, y2, color = PALETTE.border, width = 2) {
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.strokeStyle = color;
  context.lineWidth = width;
  context.stroke();
}

function cleanStatus(status) {
  if (typeof status === 'string') return status;
  if (status && typeof status === 'object') {
    return String(status.message ?? status.label ?? status.status ?? status.state ?? '');
  }
  return '';
}

function displayEpoch(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isFinite(date.getTime())
      ? date.toISOString().replace('T', ' ').replace(/:\d{2}\.000Z$/, 'Z')
      : '—';
  }
  return formatDate(value);
}

function minimumLine(summary, hasGrid) {
  if (!summary) return hasGrid ? 'No feasible discrete minimum for the active budget.' : 'No sampled-grid minimum yet.';
  if (typeof summary === 'string') return summary;
  const departure = summary.departure ?? displayEpoch(summary.departureMs);
  const tof = summary.tofDays ?? summary.tof;
  const cost = summary.cost;
  const c3 = summary.c3;
  return `Grid minimum · ${departure} · ${Number.isFinite(Number(tof)) ? `${formatNumber(tof, 1)} d` : (tof ?? '—')}`
    + ` · ${formatNumber(cost)} km/s · C3 ${formatNumber(c3)} km²/s²`;
}

function minimumLines(summary, hasGrid) {
  if (typeof summary === 'string') {
    const marker = '. Feasible: ';
    const splitAt = summary.indexOf(marker);
    if (splitAt >= 0) {
      return [summary.slice(0, splitAt), `Feasible · ${summary.slice(splitAt + marker.length).replace(/\.$/, '')}`];
    }
  }
  return [minimumLine(summary, hasGrid)];
}

function telemetryLine(telemetry) {
  if (!telemetry || typeof telemetry !== 'object') return '';
  const values = [];
  const fps = telemetry.fps ?? telemetry.frameRate;
  const frameMs = telemetry.frameMs ?? telemetry.frameIntervalMs;
  const callbackMs = telemetry.callbackMs ?? telemetry.callbackDurationMs;
  const isFiniteMetric = (value) => value !== null && value !== undefined && Number.isFinite(Number(value));
  if (isFiniteMetric(fps)) values.push(`${formatNumber(fps, 0)} Hz`);
  if (isFiniteMetric(frameMs)) values.push(`${formatNumber(frameMs, 1)} ms/frame`);
  if (isFiniteMetric(callbackMs)) values.push(`${formatNumber(callbackMs, 2)} ms callback`);
  if (isFiniteMetric(telemetry.calls)) values.push(`${telemetry.calls} calls`);
  if (isFiniteMetric(telemetry.triangles)) values.push(`${telemetry.triangles} tris`);
  return values.join(' · ');
}

function profileInstructions(profile) {
  if (typeof profile?.instructions === 'string' && profile.instructions.trim()) {
    return profile.instructions.trim();
  }
  if (Array.isArray(profile?.instructions) && profile.instructions.length > 0) {
    return profile.instructions.filter((item) => typeof item === 'string').join(' · ');
  }
  return 'Aim + trigger selects · horizontal stick scrubs mission time · ray buttons are always available.';
}

function setPanelPosition(group, position, rotationX = 0) {
  group.position.set(position[0], position[1], position[2]);
  group.rotation.x = rotationX;
}

function getSnapshotScaleFlag(snapshot, fallback = false) {
  const flag = snapshot?.modelScaleExaggerated ?? snapshot?.largerScale;
  return typeof flag === 'boolean' ? flag : fallback;
}

function getRadiusFlag(snapshot, fallback = true) {
  const flag = snapshot?.radiiExaggerated ?? snapshot?.scaleExaggerated;
  return typeof flag === 'boolean' ? flag : fallback;
}

/**
 * Build the single re-usable in-world workbench around the existing plot and
 * orrery objects. This module owns only XR composition, labels and hit targets.
 */
export function createXRWorkbench({
  renderer,
  plot,
  orrery,
  onSelect,
  onHover,
  onXRAction,
}) {
  const xrScene = new THREE.Scene();
  xrScene.name = 'VR-first mission workbench';
  xrScene.background = new THREE.Color(PALETTE.paper);

  let referenceSpace = 'local-floor';
  if (typeof renderer.xr.setReferenceSpaceType === 'function') {
    try {
      renderer.xr.setReferenceSpaceType(referenceSpace);
    } catch {
      referenceSpace = 'local';
      try {
        renderer.xr.setReferenceSpaceType(referenceSpace);
      } catch {
        // Older implementations still use their default viewer-relative space.
      }
    }
  }
  try {
    renderer.xr.setFoveation?.(1);
  } catch {
    // Foveation is an optional implementation capability.
  }

  const xrRig = new THREE.Group();
  xrRig.name = 'Viewer and controller rig';
  const xrCamera = new THREE.PerspectiveCamera(68, 1, 0.01, 100);
  xrCamera.name = 'WebXR viewer camera';
  xrCamera.position.set(0, 0, 0);
  xrRig.add(xrCamera);
  xrScene.add(xrRig);

  const layoutRoot = new THREE.Group();
  layoutRoot.name = 'Stationary tabletop workbench layout';
  if (referenceSpace === 'local') layoutRoot.position.y = -1.6;
  xrScene.add(layoutRoot);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.76);
  xrScene.add(ambientLight);
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.65);
  fillLight.position.set(-1.5, 3, 1.5);
  xrScene.add(fillLight);

  const scratchCell = { i: 0, j: 0 };
  const reusableHits = [];
  const hitRecord = {
    object: null,
    point: new THREE.Vector3(),
    uv: new THREE.Vector2(),
    kind: null,
    i: undefined,
    j: undefined,
    action: undefined,
    progress: undefined,
  };
  const scratchCorners = [
    new THREE.Vector3(-0.5, -0.5, 0),
    new THREE.Vector3(0.5, -0.5, 0),
    new THREE.Vector3(0.5, 0.5, 0),
    new THREE.Vector3(-0.5, 0.5, 0),
  ];
  const scratchNormal = new THREE.Vector3(0, 0, 1);
  const scratchNormalMatrix = new THREE.Matrix3();

  const plotRoot = new THREE.Group();
  plotRoot.name = 'Porkchop chart and scientific legend';
  setPanelPosition(plotRoot, XR_LAYOUT.plot.center);
  layoutRoot.add(plotRoot);

  const resultsRoot = new THREE.Group();
  resultsRoot.name = 'Selected transfer and playback readout';
  setPanelPosition(resultsRoot, XR_LAYOUT.results.center);
  layoutRoot.add(resultsRoot);

  const controlsRoot = new THREE.Group();
  controlsRoot.name = 'Ray-pickable mission controls';
  setPanelPosition(controlsRoot, XR_LAYOUT.controls.center, XR_LAYOUT.controls.tiltRadians);
  layoutRoot.add(controlsRoot);

  const plotPanel = createTextPanel({
    width: XR_LAYOUT.plot.width,
    height: XR_LAYOUT.plot.height,
    pixelWidth: XR_PLOT_CANVAS.width,
    pixelHeight: XR_PLOT_CANVAS.height,
    name: 'Porkchop axes and color legend',
  });
  plotRoot.add(plotPanel.mesh);

  const resultsPanel = createTextPanel({
    width: XR_LAYOUT.results.width,
    height: XR_LAYOUT.results.height,
    pixelWidth: XR_RESULTS_CANVAS.width,
    pixelHeight: XR_RESULTS_CANVAS.height,
    name: 'Mission result summary and time bar',
  });
  resultsRoot.add(resultsPanel.mesh);

  const controlsPanel = createTextPanel({
    width: XR_LAYOUT.controls.width,
    height: XR_LAYOUT.controls.height,
    pixelWidth: XR_CONTROLS_CANVAS.width,
    pixelHeight: XR_CONTROLS_CANVAS.height,
    name: 'Compact mission tuning controls',
  });
  controlsRoot.add(controlsPanel.mesh);

  // A quiet circular tabletop and thin rim orient the horizontal ephemeris
  // model without adding stars, glow, or a game-like environment.
  const table = new THREE.Mesh(
    new THREE.CircleGeometry(XR_LAYOUT.orrery.tableRadius, 96),
    new THREE.MeshBasicMaterial({ color: 0xe8edf2, side: THREE.FrontSide }),
  );
  table.name = 'Neutral orrery tabletop';
  table.rotation.x = -Math.PI / 2;
  table.position.set(
    XR_LAYOUT.orrery.center[0],
    XR_LAYOUT.orrery.center[1] - 0.012,
    XR_LAYOUT.orrery.center[2],
  );
  layoutRoot.add(table);
  const rim = new THREE.Mesh(
    new THREE.RingGeometry(XR_LAYOUT.orrery.tableRadius - 0.006, XR_LAYOUT.orrery.tableRadius, 96),
    new THREE.MeshBasicMaterial({ color: 0x9eacba, side: THREE.FrontSide }),
  );
  rim.name = 'Tabletop edge';
  rim.rotation.x = -Math.PI / 2;
  rim.position.set(
    XR_LAYOUT.orrery.center[0],
    XR_LAYOUT.orrery.center[1] - 0.008,
    XR_LAYOUT.orrery.center[2],
  );
  layoutRoot.add(rim);

  const buttonSpecs = [];
  const interactiveObjects = [];
  const buttonMeshes = new Map();
  const buttonSpecsById = new Map();
  const reusableBudgetStepAction = { type: 'budgetStep', delta: 0 };

  function addButton(id, x, y, width, height, action, label, { group = controlsRoot } = {}) {
    const canvas = XR_CONTROLS_CANVAS;
    const panel = XR_LAYOUT.controls;
    const buttonWidth = width / canvas.width * panel.width;
    const buttonHeight = height / canvas.height * panel.height;
    const geometry = new THREE.PlaneGeometry(buttonWidth, buttonHeight);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      colorWrite: false,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `XR action hitbox · ${id}`;
    mesh.position.set(
      (x / canvas.width - 0.5) * panel.width,
      (0.5 - y / canvas.height) * panel.height,
      0.006,
    );
    mesh.userData.kind = 'action';
    mesh.userData.actionId = id;
    mesh.userData.disabled = false;
    mesh.layers.set(31); // Ray-only hitbox: do not draw an invisible quad per eye.
    group.add(mesh);
    interactiveObjects.push(mesh);
    buttonMeshes.set(id, mesh);
    const spec = { id, x, y, width, height, action, label, mesh };
    buttonSpecs.push(spec);
    buttonSpecsById.set(id, spec);
    return mesh;
  }

  const targetButtons = ['Venus', 'Mars', 'Jupiter'];
  targetButtons.forEach((target, index) => {
    addButton(`target-${target.toLowerCase()}`, 300 + index * 420, CONTROL_ROWS.target, 350, 86,
      { type: 'target', target }, target);
  });

  addButton('departure-start-minus', 145, CONTROL_ROWS.departure, 156, 76,
    { type: 'step', field: 'departureStart', delta: -7 }, '− 7 d');
  addButton('departure-start-plus', 575, CONTROL_ROWS.departure, 156, 76,
    { type: 'step', field: 'departureStart', delta: 7 }, '+ 7 d');
  addButton('departure-end-minus', 865, CONTROL_ROWS.departure, 156, 76,
    { type: 'step', field: 'departureEnd', delta: -7 }, '− 7 d');
  addButton('departure-end-plus', 1295, CONTROL_ROWS.departure, 156, 76,
    { type: 'step', field: 'departureEnd', delta: 7 }, '+ 7 d');

  addButton('tof-min-minus', 145, CONTROL_ROWS.tof, 156, 76,
    { type: 'step', field: 'tofMinDays', delta: -10 }, '− 10 d');
  addButton('tof-min-plus', 575, CONTROL_ROWS.tof, 156, 76,
    { type: 'step', field: 'tofMinDays', delta: 10 }, '+ 10 d');
  addButton('tof-max-minus', 865, CONTROL_ROWS.tof, 156, 76,
    { type: 'step', field: 'tofMaxDays', delta: -10 }, '− 10 d');
  addButton('tof-max-plus', 1295, CONTROL_ROWS.tof, 156, 76,
    { type: 'step', field: 'tofMaxDays', delta: 10 }, '+ 10 d');

  addButton('resolution-minus', 86, CONTROL_ROWS.resolution, 126, 76,
    { type: 'step', field: 'resolution', delta: -10 }, '− 10');
  addButton('resolution-plus', 405, CONTROL_ROWS.resolution, 126, 76,
    { type: 'step', field: 'resolution', delta: 10 }, '+ 10');
  for (const [index, type] of ['none', 'cost', 'c3'].entries()) {
    addButton(`budget-${type}`, 735 + index * 235, CONTROL_ROWS.resolution, 208, 76,
      { type: 'budgetType', value: type }, type === 'none' ? 'None' : type === 'cost' ? 'Cost proxy' : 'C3');
  }

  addButton('budget-minus', 130, CONTROL_ROWS.budget, 164, 76,
    () => ({ type: 'budgetStep', delta: budgetStep(-1) }), '− STEP');
  addButton('budget-plus', 795, CONTROL_ROWS.budget, 164, 76,
    () => ({ type: 'budgetStep', delta: budgetStep(1) }), '+ STEP');
  addButton('compute', 1160, CONTROL_ROWS.budget, 420, 84,
    { type: 'compute' }, 'Compute grid');

  addButton('snap', 140, CONTROL_ROWS.actions, 210, 86, { type: 'snap' }, 'Snap to min');
  addButton('play', 380, CONTROL_ROWS.actions, 210, 86, { type: 'play' }, 'Play');
  addButton('scale', 620, CONTROL_ROWS.actions, 210, 86, { type: 'scale' }, 'Larger model');
  addButton('radii', 860, CONTROL_ROWS.actions, 210, 86, { type: 'radii' }, 'Physical radii');
  addButton('reset', 1100, CONTROL_ROWS.actions, 180, 86, { type: 'reset' }, 'Reset scale');
  addButton('exit', 1320, CONTROL_ROWS.actions, 180, 86, { type: 'exit' }, 'Exit VR');
  addButton('defaults', 1135, 48, 500, 68, { type: 'defaults' }, 'Reset mission inputs');

  const timeCanvas = XR_RESULTS_CANVAS;
  const timePanel = XR_LAYOUT.results;
  const timeWidthPx = 1060;
  const timeHeightPx = 78;
  const timeBar = new THREE.Mesh(
    new THREE.PlaneGeometry(
      (timeWidthPx / timeCanvas.width) * timePanel.width,
      (timeHeightPx / timeCanvas.height) * timePanel.height,
    ),
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      colorWrite: false,
      depthWrite: false,
      side: THREE.FrontSide,
    }),
  );
  const timeUv = panelLocalPointFromUV(0.5, 1 - 491 / timeCanvas.height, timePanel.width, timePanel.height);
  timeBar.name = 'XR mission progress timebar hit target';
  timeBar.position.set(timeUv.x, timeUv.y, 0.006);
  timeBar.userData.kind = 'time';
  timeBar.userData.disabled = true;
  timeBar.layers.set(31);
  resultsRoot.add(timeBar);
  interactiveObjects.push(timeBar);

  const originalTransforms = new Map();
  let immersive = false;
  let disposed = false;
  let currentSnapshot = null;
  let currentAssetStatus = null;
  let currentProfile = null;
  let hoveredActionId = null;
  let previousHoverKey = '';
  let controlSignature = null;
  let plotSignature = null;
  let lastPlotGrid = null;
  let lastPlotTarget = null;
  let lastPlotMin = null;
  let lastPlotMax = null;
  let resultStaticSignature = null;
  let resultDynamicSignature = null;
  let lastDynamicPaintMs = -Infinity;
  let pendingDynamicResult = false;
  let largerModel = false;
  let exaggeratedRadii = true;
  let previousControlsEnabled = true;

  function currentTarget() {
    const candidate = String(currentSnapshot?.inputs?.target ?? plot.getGrid()?.config?.target ?? 'Mars');
    return ['venus', 'mars', 'jupiter'].includes(candidate.toLowerCase()) ? candidate : 'Mars';
  }

  function budgetInput() {
    return currentSnapshot?.budgetInput ?? { type: 'none', limit: '0' };
  }

  function budgetStep(direction) {
    const type = budgetInput().type;
    return direction * (type === 'c3' ? 5 : 0.5);
  }

  function modelTarget() {
    return orrery.getTarget?.() ?? currentTarget();
  }

  function syncOrreryScale() {
    const target = modelTarget();
    largerModel = getSnapshotScaleFlag(currentSnapshot, largerModel);
    exaggeratedRadii = getRadiusFlag(currentSnapshot, exaggeratedRadii);
    const modelScale = getModelScale(target, largerModel);
    if (immersive) orrery.setWorldScale(modelScale.metresPerAu);
    return modelScale;
  }

  function getAssetStatus() {
    return currentSnapshot?.assetStatus ?? currentAssetStatus;
  }

  function plotRange() {
    return plot.getColorRange();
  }

  function axisDate(epoch) {
    if (!Number.isFinite(Number(epoch))) return '—';
    return new Date(Number(epoch)).toISOString().slice(0, 10);
  }

  function drawPlotPanel(context, width, height) {
    const grid = plot.getGrid();
    const target = grid?.config?.target ?? currentTarget();
    const range = plotRange();
    const chart = XR_PLOT_CANVAS.chart;
    context.fillStyle = PALETTE.paper;
    context.fillRect(0, 0, width, height);
    drawRoundedRect(context, 4, 4, width - 8, height - 8, 22, PALETTE.white, PALETTE.border);
    drawFittedText(context, `Earth → ${target} transfer costs`, 54, 66, width - 108,
      { fontSize: 48, minFontSize: 36, weight: 650, color: PALETTE.ink });

    context.fillStyle = '#fbfcfd';
    context.fillRect(chart.x, chart.y, chart.width, chart.height);
    context.strokeStyle = PALETTE.steel;
    context.lineWidth = 2;
    context.strokeRect(chart.x, chart.y, chart.width, chart.height);

    const departureEpochs = grid?.departureEpochs ?? grid?.epochs;
    const tofDays = grid?.tofDays;
    const xTicks = [0, 0.5, 1];
    const yTicks = [0, 0.5, 1];
    context.strokeStyle = '#dce3ea';
    context.lineWidth = 1.5;
    for (const t of xTicks) {
      const x = chart.x + chart.width * t;
      canvasLine(context, x, chart.y, x, chart.y + chart.height, '#e4e9ee', 1.5);
    }
    for (const t of yTicks) {
      const y = chart.y + chart.height * t;
      canvasLine(context, chart.x, y, chart.x + chart.width, y, '#e4e9ee', 1.5);
    }
    const dates = departureEpochs?.length
      ? [departureEpochs[0], (departureEpochs[0] + departureEpochs[departureEpochs.length - 1]) / 2, departureEpochs[departureEpochs.length - 1]]
      : [];
    const flightTimes = tofDays?.length
      ? [tofDays[0], (tofDays[0] + tofDays[tofDays.length - 1]) / 2, tofDays[tofDays.length - 1]]
      : [];
    canvasFont(context, 32, 500);
    context.fillStyle = PALETTE.steel;
    context.textAlign = 'center';
    for (let index = 0; index < 3; index += 1) {
      const x = chart.x + (chart.width * index) / 2;
      context.fillText(dates[index] === undefined ? '—' : axisDate(dates[index]), x, chart.y + chart.height + 31);
      const y = chart.y + chart.height - (chart.height * index) / 2;
      context.textAlign = 'right';
      context.fillText(flightTimes[index] === undefined ? '—' : `${formatNumber(flightTimes[index], 0)} d`, chart.x - 18, y);
      context.textAlign = 'center';
    }
    drawFittedText(context, 'Departure date (UTC) →', chart.x + chart.width / 2, 872, chart.width,
      { fontSize: 34, minFontSize: 28, weight: 600, color: PALETTE.ink, align: 'center' });
    context.save();
    context.translate(54, chart.y + chart.height / 2);
    context.rotate(-Math.PI / 2);
    drawFittedText(context, 'Time of flight · days ↑', 0, 0, chart.height,
      { fontSize: 32, minFontSize: 27, weight: 600, color: PALETTE.ink, align: 'center' });
    context.restore();

    const gradientX = 250;
    const gradientY = 930;
    const gradientWidth = 820;
    const gradient = context.createLinearGradient(gradientX, 0, gradientX + gradientWidth, 0);
    for (const stop of PORKCHOP_COLOUR_STOPS) gradient.addColorStop(stop.at, stop.color);
    drawFittedText(context, 'Cost proxy · km/s', gradientX, gradientY - 28, gradientWidth,
      { fontSize: 32, minFontSize: 27, weight: 600, color: PALETTE.ink, align: 'center' });
    context.fillStyle = gradient;
    context.fillRect(gradientX, gradientY - 12, gradientWidth, 24);
    context.strokeStyle = PALETTE.steel;
    context.strokeRect(gradientX, gradientY - 12, gradientWidth, 24);
    drawFittedText(context, range ? formatNumber(range.min) : '—', gradientX - 14, gradientY + 30, 220,
      { fontSize: 28, minFontSize: 22, weight: 500, color: PALETTE.ink, align: 'left' });
    drawFittedText(context, range ? formatNumber(range.max) : '—', gradientX + gradientWidth + 14, gradientY + 30, 330,
      { fontSize: 28, minFontSize: 22, weight: 500, color: PALETTE.ink, align: 'left' });
    drawFittedText(context, 'Nearest sampled cells · colors above the legend ceiling are clamped', width / 2, 986, width - 80,
      { fontSize: 23, minFontSize: 20, weight: 500, color: PALETTE.steel, align: 'center' });

    if (!grid) {
      drawFittedText(context, 'No grid · tune mission controls, then Compute grid.',
        chart.x + chart.width / 2, chart.y + chart.height / 2, chart.width - 60,
        { fontSize: 38, minFontSize: 29, weight: 550, color: PALETTE.steel, align: 'center' });
    }
  }

  function selectedLines(snapshot) {
    const selection = snapshot?.selection;
    if (!selection || typeof selection !== 'object') return null;
    if (!selection.departure && !selection.arrival) return null;
    return {
      departureArrival: `Departure ${selection.departure ?? '—'}   ·   Arrival ${selection.arrival ?? '—'}`,
      costs: `TOF ${selection.tof ?? '—'}   ·   Proxy ${selection.cost ?? '—'}   ·   C3 ${selection.c3 ?? '—'}`,
      state: `v∞ depart ${selection.vInfDeparture ?? '—'}   ·   arrive ${selection.vInfArrival ?? '—'}   ·   ${selection.branch ?? '—'}`,
      feasibility: selection.feasibility ?? selection.status ?? '—',
    };
  }

  function assetText() {
    const asset = getAssetStatus();
    if (!asset) return 'Body imagery: local assets loading or neutral surfaces.';
    const label = asset.label ?? asset.assetId ?? 'Body imagery';
    return `${label}: ${asset.message ?? asset.status ?? 'status unavailable'}`;
  }

  function scaleDisclosure() {
    const scale = syncOrreryScale();
    const radiusText = exaggeratedRadii ? 'exaggerated radii' : 'physical radii';
    const targetNote = modelTarget().toLowerCase() === currentTarget().toLowerCase()
      ? ''
      : ` · model ${modelTarget()} until Compute`;
    return `${scale.fit ? 'Jupiter fit' : 'Tabletop'} · ${scale.metresPerAu.toFixed(3)} m/AU · ${radiusText}${targetNote}`;
  }

  function drawResultsPanel(context, width, height) {
    const snapshot = currentSnapshot ?? {};
    const lines = selectedLines(snapshot);
    const grid = plot.getGrid();
    const status = snapshot.computing
      ? 'Computing grid in worker…'
      : (cleanStatus(snapshot.status) || (snapshot.hasGrid ? 'Grid ready.' : 'No current grid.'));
    const hover = typeof snapshot.hoverSummary === 'string' ? snapshot.hoverSummary : '';
    const minimum = minimumLines(snapshot.minimumSummary, Boolean(snapshot.hasGrid ?? grid));
    const progress = Number.isFinite(snapshot.progress) ? Math.min(100, Math.max(0, snapshot.progress)) : 0;
    const missionDate = snapshot.missionDate ?? '—';
    const isPlaying = Boolean(snapshot.playing);
    const instructions = profileInstructions(currentProfile);
    const telemetry = telemetryLine(snapshot.telemetry);
    context.fillStyle = PALETTE.paper;
    context.fillRect(0, 0, width, height);
    drawRoundedRect(context, 4, 4, width - 8, height - 8, 20, PALETTE.white, PALETTE.border);
    drawFittedText(context, 'Selected transfer', 40, 31, 400,
      { fontSize: 34, minFontSize: 28, weight: 700, color: PALETTE.blue });
    if (lines) {
      drawFittedText(context, lines.departureArrival, 40, 100, width - 80,
        { fontSize: 42, minFontSize: 28, weight: 560 });
      drawFittedText(context, lines.costs, 40, 158, width - 80,
        { fontSize: 42, minFontSize: 27, weight: 560 });
      drawFittedText(context, lines.state, 40, 216, width - 80,
        { fontSize: 40, minFontSize: 26, weight: 520 });
      drawFittedText(context, `Feasibility · ${lines.feasibility}`, 40, 274, width - 80,
        { fontSize: 39, minFontSize: 25, weight: 560,
          color: /infeasible|invalid|failed/i.test(lines.feasibility) ? PALETTE.error : PALETTE.success });
    } else {
      const message = snapshot.selection?.status || 'No transfer selected · select a valid plot cell or Snap to minimum.';
      drawFittedText(context, message, 40, 158, width - 80,
        { fontSize: 40, minFontSize: 28, weight: 560,
          color: /failed|invalid|no finite/i.test(message) ? PALETTE.error : PALETTE.steel });
    }
    drawFittedText(context, minimum[0], 40, 326, width - 80,
      { fontSize: 35, minFontSize: 24, weight: 550, color: PALETTE.ink });
    if (minimum[1]) {
      drawFittedText(context, minimum[1], 40, 362, width - 80,
        { fontSize: 34, minFontSize: 23, weight: 520, color: PALETTE.steel });
    }
    drawFittedText(context, hover ? `Plot hover · ${hover}` : `Status · ${status}`, 40, 407, width - 80,
      { fontSize: 37, minFontSize: 24, weight: 500,
        color: /error|failed|invalid/i.test(status) ? PALETTE.error : PALETTE.steel });
    drawFittedText(context,
      `Mission time · ${displayEpoch(missionDate)}   ·   ${progress.toFixed(0)}%   ·   ${isPlaying ? 'Playing' : 'Paused'}`,
      40, 455, width - 80,
      { fontSize: 39, minFontSize: 25, weight: 600, color: PALETTE.ink });

    const barLeft = 190;
    const barWidth = 1060;
    const barY = 491;
    const barHeight = 22;
    drawRoundedRect(context, barLeft, barY - barHeight / 2, barWidth, barHeight, 11, '#dce4ec');
    drawRoundedRect(context, barLeft, barY - barHeight / 2, barWidth * progress / 100, barHeight, 11, PALETTE.blue);
    context.fillStyle = PALETTE.steel;
    canvasFont(context, 30, 650);
    context.textAlign = 'center';
    context.fillText('0%', 132, barY);
    context.fillText('100%', 1308, barY);

    drawFittedText(context, `Controller · ${instructions}`, 40, 542, width - 80,
      { fontSize: 36, minFontSize: 23, weight: 500, color: PALETTE.ink });
    drawFittedText(context,
      `Sun-only · patched-conic · zero revolutions · ${scaleDisclosure()}`,
      40, 586, width - 80,
      { fontSize: 34, minFontSize: 22, weight: 520, color: PALETTE.steel });
    drawFittedText(context, `${status}${telemetry ? ` · ${telemetry}` : ''}`,
      40, 630, width - 80,
      { fontSize: 30, minFontSize: 20, weight: 520,
        color: /error|failed/i.test(status) ? PALETTE.error : PALETTE.steel });
    drawFittedText(context, `Local assets · ${assetText()}`,
      40, 674, width - 80,
      { fontSize: 30, minFontSize: 20, weight: 520,
        color: getAssetStatus()?.status === 'error' ? PALETTE.error : PALETTE.steel });
  }

  function inputsAreValid(snapshot) {
    if (!snapshot?.inputs || typeof snapshot.inputs !== 'object') return false;
    return Boolean(validateMissionInputs(snapshot.inputs).config);
  }

  function actionDisabled(spec, snapshot) {
    if (spec.id === 'compute') return Boolean(snapshot.computing) || !inputsAreValid(snapshot);
    if (spec.id === 'snap') return !snapshot.canSnap || snapshot.budgetValid === false;
    if (spec.id === 'play') return !snapshot.canPlay && !snapshot.playing;
    if (spec.id === 'budget-minus' || spec.id === 'budget-plus') {
      return budgetInput().type === 'none' || snapshot.budgetValid === false;
    }
    return false;
  }

  function actionSelected(spec, snapshot) {
    if (spec.id.startsWith('target-')) {
      return currentTarget().toLowerCase() === spec.id.slice('target-'.length);
    }
    if (spec.id.startsWith('budget-')) {
      return budgetInput().type === spec.id.slice('budget-'.length);
    }
    if (spec.id === 'scale') return largerModel;
    if (spec.id === 'radii') return exaggeratedRadii;
    return false;
  }

  function actionLabel(spec, snapshot) {
    const inputs = snapshot.inputs ?? {};
    const budget = budgetInput();
    if (spec.id === 'departure-start-minus') return '− 7 d';
    if (spec.id === 'departure-start-plus') return '+ 7 d';
    if (spec.id === 'departure-end-minus') return '− 7 d';
    if (spec.id === 'departure-end-plus') return '+ 7 d';
    if (spec.id === 'tof-min-minus' || spec.id === 'tof-max-minus') return '− 10 d';
    if (spec.id === 'tof-min-plus' || spec.id === 'tof-max-plus') return '+ 10 d';
    if (spec.id === 'resolution-minus') return '− 10';
    if (spec.id === 'resolution-plus') return '+ 10';
    if (spec.id === 'compute') return snapshot.computing ? 'Computing…' : 'Compute grid';
    if (spec.id === 'budget-minus') return `− ${budget.type === 'c3' ? '5' : '0.5'}`;
    if (spec.id === 'budget-plus') return `+ ${budget.type === 'c3' ? '5' : '0.5'}`;
    if (spec.id === 'snap') return 'Snap to min';
    if (spec.id === 'play') return snapshot.playing ? 'Pause' : 'Play';
    if (spec.id === 'scale') return largerModel ? 'Larger model · on' : 'Larger model';
    if (spec.id === 'radii') return exaggeratedRadii ? 'Exaggerated radii' : 'Physical radii';
    return spec.label;
  }

  function drawButton(context, spec, snapshot) {
    const { x, y, width, height } = spec;
    const disabled = actionDisabled(spec, snapshot);
    const selected = actionSelected(spec, snapshot);
    const hovered = hoveredActionId === spec.id;
    const fill = disabled
      ? PALETTE.disabled
      : hovered
        ? '#dce9f7'
        : selected
          ? '#e7f0fa'
          : PALETTE.white;
    const stroke = disabled ? '#d1d8df' : (selected || hovered ? PALETTE.blue : PALETTE.border);
    drawRoundedRect(context, x - width / 2, y - height / 2, width, height, 18, fill, stroke);
    const label = actionLabel(spec, snapshot);
    drawFittedText(context, label, x, y, width - 20,
      { fontSize: 40, minFontSize: 25, weight: selected ? 680 : 560,
        color: disabled ? '#9aa5af' : PALETTE.ink, align: 'center' });
    spec.mesh.userData.disabled = disabled;
  }

  function drawControlsPanel(context, width, height) {
    const snapshot = currentSnapshot ?? {};
    const inputs = snapshot.inputs ?? {};
    context.fillStyle = PALETTE.paper;
    context.fillRect(0, 0, width, height);
    drawRoundedRect(context, 4, 4, width - 8, height - 8, 20, PALETTE.white, PALETTE.border);
    drawFittedText(context, 'Mission tuning', 42, 46, 550,
      { fontSize: 43, minFontSize: 34, weight: 700, color: PALETTE.blue });
    drawFittedText(context, 'Range changes require a new grid', width / 2, 98, width - 80,
      { fontSize: 25, minFontSize: 22, weight: 500, color: PALETTE.steel, align: 'center' });

    for (const [index, spec] of buttonSpecs.entries()) {
      if (index < 3) drawButton(context, spec, snapshot);
    }
    canvasFont(context, 31, 700);
    context.fillStyle = PALETTE.steel;
    context.textAlign = 'center';
    context.fillText(`Departure start · ${inputs.departureStart ?? '—'}`, 360, CONTROL_ROWS.departure - 58);
    context.fillText(`Departure end · ${inputs.departureEnd ?? '—'}`, 1080, CONTROL_ROWS.departure - 58);
    context.fillText(`TOF min · ${inputs.tofMinDays ?? '—'} d`, 360, CONTROL_ROWS.tof - 58);
    context.fillText(`TOF max · ${inputs.tofMaxDays ?? '—'} d`, 1080, CONTROL_ROWS.tof - 58);
    canvasLine(context, 50, 340, width - 50, 340, '#e4e9ee');
    canvasLine(context, 50, 465, width - 50, 465, '#e4e9ee');

    drawFittedText(context, `Grid ${inputs.resolution ?? '—'} × ${inputs.resolution ?? '—'}`,
      245, CONTROL_ROWS.resolution - 60, 184,
      { fontSize: 27, minFontSize: 21, weight: 620, color: PALETTE.ink, align: 'center' });
    drawFittedText(context, 'Budget type', 970, CONTROL_ROWS.resolution - 60, 500,
      { fontSize: 30, minFontSize: 23, weight: 700, color: PALETTE.steel, align: 'center' });

    const budget = budgetInput();
    const limit = budget.limit ?? '0';
    const unit = budget.type === 'c3' ? 'km²/s²' : 'km/s';
    const limitText = budget.type === 'none' ? 'No threshold' : `${limit} ${unit}`;
    drawFittedText(context, `Threshold · ${limitText}`, 470, CONTROL_ROWS.budget - 60, 510,
      { fontSize: 34, minFontSize: 24, weight: 620, color: PALETTE.ink, align: 'center' });

    for (let index = 3; index < buttonSpecs.length; index += 1) {
      drawButton(context, buttonSpecs[index], snapshot);
    }
    const validInputs = inputsAreValid(snapshot);
    const rangeMessage = !validInputs
      ? 'Mission ranges are invalid · correct target/date/flight-time/resolution before computing.'
      : snapshot.computing
        ? 'Worker is computing the selected grid…'
        : cleanStatus(snapshot.status);
    const rangeColor = !validInputs || /error|invalid|failed/i.test(rangeMessage) ? PALETTE.error : PALETTE.steel;
    drawFittedText(context, rangeMessage || 'Ray-pick a field to adjust; Compute starts the sampled search.',
      width / 2, 918, width - 80,
      { fontSize: 31, minFontSize: 21, weight: 500, color: rangeColor, align: 'center' });
  }

  function updatePlotTransform() {
    const rect = XR_PLOT_CANVAS.chart;
    const panel = XR_LAYOUT.plot;
    plot.mesh.position.set(
      ((rect.x + rect.width / 2) / XR_PLOT_CANVAS.width - 0.5) * panel.width,
      (0.5 - (rect.y + rect.height / 2) / XR_PLOT_CANVAS.height) * panel.height,
      0.004,
    );
    plot.mesh.scale.set(
      (rect.width / XR_PLOT_CANVAS.width) * panel.width,
      (rect.height / XR_PLOT_CANVAS.height) * panel.height,
      1,
    );
    plot.mesh.userData.kind = 'plot';
  }

  // Preserve the original desktop transform until setImmersive saves it.
  plot.mesh.userData.kind = 'plot';
  interactiveObjects.push(plot.mesh);

  function paintPlotIfChanged() {
    const grid = plot.getGrid();
    const range = plotRange();
    const target = currentTarget();
    const min = range?.min ?? null;
    const max = range?.max ?? null;
    if (grid === lastPlotGrid && target === lastPlotTarget && min === lastPlotMin && max === lastPlotMax) return;
    lastPlotGrid = grid;
    lastPlotTarget = target;
    lastPlotMin = min;
    lastPlotMax = max;
    plotSignature = `${target}:${min ?? ''}:${max ?? ''}`;
    plotPanel.repaint(drawPlotPanel);
  }

  function paintControlsIfChanged(force = false) {
    const snapshot = currentSnapshot ?? {};
    syncOrreryScale();
    const signature = JSON.stringify({
      inputs: snapshot.inputs,
      budgetInput: snapshot.budgetInput,
      budgetValid: snapshot.budgetValid,
      computing: snapshot.computing,
      status: snapshot.status,
      hasGrid: snapshot.hasGrid,
      canSnap: snapshot.canSnap,
      canPlay: snapshot.canPlay,
      playing: snapshot.playing,
      modelScaleExaggerated: largerModel,
      scaleExaggerated: exaggeratedRadii,
      hoveredActionId,
    });
    if (!force && signature === controlSignature) return;
    controlSignature = signature;
    controlsPanel.repaint(drawControlsPanel);
  }

  function paintResults(force = false) {
    resultsPanel.repaint(drawResultsPanel);
    const canPlay = Boolean(currentSnapshot?.canPlay);
    timeBar.userData.disabled = !canPlay;
    lastDynamicPaintMs = performance.now();
    pendingDynamicResult = false;
    if (force) resultStaticSignature = JSON.stringify({
      selection: currentSnapshot?.selection,
      minimumSummary: currentSnapshot?.minimumSummary,
      status: currentSnapshot?.status,
      assetStatus: getAssetStatus(),
      scaleExaggerated: currentSnapshot?.scaleExaggerated,
      modelScaleExaggerated: currentSnapshot?.modelScaleExaggerated,
    });
  }

  function syncState(snapshot, nowMs = performance.now()) {
    currentSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : {};
    largerModel = getSnapshotScaleFlag(currentSnapshot, largerModel);
    exaggeratedRadii = getRadiusFlag(currentSnapshot, exaggeratedRadii);
    syncOrreryScale();
    paintPlotIfChanged();
    paintControlsIfChanged();

    const staticState = {
      selection: currentSnapshot.selection,
      minimumSummary: currentSnapshot.minimumSummary,
      status: currentSnapshot.status,
      computing: currentSnapshot.computing,
      hasGrid: currentSnapshot.hasGrid,
      canPlay: currentSnapshot.canPlay,
      assetStatus: getAssetStatus(),
      modelScaleExaggerated: largerModel,
      scaleExaggerated: exaggeratedRadii,
      profile: currentProfile,
    };
    const nextStaticSignature = JSON.stringify(staticState);
    const dynamicState = {
      hoverSummary: currentSnapshot.hoverSummary,
      missionDate: currentSnapshot.missionDate,
      progress: currentSnapshot.progress,
      playing: currentSnapshot.playing,
      canPlay: currentSnapshot.canPlay,
      telemetry: currentSnapshot.telemetry,
    };
    const nextDynamicSignature = JSON.stringify(dynamicState);
    if (nextStaticSignature !== resultStaticSignature) {
      resultStaticSignature = nextStaticSignature;
      resultDynamicSignature = nextDynamicSignature;
      paintResults();
      return;
    }
    if (nextDynamicSignature !== resultDynamicSignature) {
      resultDynamicSignature = nextDynamicSignature;
      if (nowMs - lastDynamicPaintMs >= 250) paintResults();
      else pendingDynamicResult = true;
    }
  }

  function setAssetStatus(assetStatus) {
    currentAssetStatus = assetStatus && typeof assetStatus === 'object' ? assetStatus : null;
    controlSignature = null;
    resultStaticSignature = null;
    syncState(currentSnapshot);
  }

  function rememberTransform(object) {
    if (originalTransforms.has(object)) return;
    originalTransforms.set(object, {
      parent: object.parent,
      position: object.position.clone(),
      quaternion: object.quaternion.clone(),
      scale: object.scale.clone(),
    });
  }

  function restoreTransform(object) {
    const saved = originalTransforms.get(object);
    if (!saved) return;
    saved.parent?.add(object);
    object.position.copy(saved.position);
    object.quaternion.copy(saved.quaternion);
    object.scale.copy(saved.scale);
    originalTransforms.delete(object);
  }

  function setImmersive(active) {
    const nextActive = Boolean(active);
    if (disposed || immersive === nextActive) return;
    immersive = nextActive;
    if (immersive) {
      const enabledFeatures = renderer.xr.getSession?.()?.enabledFeatures;
      referenceSpace = enabledFeatures?.includes?.('local-floor') ? 'local-floor' : 'local';
      layoutRoot.position.y = referenceSpace === 'local' ? -1.6 : 0;
      rememberTransform(orrery.contentGroup);
      rememberTransform(plot.mesh);
      previousControlsEnabled = orrery.controls.enabled;
      layoutRoot.add(orrery.contentGroup);
      orrery.contentGroup.position.set(...XR_LAYOUT.orrery.center);
      plotRoot.add(plot.mesh);
      updatePlotTransform();
      syncOrreryScale();
      orrery.setControlsEnabled(false);
      xrScene.updateMatrixWorld(true);
      controllers.setActive(true);
    } else {
      controllers.setActive(false);
      const originalWorldScale = originalTransforms.get(orrery.contentGroup)?.scale.x;
      restoreTransform(plot.mesh);
      restoreTransform(orrery.contentGroup);
      if (Number.isFinite(originalWorldScale) && originalWorldScale > 0) {
        orrery.setWorldScale(originalWorldScale);
      }
      orrery.setControlsEnabled(previousControlsEnabled);
    }
  }

  function compareHover(hit) {
    let key = '';
    let nextActionId = null;
    let nextCell = null;
    if (hit?.kind === 'plot') {
      key = `plot:${hit.i}:${hit.j}`;
      nextCell = { i: hit.i, j: hit.j };
    } else if (hit?.kind === 'action') {
      nextActionId = hit.object?.userData?.actionId ?? null;
      key = `action:${nextActionId ?? ''}`;
    } else if (hit?.kind === 'time') {
      key = 'time';
    }
    if (key === previousHoverKey) return;
    const wasPlot = previousHoverKey.startsWith('plot:');
    previousHoverKey = key;
    const hoverChanged = hoveredActionId !== nextActionId;
    hoveredActionId = nextActionId;
    if (hit?.kind === 'plot') plot.setHover(nextCell);
    else if (wasPlot) plot.setHover(null);
    if (wasPlot || hit?.kind === 'plot') onHover?.(nextCell ? { i: nextCell.i, j: nextCell.j } : null);
    if (hoverChanged) {
      controlSignature = null;
      paintControlsIfChanged();
    }
  }

  function hitTest(raycaster) {
    if (!immersive || disposed) return null;
    raycaster.layers.enable(31);
    reusableHits.length = 0;
    raycaster.intersectObjects(interactiveObjects, false, reusableHits);
    for (const intersection of reusableHits) {
      const object = intersection.object;
      if (object.userData.disabled) continue;
      hitRecord.object = object;
      hitRecord.point.copy(intersection.point);
      if (intersection.uv) hitRecord.uv.copy(intersection.uv);
      if (object.userData.kind === 'plot') {
        const cell = plot.getCellAtUV(hitRecord.uv.x, hitRecord.uv.y, scratchCell);
        if (!cell) continue;
        hitRecord.kind = 'plot';
        hitRecord.i = cell.i;
        hitRecord.j = cell.j;
        hitRecord.action = undefined;
        hitRecord.progress = undefined;
        return hitRecord;
      }
      if (object.userData.kind === 'action') {
        const spec = buttonSpecsById.get(object.userData.actionId);
        if (!spec) continue;
        hitRecord.kind = 'action';
        hitRecord.i = undefined;
        hitRecord.j = undefined;
        if (spec.id === 'budget-minus' || spec.id === 'budget-plus') {
          reusableBudgetStepAction.delta = budgetStep(spec.id === 'budget-minus' ? -1 : 1);
          hitRecord.action = reusableBudgetStepAction;
        } else {
          hitRecord.action = spec.action;
        }
        hitRecord.progress = undefined;
        return hitRecord;
      }
      if (object.userData.kind === 'time') {
        const progress = progressFromUV(hitRecord.uv.x);
        if (progress === null) continue;
        hitRecord.kind = 'time';
        hitRecord.i = undefined;
        hitRecord.j = undefined;
        hitRecord.action = undefined;
        hitRecord.progress = progress;
        return hitRecord;
      }
    }
    return null;
  }

  function activateHit(hit) {
    if (!hit || disposed) return;
    if (hit.kind === 'plot') {
      plot.setSelection({ i: hit.i, j: hit.j });
      onSelect?.({ i: hit.i, j: hit.j });
      return;
    }
    if (hit.kind === 'action' && hit.action) {
      onXRAction?.(hit.action);
      return;
    }
    if (hit.kind === 'time' && Number.isFinite(hit.progress)) {
      onXRAction?.({ type: 'scrub', progress: hit.progress });
    }
  }

  const controllers = createXRControllers({
    renderer,
    rig: xrRig,
    hitTest,
    onHover: compareHover,
    onActivate: activateHit,
    onScrub: (delta) => onXRAction?.({ type: 'scrubDelta', delta }),
    onShortcut: (shortcut) => onXRAction?.({ type: shortcut === 'nextTarget' ? 'nextTarget' : 'snap' }),
    onProfile: (profile) => {
      currentProfile = profile && typeof profile === 'object' ? profile : null;
      resultStaticSignature = null;
      syncState(currentSnapshot);
    },
  });

  function updateXR(deltaSeconds, nowMs = performance.now()) {
    if (disposed) return;
    controllers.update(nowMs, deltaSeconds);
    if (pendingDynamicResult && nowMs - lastDynamicPaintMs >= 250) paintResults();
  }

  function setState(snapshot, nowMs = performance.now()) {
    if (disposed) return;
    syncState(snapshot, nowMs);
  }

  function pointToArray(point) {
    return [point.x, point.y, point.z];
  }

  function worldCorners(mesh) {
    mesh.updateWorldMatrix(true, false);
    return scratchCorners.map((corner) => pointToArray(mesh.localToWorld(corner.clone())));
  }

  function worldNormal(mesh) {
    mesh.updateWorldMatrix(true, false);
    scratchNormalMatrix.getNormalMatrix(mesh.matrixWorld);
    return pointToArray(scratchNormal.clone().applyMatrix3(scratchNormalMatrix).normalize());
  }

  function diagnostics() {
    const scale = getModelScale(currentTarget(), largerModel);
    const controls = buttonSpecs.map((spec) => {
      spec.mesh.updateWorldMatrix(true, false);
      return {
        id: spec.id,
        action: typeof spec.action === 'function' ? spec.action() : spec.action,
        center: pointToArray(spec.mesh.getWorldPosition(new THREE.Vector3())),
        normal: worldNormal(spec.mesh),
      };
    });
    const range = plotRange();
    return {
      immersive,
      sessionActive: Boolean(renderer.xr.isPresenting),
      referenceSpace,
      metresPerAu: scale.metresPerAu,
      jupiterFit: scale.fit,
      largerModel,
      exaggeratedRadii,
      plotCorners: worldCorners(plot.mesh),
      plotNormal: worldNormal(plot.mesh),
      plotVisible: plot.mesh.visible,
      plotColorRange: range ? { min: range.min, max: range.max } : null,
      controls,
      controller: controllers.getDiagnostics(),
    };
  }

  // Render once immediately. Main may deliver the first metadata snapshot
  // after synchronous asset notifications from the orrery constructor.
  syncState(null);
  controllers.setActive(false);

  return {
    xrScene,
    xrCamera,
    xrRig,
    setImmersive,
    updateXR,
    setState,
    setAssetStatus,
    hitTest,
    getDiagnostics: diagnostics,
    destroy() {
      if (disposed) return;
      if (immersive) setImmersive(false);
      disposed = true;
      controllers.setActive(false);
      controllers.destroy();
      plotPanel.dispose();
      resultsPanel.dispose();
      controlsPanel.dispose();
      for (const spec of buttonSpecs) {
        spec.mesh.removeFromParent();
        spec.mesh.geometry.dispose();
        spec.mesh.material.dispose();
      }
      timeBar.geometry.dispose();
      timeBar.material.dispose();
      table.geometry.dispose();
      table.material.dispose();
      rim.geometry.dispose();
      rim.material.dispose();
      xrScene.remove(layoutRoot, xrRig, fillLight, ambientLight);
      xrRig.clear();
      layoutRoot.clear();
      originalTransforms.clear();
    },
  };
}
