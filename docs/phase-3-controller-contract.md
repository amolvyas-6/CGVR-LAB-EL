# Phase 3 controller and input contract

`src/xr/controllers.js` owns the tracked-pointer rays, trigger selection, optional stick/face-button input, controller visuals, local model loading, and source diagnostics. It does not decide which grid/action a ray hits or run mission physics.

## Scene-facing API

```js
const controllers = createXRControllers({
  renderer,
  rig,
  hitTest(raycaster),
  onHover(hitOrNull),
  onActivate(hit),
  onScrub(deltaPercentage),
  onShortcut('nextTarget' | 'snap'),
  onProfile(profileStatus),
});

controllers.update(nowMs, deltaSeconds);
controllers.setActive(boolean);
controllers.getDiagnostics();
controllers.destroy();
```

- The rig receives `renderer.xr.getController(0/1)` and `getControllerGrip(0/1)` as separate children. The scene may keep its camera under the same rig and its table/workbench elsewhere.
- Controllers begin active. The scene should set them inactive outside the immersive workbench and active for the XR session. Inactive mode hides controller visuals and suppresses ray hover, activation, shortcuts, and scrubbing; it calls `onHover(null)` to clear any prior mask. Reactivation baselines face-button states so a button held across a mode switch does not fire.
- WebXR `selectstart` is the only trigger activation path. `select` is ignored, and trigger buttons are not polled from Gamepad, preventing duplicate activation. Any connected tracked pointer can activate. Each event performs a fresh pose/raycast; it never selects from the last hover result.
- `hitTest(raycaster)` returns `null` or a borrowed `{object, point, uv, kind, i?, j?, action?, progress?}` hit. Consume its borrowed data synchronously in callbacks; controllers retain only primitive hover identity and copy `point` into their own reticle transform. The reticle follows the current hit and the `-Z` ray ends at hit distance.
- `onHover(hitOrNull)` receives the current borrowed hit only when its identity/cell/action/pointer changes. Right hand is the deterministic hover pointer preference, then left, then unhanded sources. Other pointers still raycast fresh on activation. Disconnect and invalid pose clear hover; after a right disconnect, a usable left ray becomes hover on the next update.
- `onActivate(hit)` runs once for a successful `selectstart`, passing the fresh borrowed hit. `onScrub(deltaPercentage)` reports a progress delta for that XR frame, not a timestamp-based value. Stick rate is 25 percentage points/second with a rescaled 0.18 deadzone and `deltaSeconds` clamped to 0–0.1 seconds.
- Profile callback data is JSON-serializable and has this stable shape:

```js
{
  active: boolean,
  sources: [{
    index: number,
    handedness: 'left' | 'right' | 'none',
    profiles: string[],
    targetRayMode: string,
    profileId: string | null,
    gamepadMapping: string,
    mapping: {
      profileKnown: boolean,
      horizontalAxisIndex: number | null,
      axisMapping: string | null,
      shortcut: 'nextTarget' | 'snap' | null,
      shortcutButtonIndex: number | null,
      shortcutButtonName: 'A' | 'X' | null,
      shortcutAvailable: boolean
    },
    instructions: string[]
  }],
  instructions: string[]
}
```

`getDiagnostics()` returns `{active, sources}` with plain source/profile/mapping fields only; it never exposes Three.js objects, gamepad objects, or mutable matrices.

## Input mappings

- A valid `xr-standard` gamepad with at least four axes maps its thumbstick horizontal axis to index 2. The supported Oculus/Meta Touch profile component layouts also map thumbstick axes 2/3 when at least four axes are present, including when a runtime omits the mapping label.
- Profile-confirmed face shortcuts are limited to `oculus-touch-v2`, `oculus-touch-v3`, and `meta-quest-touch-plus`: right A (button 4) calls `onShortcut('snap')`; left X (button 4) calls `onShortcut('nextTarget')`. They fire once per rising edge. Other profiles—including a generic-trigger fallback—do not get guessed face-button shortcuts. In-world ray buttons remain the universal alternative.
- `handedness: 'none'` sources are ray/trigger-only. Missing, sparse, non-finite, or throwing gamepad values are neutral; button `pressed` booleans take precedence over a numeric value, which must itself be finite.

## Models, ownership, and teardown

The procedural grip is shown immediately with each valid tracked pose. `XRControllerModelFactory` is optional decoration and resolves beneath `${import.meta.env.BASE_URL}xr-profiles`; no CDN fallback is configured. A loader wrapper prevents Three's factory error callback from throwing for absent/malformed profile GLBs. Generic or missing models leave the procedural grip and rays functional.

On disconnect and destroy, controller edge/hover state is cleared. Factory listeners live on owned event proxies, with removable forwarders on renderer-owned grips; destruction detaches the forwarders and invalidates outstanding factory connections. Loaded source GLTF resources are disposed once after shared clones are detached; an asset finishing after destroy is disposed and not handed back to the factory cache. Optional input is suppressed during invalid tracking or session focus loss, with held shortcuts baselined to avoid replay. Per-controller procedural/ray/reticle resources are separately disposed. The renderer, rig, and scene-owned hit targets remain caller-owned.

The input helpers in `src/xr/input.js` are pure and are tested independently. Automated tests use Three groups and a fake renderer/hit-test callback; they verify lifecycle and logic but do not claim actual headset/emulator validation.
