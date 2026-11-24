const SESSION_OPTIONS = { optionalFeatures: ['local-floor'] };

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/** Own one button and one immersive session, requested only from a user gesture. */
export function createVREntry({ renderer, host, onStatus, onSessionState } = {}) {
  if (!renderer?.xr || !host) throw new TypeError('renderer.xr and a VR entry host are required.');

  const xr = globalThis.navigator?.xr;
  const button = host.querySelector('button') ?? document.createElement('button');
  button.id = 'vr-entry-button';
  button.classList.add('vr-entry-button');
  button.type = 'button';
  if (button.parentNode !== host) host.replaceChildren(button);

  let state = 'checking';
  let supportAttempt = 0;
  let current = null;
  let attaching = null;
  let disposed = false;

  function render(nextState, label, message, kind = '') {
    if (disposed) return;
    state = nextState;
    button.textContent = label;
    button.disabled = ['checking', 'unavailable', 'starting', 'ending'].includes(state);
    onStatus?.(message, kind);
  }

  function ready(message = 'Immersive VR is available.') {
    render('ready', 'Enter VR', message, 'ready');
  }

  async function checkSupport() {
    const attempt = ++supportAttempt;
    if (globalThis.isSecureContext === false) {
      render('unavailable', 'VR needs HTTPS', 'Open the planner on HTTPS or localhost to use WebXR.', 'warning');
      return;
    }
    if (typeof xr?.isSessionSupported !== 'function') {
      render('unavailable', 'WebXR unavailable', 'Open the planner in a browser with immersive WebXR support.', 'warning');
      return;
    }
    render('checking', 'Checking VR support…', 'Checking for an immersive VR runtime…');
    try {
      const supported = await xr.isSessionSupported('immersive-vr');
      if (disposed || attempt !== supportAttempt) return;
      if (supported) ready();
      else render('retry', 'Check VR again', 'Connect a headset or enable the WebXR emulator, then check again.', 'warning');
    } catch (error) {
      if (disposed || attempt !== supportAttempt) return;
      render('retry', 'Check VR again', `WebXR support check failed. ${errorMessage(error)}`, 'error');
    }
  }

  function onDeviceChange() {
    if (['checking', 'ready', 'retry'].includes(state)) void checkSupport();
  }

  async function closeSession(session) {
    try {
      await session.end();
    } catch (error) {
      console.warn('Could not close the WebXR session.', error);
    }
  }

  async function attachSession(record) {
    const { session } = record;
    // Discover floor space by requesting it. Some runtimes omit enabledFeatures.
    let floorSpace = null;
    try {
      floorSpace = await session.requestReferenceSpace('local-floor');
    } catch {
      // Immersive VR also supplies a viewer-relative local space.
    }
    if (disposed || current !== record) return;
    renderer.xr.setReferenceSpaceType('local');
    await renderer.xr.setSession(session);
    if (disposed || current !== record) return;
    if (floorSpace) renderer.xr.setReferenceSpace(floorSpace);
    record.active = true;
    onSessionState?.(true, session, floorSpace ? 'local-floor' : 'local');
    render('active', 'Exit VR', 'VR is active. Use the controller rays to explore the workbench.', 'ready');
  }

  async function startSession() {
    render('starting', 'Starting VR…', 'Waiting for the immersive VR session…');
    let record = null;
    try {
      // Call requestSession before the first await to keep the user gesture.
      const session = await xr.requestSession('immersive-vr', SESSION_OPTIONS);
      if (disposed) {
        await closeSession(session);
        return;
      }
      record = { session, active: false };
      current = record;
      session.addEventListener('end', () => {
        if (current !== record) return;
        current = null;
        // Three.js also handles this event and restores its desktop framebuffer.
        queueMicrotask(() => {
          if (record.active) onSessionState?.(false, session);
          if (!disposed && current === null && state !== 'starting') ready('VR session ended.');
        });
      }, { once: true });
      const pending = attachSession(record);
      attaching = pending;
      try {
        await pending;
      } finally {
        attaching = null;
      }
      if (!disposed && current === null && state === 'starting') ready('VR session ended.');
    } catch (error) {
      if (record && current === record) {
        current = null;
        await closeSession(record.session);
        if (record.active) onSessionState?.(false, record.session);
      }
      render('ready', 'Retry VR entry', `Could not start VR. ${errorMessage(error)}`, 'error');
    }
  }

  async function exitSession() {
    if (disposed || state !== 'active' || !current) return;
    const record = current;
    render('ending', 'Exiting VR…', 'Closing the immersive VR session…');
    try {
      await record.session.end();
    } catch (error) {
      if (current === record) render('active', 'Exit VR', `Could not exit VR. ${errorMessage(error)}`, 'error');
    }
  }

  function onClick(event) {
    if (disposed || event.isTrusted === false) return;
    if (state === 'ready') void startSession();
    else if (state === 'active') void exitSession();
    else if (state === 'retry') void checkSupport();
  }

  button.addEventListener('click', onClick);
  xr?.addEventListener?.('devicechange', onDeviceChange);
  void checkSupport();

  return {
    exitSession,
    async destroy() {
      if (disposed) return;
      disposed = true;
      button.removeEventListener('click', onClick);
      xr?.removeEventListener?.('devicechange', onDeviceChange);
      if (attaching) await attaching.catch(() => {});
      if (current) {
        const { session } = current;
        current = null;
        await closeSession(session);
      }
    },
  };
}
