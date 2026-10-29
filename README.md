# Interplanetary Transfer Planner

A VR-first engineering workbench for examining Earth-origin transfer opportunities to Venus, Mars, and Jupiter. The immersive scene combines a discrete porkchop plot, an ephemeris orrery, the selected Lambert transfer and spacecraft, budget feasibility, and the sampled-grid minimum. Desktop remains a complete fallback.

## Requirements and local use

- Node.js `^22.12.0`, `^24.0.0`, or `>=26.0.0`
- npm
- A modern WebGL2 browser; immersive VR additionally requires WebXR and a secure context

```sh
npm install
npm run dev
```

For a production build and local preview:

```sh
npm run build
npm run preview
```

Vite uses a relative base, so the production build can be hosted below a static-site subpath. Serve immersive VR over HTTPS (or localhost during development). Mission ephemerides, controller profile models, and grid-worker code are bundled or served from this site; there is no backend, external runtime API, or remote controller-model request. Porkchop grids run in replaceable module workers: if a worker cannot start or fails, the app reports the error and lets you retry rather than blocking the main thread with a synchronous fallback.

## Entering and testing VR

1. Open the app in Chrome with the **Meta Immersive Web Emulator** extension enabled for this site, then reload. Choose **Meta Quest 3** in the emulator controls; IWE 2.0 uses an in-page overlay, while older releases use DevTools → WebXR. Oculus/Quest Touch profiles are also supported by the input mapping.
2. Use the prominent **Enter VR** button in the page header and accept the browser's immersive-session prompt. The page is not entered automatically.
3. In the headset/emulator view, aim a controller ray at a workbench control and press its trigger. Hovering a plot cell previews the date, TOF, cost proxy, and feasibility; triggering a valid cell selects and propagates it.
4. Controller profile instructions appear in the workbench. Verified Touch profiles provide a horizontal thumbstick scrub, left **X** target-cycle shortcut, and right **A** snap shortcut. Ray buttons provide the same core actions for unknown or unrecognized profiles; optional shortcuts are not guessed.
5. Exit with the in-world **Exit VR** control or the header button. The desktop scissored views and display settings are restored. Playback starts paused and pauses on VR entry or grid recomputation.

The emulator is useful for exercising session entry, controller events, stereo rendering, and the in-world workflow, but its frame rate is not a Quest performance measurement. Actual extension/headset acceptance must be recorded separately; this README does not claim that an emulator run has passed.

## VR mission workflow

- Earth is the origin. Choose **Venus**, **Mars**, or **Jupiter**. Target presets set TOF bounds (Venus 80–220 days, Mars 100–400 days, Jupiter 450–1200 days); these are search bounds, not predicted opportunities.
- Use the in-world date and TOF steppers (7- and 10-day increments), grid-resolution steps (2–120 per axis), and **Compute grid**. A draft range change immediately marks and clears the old grid; compute explicitly to start the replacement. A target shortcut also leaves a dirty draft until Compute is selected.
- Set a transfer-cost-proxy budget (`v∞,dep + v∞,arr`, km/s) or departure-C3 budget (`v∞,dep²`, km²/s²). Budget edits rescan feasibility and the discrete optimum without recomputing the porkchop values. No-feasible and invalid-budget states are shown and disable Snap as appropriate.
- **Snap to optimum** selects the lowest-cost feasible sampled cell when a budget is active, otherwise the unconstrained minimum. Select another valid plot cell to inspect departure/arrival UTC, TOF, cost proxy, C3, departure/arrival v∞, transfer branch, and feasibility.
- **Play/Pause** or the in-world time bar animates the transfer. Planet positions and spacecraft propagation use the same mission epoch. Thumbstick scrubbing is dead-zoned, time-based, and bounded to the transfer interval.
- The workbench includes larger/fit scale, exaggerated/physical body radii, reset, and exit controls. The standard display is about 0.3 m/AU for Venus and Mars; Jupiter uses a disclosed fit scale. Scale and radius choices affect only visualization, not physics.
- **Reset mission inputs** explicitly restores the Mars defaults and clears the budget, including recovery from malformed desktop drafts without leaving VR. Compute afterwards. **Reset scale** restores the visualization settings; it does not move or recenter the headset.
- Results include both the unrestricted and budget-feasible discrete grid minimum, including the no-feasible case. The scene also discloses the Sun-only, zero-revolution patched-conic model, asset errors, worker status, active controller instructions, and mode-aware rendering telemetry.

## Desktop fallback

The browser page retains the original mission form and workflow. Choose inputs and **Compute grid**; click or keyboard-select the porkchop plot to inspect a propagated cell. Arrow keys move plot hover and Enter selects; the orrery responds to arrow keys, `+`/`−` zoom, and Home resets its desktop camera. Desktop budget, time scrub/playback, and Snap controls operate on the same application state as the in-world controls. A WebGL/WebXR failure leaves numerical mission computation available.

## Model and interpretation

The model uses a heliocentric J2000 mean-ecliptic frame, km and km/s, offline `astronomy-engine` ephemerides, zero-revolution (single-pass) universal-variable Lambert solutions, and Sun-only two-body propagation. It assumes patched conics, impulsive maneuvers, point-mass planets, and no perturbations or planetary gravity wells during flight. It does not model parking-orbit burns. The proxy is not an unqualified total delta-v or a launch-system capability.

The Lambert implementation masks exact collinearity and transfer angles within approximately `1e-7` radians of collinearity; ill-conditioned geometries remain invalid rather than being silently nudged. Every candidate must propagate to within 1 km of its requested endpoint. See [numerical methods and validation scope](docs/numerical-methods.md) for details and references.

The porkchop plot samples a discrete grid. Its contours are visual guides over cell values, not continuous solutions. The plot uses a float `DataTexture`; `?textureFormat=rgba` selects the RGBA-float compatibility upload.

## Local controller assets

Touch and generic-trigger glTF controller models are served from `public/xr-profiles/` by Three.js `XRControllerModelFactory`; it is configured not to use its default CDN. These selected, unmodified assets come from `@webxr-input-profiles/assets@1.0.20` and are MIT licensed. The attribution and license are in `public/xr-profiles/README.md` and `public/xr-profiles/LICENSE.md`. Unknown devices retain ray/trigger interaction and a procedural grip fallback.

## Development checks

```sh
npm test
npm run validate:physics
npm run benchmark:grid
npm run build
```

Physics validation and the benchmark are not GPU or headset performance claims. The browser telemetry reports callback duration (not GPU time), measured cadence/frame interval, and renderer draw calls, triangles, geometry, and texture counts. The debug-only read-only harness is available at `?debugXR=1` as `window.__plannerXRDiagnostics()`; it is absent by default and exposes no action or mutation API.

## Phase boundaries

- **Phase 1:** desktop shell and supplied-asset preview.
- **Phase 2:** validated numerical transfers and the real-data desktop planner.
- **Phase 3:** in-world mission controls and results, controller interaction, module-worker replacement, manual WebXR entry, and mode-aware measurements.

Testing is paused at the owner's request. Further browser/VR validation will use the MCP server supplied in a later session, followed by immersion and interaction changes based on owner feedback. See [Phase 3 handoff](docs/phase-3-handoff.md) and the [VR demonstration guide](docs/vr-demo-guide.md). Full immersive acceptance is not claimed.
