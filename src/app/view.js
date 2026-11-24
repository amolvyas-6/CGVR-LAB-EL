import { DEFAULT_PROPELLANT_SETTINGS } from '../physics/propellant.js';

const FIELD_IDS = Object.freeze({
  target: 'target',
  departureStart: 'departure-start',
  departureEnd: 'departure-end',
  tofMinDays: 'tof-min',
  tofMaxDays: 'tof-max',
  resolution: 'resolution',
});

function element(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Required planner element #${id} is missing`);
  return node;
}

function setText(id, value) {
  element(id).textContent = value;
}

export function createAppView({
  onCompute,
  onMissionInput,
  onBudgetChange,
  onPropellantChange,
  onTimeScrub,
  onTogglePlayback,
  onResetView,
  onSnap,
}) {
  const form = element('mission-form');
  const target = element('target');
  const budgetType = element('budget-type');
  const budgetLimit = element('budget-limit');
  const formError = element('form-errors');
  const propellantSettings = element('propellant-settings');
  const propellantInputs = Array.from(propellantSettings.querySelectorAll('input'));
  for (const input of propellantInputs) input.value = String(DEFAULT_PROPELLANT_SETTINGS[input.name]);
  const inputFields = Object.fromEntries(
    Object.entries(FIELD_IDS).map(([key, id]) => [key, element(id)]),
  );
  let disposed = false;
  const assetStatuses = new Map();

  const renderAssetStatus = () => {
    const statuses = [...assetStatuses.values()];
    const missing = statuses.filter(item => item.status === 'error');
    const loading = statuses.filter(item => item.status === 'loading');
    if (missing.length) {
      setText('asset-status', `Missing imagery: ${missing.map(item => item.label).join(', ')}. Neutral surfaces are shown; mission calculations remain available.`);
    } else if (loading.length) {
      setText('asset-status', `Loading imagery: ${loading.map(item => item.label).join(', ')}. Mission calculations are independent.`);
    } else if (statuses.length) {
      setText('asset-status', `Imagery ready for ${statuses.map(item => item.label).join(', ')}. Planet positions use ephemeris data.`);
    }
  };

  const readInputValues = () => Object.fromEntries(
    Object.entries(inputFields).map(([key, input]) => [key, input.value]),
  );

  const clearFieldValidity = () => {
    for (const input of Object.values(inputFields)) input.setCustomValidity('');
    formError.hidden = true;
    formError.textContent = '';
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    clearFieldValidity();
    onCompute?.(readInputValues());
  };
  const handleMissionInput = (event) => {
    const field = event.target;
    if (!field || field.id === 'target') return;
    field.setCustomValidity('');
    onMissionInput?.(field.name, readInputValues());
  };
  const handleTargetChange = () => {
    target.setCustomValidity('');
    onMissionInput?.('target', readInputValues());
  };
  const handleBudgetInput = () => onBudgetChange?.(budgetType.value, budgetLimit.value);
  const handlePropellantInput = () => onPropellantChange?.();
  const handleTimeScrub = () => onTimeScrub?.(Number(element('time-progress').value));
  const handlePlayback = () => onTogglePlayback?.();
  const handleReset = () => onResetView?.();
  const handleSnap = () => onSnap?.();

  form.addEventListener('submit', handleSubmit);
  form.addEventListener('input', handleMissionInput);
  form.addEventListener('change', handleMissionInput);
  target.addEventListener('change', handleTargetChange);
  budgetType.addEventListener('change', handleBudgetInput);
  budgetLimit.addEventListener('input', handleBudgetInput);
  budgetLimit.addEventListener('change', handleBudgetInput);
  propellantSettings.addEventListener('input', handlePropellantInput);
  element('time-progress').addEventListener('input', handleTimeScrub);
  element('play-toggle').addEventListener('click', handlePlayback);
  element('reset-view').addEventListener('click', handleReset);
  element('snap-optimum').addEventListener('click', handleSnap);

  return {
    readInputValues,

    setTargetPreset(value, preset) {
      target.value = value;
      inputFields.tofMinDays.value = String(preset.min);
      inputFields.tofMaxDays.value = String(preset.max);
    },

    // Mirror XR-edited canonical strings without dispatching synthetic form events.
    setInputValues(values) {
      for (const [key, input] of Object.entries(inputFields)) {
        if (typeof values?.[key] === 'string' && input.value !== values[key]) input.value = values[key];
      }
    },

    setFormErrors(errors, message) {
      clearFieldValidity();
      for (const [key, error] of Object.entries(errors ?? {})) {
        const input = inputFields[key];
        if (input) input.setCustomValidity(error);
      }
      formError.textContent = message ?? Object.values(errors ?? {})[0] ?? '';
      formError.hidden = !formError.textContent;
      const invalidInput = Object.values(inputFields).find((input) => !input.validity.valid);
      const searchOptions = invalidInput?.closest('details');
      if (searchOptions) searchOptions.open = true;
      invalidInput?.focus();
      invalidInput?.reportValidity();
    },

    clearFormErrors() {
      clearFieldValidity();
    },

    setComputeStatus(message, status = '') {
      const node = element('compute-status');
      node.textContent = message;
      node.dataset.status = status;
    },

    setVREntryStatus(message, status = '') {
      const node = element('vr-status');
      node.textContent = message;
      node.dataset.status = status;
    },

    setVREntryUnavailable(label = 'WebXR unavailable') {
      const button = element('vr-entry-button');
      button.textContent = label;
      button.disabled = true;
    },

    setGridSummary(message) {
      setText('grid-summary', message);
    },

    setBudgetControl(type, unit, enabled, message = '', limit = undefined) {
      budgetType.value = type;
      if (typeof limit === 'string' && budgetLimit.value !== limit) budgetLimit.value = limit;
      element('budget-unit').textContent = unit;
      budgetLimit.disabled = !enabled;
      element('budget-limit-field').hidden = !enabled;
      budgetLimit.setCustomValidity(message);
      setText('budget-error', message);
      element('budget-error').hidden = !message;
    },

    setGridAxes(config) {
      setText('plot-departure-start', config ? new Date(config.departureStartMs).toISOString().slice(0, 10) : '—');
      setText('plot-departure-end', config ? new Date(config.departureEndMs).toISOString().slice(0, 10) : '—');
      setText('plot-tof-min', config ? `${config.tofMinDays} d` : '—');
      setText('plot-tof-max', config ? `${config.tofMaxDays} d` : '—');
    },

    setLegend({ min, max, clampedAbove = false } = {}) {
      setText('legend-min', Number.isFinite(min) ? `${min.toFixed(2)} km/s` : '—');
      setText('legend-max', Number.isFinite(max) ? `${max.toFixed(2)} km/s` : '—');
      setText(
        'legend-note',
        clampedAbove
          ? `Transfer-cost proxy v∞,dep + v∞,arr; values above ${max.toFixed(2)} km/s are clamped to amber.`
          : 'Transfer-cost proxy v∞,dep + v∞,arr; units are km/s.',
      );
    },

    setHoverSummary(message) {
      setText('hover-summary', message);
    },

    setTargetLabel(name) {
      setText('selected-target', name ?? 'Not computed');
      if (name) {
        for (const id of assetStatuses.keys()) {
          if (!['sun', 'earth', name.toLowerCase()].includes(id)) assetStatuses.delete(id);
        }
        renderAssetStatus();
      }
    },

    setMinimums({ unconstrained = null, feasible = null, hasGrid = false, budgetActive = false, budgetValid = true } = {}) {
      if (!hasGrid) {
        setText('unconstrained-minimum', 'Not computed');
        setText('unconstrained-cost', '—');
        setText('unconstrained-c3', '—');
        setText('feasible-minimum', 'No grid computed');
        setText('feasible-dates', '—');
        setText('feasible-cost', '—');
        setText('feasible-c3', '—');
        return;
      }

      const minimumDates = (cell) => cell
        ? `${new Date(cell.departureMs).toISOString().slice(0, 10)} · ${cell.tofDays.toFixed(1)} d · ${new Date(cell.arrivalMs).toISOString().slice(0, 10)}`
        : 'No valid transfer';
      const fillMinimum = (prefix, cell) => {
        setText(`${prefix}-minimum`, minimumDates(cell));
        setText(`${prefix}-cost`, cell ? `${cell.cost.toFixed(3)} km/s` : '—');
        setText(`${prefix}-c3`, cell ? `${cell.c3.toFixed(3)} km²/s²` : '—');
      };

      fillMinimum('unconstrained', unconstrained);
      if (!feasible || !budgetValid) {
        setText('feasible-minimum', budgetValid ? 'No feasible transfer' : 'Enter a valid budget limit');
        setText('feasible-dates', '—');
        setText('feasible-cost', '—');
        setText('feasible-c3', '—');
      } else {
        setText('feasible-minimum', budgetActive ? 'Lowest-cost cell within budget' : 'No budget active · all valid cells feasible');
        setText('feasible-dates', minimumDates(feasible));
        setText('feasible-cost', `${feasible.cost.toFixed(3)} km/s`);
        setText('feasible-c3', `${feasible.c3.toFixed(3)} km²/s²`);
      }
    },

    setSelection(result = null) {
      const fields = [
        ['selected-departure', result?.departure ?? '—'],
        ['selected-arrival', result?.arrival ?? '—'],
        ['selected-tof', result?.tof ?? '—'],
        ['selected-cost', result?.cost ?? '—'],
        ['selected-c3', result?.c3 ?? '—'],
        ['selected-vinf-departure', result?.vInfDeparture ?? '—'],
        ['selected-vinf-arrival', result?.vInfArrival ?? '—'],
        ['selected-branch', result?.branch ?? '—'],
        ['selected-feasibility', result?.feasibility ?? '—'],
      ];
      for (const [id, value] of fields) setText(id, value);
      setText('selection-status', result?.status ?? 'Select a valid plot cell.');
    },

    readPropellantInputs() {
      return Object.fromEntries(propellantInputs.map((input) => [input.name, input.value]));
    },

    setPropellantEstimate({ estimate, status }) {
      const velocity = (value) => Number.isFinite(value) ? `${value.toFixed(3)} km/s` : '—';
      const format = (value, decimals = 1) => value.toLocaleString('en-US', { maximumFractionDigits: decimals });
      setText('propellant-mass', estimate ? `${format(estimate.propellantKg)} kg` : '—');
      setText('propellant-cost', Number.isFinite(estimate?.propellantCostUsd)
        ? estimate.propellantCostUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
        : '—');
      setText('propellant-total-dv', velocity(estimate?.totalDeltaVKmPerSec));
      setText('propellant-departure-dv', velocity(estimate?.departureDeltaVKmPerSec));
      setText('propellant-capture-dv', velocity(estimate?.captureDeltaVKmPerSec));
      const orbits = estimate
        ? `${format(estimate.departureAltitudeKm, 0)} km Earth orbit → ${format(estimate.captureAltitudeKm, 0)} km ${estimate.target} orbit, both circular.`
        : '';
      const inputs = estimate
        ? `${format(estimate.dryMassKg)} kg dry mass, ${format(estimate.specificImpulseSeconds)} s Isp`
        : '';
      const price = estimate?.pricePerKgUsd != null ? `, $${format(estimate.pricePerKgUsd, 2)}/kg assumed` : '';
      setText('propellant-orbits', estimate ? `${orbits} ${inputs}${price}.` : '');
      setText('propellant-status', status);
    },

    setMissionTime(epochMs, formattedDate, progress, playing) {
      setText('mission-date', Number.isFinite(epochMs) ? formattedDate : '—');
      const slider = element('time-progress');
      if (Number.isFinite(progress)) slider.value = String(Math.min(100, Math.max(0, progress)));
      element('play-toggle').textContent = playing ? 'Pause' : 'Play';
    },

    setPlaybackAvailable(available) {
      element('play-toggle').disabled = !available;
      element('time-progress').disabled = !available;
    },

    setSnapAvailable(available) {
      element('snap-optimum').disabled = !available;
    },

    setSpatialAvailable(available) {
      const surface = element('graphics-surface');
      surface.classList.toggle('spatial-unavailable', !available);
      element('orrery-viewport').setAttribute('aria-disabled', String(!available));
      element('plot-viewport').setAttribute('aria-disabled', String(!available));
      element('reset-view').disabled = !available;
      this.setPlaybackAvailable(available && element('play-toggle').dataset.transferAvailable === 'true');
      const unavailable = element('renderer-unavailable');
      unavailable.hidden = available;
    },

    setTransferAvailable(available) {
      element('play-toggle').dataset.transferAvailable = String(available);
      const spatialAvailable = !element('graphics-surface').classList.contains('spatial-unavailable');
      this.setPlaybackAvailable(available && spatialAvailable);
    },

    setAssetStatus(payload) {
      if (payload?.assetId) {
        assetStatuses.set(payload.assetId, payload);
        renderAssetStatus();
        return;
      }
      // A generic startup message must not hide an already reported failure.
      if (assetStatuses.size) return;
      const status = typeof payload === 'string' ? payload : payload?.status;
      const label = typeof payload === 'object' && payload ? payload.label : null;
      const detail = typeof payload === 'object' && payload ? payload.message : '';
      if (status === 'ready') {
        setText('asset-status', `${label ?? 'Body'} imagery ready. Planet positions use ephemeris data.`);
      } else if (status === 'error') {
        setText('asset-status', `${label ?? 'Body'} imagery unavailable; a neutral surface is shown. ${detail || 'Mission calculations remain available.'}`);
      } else if (status === 'loading') {
        setText('asset-status', `${label ?? 'Body'} imagery loading; mission calculations are independent.`);
      } else {
        setText('asset-status', detail || 'Body imagery status updated; mission calculations are independent.');
      }
    },

    showRendererUnavailable() {
      this.setSpatialAvailable(false);
      element('renderer-unavailable').hidden = false;
      this.setComputeStatus('3D visualization unavailable; numerical planning remains active.', 'warning');
    },

    destroy() {
      if (disposed) return;
      disposed = true;
      form.removeEventListener('submit', handleSubmit);
      form.removeEventListener('input', handleMissionInput);
      form.removeEventListener('change', handleMissionInput);
      target.removeEventListener('change', handleTargetChange);
      budgetType.removeEventListener('change', handleBudgetInput);
      budgetLimit.removeEventListener('input', handleBudgetInput);
      budgetLimit.removeEventListener('change', handleBudgetInput);
      propellantSettings.removeEventListener('input', handlePropellantInput);
      element('time-progress').removeEventListener('input', handleTimeScrub);
      element('play-toggle').removeEventListener('click', handlePlayback);
      element('reset-view').removeEventListener('click', handleReset);
      element('snap-optimum').removeEventListener('click', handleSnap);
    },
  };
}
