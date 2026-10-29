# Phase 3: VR-first mission workbench

Status: owner authorized the recommended full in-VR workflow and opted out of further design questions. No Git repository/commits are introduced.

## Intent and scope

VR is the primary experience, not a desktop screen projected onto a plane. Reuse the verified Phase 2 calculations, shader plot and ephemeris orrery in an immersive engineering workbench. Desktop remains a useful fallback. Core mission tuning, inspecting a cell, finding a feasible discrete optimum, and time playback all work without removing the headset.

The approved tabletop approach is the one sensible fit with CONTEXT.md. Merely wrapping the existing desktop interface would fail the VR focus; a free-flying solar-system/game environment would add unwanted locomotion and conflict with the engineering brief.

## Spatial composition (builder choices)

- Quiet instrument-white/steel environment: `#f5f7fa`, white panels, ink `#243348`, steel `#5d6d82`, blue `#245da8`, amber `#b17c45`. Existing blue-to-amber scientific colormap remains unchanged. No stars, decorative cockpit, bloom or postprocessing.
- A horizontal orrery at approximately table height in front/left of the user; a large upright, slightly inward-facing plot to the right; short results and action strips next to the data they describe. Avoid a text-heavy GUI or requiring large head turns. Local system sans, clear sentence-case labels and unit-bearing numeric text, with canvas texture labels at sufficient resolution.
- Default 0.3 m/AU for Venus/Mars. Jupiter uses a disclosed fit scale to keep its orbit within comfortable viewing space. Larger-scale toggle uses the same group scale for planet positions, orbit guides, conic and spacecraft. Exaggerated/physical radii remain separately selectable and disclosed. Scale does not alter physics.
- Camera/controller rig independent of the orrery; local-floor reference where available, local fallback with reasonable eye-height handling. No artificial locomotion or forced camera animation. Exit VR and reset workbench are explicit actions.

## Core controls

Controller trigger rays select plot cells and in-world buttons. A hit reticle and shader hover identify the prospective cell. Thumbstick horizontally scrubs mission progress with a deadzone, dt-based rate and bounded 0–100%. Profile-confirmed face-button shortcuts can cycle target and snap to optimum, with visible instructions; the same actions are always available as ray buttons so unknown profiles remain usable.

Compact in-world mission controls expose Venus/Mars/Jupiter, departure start/end (7-day steppers), TOF min/max (10-day steppers), resolution (bounded steps), budget type and threshold, Compute grid, Snap to optimum, Play/Pause, time bar and endpoints, scale/radii, reset and exit. Draft range changes invalidate the grid immediately; Compute explicitly launches the new search. Budget changes rescan the grid without recomputation. Invalid/no-feasible states disable the relevant actions. Target changes apply the tested presets.

Results disclose selected departure/arrival UTC, TOF, cost proxy (km/s), C3 (km²/s²), v∞ departure/arrival, branch, feasibility, and sampled-grid minimum. Axes and legend are in-world, not HTML overlays. A short model strip says Sun-only, zero-revolution patched-conic transfers and exaggerated radii. Worker/loading and asset errors remain visible inside VR.

## Architecture and responsiveness

One renderer and one setAnimationLoop branch between the two scissored desktop views and a single stereo XR scene. The actual orrery/plot content is reparented, not recalculated or duplicated. World-space labels/controls are separate reusable meshes. Controller models use bundled local WebXR profile assets, with procedural fallback for missing/unknown models. No runtime remote asset/API dependency is added.

The measured 0.2–0.35 s grid pause exceeds the XR frame budget: put grid computation in a module worker with typed-array transfers. Superseded requests and teardown terminate/cancel work; stale replies cannot resurrect obsolete grids. Worker failure is reported, not silently rerun synchronously in VR. Selected-cell solves and throttled spacecraft/ephemeris updates remain on the main thread; measure these rather than prematurely introducing another pipeline.

## Acceptance

- Numerical suite/NASA/RK4 checks remain green; all supplied assets and CONTEXT.md unchanged.
- Controller ray UV mapping at corners/interior, select, invalid masks, scrub deadzone, action edges, disconnect and reentry verified. Resolve mappings from active input source profiles/capabilities, not presumed universal buttons.
- All core tuning/actions and necessary scientific labels usable in VR independently of HTML.
- Worker replacement/cancellation, no-feasible budgets, dirty ranges and failure statuses verified. No grid-induced main-thread stall.
- Enter/exit/reenter actual Meta Immersive Web Emulator, render stereo, restore desktop, and record browser/emulator/profile plus frame cadence, callback duration, draw calls/triangles. If tooling blocks actual extension testing, report that explicitly and provide reproducible manual steps rather than claim acceptance.
- HTTPS/static-subpath production works; no external runtime network requests, no postprocessing and no per-frame new Three vectors/geometries/textures. Emulator performance is not headset performance.
