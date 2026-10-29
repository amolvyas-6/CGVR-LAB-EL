import Stats from 'stats.js';

function createStatsReadout(container, { label, panel }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'stats-readout';

  const heading = document.createElement('span');
  heading.className = 'stats-readout-label';
  heading.textContent = label;

  const stats = new Stats();
  stats.showPanel(panel);
  stats.dom.style.position = 'relative';
  stats.dom.style.top = 'auto';
  stats.dom.style.right = 'auto';
  stats.dom.style.bottom = 'auto';
  stats.dom.style.left = 'auto';
  stats.dom.style.zIndex = 'auto';
  stats.dom.style.opacity = '1';
  stats.dom.style.cursor = 'default';
  stats.dom.setAttribute('aria-hidden', 'true');

  wrapper.append(heading, stats.dom);
  container.append(wrapper);
  return { stats, wrapper, heading };
}

function createMetric(label, id) {
  const wrapper = document.createElement('div');
  wrapper.className = 'renderer-metric';

  const term = document.createElement('dt');
  term.textContent = label;
  const value = document.createElement('dd');
  value.id = id;
  value.textContent = '—';

  wrapper.append(term, value);
  return { wrapper, term, value };
}

function average(values, key) {
  if (values.length === 0) return NaN;
  let total = 0;
  for (const sample of values) total += sample[key];
  return total / values.length;
}

export function createPerformanceMonitor(container) {
  container.replaceChildren();

  const readouts = document.createElement('div');
  readouts.className = 'stats-readouts';
  const cadence = createStatsReadout(readouts, {
    label: 'Desktop measured cadence · stats.js FPS',
    panel: 0,
  });
  const callback = createStatsReadout(readouts, {
    label: 'Desktop callback time · stats.js ms',
    panel: 1,
  });

  const rendererInfo = document.createElement('dl');
  rendererInfo.className = 'renderer-metrics';
  const metrics = [
    createMetric('Mode', 'metric-mode'),
    createMetric('Measured cadence', 'metric-cadence'),
    createMetric('Mean frame interval', 'metric-interval'),
    createMetric('Mean callback CPU', 'metric-cpu'),
    createMetric('Draw calls / XR frame', 'metric-calls'),
    createMetric('Triangles / XR frame', 'metric-triangles'),
    createMetric('Geometries', 'metric-geometries'),
    createMetric('Textures', 'metric-textures'),
  ];
  rendererInfo.append(...metrics.map(({ wrapper }) => wrapper));
  container.append(readouts, rendererInfo);

  let disposed = false;
  let frameStartedAt = 0;
  let previousSampleTime = null;
  let mode = 'desktop';
  let lastInfoUpdate = 0;
  let snapshot = {
    mode,
    cadenceFps: null,
    fps: null,
    frameIntervalMs: null,
    frameMs: null,
    callbackMs: null,
    callbackDurationMs: null,
    drawCalls: null,
    calls: null,
    triangles: null,
    geometries: null,
    textures: null,
    measuredWindowMs: 0,
  };
  const samples = [];

  function refreshMode(nextMode) {
    const normalized = nextMode === 'XR' ? 'XR' : 'desktop';
    if (normalized === mode) return;
    mode = normalized;
    samples.length = 0;
    previousSampleTime = null;
    lastInfoUpdate = -Infinity;
    snapshot = { ...snapshot, mode, cadenceFps: null, fps: null,
      frameIntervalMs: null, frameMs: null, callbackMs: null,
      callbackDurationMs: null, measuredWindowMs: 0 };
    const prefix = mode === 'XR' ? 'XR browser callback' : 'Desktop browser callback';
    cadence.heading.textContent = `${prefix} cadence · stats.js FPS`;
    callback.heading.textContent = `${prefix} duration · stats.js ms`;
    metrics[0].value.textContent = mode;
    const scope = mode === 'XR' ? 'stereo frame' : 'desktop frame';
    metrics[4].term.textContent = `Draw calls / ${scope}`;
    metrics[5].term.textContent = `Triangles / ${scope}`;
  }

  function pruneSamples(now) {
    while (samples.length && now - samples[0].time > 1000) samples.shift();
  }

  return {
    beginFrame(now = performance.now(), nextMode = 'desktop') {
      if (disposed) return;
      refreshMode(nextMode);
      frameStartedAt = performance.now();
      cadence.stats.begin();
      callback.stats.begin();
    },
    endFrame(renderer, now = performance.now(), nextMode = mode) {
      if (disposed) return;
      const callbackMs = Math.max(0, performance.now() - frameStartedAt);
      callback.stats.end();
      cadence.stats.end();
      refreshMode(nextMode);

      const timestamp = Number.isFinite(now) ? now : performance.now();
      const interval = Number.isFinite(previousSampleTime) && timestamp >= previousSampleTime
        ? timestamp - previousSampleTime
        : NaN;
      previousSampleTime = timestamp;
      if (Number.isFinite(interval) && interval > 0) {
        samples.push({ time: timestamp, interval, callbackMs });
      }
      pruneSamples(timestamp);

      const averageInterval = average(samples, 'interval');
      const averageCallback = average(samples, 'callbackMs');
      const renderInfo = renderer?.info?.render ?? {};
      const memoryInfo = renderer?.info?.memory ?? {};
      const cadenceFps = Number.isFinite(averageInterval) && averageInterval > 0
        ? 1000 / averageInterval
        : null;
      const measuredCallbackMs = Number.isFinite(averageCallback) ? averageCallback : callbackMs;
      const drawCalls = Number.isFinite(renderInfo.calls) ? renderInfo.calls : null;
      snapshot = {
        mode,
        cadenceFps,
        fps: cadenceFps,
        frameIntervalMs: Number.isFinite(averageInterval) ? averageInterval : null,
        frameMs: Number.isFinite(averageInterval) ? averageInterval : null,
        callbackMs: measuredCallbackMs,
        callbackDurationMs: measuredCallbackMs,
        drawCalls,
        calls: drawCalls,
        triangles: Number.isFinite(renderInfo.triangles) ? renderInfo.triangles : null,
        geometries: Number.isFinite(memoryInfo.geometries) ? memoryInfo.geometries : null,
        textures: Number.isFinite(memoryInfo.textures) ? memoryInfo.textures : null,
        measuredWindowMs: samples.length ? Math.min(1000, timestamp - samples[0].time) : 0,
      };

      if (timestamp - lastInfoUpdate < 300) return;
      lastInfoUpdate = timestamp;
      metrics[0].value.textContent = mode;
      const scope = mode === 'XR' ? 'stereo frame' : 'desktop frame';
      metrics[4].term.textContent = `Draw calls / ${scope}`;
      metrics[5].term.textContent = `Triangles / ${scope}`;
      metrics[1].value.textContent = Number.isFinite(snapshot.cadenceFps)
        ? `${snapshot.cadenceFps.toFixed(1)} fps`
        : '—';
      metrics[2].value.textContent = Number.isFinite(snapshot.frameIntervalMs)
        ? `${snapshot.frameIntervalMs.toFixed(2)} ms`
        : '—';
      metrics[3].value.textContent = Number.isFinite(snapshot.callbackMs)
        ? `${snapshot.callbackMs.toFixed(2)} ms`
        : '—';
      metrics[4].value.textContent = Number.isFinite(snapshot.drawCalls) ? String(snapshot.drawCalls) : '—';
      metrics[5].value.textContent = Number.isFinite(snapshot.triangles) ? String(snapshot.triangles) : '—';
      metrics[6].value.textContent = Number.isFinite(snapshot.geometries) ? String(snapshot.geometries) : '—';
      metrics[7].value.textContent = Number.isFinite(snapshot.textures) ? String(snapshot.textures) : '—';
    },
    getSnapshot() {
      return { ...snapshot };
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      cadence.wrapper.remove();
      callback.wrapper.remove();
      rendererInfo.remove();
      samples.length = 0;
    },
  };
}
