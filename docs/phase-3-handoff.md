# Phase 3 handoff — implementation ready, immersive validation deferred

## Owner's direction

The project is VR-focused. The owner approved the full core workflow inside VR,
then explicitly requested that browser/emulator testing stop for this session.
A later session will receive an MCP server for website testing; immersion and
interaction changes will follow the owner's hands-on feedback. Do not resume
the previous browser test campaign without that authorization.

## Implemented

- Single WebXR stereo workbench with the actual shared orrery/trajectory and
  shader/DataTexture plot, not duplicated or fabricated scientific data.
- In-world parameters, chart axes/legend, results/minima, status, model/scale
  disclosures, controller instructions, and telemetry.
- Controller trigger picking, reticles, profile-aware horizontal stick scrub,
  confirmed Touch A/X shortcuts, and ray-button alternatives.
- Target/date/TOF/resolution/budget tuning, compute, optimum snap, playback/time
  bar, whole-model scale, body radii, reset and exit actions inside VR.
- Explicit Reset mission inputs recovers malformed drafts. Reset scale does
  not recenter or move the headset.
- Replaceable module-worker grid computation with typed-array transfers,
  cancellation, stale-reply protection, retryable errors and no synchronous
  fallback. The mathematical model and budget semantics are unchanged.
- Guarded manual WebXR entry, desktop restoration, local controller models and
  procedural fallback, with lifecycle/disposal fixes from Luna-high reviews.

## Verification status

Earlier implementation checkpoints passed 114 unit tests, production build,
and NASA/RK4 physics validation. A standalone browser worker check matched the
default Mars minimum and kept main-thread timers running during computation.
Exploratory entry with the actual Meta Immersive Web Emulator 2.0 / Quest 3
profile produced a stereo render. This is **not full VR acceptance**: controller
E2E, reentry, final layout/interaction, production-subpath and performance
acceptance remain pending.

After the owner paused testing, remaining known integration issues were fixed:
invalid-draft recovery, selection-failure messages in XR, reference-space
offset synchronization, separating overlapping panels, throttling hover canvas
updates, restoring desktop plot transforms, resetting telemetry between modes,
and excluding invisible ray hitboxes from rendering. Those final edits were
not followed by another test/build run, in accordance with the pause. Rebuild
before production deployment; an earlier dist build may not contain final edits.

## Resume later

Use the owner-provided MCP server to inspect the website and actual interactions.
Validate entry/exit/reentry, cell corners and invalid-cell behavior, core mission
controls, time coherence, budgets/minimum selection, worker cancellation/errors,
desktop restoration and readable comfortable labels. Capture performance only
with the actual test environment disclosed; emulator FPS is not Quest FPS.

Then prioritize the owner's requested immersion/interactivity changes rather
than treating the current layout as final. Preserve CONTEXT.md, the scientific
constraints, supplied textures/model, and the numerical validation suite.

Useful files: `src/main.js`, `src/xr/{entry,workbench,controllers,input,layout,textPanel}.js`,
`src/scene/plannerScene.js`, `src/app/{gridService,missionActions}.js`,
`src/workers/porkchop.worker.js`, and `docs/vr-demo-guide.md`.

The development URL is `http://127.0.0.1:5173/` when the Vite server is running.
`?debugXR=1` exposes a read-only diagnostic function for future harness use.
Temporary browser scripts/screenshots remain under `/tmp/opencode/cgvr-browser-check/`;
they are not part of the shipped application.
