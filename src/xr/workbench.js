import * as THREE from 'three';
import { createXRControllers } from './controllers.js';
import { createStarfield } from './starfield.js';
import { PORKCHOP_COLOUR_STOPS } from '../scene/porkchop.js';
import { validateMissionInputs } from '../app/planner.js';
import {
  getModelScale,
  panelLocalPointFromUV,
  progressFromUV,
  viewerHeading,
  XR_CONTROLS_CANVAS,
  XR_LAYOUT,
  XR_PLAYBACK_CANVAS,
  XR_PLOT_CANVAS,
  XR_RESULTS_CANVAS,
  XR_TIMELINE,
} from './layout.js';
import {
  createTextPanel,
  drawFittedText,
  drawRoundedRect,
  formatDate,
  formatNumber,
} from './textPanel.js';

const PALETTE = Object.freeze({
  space: '#101b2a',
  panel: '#172638',
  surface: '#22354a',
  ink: '#f0f5fb',
  secondary: '#b1c4d8',
  accent: '#8be2db',
  hover: '#355467',
  border: '#496178',
  disabled: '#192638',
  error: '#ffac9c',
  success: '#9fe1b8',
});

function drawPanel(context, width, height, color = PALETTE.panel) {
  context.fillStyle = PALETTE.space;
  context.fillRect(0, 0, width, height);
  drawRoundedRect(context, 4, 4, width - 8, height - 8, 22, color, PALETTE.border);
}

const CONTROL_SECTIONS = Object.freeze({ mission: 'Mission', search: 'Search', display: 'Display' });
const CONTROL_ROWS = Object.freeze({
  tabs: 145,
  destination: 314,
  budgetType: 505,
  budgetLimit: 673,
  departure: 337,
  flight: 513,
  samples: 686,
  display: 316,
  reset: 530,
  footer: 844,
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
  return formatDate(value).replace(/\.\d{3}Z$/, 'Z');
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
  const sources = profile?.sources ?? [];
  if (!sources.length) return 'Connect a controller to aim and select.';
  const instructions = ['Aim and press the trigger'];
  if (sources.some(({ mapping }) => mapping.horizontalAxisIndex !== null)) instructions.push('Stick ↔ scrub');
  for (const { mapping } of sources) {
    if (!mapping.shortcutAvailable) continue;
    instructions.push(mapping.shortcut === 'snap' ? 'A best transfer' : 'X change target');
  }
  return instructions.join('  ·  ');
}

function setPanelPosition(group, { center, tiltRadians = 0, yawRadians = 0 }) {
  group.position.set(...center);
  group.rotation.set(tiltRadians, yawRadians, 0, 'YXZ');
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
  xrScene.background = new THREE.Color(0x000000);
  const sky = createStarfield();
  xrScene.add(sky.stars);

  let referenceSpace = 'local';
  let sessionSpace = null;
  let needsCentering = false;

  const xrRig = new THREE.Group();
  xrRig.name = 'Viewer and controller rig';
  const xrCamera = new THREE.PerspectiveCamera(68, 1, 0.01, 100);
  xrCamera.name = 'WebXR viewer camera';
  xrCamera.position.set(0, 0, 0);
  xrRig.add(xrCamera);
  xrScene.add(xrRig);

  const layoutRoot = new THREE.Group();
  layoutRoot.name = 'Stationary workbench layout';

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
  setPanelPosition(plotRoot, XR_LAYOUT.plot);
  layoutRoot.add(plotRoot);

  const resultsRoot = new THREE.Group();
  resultsRoot.name = 'Selected transfer readout';
  setPanelPosition(resultsRoot, XR_LAYOUT.results);
  layoutRoot.add(resultsRoot);

  const playbackRoot = new THREE.Group();
  playbackRoot.name = 'Mission playback';
  setPanelPosition(playbackRoot, XR_LAYOUT.playback);
  layoutRoot.add(playbackRoot);

  const controlsRoot = new THREE.Group();
  controlsRoot.name = 'Ray-pickable mission controls';
  setPanelPosition(controlsRoot, XR_LAYOUT.controls);
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

  const playbackPanel = createTextPanel({
    width: XR_LAYOUT.playback.width,
    height: XR_LAYOUT.playback.height,
    pixelWidth: XR_PLAYBACK_CANVAS.width,
    pixelHeight: XR_PLAYBACK_CANVAS.height,
    name: 'Mission time and playback',
  });
  playbackRoot.add(playbackPanel.mesh);

  const controlsPanel = createTextPanel({
    width: XR_LAYOUT.controls.width,
    height: XR_LAYOUT.controls.height,
    pixelWidth: XR_CONTROLS_CANVAS.width,
    pixelHeight: XR_CONTROLS_CANVAS.height,
    name: 'Compact mission tuning controls',
  });
  controlsRoot.add(controlsPanel.mesh);

  const buttonSpecs = [];
  // Opaque panel faces also stop rays from activating controls behind them.
  const interactiveObjects = [plotPanel.mesh, resultsPanel.mesh, playbackPanel.mesh, controlsPanel.mesh];
  const buttonSpecsById = new Map();
  const reusableBudgetStepAction = { type: 'budgetStep', delta: 0 };

  function addButton(id, x, y, width, height, action, label, { playback = false, section = null } = {}) {
    const group = playback ? playbackRoot : controlsRoot;
    const canvas = playback ? XR_PLAYBACK_CANVAS : XR_CONTROLS_CANVAS;
    const panel = playback ? XR_LAYOUT.playback : XR_LAYOUT.controls;
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
    const spec = { id, x, y, width, height, action, label, mesh, playback, section };
    buttonSpecs.push(spec);
    buttonSpecsById.set(id, spec);
    return mesh;
  }

  for (const [index, [section, label]] of Object.entries(CONTROL_SECTIONS).entries()) {
    addButton(`tab-${section}`, 265 + index * 455, CONTROL_ROWS.tabs, 418, 96,
      { type: 'openSection', section }, label);
  }

  const mission = { section: 'mission' };
  for (const [index, target] of ['Venus', 'Mars', 'Jupiter'].entries()) {
    addButton(`target-${target.toLowerCase()}`, 265 + index * 455, CONTROL_ROWS.destination, 408, 110,
      { type: 'target', target }, target, mission);
  }
  for (const [index, [type, label]] of [['none', 'None'], ['cost', 'Cost proxy'], ['c3', 'Departure C3']].entries()) {
    addButton(`budget-${type}`, 265 + index * 455, CONTROL_ROWS.budgetType, 408, 104,
      { type: 'budgetType', value: type }, label, mission);
  }
  addButton('budget-minus', 160, CONTROL_ROWS.budgetLimit, 183, 96,
    () => ({ type: 'budgetStep', delta: budgetStep(-1) }), '−', mission);
  addButton('budget-plus', 766, CONTROL_ROWS.budgetLimit, 183, 96,
    () => ({ type: 'budgetStep', delta: budgetStep(1) }), '+', mission);
  addButton('snap', 1137, CONTROL_ROWS.budgetLimit, 414, 96, { type: 'snap' }, 'Best transfer', mission);

  const search = { section: 'search' };
  const searchSteps = [
    ['departure-start', 'departureStart', CONTROL_ROWS.departure, 0, 7, ' d'],
    ['departure-end', 'departureEnd', CONTROL_ROWS.departure, 720, 7, ' d'],
    ['tof-min', 'tofMinDays', CONTROL_ROWS.flight, 0, 10, ' d'],
    ['tof-max', 'tofMaxDays', CONTROL_ROWS.flight, 720, 10, ' d'],
  ];
  for (const [id, field, y, offset, step, unit] of searchSteps) {
    addButton(`${id}-minus`, 145 + offset, y, 170, 90,
      { type: 'step', field, delta: -step }, `− ${step}${unit}`, search);
    addButton(`${id}-plus`, 575 + offset, y, 170, 90,
      { type: 'step', field, delta: step }, `+ ${step}${unit}`, search);
  }
  addButton('resolution-minus', 145, CONTROL_ROWS.samples, 170, 90,
    { type: 'step', field: 'resolution', delta: -10 }, '− 10', search);
  addButton('resolution-plus', 575, CONTROL_ROWS.samples, 170, 90,
    { type: 'step', field: 'resolution', delta: 10 }, '+ 10', search);

  const display = { section: 'display' };
  addButton('scale', 365, CONTROL_ROWS.display, 614, 104, { type: 'scale' }, 'Larger model', display);
  addButton('radii', 1075, CONTROL_ROWS.display, 614, 104, { type: 'radii' }, 'Radii enlarged', display);
  addButton('reset', 365, CONTROL_ROWS.reset, 614, 104, { type: 'reset' }, 'Reset display', display);
  addButton('defaults', 1075, CONTROL_ROWS.reset, 614, 104, { type: 'defaults' }, 'Restore Mars defaults', display);

  addButton('compute', 407, CONTROL_ROWS.footer, 684, 108, { type: 'compute' }, 'Compute grid');
  addButton('recenter', 939, CONTROL_ROWS.footer, 322, 108, { type: 'recenter' }, 'Recenter');
  addButton('exit', 1253, CONTROL_ROWS.footer, 244, 108, { type: 'exit' }, 'Exit VR');
  addButton('play', 166, 112, 235, 130, { type: 'play' }, 'Play', { playback: true });

  const timeCanvas = XR_PLAYBACK_CANVAS;
  const timePanel = XR_LAYOUT.playback;
  const timelineWidth = XR_TIMELINE.right - XR_TIMELINE.left;
  const timelineInset = XR_TIMELINE.inset;
  const timeBar = new THREE.Mesh(
    new THREE.PlaneGeometry(
      timelineWidth / timeCanvas.width * timePanel.width,
      XR_TIMELINE.height / timeCanvas.height * timePanel.height,
    ),
    new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
  );
  const timeUv = panelLocalPointFromUV(
    (XR_TIMELINE.left + timelineWidth / 2) / timeCanvas.width,
    1 - XR_TIMELINE.y / timeCanvas.height, timePanel.width, timePanel.height,
  );
  timeBar.name = 'Mission timeline hit target';
  timeBar.position.set(timeUv.x, timeUv.y, 0.006);
  timeBar.userData.kind = 'time';
  timeBar.userData.disabled = true;
  timeBar.layers.set(31);
  playbackRoot.add(timeBar);
  interactiveObjects.push(timeBar);

  const originalTransforms = new Map();
  let immersive = false;
  let disposed = false;
  let currentSnapshot = null;
  let currentAssetStatus = null;
  let currentProfile = null;
  let hoveredActionId = null;
  let activeSection = 'mission';
  let previousHoverKey = '';
  let controlSignature = null;
  let lastPlotGrid = null;
  let lastPlotTarget = null;
  let lastPlotMin = null;
  let lastPlotMax = null;
  let lastPlotComputing = false;
  let resultSignature = null;
  let playbackSignature = null;
  let lastPreviewPaintMs = -Infinity;
  let previewDirty = false;
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
    drawPanel(context, width, height);
    drawFittedText(context, `Earth → ${target}`, 54, 61, 790,
      { fontSize: 64, minFontSize: 46, weight: 680, color: PALETTE.ink });
    drawFittedText(context, 'Transfer cost map', width - 52, 64, 490,
      { fontSize: 39, weight: 550, color: PALETTE.accent, align: 'right' });

    context.fillStyle = PALETTE.space;
    context.fillRect(chart.x, chart.y, chart.width, chart.height);
    context.strokeStyle = PALETTE.secondary;
    context.lineWidth = 2;
    context.strokeRect(chart.x, chart.y, chart.width, chart.height);

    const departureEpochs = grid?.departureEpochs ?? grid?.epochs;
    const tofDays = grid?.tofDays;
    const xTicks = [0, 0.5, 1];
    const yTicks = [0, 0.5, 1];
    for (const t of xTicks) {
      const x = chart.x + chart.width * t;
      canvasLine(context, x, chart.y, x, chart.y + chart.height, PALETTE.surface, 1.5);
    }
    for (const t of yTicks) {
      const y = chart.y + chart.height * t;
      canvasLine(context, chart.x, y, chart.x + chart.width, y, PALETTE.surface, 1.5);
    }
    const dates = departureEpochs?.length
      ? [departureEpochs[0], (departureEpochs[0] + departureEpochs[departureEpochs.length - 1]) / 2, departureEpochs[departureEpochs.length - 1]]
      : [];
    const flightTimes = tofDays?.length
      ? [tofDays[0], (tofDays[0] + tofDays[tofDays.length - 1]) / 2, tofDays[tofDays.length - 1]]
      : [];
    canvasFont(context, 32, 500);
    context.fillStyle = PALETTE.secondary;
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

    const gradientX = 432;
    const gradientY = 940;
    const gradientWidth = 670;
    const gradient = context.createLinearGradient(gradientX, 0, gradientX + gradientWidth, 0);
    for (const stop of PORKCHOP_COLOUR_STOPS) gradient.addColorStop(stop.at, stop.color);
    drawFittedText(context, 'Cost proxy (km/s)', 54, gradientY, 220,
      { fontSize: 31, minFontSize: 25, weight: 600, color: PALETTE.ink });
    context.fillStyle = gradient;
    context.fillRect(gradientX, gradientY - 12, gradientWidth, 24);
    drawFittedText(context, range ? formatNumber(range.min) : '—', gradientX - 17, gradientY, 90,
      { fontSize: 29, color: PALETTE.secondary, align: 'right' });
    drawFittedText(context, range ? `${formatNumber(range.max)}+` : '—', gradientX + gradientWidth + 17, gradientY, 210,
      { fontSize: 29, color: PALETTE.secondary });

    if (!grid) {
      const message = currentSnapshot?.computing ? 'Computing transfer grid…' : 'Compute a grid to see transfer opportunities';
      drawFittedText(context, message,
        chart.x + chart.width / 2, chart.y + chart.height / 2, chart.width - 60,
        { fontSize: 42, minFontSize: 32, weight: 550, color: PALETTE.secondary, align: 'center' });
    }
  }

  function selectedLines(snapshot) {
    const selection = snapshot?.selection;
    if (!selection || typeof selection !== 'object') return null;
    if (!selection.departure && !selection.arrival) return null;
    return {
      departureArrival: `Depart ${displayEpoch(selection.departure)}  ·  Arrive ${displayEpoch(selection.arrival)}`,
      costs: `TOF ${selection.tof ?? '—'}   ·   Proxy ${selection.cost ?? '—'}   ·   C3 ${selection.c3 ?? '—'}`,
      state: `v∞ depart ${selection.vInfDeparture ?? '—'}   ·   arrive ${selection.vInfArrival ?? '—'}   ·   ${selection.branch ?? '—'}`,
      feasibility: selection.feasibility ?? selection.status ?? '—',
    };
  }

  function assetText() {
    const asset = getAssetStatus();
    if (!asset) return 'Body imagery: local assets loading or neutral surfaces.';
    return asset.message ?? asset.label ?? 'Body imagery status unavailable.';
  }

  function scaleDisclosure() {
    const scale = syncOrreryScale();
    const radiusText = exaggeratedRadii ? 'exaggerated radii' : 'physical radii';
    const targetNote = modelTarget().toLowerCase() === currentTarget().toLowerCase()
      ? ''
      : ` · model ${modelTarget()} until Compute`;
    return `${scale.fit ? 'Jupiter fit' : 'Display scale'} · ${scale.metresPerAu.toFixed(3)} m/AU · ${radiusText}${targetNote}`;
  }

  function drawPropellantReadout(context, width, propellant) {
    const estimate = propellant?.estimate;
    drawRoundedRect(context, 30, 283, width - 60, 115, 10, PALETTE.surface);
    if (!estimate) {
      drawFittedText(context, propellant?.status || 'Propellant estimate unavailable.', 49, 337, width - 98,
        { fontSize: 33, minFontSize: 27, color: PALETTE.error });
      return;
    }

    const rounded = (value) => value.toLocaleString('en-US', { maximumFractionDigits: 0 });
    const price = estimate.propellantCostUsd;
    drawFittedText(context, `Est. propellant ${rounded(estimate.propellantKg)} kg`, 49, 311, 780,
      { fontSize: 42, minFontSize: 30, weight: 700, color: PALETTE.accent });
    if (Number.isFinite(price)) {
      drawFittedText(context, `Est. cost $${rounded(price)}`, width - 49, 311, 515,
        { fontSize: 40, minFontSize: 28, weight: 680, color: PALETTE.ink, align: 'right' });
    }
    drawFittedText(context,
      `Circular orbits · ${rounded(estimate.departureAltitudeKm)} km Earth → ${rounded(estimate.captureAltitudeKm)} km ${estimate.target} · Δv ${formatNumber(estimate.totalDeltaVKmPerSec, 2)} km/s`,
      49, 345, width - 98, { fontSize: 31, minFontSize: 25, color: PALETTE.secondary });
    const priceNote = propellant.status || (price === null ? 'Price unset' : `$${formatNumber(estimate.pricePerKgUsd, 2)}/kg assumed`);
    drawFittedText(context,
      `${rounded(estimate.dryMassKg)} kg dry · Isp ${formatNumber(estimate.specificImpulseSeconds, 1)} s · ${priceNote}`,
      49, 375, width - 98, { fontSize: 29, minFontSize: 24, color: PALETTE.secondary });
  }

  function drawResultsPanel(context, width, height) {
    const snapshot = currentSnapshot ?? {};
    const lines = selectedLines(snapshot);
    const minimum = minimumLines(snapshot.minimumSummary, Boolean(snapshot.hasGrid));
    if (snapshot.hasGrid && snapshot.budgetValid && budgetInput().type === 'none') {
      minimum[0] = minimum[0].replace(/^Unrestricted: /, 'Grid minimum · ');
      minimum.length = 1;
    }
    const status = cleanStatus(snapshot.status) || 'Preparing mission planner…';
    const isPreview = previousHoverKey.startsWith('plot:');
    const detail = isPreview ? snapshot.hoverSummary : status;
    const telemetry = telemetryLine(snapshot.telemetry);
    const asset = getAssetStatus();
    drawPanel(context, width, height);

    drawFittedText(context, 'Selected transfer', 42, 43, 600,
      { fontSize: 42, weight: 700, color: PALETTE.ink });
    if (lines) {
      drawFittedText(context, lines.departureArrival, 42, 103, width - 84,
        { fontSize: 41, minFontSize: 31, color: PALETTE.ink });
      drawFittedText(context, lines.costs, 42, 158, width - 84,
        { fontSize: 43, minFontSize: 32, weight: 650, color: PALETTE.ink });
      drawFittedText(context, lines.state, 42, 213, width - 84,
        { fontSize: 37, minFontSize: 30, color: PALETTE.secondary });
      drawFittedText(context, lines.feasibility, 42, 261, width - 84,
        { fontSize: 35, minFontSize: 30, weight: 630,
          color: /infeasible|invalid|failed/i.test(lines.feasibility) ? PALETTE.error : PALETTE.success });
      drawPropellantReadout(context, width, snapshot.propellant);
    } else {
      const message = snapshot.selection?.status || 'Choose a plot cell to inspect its transfer.';
      drawFittedText(context, message, 42, 130, width - 84,
        { fontSize: 40, minFontSize: 30, color: PALETTE.secondary });
    }

    canvasLine(context, 42, 412, width - 42, 412);
    for (const [index, line] of minimum.entries()) {
      drawFittedText(context, line, 42, 438 + index * 36, width - 84,
        { fontSize: 35, minFontSize: 29, color: PALETTE.secondary });
    }
    drawRoundedRect(context, 30, 496, width - 60, 51, 10, PALETTE.surface);
    drawFittedText(context, isPreview ? `Preview · ${detail}` : detail, 49, 521, width - 98,
      { fontSize: 35, minFontSize: 30, color: /error|failed|invalid/i.test(detail) ? PALETTE.error : PALETTE.accent });
    drawFittedText(context, `${profileInstructions(currentProfile)}${telemetry ? `  ·  ${telemetry}` : ''}`,
      42, 570, width - 84, { fontSize: 31, minFontSize: 26, color: PALETTE.secondary });
    drawFittedText(context, `Sun-only patched conic, 0 revolutions  ·  ${scaleDisclosure()}`,
      42, 609, width - 84, { fontSize: 31, minFontSize: 27, color: PALETTE.secondary });
    if (asset?.status === 'error' || asset?.status === 'loading') {
      drawFittedText(context, assetText(), 42, 636, width - 84,
        { fontSize: 26, color: asset.status === 'error' ? PALETTE.error : PALETTE.secondary });
    }
  }

  function drawPlaybackPanel(context, width, height) {
    const snapshot = currentSnapshot ?? {};
    const { left, right, y } = XR_TIMELINE;
    const trackLeft = left + timelineInset;
    const trackRight = right - timelineInset;
    const progress = snapshot.progress ?? 0;
    const x = trackLeft + (trackRight - trackLeft) * progress / 100;
    const enabled = Boolean(snapshot.canPlay);
    drawPanel(context, width, height, PALETTE.surface);
    drawButton(context, buttonSpecsById.get('play'), snapshot);
    canvasLine(context, 294, 38, 294, height - 38);
    drawFittedText(context, enabled ? displayEpoch(snapshot.missionDate) : 'Select a transfer to enable playback',
      left, 55, right - left - 160, { fontSize: 38, minFontSize: 30, color: PALETTE.ink });
    if (enabled) {
      drawFittedText(context, `${Math.round(progress)}%`, right, 55, 150,
        { fontSize: 37, weight: 680, color: PALETTE.accent, align: 'right' });
    }
    drawRoundedRect(context, trackLeft, y - 11, trackRight - trackLeft, 22, 11, PALETTE.border);
    if (!enabled) return;
    if (x > trackLeft) drawRoundedRect(context, trackLeft, y - 11, x - trackLeft, 22, 11, PALETTE.accent);
    context.fillStyle = PALETTE.accent;
    context.beginPath();
    context.arc(x, y, 21, 0, Math.PI * 2);
    context.fill();
    drawFittedText(context, 'Hold trigger to scrub', (left + right) / 2, 185, right - left,
      { fontSize: 30, color: PALETTE.secondary, align: 'center' });
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

  function actionSelected(spec) {
    if (spec.action.type === 'openSection') return spec.action.section === activeSection;
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
    const budget = budgetInput();
    if (spec.id === 'compute') return snapshot.computing ? 'Computing…' : 'Compute grid';
    if (spec.id === 'budget-minus') return `− ${budget.type === 'c3' ? '5' : '0.5'}`;
    if (spec.id === 'budget-plus') return `+ ${budget.type === 'c3' ? '5' : '0.5'}`;
    if (spec.id === 'play') return snapshot.playing ? 'Pause' : 'Play';
    if (spec.id === 'radii') return exaggeratedRadii ? 'Radii enlarged' : 'Physical radii';
    return spec.label;
  }

  function drawButton(context, spec, snapshot) {
    const { x, y, width, height } = spec;
    const disabled = actionDisabled(spec, snapshot);
    const selected = actionSelected(spec);
    const hovered = hoveredActionId === spec.id;
    const primary = spec.id === 'compute' || spec.id === 'play';
    const fill = disabled ? PALETTE.disabled : (hovered ? PALETTE.hover : (primary ? PALETTE.accent : PALETTE.surface));
    const stroke = !disabled && (selected || hovered) ? PALETTE.accent : PALETTE.border;
    drawRoundedRect(context, x - width / 2, y - height / 2, width, height, 13, fill, stroke);
    const label = actionLabel(spec, snapshot);
    const color = disabled ? PALETTE.secondary : (primary && !hovered ? PALETTE.space : PALETTE.ink);
    drawFittedText(context, label, x, y, width - 20,
      { fontSize: 40, minFontSize: 28, weight: selected || primary ? 700 : 580, color, align: 'center' });
    if (selected && !disabled) canvasLine(context, x - width / 4, y + height / 2 - 11,
      x + width / 4, y + height / 2 - 11, PALETTE.accent, 4);
    spec.mesh.userData.disabled = disabled;
  }

  function drawMissionSection(context, snapshot) {
    drawFittedText(context, 'Destination from Earth', 58, 230, 1000,
      { fontSize: 40, weight: 620, color: PALETTE.ink });
    const { tofMinDays, tofMaxDays } = snapshot.inputs ?? {};
    if (tofMinDays && tofMaxDays) {
      drawFittedText(context, `${tofMinDays}–${tofMaxDays} days of flight`, 1380, 230, 660,
        { fontSize: 34, color: PALETTE.secondary, align: 'right' });
    }
    drawFittedText(context, 'Budget filter', 58, 423, 420,
      { fontSize: 40, weight: 620, color: PALETTE.ink });
    drawFittedText(context, 'Dims cells above your limit', 1380, 423, 790,
      { fontSize: 34, color: PALETTE.secondary, align: 'right' });
    const budget = budgetInput();
    const unit = budget.type === 'c3' ? 'km²/s²' : 'km/s';
    let limitLabel = 'No limit';
    if (snapshot.budgetValid === false) limitLabel = 'Choose a budget type';
    else if (budget.type !== 'none') limitLabel = `${budget.limit} ${unit}`;
    drawFittedText(context, limitLabel, 463, CONTROL_ROWS.budgetLimit, 360,
      { fontSize: 40, minFontSize: 28, weight: 650, color: PALETTE.ink, align: 'center' });

    let guide = 'Choose a destination and compute a grid.';
    if (snapshot.hasGrid) guide = 'Aim at the chart to preview a transfer.';
    if (snapshot.hasGrid && !snapshot.canSnap && budget.type !== 'none') {
      guide = 'Adjust the budget to find a feasible transfer.';
    }
    drawFittedText(context, guide, 58, 762, 1324, { fontSize: 33, color: PALETTE.secondary });
  }

  function drawSearchSection(context, inputs) {
    const fields = [
      ['First departure (UTC)', inputs.departureStart, 360, CONTROL_ROWS.departure],
      ['Last departure (UTC)', inputs.departureEnd, 1080, CONTROL_ROWS.departure],
      ['Shortest flight (days)', inputs.tofMinDays, 360, CONTROL_ROWS.flight],
      ['Longest flight (days)', inputs.tofMaxDays, 1080, CONTROL_ROWS.flight],
      ['Samples per axis', inputs.resolution, 360, CONTROL_ROWS.samples],
    ];
    for (const [label, value, x, y] of fields) {
      drawFittedText(context, label, x, y - 75, 540,
        { fontSize: 36, weight: 620, color: PALETTE.secondary, align: 'center' });
      drawFittedText(context, value || '—', x, y, 236,
        { fontSize: 40, minFontSize: 28, weight: 680, color: PALETTE.ink, align: 'center' });
    }
    drawFittedText(context, 'More samples give a finer map', 765, CONTROL_ROWS.samples, 614,
      { fontSize: 33, color: PALETTE.secondary });
  }

  function drawDisplaySection(context) {
    drawFittedText(context, 'Planet display', 58, 230, 1000,
      { fontSize: 40, weight: 620, color: PALETTE.ink });
    const descriptions = [
      ['Zooms the orrery', 365, 399],
      ['Switches between visible and true radii', 1075, 399],
      ['Restores model scale and radii', 365, 617],
      ['Restores search settings and clears the budget', 1075, 617],
    ];
    for (const [label, x, y] of descriptions) {
      drawFittedText(context, label, x, y, 614, { fontSize: 32, color: PALETTE.secondary, align: 'center' });
    }
    drawFittedText(context, 'Recenter brings the workbench to your current view.', 58, 736, 1324,
      { fontSize: 33, color: PALETTE.secondary });
  }

  function drawControlsPanel(context, width, height) {
    const snapshot = currentSnapshot ?? {};
    drawPanel(context, width, height);
    drawFittedText(context, 'Mission controls', 58, 52, 900,
      { fontSize: 46, weight: 700, color: PALETTE.ink });

    if (activeSection === 'mission') drawMissionSection(context, snapshot);
    else if (activeSection === 'search') drawSearchSection(context, snapshot.inputs ?? {});
    else drawDisplaySection(context);
    for (const spec of buttonSpecs) {
      if (spec.playback) continue;
      const visible = !spec.section || spec.section === activeSection;
      if (visible) drawButton(context, spec, snapshot);
      else spec.mesh.userData.disabled = true;
    }

    const validInputs = inputsAreValid(snapshot);
    const status = validInputs ? cleanStatus(snapshot.status) : 'Check the dates, flight duration, and samples in Search.';
    drawFittedText(context, status, 58, 925, width - 116,
      { fontSize: 32, minFontSize: 27, color: !validInputs || /failed|error/i.test(status) ? PALETTE.error : PALETTE.secondary });
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
    const computing = Boolean(currentSnapshot?.computing);
    if (grid === lastPlotGrid && target === lastPlotTarget && min === lastPlotMin
      && max === lastPlotMax && computing === lastPlotComputing) return;
    lastPlotGrid = grid;
    lastPlotTarget = target;
    lastPlotMin = min;
    lastPlotMax = max;
    lastPlotComputing = computing;
    plotPanel.repaint(drawPlotPanel);
  }

  function paintControlsIfChanged() {
    const snapshot = currentSnapshot ?? {};
    const signature = JSON.stringify({
      activeSection,
      inputs: snapshot.inputs,
      budgetInput: snapshot.budgetInput,
      budgetValid: snapshot.budgetValid,
      computing: snapshot.computing,
      status: snapshot.status,
      hasGrid: snapshot.hasGrid,
      canSnap: snapshot.canSnap,
      modelScaleExaggerated: largerModel,
      scaleExaggerated: exaggeratedRadii,
      hoveredActionId: hoveredActionId === 'play' ? null : hoveredActionId,
    });
    if (signature === controlSignature) return;
    controlSignature = signature;
    controlsPanel.repaint(drawControlsPanel);
  }

  function paintResults(nowMs = performance.now()) {
    resultsPanel.repaint(drawResultsPanel);
    lastPreviewPaintMs = nowMs;
    previewDirty = false;
  }

  function paintPlaybackIfChanged() {
    const { canPlay, missionDate, progress, playing } = currentSnapshot;
    const signature = JSON.stringify([canPlay, missionDate, progress, playing, hoveredActionId === 'play']);
    if (signature === playbackSignature) return;
    playbackSignature = signature;
    timeBar.userData.disabled = !canPlay;
    playbackPanel.repaint(drawPlaybackPanel);
  }

  function syncState(snapshot, nowMs = performance.now()) {
    const previousPreview = currentSnapshot?.hoverSummary;
    currentSnapshot = snapshot ?? {};
    if (!immersive) return;
    syncOrreryScale();
    paintPlotIfChanged();
    paintControlsIfChanged();
    paintPlaybackIfChanged();

    const signature = JSON.stringify({
      selection: currentSnapshot.selection,
      propellant: currentSnapshot.propellant,
      minimumSummary: currentSnapshot.minimumSummary,
      budgetType: budgetInput().type,
      budgetValid: currentSnapshot.budgetValid,
      status: currentSnapshot.status,
      hasGrid: currentSnapshot.hasGrid,
      assetStatus: getAssetStatus(),
      modelScaleExaggerated: largerModel,
      scaleExaggerated: exaggeratedRadii,
      target: currentTarget(),
      modelTarget: modelTarget(),
      profile: currentProfile,
      telemetry: currentSnapshot.telemetry,
    });
    if (signature !== resultSignature) {
      resultSignature = signature;
      paintResults(nowMs);
    } else if (previousPreview !== currentSnapshot.hoverSummary) {
      previewDirty = true;
    }
  }

  function setAssetStatus(assetStatus) {
    currentAssetStatus = assetStatus ?? null;
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

  function requestCentering() {
    needsCentering = true;
  }

  function setImmersive(active, spaceType) {
    const nextActive = Boolean(active);
    if (disposed || immersive === nextActive) return;
    immersive = nextActive;
    if (immersive) {
      activeSection = 'mission';
      referenceSpace = spaceType ?? 'local';
      sessionSpace = renderer.xr.getReferenceSpace?.();
      sessionSpace?.addEventListener?.('reset', requestCentering);
      layoutRoot.position.set(0, referenceSpace === 'local' ? -XR_LAYOUT.eyeHeight : 0, 0);
      layoutRoot.rotation.y = 0;
      requestCentering();
      rememberTransform(orrery.contentGroup);
      rememberTransform(plot.mesh);
      previousControlsEnabled = orrery.controls.enabled;
      layoutRoot.add(orrery.contentGroup);
      orrery.contentGroup.position.set(...XR_LAYOUT.orrery.center);
      plotRoot.add(plot.mesh);
      updatePlotTransform();
      syncState(currentSnapshot);
      orrery.setControlsEnabled(false);
      orrery.setImmersiveStyle(true);
      xrScene.updateMatrixWorld(true);
      controllers.setActive(true);
    } else {
      sessionSpace?.removeEventListener?.('reset', requestCentering);
      sessionSpace = null;
      needsCentering = false;
      controllers.setActive(false);
      const originalWorldScale = originalTransforms.get(orrery.contentGroup)?.scale.x;
      restoreTransform(plot.mesh);
      restoreTransform(orrery.contentGroup);
      if (Number.isFinite(originalWorldScale) && originalWorldScale > 0) {
        orrery.setWorldScale(originalWorldScale);
      }
      orrery.setControlsEnabled(previousControlsEnabled);
      orrery.setImmersiveStyle(false);
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
    if (wasPlot || hit?.kind === 'plot') {
      previewDirty = true;
      onHover?.(nextCell);
    }
    if (hoverChanged && immersive) {
      paintControlsIfChanged();
      paintPlaybackIfChanged();
    }
  }

  function hitTest(raycaster) {
    if (!immersive || disposed) return null;
    raycaster.layers.enable(31);
    reusableHits.length = 0;
    raycaster.intersectObjects(interactiveObjects, false, reusableHits);
    for (const intersection of reusableHits) {
      const object = intersection.object;
      if (object.userData.xrPanel) return null;
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
        const progress = progressFromUV((hitRecord.uv.x * timelineWidth - timelineInset) / (timelineWidth - 2 * timelineInset));
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
      onSelect?.({ i: hit.i, j: hit.j });
      return;
    }
    if (hit.kind === 'action' && hit.action) {
      if (hit.action.type === 'openSection') {
        activeSection = hit.action.section;
        paintControlsIfChanged();
      } else if (hit.action.type === 'recenter') requestCentering();
      else onXRAction?.(hit.action);
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
    onDrag: activateHit,
    onScrub: (delta) => onXRAction?.({ type: 'scrubDelta', delta }),
    onShortcut: (shortcut) => onXRAction?.({ type: shortcut === 'nextTarget' ? 'nextTarget' : 'snap' }),
    onProfile: (profile) => {
      currentProfile = profile && typeof profile === 'object' ? profile : null;
      syncState(currentSnapshot);
    },
  });

  function updateXR(deltaSeconds, nowMs = performance.now()) {
    if (disposed || !immersive) return;
    if (needsCentering && sessionSpace) {
      const visibility = renderer.xr.getSession?.()?.visibilityState;
      const frame = renderer.xr.getFrame?.();
      const transform = (!visibility || visibility === 'visible')
        ? frame?.getViewerPose(sessionSpace)?.transform : null;
      if (transform) {
        const { position, orientation } = transform;
        layoutRoot.position.set(position.x, position.y - XR_LAYOUT.eyeHeight, position.z);
        sky.stars.position.set(position.x, position.y, position.z);
        layoutRoot.rotation.y = viewerHeading(orientation, layoutRoot.rotation.y);
        layoutRoot.updateMatrixWorld(true);
        needsCentering = false;
      }
    }
    controllers.update(nowMs, deltaSeconds);
    if (previewDirty && nowMs - lastPreviewPaintMs >= 120) paintResults(nowMs);
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
    const scale = getModelScale(modelTarget(), largerModel);
    const controls = buttonSpecs.map((spec) => {
      spec.mesh.updateWorldMatrix(true, false);
      return {
        id: spec.id,
        disabled: spec.mesh.userData.disabled,
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
      activeSection,
      layoutPosition: pointToArray(layoutRoot.position),
      layoutHeading: layoutRoot.rotation.y,
      timeline: {
        center: pointToArray(timeBar.getWorldPosition(new THREE.Vector3())),
        enabled: !timeBar.userData.disabled,
      },
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
      sky.dispose();
      plotPanel.dispose();
      resultsPanel.dispose();
      playbackPanel.dispose();
      controlsPanel.dispose();
      for (const spec of buttonSpecs) {
        spec.mesh.removeFromParent();
        spec.mesh.geometry.dispose();
        spec.mesh.material.dispose();
      }
      timeBar.geometry.dispose();
      timeBar.material.dispose();
      xrScene.remove(layoutRoot, xrRig, fillLight, ambientLight);
      xrRig.clear();
      layoutRoot.clear();
      originalTransforms.clear();
    },
  };
}
