import { VRButton } from 'three/addons/webxr/VRButton.js';

function removeButtonHandlers(button, onEnter, onRetry) {
  if (!button) return;
  button.removeEventListener('click', onEnter, true);
  button.removeEventListener('click', onRetry);
  button.onclick = null;
}

function createManualButton(label, disabled = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'vr-entry-button';
  button.textContent = label;
  button.disabled = disabled;
  return button;
}

function setText(callback, message, status) {
  try {
    callback?.(message, status);
  } catch (error) {
    console.warn('Could not update WebXR entry status.', error);
  }
}

/** Create a user-gesture-only immersive VR entry control with guarded setup. */
export function createVREntry({ renderer, host, onStatus, onSessionState } = {}) {
  if (!renderer?.xr || !host) throw new TypeError('renderer.xr and a VR entry host are required.');

  let disposed = false;
  let currentSession = null;
  let button = null;
  let sessionEndedHandler = null;
  let supportAttempt = 0;
  let sessionActive = false;
  const sessionOptions = { optionalFeatures: ['local-floor', 'bounded-floor'] };

  function updateStatus(message, status = '') {
    setText(onStatus, message, status);
  }

  function publishSessionState(active, session = null) {
    if (sessionActive === active) return;
    sessionActive = active;
    try {
      onSessionState?.(active, session);
    } catch (error) {
      console.error('WebXR session state callback failed.', error);
    }
  }

  function replaceButton(nextButton) {
    if (button) removeButtonHandlers(button, handleEnter, handleRetry);
    button?.remove();
    button = nextButton;
    button.id = 'vr-entry-button';
    button.classList.add('vr-entry-button');
    host.replaceChildren(button);
  }

  function showRetry(message, status = 'warning') {
    if (disposed) return;
    const retry = createManualButton('Retry VR support check');
    retry.addEventListener('click', handleRetry);
    replaceButton(retry);
    updateStatus(message, status);
  }

  async function checkSupport() {
    if (disposed) return;
    const attempt = ++supportAttempt;
    const xr = globalThis.navigator?.xr;
    if (globalThis.isSecureContext === false) {
      replaceButton(createManualButton('VR needs HTTPS', true));
      updateStatus('WebXR requires HTTPS or localhost. The desktop planner remains available.', 'warning');
      return;
    }
    if (!xr || typeof xr.isSessionSupported !== 'function') {
      replaceButton(createManualButton('WebXR unavailable', true));
      updateStatus('This browser does not expose WebXR. Use the desktop planner or a WebXR-capable browser.', 'warning');
      return;
    }

    replaceButton(createManualButton('Checking VR support…', true));
    updateStatus('Checking immersive WebXR support…', 'working');
    let supported;
    try {
      supported = await xr.isSessionSupported('immersive-vr');
    } catch (error) {
      if (disposed || attempt !== supportAttempt) return;
      const reason = error instanceof Error ? error.message : String(error);
      showRetry(`WebXR support check failed: ${reason}. Retry, or continue with the desktop planner.`, 'error');
      return;
    }
    if (disposed || attempt !== supportAttempt) return;
    if (!supported) {
      showRetry('Immersive VR is not available in this browser or device. Retry after enabling a WebXR runtime.', 'warning');
      return;
    }

    // VRButton's built-in offerSession path may start a session without a click.
    // Use its official control only in browsers without that automatic API; in
    // either case this module owns the sole user-gesture requestSession call.
    if (xr.offerSession !== undefined) {
      replaceButton(createManualButton('Enter VR'));
    } else {
      let officialButton;
      try {
        officialButton = VRButton.createButton(renderer, sessionOptions);
      } catch (error) {
        showRetry(`Could not prepare the Three.js VR entry control: ${error instanceof Error ? error.message : String(error)}. Retry, or continue on desktop.`, 'error');
        return;
      }
      if (!(globalThis.HTMLButtonElement && officialButton instanceof globalThis.HTMLButtonElement)) {
        replaceButton(createManualButton('Enter VR'));
      } else {
        officialButton.removeAttribute('id');
        officialButton.type = 'button';
        officialButton.className = 'vr-entry-button';
        replaceButton(officialButton);
      }
    }
    button.disabled = false;
    button.textContent = 'Enter VR';
    button.addEventListener('click', handleEnter, true);
    updateStatus('VR is ready. Enter manually when you are ready; the desktop planner stays available.', 'ready');
  }

  async function handleEnter(event) {
    if (event) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.isTrusted === false) return;
    }
    if (disposed) return;
    if (currentSession) {
      try {
        await currentSession.end();
      } catch (error) {
        restoreAfterSessionError(error);
      }
      return;
    }
    const xr = globalThis.navigator?.xr;
    if (!xr || typeof xr.requestSession !== 'function') {
      showRetry('The WebXR session API became unavailable. Retry the support check.', 'error');
      return;
    }

    button.disabled = true;
    button.textContent = 'Starting VR…';
    updateStatus('Requesting immersive VR session…', 'working');
    let request;
    try {
      // Invoke requestSession before awaiting anything so the headset prompt is
      // still tied to this explicit button gesture.
      request = xr.requestSession('immersive-vr', sessionOptions);
    } catch (error) {
      restoreAfterSessionError(error);
      return;
    }

    let session;
    try {
      session = await request;
      if (disposed) {
        await endSessionSafely(session);
        return;
      }
      currentSession = session;
      sessionEndedHandler = () => {
        if (currentSession !== session) return;
        session.removeEventListener?.('end', sessionEndedHandler);
        sessionEndedHandler = null;
        currentSession = null;
        void Promise.resolve().then(() => {
          if (!disposed) publishSessionState(false, session);
        });
        if (!disposed && button?.isConnected) {
          button.disabled = false;
          button.textContent = 'Enter VR';
          updateStatus('VR session ended. Enter again whenever you are ready.', '');
        }
      };
      session.addEventListener?.('end', sessionEndedHandler, { once: true });

      const enabledFeatures = session.enabledFeatures;
      const hasLocalFloor = enabledFeatures && typeof enabledFeatures.includes === 'function'
        ? enabledFeatures.includes('local-floor')
        : false;
      renderer.xr.setReferenceSpaceType(hasLocalFloor ? 'local-floor' : 'local');
      await renderer.xr.setSession(session);
      if (disposed) {
        await endSessionSafely(session);
        return;
      }
      publishSessionState(true, session);
      button.disabled = false;
      button.textContent = 'Exit VR';
      updateStatus('Immersive VR active. Use controller rays or the profile instructions in the workbench.', 'ready');
    } catch (error) {
      if (session && currentSession === session) {
        session.removeEventListener?.('end', sessionEndedHandler);
        sessionEndedHandler = null;
        currentSession = null;
      }
      if (session) await endSessionSafely(session);
      if (!disposed) restoreAfterSessionError(error);
    }
  }

  function restoreAfterSessionError(error) {
    if (disposed) return;
    const reason = error instanceof Error ? error.message : String(error);
    if (button?.isConnected) {
      button.disabled = false;
      button.textContent = 'Retry VR entry';
    }
    updateStatus(`Could not start immersive VR: ${reason}. Retry, or continue with the desktop planner.`, 'error');
  }

  async function endSessionSafely(session) {
    try {
      if (session && session.end && session.ended !== true) await session.end();
    } catch (error) {
      console.warn('Could not end the WebXR session cleanly.', error);
    }
  }

  function reportSupportCheckFailure(error) {
    if (disposed) return;
    const reason = error instanceof Error ? error.message : String(error);
    showRetry(`WebXR setup failed: ${reason}. Retry, or continue with the desktop planner.`, 'error');
  }

  async function handleRetry(event) {
    event?.preventDefault?.();
    if (disposed) return;
    try {
      await checkSupport();
    } catch (error) {
      reportSupportCheckFailure(error);
    }
  }

  replaceButton(createManualButton('Checking VR support…', true));
  void checkSupport().catch(reportSupportCheckFailure);

  return {
    async exitSession() {
      if (!currentSession) return;
      const session = currentSession;
      try {
        await session.end();
      } catch (error) {
        if (!disposed) updateStatus(`Could not end VR session: ${error instanceof Error ? error.message : String(error)}`, 'error');
      }
    },
    destroy() {
      if (disposed) return Promise.resolve();
      disposed = true;
      supportAttempt += 1;
      let endPromise = Promise.resolve();
      if (currentSession) {
        const session = currentSession;
        if (sessionEndedHandler) session.removeEventListener?.('end', sessionEndedHandler);
        sessionEndedHandler = null;
        currentSession = null;
        publishSessionState(false, session);
        endPromise = endSessionSafely(session);
      }
      removeButtonHandlers(button, handleEnter, handleRetry);
      button?.remove();
      button = null;
      host.replaceChildren();
      return endPromise;
    },
  };
}
