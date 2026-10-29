import './styles.css';
import GUI from 'lil-gui';
import { createAppView } from './app/view.js';
import {
  DEFAULT_MISSION_INPUTS,
  TARGET_TOF_PRESETS,
  formatUTCInstant,
  validateBudget,
  validateMissionInputs,
} from './app/planner.js';
import { applyMissionAction } from './app/missionActions.js';
import { createGridService } from './app/gridService.js';
import {
  findGridMinimum,
  getGridCell,
  isCellFeasible,
} from './physics/porkchop.js';
import { propagateState, sampleTrajectory } from './physics/propagate.js';
import { computeTransfer } from './physics/transfer.js';
import { createPlannerScene } from './scene/plannerScene.js';
import { createPerformanceMonitor } from './utils/perf.js';
import { createVREntry } from './xr/entry.js';

const PLAYBACK_DURATION_MS = 20_000;
const PHYSICS_UPDATE_INTERVAL_MS = 1000 / 30;
const DOM_UPDATE_INTERVAL_MS = 100;
const XR_PLAYBACK_SNAPSHOT_INTERVAL_MS = 100;
const XR_TELEMETRY_SNAPSHOT_INTERVAL_MS = 1000;
const TARGET_ORDER = Object.freeze(['Venus', 'Mars', 'Jupiter']);

function displayNumber(value, decimals = 3) {
  return Number.isFinite(value) ? value.toFixed(decimals) : '—';
}

function finiteCostRange(grid) {
  let min = Infinity;
  let max = -Infinity;
  for (const value of grid.costs) {
    if (!Number.isFinite(value) || value < 0) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { min, max: max > min ? max : min + Math.max(Math.abs(min) * 0.05, 0.1) };
}

const gridService = createGridService();
let planner = null;
let performanceMonitor = null;
let displayGui = null;
let displayOptions = { exaggeratedBodies: true };
let vrEntry = null;
let disposed = false;
let inputRevision = 0;
let computeRequestId = 0;
let grid = null;
let inputs = { ...DEFAULT_MISSION_INPUTS };
let budgetInput = { type: 'none', limit: '0' };
let budget = { type: 'none', limit: 0 };
let budgetInputValid = true;
let unconstrainedMinimum = null;
let feasibleMinimum = null;
let selectedCell = null;
let selectedTransfer = null;
let selectedSamples = null;
let selectedOutput = null;
let selectionStatus = 'Select a valid plot cell.';
let selectedProgress = 0;
let playing = false;
let computing = false;
let lastFrameTime = null;
let lastPhysicsUpdate = -Infinity;
let lastAppliedProgress = NaN;
let lastDisplayedProgress = NaN;
let lastDomUpdate = -Infinity;
let previousAnimationTimestamp = null;
let lastPlaybackSnapshot = -Infinity;
let lastTelemetrySnapshot = -Infinity;
let sceneTarget = null;
let sceneDepartureMs = NaN;
let scaleExaggerated = true;
let scaleLarge = false;
let computeStatus = { message: 'Preparing mission planner…', kind: '' };
let gridSummary = 'No grid computed.';
let hoverSummary = 'Compute a grid to inspect transfer cells.';
let missionDate = '—';
let assetStatuses = new Map();
let currentAssetTarget = 'mars';
let debugFunction = null;
let view = null;

function publishXRState({ force = false, playback = false } = {}) {
  if (disposed || typeof planner?.setXRState !== 'function') return;
  const now = performance.now();
  if (playback && !force && now - lastPlaybackSnapshot < XR_PLAYBACK_SNAPSHOT_INTERVAL_MS) return;
  if (playback) lastPlaybackSnapshot = now;

  planner.setXRState({
    inputs: { ...inputs },
    budgetInput: { ...budgetInput },
    budgetValid: budgetInputValid,
    status: computeStatus.message,
    hasGrid: Boolean(grid),
    computing,
    selection: selectedOutput ? { ...selectedOutput } : { status: selectionStatus },
    hoverSummary,
    missionDate,
    progress: selectedTransfer ? selectedProgress : null,
    playing,
    canSnap: Boolean(
      grid
      && budgetInputValid
      && (budget.type === 'none' ? unconstrainedMinimum : feasibleMinimum),
    ),
    canPlay: Boolean(selectedTransfer && !computing),
    minimumSummary: minimumSummary(),
    assetStatus: activeAssetStatus(),
    scaleExaggerated,
    modelScaleExaggerated: scaleLarge,
    telemetry: performanceMonitor?.getSnapshot?.() ?? null,
  });
}

function setComputeStatus(message, kind = '') {
  computeStatus = { message, kind };
  view.setComputeStatus(message, kind);
  publishXRState();
}

function setGridSummary(message) {
  gridSummary = message;
  view.setGridSummary(message);
}

function setHoverSummary(message) {
  hoverSummary = message;
  view.setHoverSummary(message);
  publishXRState();
}

function activeAssetStatus() {
  const relevant = [...assetStatuses.values()].filter((item) => (
    ['sun', 'earth', currentAssetTarget].includes(item.assetId)
  ));
  if (relevant.length === 0) return { status: 'loading', label: 'Body', message: 'Loading body imagery.' };
  const errors = relevant.filter((item) => item.status === 'error');
  const loading = relevant.filter((item) => item.status === 'loading');
  if (errors.length) {
    const labels = errors.map((item) => item.label).join(', ');
    return {
      status: 'error',
      label: labels,
      message: `Missing imagery: ${labels}. Neutral surfaces are shown; mission calculations remain available.`,
    };
  }
  if (loading.length) {
    const labels = loading.map((item) => item.label).join(', ');
    return {
      status: 'loading',
      label: labels,
      message: `Loading imagery: ${labels}. Mission calculations are independent.`,
    };
  }
  return {
    status: 'ready',
    label: relevant.map((item) => item.label).join(', '),
    message: `Imagery ready for ${relevant.map((item) => item.label).join(', ')}. Planet positions use ephemeris data.`,
  };
}

function formatMinimum(cell) {
  if (!cell) return 'No valid transfer';
  return `${new Date(cell.departureMs).toISOString().slice(0, 10)} · ${cell.tofDays.toFixed(1)} d · ${new Date(cell.arrivalMs).toISOString().slice(0, 10)} · ${cell.cost.toFixed(3)} km/s · C3 ${cell.c3.toFixed(3)} km²/s²`;
}

function minimumSummary() {
  if (!grid) return 'No grid computed.';
  const unconstrained = `Unrestricted: ${formatMinimum(unconstrainedMinimum)}.`;
  if (!budgetInputValid) return `${unconstrained} Feasible: budget input invalid.`;
  if (!feasibleMinimum && budget.type !== 'none') return `${unconstrained} Feasible: no cell meets the active budget.`;
  return `${unconstrained} Feasible: ${formatMinimum(feasibleMinimum)}.`;
}

function setSelection(result = null) {
  selectionStatus = result?.status ?? 'Select a valid plot cell.';
  selectedOutput = result && ('departure' in result || 'arrival' in result) ? { ...result } : null;
  view.setSelection(result);
}

function applyMinimums() {
  if (!grid) {
    unconstrainedMinimum = null;
    feasibleMinimum = null;
  } else {
    unconstrainedMinimum = findGridMinimum(grid, { type: 'none' });
    feasibleMinimum = budgetInputValid ? findGridMinimum(grid, budget) : null;
  }

  view.setMinimums({
    unconstrained: unconstrainedMinimum,
    feasible: feasibleMinimum,
    hasGrid: Boolean(grid),
    budgetActive: budget.type !== 'none',
    budgetValid: budgetInputValid,
  });
  const snapCell = !grid
    ? null
    : (budget.type === 'none' ? unconstrainedMinimum : feasibleMinimum);
  view.setSnapAvailable(Boolean(snapCell) && budgetInputValid);
}

function updateLegend() {
  if (!grid) {
    view.setLegend();
    return;
  }

  const shaderRange = planner?.getColorRange?.();
  const range = shaderRange
    && Number.isFinite(shaderRange.min)
    && Number.isFinite(shaderRange.max)
    ? shaderRange
    : finiteCostRange(grid);
  const allRange = finiteCostRange(grid);
  view.setLegend({
    min: range?.min,
    max: range?.max,
    clampedAbove: Boolean(range && allRange && allRange.max > range.max + 1e-6),
  });
}

function setMissionTimeDisplay(epochMs, formattedDate, progress, isPlaying) {
  missionDate = Number.isFinite(epochMs) ? formattedDate : '—';
  lastDisplayedProgress = Number.isFinite(progress) ? progress : NaN;
  view.setMissionTime(epochMs, formattedDate, progress, isPlaying);
}

function stopPlayback() {
  playing = false;
  lastFrameTime = null;
  setMissionTimeDisplay(
    selectedTransfer ? selectedTransfer.departureMs + selectedTransfer.tofSeconds * 1000 * selectedProgress / 100 : NaN,
    selectedTransfer
      ? formatUTCInstant(selectedTransfer.departureMs + selectedTransfer.tofSeconds * 1000 * selectedProgress / 100)
      : '—',
    selectedTransfer ? selectedProgress : NaN,
    false,
  );
}

function clearSelectedTransfer(status = 'Select a valid plot cell.') {
  stopPlayback();
  selectedCell = null;
  selectedTransfer = null;
  selectedSamples = null;
  selectedOutput = null;
  selectedProgress = 0;
  lastAppliedProgress = NaN;
  lastDisplayedProgress = NaN;
  planner?.setSelection(null);
  planner?.setTransfer(null, null);
  setSelection({ status });
  view.setTransferAvailable(false);
  setMissionTimeDisplay(NaN, '—', 0, false);
}

function clearComputedGrid() {
  grid = null;
  clearSelectedTransfer('Inputs changed; compute a new grid to select a transfer.');
  planner?.setGrid(null);
  planner?.setSelection(null);
  planner?.setHover(null);
  planner?.setTransfer(null, null);
  view.setGridAxes(null);
  view.setLegend();
  view.setTargetLabel(null);
  view.setMinimums({ hasGrid: false });
  view.setSnapAvailable(false);
  setHoverSummary('Compute a grid to inspect transfer cells.');
  setGridSummary('No current grid.');
  applyMinimums();
}

function updateSelectionFeasibility() {
  if (!selectedCell || !selectedTransfer || !selectedOutput) return;
  const feasible = isCellFeasible(selectedCell, budget);
  const budgetLabel = budget.type === 'cost'
    ? `transfer-cost proxy ≤ ${displayNumber(budget.limit)} km/s`
    : `departure C3 ≤ ${displayNumber(budget.limit)} km²/s²`;
  selectedOutput.feasibility = !budgetInputValid
    ? 'Budget input invalid; feasibility is unavailable'
    : budget.type === 'none'
      ? 'Feasible · no budget active'
      : (feasible ? `Feasible · within ${budgetLabel}` : `Infeasible · above ${budgetLabel}`);
  setSelection(selectedOutput);
}

function refreshBudgetResults() {
  if (grid) {
    planner?.setBudget(budgetInputValid ? budget : { type: 'none', limit: 0 });
    applyMinimums();
    updateSelectionFeasibility();
  }
  publishXRState();
}

function handleBudgetChange(type, rawLimit) {
  budgetInput = { type, limit: String(rawLimit) };
  const { budget: nextBudget, error } = validateBudget(type, rawLimit);
  const unit = type === 'cost' ? 'km/s' : type === 'c3' ? 'km²/s²' : 'No unit';
  view.setBudgetControl(type, unit, type !== 'none', error ?? '', budgetInput.limit);
  budgetInputValid = Boolean(nextBudget);
  if (!nextBudget) {
    refreshBudgetResults();
    view.setSnapAvailable(false);
    return;
  }
  budget = nextBudget;
  refreshBudgetResults();
}

function handleMissionInput(name, values) {
  if (disposed) return;
  let nextInputs = Object.fromEntries(
    Object.entries(DEFAULT_MISSION_INPUTS).map(([key]) => [key, String(values?.[key] ?? '')]),
  );
  if (name === 'target' && TARGET_TOF_PRESETS[nextInputs.target]) {
    const preset = TARGET_TOF_PRESETS[nextInputs.target];
    nextInputs = {
      ...nextInputs,
      tofMinDays: String(preset.min),
      tofMaxDays: String(preset.max),
    };
    view.setTargetPreset(nextInputs.target, preset);
  }
  inputs = nextInputs;
  view.setInputValues(inputs);
  inputRevision += 1;
  computeRequestId += 1;
  gridService.cancel();
  computing = false;
  clearComputedGrid();
  if (name === 'target' && TARGET_TOF_PRESETS[inputs.target]) {
    const draftConfig = validateMissionInputs(inputs).config;
    const departureMs = draftConfig?.departureStartMs
      ?? (Number.isFinite(sceneDepartureMs) ? sceneDepartureMs : Date.UTC(2026, 6, 1));
    updateSceneTarget(inputs.target, departureMs, true);
  }
  view.clearFormErrors();
  setComputeStatus('Inputs changed — compute grid to refresh results.', 'stale');
  publishXRState({ force: true });
}

function updateSceneTarget(target, departureMs, force = false) {
  if (!planner || !Number.isFinite(departureMs)) return;
  if (force || sceneTarget !== target || sceneDepartureMs !== departureMs) {
    sceneTarget = target;
    sceneDepartureMs = departureMs;
    currentAssetTarget = target.toLowerCase();
    for (const id of assetStatuses.keys()) {
      if (!['sun', 'earth', currentAssetTarget].includes(id)) assetStatuses.delete(id);
    }
    planner.setTarget(target, departureMs);
  }
}

function selectedOutputFor(cell, transfer) {
  const isFeasible = isCellFeasible(cell, budget);
  const budgetLabel = budget.type === 'cost'
    ? `transfer-cost proxy ≤ ${displayNumber(budget.limit)} km/s`
    : `departure C3 ≤ ${displayNumber(budget.limit)} km²/s²`;
  return {
    departure: formatUTCInstant(cell.departureMs),
    arrival: formatUTCInstant(cell.arrivalMs),
    tof: `${displayNumber(cell.tofDays, 2)} days`,
    cost: `${displayNumber(cell.cost)} km/s`,
    c3: `${displayNumber(cell.c3)} km²/s²`,
    vInfDeparture: `${displayNumber(transfer.vInfDeparture)} km/s`,
    vInfArrival: `${displayNumber(transfer.vInfArrival)} km/s`,
    branch: Number.isFinite(transfer.transferAngle)
      ? (transfer.transferAngle > Math.PI ? 'Type II' : 'Type I')
      : '—',
    feasibility: !budgetInputValid
      ? 'Budget input invalid; feasibility is unavailable'
      : budget.type === 'none'
        ? 'Feasible · no budget active'
        : (isFeasible ? `Feasible · within ${budgetLabel}` : `Infeasible · above ${budgetLabel}`),
    status: 'Transfer solution and propagated conic are valid.',
  };
}

function setMissionPosition(progress, now = performance.now(), force = false) {
  if (!selectedTransfer) return false;
  const boundedProgress = Math.min(100, Math.max(0, progress));
  selectedProgress = boundedProgress;
  const elapsedSeconds = selectedTransfer.tofSeconds * boundedProgress / 100;
  const epochMs = selectedTransfer.departureMs + elapsedSeconds * 1000;

  if (force || now - lastPhysicsUpdate >= PHYSICS_UPDATE_INTERVAL_MS) {
    const state = propagateState(selectedTransfer.r1, selectedTransfer.v1, elapsedSeconds);
    if (!state.valid || !state.r.every(Number.isFinite)) {
      playing = false;
      selectedTransfer = null;
      selectedSamples = null;
      planner?.setTransfer(null, null);
      planner?.setMissionTime(epochMs, null);
      view.setTransferAvailable(false);
      const reason = `Propagation failed: ${state.reason || 'non-finite spacecraft state'}`;
      if (selectedOutput) setSelection({ ...selectedOutput, status: reason });
      setComputeStatus(reason, 'error');
      setMissionTimeDisplay(NaN, '—', NaN, false);
      return false;
    }
    planner?.setMissionTime(epochMs, state.r);
    lastPhysicsUpdate = now;
    lastAppliedProgress = boundedProgress;
  }

  if (force || now - lastDomUpdate >= DOM_UPDATE_INTERVAL_MS) {
    setMissionTimeDisplay(epochMs, formatUTCInstant(epochMs), boundedProgress, playing);
    lastDomUpdate = now;
  }
  publishXRState({ playback: !force });
  return true;
}

function selectCell(indices) {
  if (!grid || disposed || !indices) return;
  stopPlayback();
  selectedProgress = 0;

  let cell;
  try {
    cell = getGridCell(grid, indices.i, indices.j);
  } catch (error) {
    planner?.setSelection(null);
    planner?.setTransfer(null, null);
    clearSelectedTransfer(error instanceof Error ? error.message : 'Invalid grid cell.');
    publishXRState({ force: true });
    return;
  }

  planner?.setSelection({ i: cell.i, j: cell.j });
  if (!cell.valid) {
    updateSceneTarget(grid.config.target, cell.departureMs);
    planner?.setTransfer(null, null);
    selectedCell = cell;
    selectedTransfer = null;
    selectedSamples = null;
    setSelection({ status: 'This grid cell has no finite transfer solution.' });
    view.setTransferAvailable(false);
    if (Number.isFinite(cell.departureMs)) planner?.setMissionTime(cell.departureMs, null);
    setMissionTimeDisplay(NaN, '—', 0, false);
    publishXRState({ force: true });
    return;
  }

  updateSceneTarget(cell.target, cell.departureMs);
  const transfer = computeTransfer({
    target: cell.target,
    departureMs: cell.departureMs,
    tofDays: cell.tofDays,
  });
  if (!transfer.valid) {
    planner?.setTransfer(null, null);
    selectedCell = cell;
    selectedTransfer = null;
    selectedSamples = null;
    setSelection({ status: `Transfer solve failed: ${transfer.reason}` });
    view.setTransferAvailable(false);
    planner?.setMissionTime(cell.departureMs, null);
    setMissionTimeDisplay(NaN, '—', 0, false);
    publishXRState({ force: true });
    return;
  }

  const samples = sampleTrajectory(transfer.r1, transfer.v1, transfer.tofSeconds, 128);
  if (!samples.valid) {
    planner?.setTransfer(null, null);
    selectedCell = cell;
    selectedTransfer = null;
    selectedSamples = null;
    setSelection({ status: `Trajectory propagation failed: ${samples.reason}` });
    view.setTransferAvailable(false);
    planner?.setMissionTime(cell.departureMs, null);
    setMissionTimeDisplay(NaN, '—', 0, false);
    publishXRState({ force: true });
    return;
  }

  selectedCell = cell;
  selectedTransfer = transfer;
  selectedSamples = samples;
  selectedOutput = selectedOutputFor(cell, transfer);
  planner?.setTransfer(transfer, samples);
  setSelection(selectedOutput);
  view.setTransferAvailable(true);
  lastPhysicsUpdate = -Infinity;
  lastAppliedProgress = NaN;
  lastDomUpdate = -Infinity;
  setMissionPosition(0, performance.now(), true);
  publishXRState({ force: true });
}

function snapToMinimum() {
  if (!grid || disposed || !budgetInputValid) return;
  const cell = budget.type === 'none' ? unconstrainedMinimum : feasibleMinimum;
  if (cell) selectCell({ i: cell.i, j: cell.j });
}

function scrubMissionTime(progress) {
  if (!selectedTransfer || !planner || disposed || !Number.isFinite(progress)) return;
  if (playing) stopPlayback();
  else lastFrameTime = null;
  selectedProgress = Math.min(100, Math.max(0, progress));
  setMissionPosition(selectedProgress, performance.now(), false);
}

function togglePlayback() {
  if (!planner || !selectedTransfer || disposed || computing) return;
  if (playing) {
    stopPlayback();
    publishXRState({ force: true });
    return;
  }
  if (selectedProgress >= 100) setMissionPosition(0, performance.now(), true);
  playing = true;
  lastFrameTime = performance.now();
  setMissionTimeDisplay(
    selectedTransfer.departureMs + selectedTransfer.tofSeconds * 1000 * selectedProgress / 100,
    formatUTCInstant(selectedTransfer.departureMs + selectedTransfer.tofSeconds * 1000 * selectedProgress / 100),
    selectedProgress,
    true,
  );
  publishXRState({ force: true });
}

function applyXRAction(action) {
  if (disposed || !action || typeof action.type !== 'string') return;
  try {
    if (['target', 'step', 'budgetType', 'budgetStep', 'compute'].includes(action.type)) {
      if (action.type === 'budgetStep' && !budgetInputValid) return;
      let budgetForAction = budgetInputValid ? budgetInput : { type: 'none', limit: '0' };
      if (!budgetInputValid && action.type === 'budgetType') {
        budgetForAction = action.value === 'none'
          ? { type: 'cost', limit: '6' }
          : { type: 'none', limit: '0' };
      }
      const result = applyMissionAction(inputs, budgetForAction, action);
      inputs = result.inputs;
      if (action.type === 'budgetType' || action.type === 'budgetStep' || budgetInputValid) {
        budgetInput = result.budgetInput;
      }
      view.setInputValues(inputs);
      if (action.type === 'target') {
        const preset = TARGET_TOF_PRESETS[inputs.target];
        if (preset) view.setTargetPreset(inputs.target, preset);
      }
      if (result.missionChanged) {
        handleMissionInput(action.type === 'target' ? 'target' : action.field, inputs);
      }
      if (result.budgetChanged) handleBudgetChange(budgetInput.type, budgetInput.limit);
      if (result.computeRequested) void computeGrid(inputs);
      publishXRState({ force: true });
      return;
    }

    switch (action.type) {
      case 'snap':
        snapToMinimum();
        break;
      case 'play':
        togglePlayback();
        break;
      case 'scrub':
        scrubMissionTime(action.progress);
        break;
      case 'scrubDelta':
        if (selectedTransfer && Number.isFinite(action.delta)) {
          scrubMissionTime(selectedProgress + action.delta);
        }
        return;
      case 'reset':
        scaleLarge = false;
        scaleExaggerated = true;
        displayOptions.exaggeratedBodies = true;
        planner?.setBodyScale(true);
        planner?.resetView();
        document.getElementById('body-scale-note').textContent = 'Planet radii exaggerated for visibility';
        break;
      case 'defaults':
        // Explicit in-world recovery for malformed drafts entered on desktop.
        // Do not silently replace mission parameters when another action fails.
        handleBudgetChange('none', '0');
        handleMissionInput('target', { ...DEFAULT_MISSION_INPUTS });
        break;
      case 'exit':
        void vrEntry?.exitSession();
        break;
      case 'radii':
        scaleExaggerated = !scaleExaggerated;
        displayOptions.exaggeratedBodies = scaleExaggerated;
        planner?.setBodyScale(scaleExaggerated);
        document.getElementById('body-scale-note').textContent = scaleExaggerated
          ? 'Planet radii exaggerated for visibility'
          : 'Physical body radii; 1 scene unit = 1 AU';
        break;
      case 'scale':
        scaleLarge = !scaleLarge;
        break;
      case 'nextTarget': {
        const index = TARGET_ORDER.indexOf(inputs.target);
        const nextTarget = TARGET_ORDER[(index + 1) % TARGET_ORDER.length];
        applyXRAction({ type: 'target', target: nextTarget });
        return;
      }
      default:
        return;
    }
  } catch (error) {
    setComputeStatus(`Workbench action failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
  publishXRState({ force: true });
}

function updateFrame(timestamp) {
  if (disposed || !planner) return;
  const now = Number.isFinite(timestamp) ? timestamp : performance.now();
  const deltaSeconds = previousAnimationTimestamp === null
    ? 0
    : Math.min(0.1, Math.max(0, (now - previousAnimationTimestamp) / 1000));
  previousAnimationTimestamp = now;
  const mode = planner.renderer.xr?.isPresenting ? 'XR' : 'desktop';
  performanceMonitor?.beginFrame(now, mode);
  if (mode === 'XR') planner.updateXR?.(deltaSeconds, now);

  let playbackTick = false;
  let playbackFinished = false;
  if (playing && selectedTransfer) {
    playbackTick = true;
    if (lastFrameTime === null) lastFrameTime = now;
    const elapsed = Math.max(0, now - lastFrameTime);
    lastFrameTime = now;
    selectedProgress += elapsed / PLAYBACK_DURATION_MS * 100;
    if (selectedProgress >= 100) {
      selectedProgress = 100;
      playing = false;
      lastFrameTime = null;
      playbackFinished = true;
    }
  }
  if (selectedTransfer && playbackTick) {
    setMissionPosition(selectedProgress, now, playbackFinished);
  } else if (selectedTransfer && !playing) {
    if (selectedProgress !== lastAppliedProgress && now - lastPhysicsUpdate >= PHYSICS_UPDATE_INTERVAL_MS) {
      setMissionPosition(selectedProgress, now, false);
    } else if (
      selectedProgress !== lastDisplayedProgress
      && now - lastDomUpdate >= DOM_UPDATE_INTERVAL_MS
    ) {
      const epochMs = selectedTransfer.departureMs
        + selectedTransfer.tofSeconds * 1000 * selectedProgress / 100;
      setMissionTimeDisplay(epochMs, formatUTCInstant(epochMs), selectedProgress, false);
      lastDomUpdate = now;
      publishXRState({ playback: true });
    }
  }

  planner.render();
  performanceMonitor?.endFrame(planner.renderer, now, mode);
  if (mode === 'XR' && now - lastTelemetrySnapshot >= XR_TELEMETRY_SNAPSHOT_INTERVAL_MS) {
    lastTelemetrySnapshot = now;
    publishXRState({ force: true });
  }
}

async function computeGrid(rawInputs) {
  if (disposed) return;
  view.clearFormErrors();
  inputs = Object.fromEntries(
    Object.entries(DEFAULT_MISSION_INPUTS).map(([key]) => [key, String(rawInputs?.[key] ?? '')]),
  );
  view.setInputValues(inputs);
  const requestId = ++computeRequestId;
  const revision = inputRevision;
  gridService.cancel();
  computing = false;
  clearComputedGrid();
  const { config, errors } = validateMissionInputs(inputs);
  if (!config) {
    gridService.cancel();
    view.setFormErrors(errors, 'Correct the mission inputs before computing the grid.');
    setGridSummary('No grid available.');
    setComputeStatus('Mission inputs are invalid.', 'error');
    publishXRState({ force: true });
    return;
  }

  computing = true;
  setComputeStatus('Computing grid in a module worker…', 'working');
  setGridSummary(`Computing ${config.departureCount} × ${config.tofCount} cells in a worker…`);
  view.setSnapAvailable(false);
  view.setTransferAvailable(false);
  publishXRState({ force: true });

  try {
    const nextGrid = await gridService.compute(config);
    if (disposed || requestId !== computeRequestId || revision !== inputRevision) return;

    computing = false;
    grid = nextGrid;
    view.setGridAxes(nextGrid.config);
    planner?.setGrid(nextGrid);
    planner?.setBudget(budgetInputValid ? budget : { type: 'none', limit: 0 });
    const firstInspectionCell = (budgetInputValid ? findGridMinimum(nextGrid, budget) : null)
      ?? findGridMinimum(nextGrid, { type: 'none' });
    const departureMs = firstInspectionCell?.departureMs ?? nextGrid.departureEpochs[0];
    updateSceneTarget(nextGrid.config.target, departureMs, true);
    currentAssetTarget = nextGrid.config.target.toLowerCase();
    view.setTargetLabel(nextGrid.config.target);
    updateLegend();
    applyMinimums();

    const inspectionCell = budget.type === 'none'
      ? unconstrainedMinimum
      : (feasibleMinimum ?? unconstrainedMinimum);
    if (inspectionCell) {
      selectCell({ i: inspectionCell.i, j: inspectionCell.j });
    } else {
      planner?.setSelection(null);
      planner?.setTransfer(null, null);
      setSelection({ status: 'The computed grid contains no valid transfer cells.' });
      view.setTransferAvailable(false);
      setMissionTimeDisplay(NaN, '—', 0, false);
    }
    setGridSummary(
      `${nextGrid.departureCount} × ${nextGrid.tofCount} · ${nextGrid.validCount} valid · ${nextGrid.invalidCount} masked · ${nextGrid.computeMs.toFixed(1)} ms worker CPU`,
    );
    setHoverSummary(nextGrid.validCount > 0
      ? 'Hover a cell, or focus the plot and use arrows + Enter to select.'
      : 'All transfer cells are masked; adjust the departure or flight-time ranges.');
    setComputeStatus('Grid ready', 'ready');
    publishXRState({ force: true });
  } catch (error) {
    if (disposed || requestId !== computeRequestId || revision !== inputRevision) return;
    computing = false;
    if (error?.name === 'AbortError') {
      publishXRState({ force: true });
      return;
    }
    grid = null;
    planner?.setGrid(null);
    view.setGridAxes(null);
    view.setLegend();
    view.setTargetLabel(null);
    applyMinimums();
    setSelection({ status: 'Grid computation failed.' });
    setGridSummary('No grid available. Select Compute grid to retry.');
    setComputeStatus(`Grid worker error: ${error instanceof Error ? error.message : String(error)}. Compute grid to retry.`, 'error');
    publishXRState({ force: true });
  }
}

function onXRHover(indices) {
  if (!grid || !indices) {
    setHoverSummary(grid ? 'No grid cell under pointer.' : 'Compute a grid to inspect transfer cells.');
    return;
  }
  const cell = getGridCell(grid, indices.i, indices.j);
  setHoverSummary(cell.valid
    ? `Departure ${formatUTCInstant(cell.departureMs)} · ${cell.tofDays.toFixed(1)} days · ${cell.cost.toFixed(3)} km/s proxy · ${!budgetInputValid ? 'budget input invalid' : isCellFeasible(cell, budget) ? 'within budget' : 'above budget'}`
    : 'This cell has no finite transfer solution.');
}

view = createAppView({
  onCompute: (values) => computeGrid(values),
  onMissionInput: (name, values) => handleMissionInput(name, values),
  onBudgetChange: (type, limit) => handleBudgetChange(type, limit),
  onTimeScrub: (progress) => scrubMissionTime(progress),
  onTogglePlayback: () => togglePlayback(),
  onResetView: () => planner?.resetView(),
  onSnap: () => snapToMinimum(),
});

view.setInputValues(inputs);
view.setTargetPreset(DEFAULT_MISSION_INPUTS.target, TARGET_TOF_PRESETS[DEFAULT_MISSION_INPUTS.target]);
view.setBudgetControl('none', 'No unit', false, '', budgetInput.limit);
view.setSelection();
view.setMinimums({ hasGrid: false });
view.setSnapAvailable(false);
view.setPlaybackAvailable(false);
view.setLegend();
view.setHoverSummary(hoverSummary);

try {
  planner = createPlannerScene({
    surface: document.getElementById('graphics-surface'),
    orreryViewport: document.getElementById('orrery-viewport'),
    plotViewport: document.getElementById('plot-viewport'),
    textureFormat: new URLSearchParams(window.location.search).get('textureFormat') === 'rgba' ? 'rgba' : 'red',
    onSelect: (indices) => selectCell(indices),
    onHover: onXRHover,
    onXRAction: applyXRAction,
    onAssetStatus: (status) => {
      if (disposed) return;
      if (status?.assetId) assetStatuses.set(status.assetId, { ...status });
      // Keep the desktop view's per-asset map untouched; the scene receives an
      // aggregate so a late ready/loading event cannot hide another missing map.
      view.setAssetStatus(status?.assetId ? { ...status } : status);
      if (status?.assetId) Object.assign(status, activeAssetStatus());
      publishXRState();
    },
  });
  view.setSpatialAvailable(true);
  view.setAssetStatus({ status: 'loading', label: 'Body', message: 'Loading body imagery.' });

  try {
    displayGui = new GUI({
      container: document.getElementById('display-settings'),
      title: 'Display settings',
      width: 245,
    });
    displayGui.add(displayOptions, 'exaggeratedBodies')
      .name('Exaggerated body sizes')
      .listen()
      .onChange((value) => {
        scaleExaggerated = Boolean(value);
        planner?.setBodyScale(scaleExaggerated);
        document.getElementById('body-scale-note').textContent = value
          ? 'Planet radii exaggerated for visibility'
          : 'Physical body radii; 1 scene unit = 1 AU';
        publishXRState({ force: true });
      });
    displayGui.close();
  } catch (error) {
    console.warn('Display settings are unavailable.', error);
  }

  performanceMonitor = createPerformanceMonitor(document.getElementById('performance-telemetry'));
  planner.renderer.setAnimationLoop(updateFrame);
  try {
    vrEntry = createVREntry({
      renderer: planner.renderer,
      host: document.getElementById('vr-entry'),
      onStatus: (message, status) => view.setVREntryStatus(message, status),
      onSessionState: (active) => {
        previousAnimationTimestamp = null;
        lastFrameTime = null;
        stopPlayback();
        if (active) {
          document.body.classList.add('xr-presenting');
          if (displayGui?.domElement) displayGui.domElement.hidden = true;
          planner?.setImmersive(true);
        } else {
          planner?.setImmersive(false);
          document.body.classList.remove('xr-presenting');
          if (displayGui?.domElement) displayGui.domElement.hidden = false;
        }
        publishXRState({ force: true });
      },
    });
  } catch (error) {
    view.setVREntryUnavailable('VR setup unavailable');
    view.setVREntryStatus(`WebXR entry could not be initialized: ${error instanceof Error ? error.message : String(error)}. Desktop planning remains available.`, 'error');
    console.warn('WebXR entry is unavailable; desktop planning remains active.', error);
  }
} catch (error) {
  planner?.renderer.setAnimationLoop(null);
  performanceMonitor?.destroy();
  performanceMonitor = null;
  displayGui?.destroy();
  displayGui = null;
  planner?.destroy();
  planner = null;
  view.showRendererUnavailable();
  view.setVREntryUnavailable('3D unavailable');
  view.setVREntryStatus('3D rendering is unavailable, so immersive VR cannot start. Mission computation remains available.', 'error');
  console.warn('The 3D planner could not start; numerical planning remains available.', error);
}

if (new URLSearchParams(window.location.search).get('debugXR') === '1') {
  const toPlain = (value, seen = new WeakSet()) => {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
    if (typeof value !== 'object' || seen.has(value)) return undefined;
    seen.add(value);
    if (Array.isArray(value)) return value.map((item) => toPlain(item, seen));
    if (Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)) {
      return [value.x, value.y, value.z];
    }
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      const plain = toPlain(item, seen);
      if (plain !== undefined) result[key] = plain;
    }
    return result;
  };
  debugFunction = () => toPlain({
    inputs: { ...inputs },
    budgetInput: { ...budgetInput },
    budgetValid: budgetInputValid,
    gridConfig: grid ? { ...grid.config } : null,
    gridCounts: grid ? { departures: grid.departureCount, tof: grid.tofCount, valid: grid.validCount, invalid: grid.invalidCount } : null,
    selection: selectedCell ? { i: selectedCell.i, j: selectedCell.j } : null,
    selectedOutput: selectedOutput ? { ...selectedOutput } : null,
    selectionStatus,
    minimumSummary: minimumSummary(),
    status: { ...computeStatus },
    computing,
    progress: selectedTransfer ? selectedProgress : null,
    playing,
    hoverSummary,
    assetStatus: activeAssetStatus(),
    scaleExaggerated,
    modelScaleExaggerated: scaleLarge,
    telemetry: performanceMonitor?.getSnapshot?.() ?? null,
    scene: planner?.getXRDiagnostics?.() ?? null,
  });
  window.__plannerXRDiagnostics = debugFunction;
}

function teardown() {
  if (disposed) return;
  disposed = true;
  computeRequestId += 1;
  inputRevision += 1;
  gridService.destroy();
  window.removeEventListener('beforeunload', teardown);
  const plannerToDestroy = planner;
  planner?.renderer.setAnimationLoop(null);
  const sessionEnd = vrEntry?.destroy();
  vrEntry = null;
  performanceMonitor?.destroy();
  displayGui?.destroy();
  if (sessionEnd && typeof sessionEnd.then === 'function') {
    void sessionEnd.then(() => plannerToDestroy?.destroy()).catch((error) => {
      console.warn('Could not finish VR teardown cleanly.', error);
      plannerToDestroy?.destroy();
    });
  } else {
    plannerToDestroy?.destroy();
  }
  planner = null;
  view.destroy();
  if (debugFunction && window.__plannerXRDiagnostics === debugFunction) {
    delete window.__plannerXRDiagnostics;
  }
}

window.addEventListener('beforeunload', teardown, { once: true });
if (import.meta.hot) import.meta.hot.dispose(teardown);

// Preserve the established desktop startup workflow; users may recompute after edits.
void computeGrid(DEFAULT_MISSION_INPUTS);
