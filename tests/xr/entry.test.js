import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVREntry } from '../../src/xr/entry.js';

function setup() {
  let click;
  const host = {
    querySelector: () => button,
  };
  const button = {
    parentNode: host,
    classList: { add: vi.fn() },
    addEventListener: vi.fn((_event, handler) => { click = handler; }),
    removeEventListener: vi.fn(),
  };
  const xr = Object.assign(new EventTarget(), {
    isSessionSupported: vi.fn().mockResolvedValue(true),
    requestSession: vi.fn(),
  });
  const renderer = {
    xr: { setReferenceSpaceType: vi.fn(), setSession: vi.fn(), setReferenceSpace: vi.fn() },
  };
  vi.stubGlobal('navigator', { xr });
  vi.stubGlobal('isSecureContext', true);
  const onSessionState = vi.fn();
  const entry = createVREntry({ renderer, host, onSessionState });
  return { entry, xr, button, renderer, onSessionState, click: (isTrusted = true) => click({ isTrusted }) };
}

function sessionFor(space) {
  const session = Object.assign(new EventTarget(), {
    requestReferenceSpace: vi.fn().mockImplementation(async () => {
      if (!space) throw new Error('Floor space unavailable');
      return space;
    }),
    end: vi.fn().mockImplementation(async () => {
      session.dispatchEvent(new Event('end'));
    }),
  });
  return session;
}

afterEach(() => vi.unstubAllGlobals());

describe('VR entry', () => {
  it('starts from one trusted gesture, uses floor space and reenters with a local fallback', async () => {
    const { entry, xr, renderer, button, click, onSessionState } = setup();
    const space = new EventTarget();
    const floorSession = sessionFor(space);
    const localSession = sessionFor(null);
    xr.requestSession.mockResolvedValueOnce(floorSession).mockResolvedValueOnce(localSession);

    await vi.waitFor(() => expect(button.textContent).toBe('Enter VR'));
    click(false);
    expect(xr.requestSession).not.toHaveBeenCalled();
    click();
    click();
    expect(xr.requestSession).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(button.textContent).toBe('Exit VR'));
    expect(renderer.xr.setReferenceSpaceType).toHaveBeenCalledWith('local');
    expect(renderer.xr.setReferenceSpace).toHaveBeenCalledExactlyOnceWith(space);
    expect(onSessionState).toHaveBeenLastCalledWith(true, floorSession, 'local-floor');

    await entry.exitSession();
    expect(onSessionState).toHaveBeenLastCalledWith(false, floorSession);
    expect(button.textContent).toBe('Enter VR');

    click();
    await vi.waitFor(() => expect(button.textContent).toBe('Exit VR'));
    expect(onSessionState).toHaveBeenLastCalledWith(true, localSession, 'local');
    expect(renderer.xr.setReferenceSpace).toHaveBeenCalledTimes(1);
    await entry.destroy();
    expect(localSession.end).toHaveBeenCalledTimes(1);
  });

  it('recovers when the runtime closes the session during renderer setup', async () => {
    const { entry, xr, renderer, button, click, onSessionState } = setup();
    const session = sessionFor(null);
    xr.requestSession.mockResolvedValue(session);
    renderer.xr.setSession.mockImplementation(() => session.end());

    await vi.waitFor(() => expect(button.textContent).toBe('Enter VR'));
    click();
    await vi.waitFor(() => expect(renderer.xr.setSession).toHaveBeenCalledWith(session));
    expect(button.textContent).toBe('Enter VR');
    expect(onSessionState).not.toHaveBeenCalled();
    await entry.destroy();
  });

  it('keeps the active session retryable after a rejected exit', async () => {
    const { entry, xr, button, click, onSessionState } = setup();
    const session = sessionFor(null);
    session.end.mockRejectedValueOnce(new Error('Session busy'));
    xr.requestSession.mockResolvedValue(session);
    await vi.waitFor(() => expect(button.textContent).toBe('Enter VR'));
    click();
    await vi.waitFor(() => expect(button.textContent).toBe('Exit VR'));

    await entry.exitSession();
    expect(button.textContent).toBe('Exit VR');
    expect(onSessionState).toHaveBeenCalledTimes(1);
    await entry.exitSession();
    expect(button.textContent).toBe('Enter VR');
    expect(onSessionState).toHaveBeenLastCalledWith(false, session);
    await entry.destroy();
  });
});
