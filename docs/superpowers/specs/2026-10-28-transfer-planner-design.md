# WebXR Interplanetary Transfer Planner — Design

**Date:** 2026-10-28  
**Status:** Approved by the project owner; implementation starts with Phase 1 only.  
**Source of truth:** `CONTEXT.md` and the project owner's handoff. Where this document proposes a default, it is an agent recommendation for the builder to confirm, not an additional user approval.

## Intent

Create a small, browser-only engineering tool for the Computer Graphics and Virtual Reality course. It will let a user examine Earth-to-planet transfer opportunities with a real ephemeris, a Lambert transfer model, and a porkchop plot, and ultimately explore the selected transfer in a WebXR tabletop visualization. It is a mission-design aid, not a game. There is no backend or runtime API dependency.

The work is intentionally phased: first establish a truthful, testable application shell; then implement and validate the mathematical model; then add the immersive interactions and graphics. In particular, Phase 1 must not imply that a real ephemeris, transfer solver, or porkchop result already exists.

## Goals

- Keep the app simple, browser-based, offline at runtime, and deployable as a static site.
- Establish a real Vite/three.js application and small, testable pure-JavaScript utilities before tackling astrodynamics.
- Use a coherent units/frame boundary and validate the mathematical model against established checks before rendering computed results.
- Make the final VR workflow legible as an engineering instrument: tune mission parameters, inspect costs, and find the discrete minimum.
- Demonstrate computer-graphics work (GLSL, a data texture, ray picking, stereo rendering, and measured performance) in later phases where it can use real data.
- Use the Meta Immersive Web Emulator in Chrome as the primary XR test/demo environment. Lack of a headset is not a blocker; emulator performance must not be presented as a hardware performance guarantee.

## Non-goals

- No game mechanics, backend, database, runtime network APIs, or fabricated scientific results.
- No multi-revolution transfers, gravity assists, low thrust, N-body perturbations, atmospheric entry, or launch-vehicle model.
- No production ephemeris, Lambert solver, propagation, or porkchop computation in Phase 1.
- No post-processing effects in VR or text-heavy in-world forms.
- No commitment to phone/Cardboard WebXR support or a real-headset acceptance test.
- No loading/using the supplied animated GLB as a spacecraft or solar-system simulation; its one animation is intentionally unused.

## Anti-goals (failure conditions)

- A polished-looking plot or planet layout with invented dates, orbits, transfer values, or an apparent optimum.
- Calling `v∞,dep + v∞,arr` a real launch/capture burn or an unqualified “total delta-v.” It is a transfer-cost proxy unless parking-orbit burns are separately modeled.
- Letting an exact 180-degree Lambert singularity, bad cell, or missing texture crash the application.
- Confusing equatorial z with the ecliptic normal, or assuming prograde always means the short-way transfer.
- Shipping an overbuilt framework of empty modules, stubs that throw, or controls that appear functional but do not affect a real computation.
- Broadly changing supplied assets or `CONTEXT.md` as part of this work.

## Constraints and existing material

- The workspace currently contains `CONTEXT.md` and `solar-system-model/`; it is not a Git repository. This design does not initialize Git or change existing assets.
- Existing assets are in `solar-system-model/textures/`: embedded textures numbered 0–10. Textures 9 (Moon) and 10 (Sun) are identified. Textures 0–8 are in the order supplied by the owner; do not use filesystem enumeration order to infer their identities. Texture 6 is provisionally the Saturn ring texture and needs visual confirmation before it is labeled as such.
- `solar-system-model/source/solar_system_animation.glb` is about 10.6 MB, with 22 meshes and one animation. It is deliberately outside the initial preview scope: the app needs small sphere previews and later data-driven bodies, not this animated model.
- The locked stack is JavaScript, Vite, pinned three.js, WebXR, the Meta Immersive Web Emulator, `astronomy-engine` for offline ephemeris, and an in-house universal-variable Lambert solver. No replacement of those decisions without asking.
- All physical calculations use km, km/s, seconds, and a consistent inertial frame internally. Convert library AU/AU-day output at the ephemeris boundary. Dates crossing the UI boundary are UTC.
- Desktop is available for development. The emulator is the primary XR demo/test target; there is no headset available.

## Approaches considered

1. **Thin functional scaffold — selected.** Establish the runnable Vite/three.js app, minimal preview scene, shared state/subscription helper, pure physics constants/unit helpers with tests, and explicit unavailable states for all unimplemented science. This produces a useful base without pretending to calculate anything. Its limitation is that it is intentionally not yet an end-to-end mission planner.
2. **Visual mockup with sample plot/orbits — rejected.** It could look closer to the destination quickly, but sample values and orbital guides would be throwaway or could be mistaken for real results. That conflicts with the engineering-tool intent and would make the scaffold less reusable.
3. **Build the physics first, then the shell — rejected for this build.** It delays validating the deployment/rendering foundation and conflicts with the approved three-phase sequence. Math remains isolated and is the focus of Phase 2.

The owner approved the three-phase sequence and selected the functional scaffold over a throwaway visual mockup. The concrete mechanics and visual details below—including layout, preview arrangement, and UI defaults—are recommendations for the builder, not user-approved design specifications.

## Phased scope

### Phase 1 — truthful functional scaffold (most detailed)

**Purpose:** Prove the project runs, has a maintainable boundary between UI/rendering and pure calculations, and can display supplied texture assets without misrepresenting their meaning.

**Recommended implementation scope**

- JavaScript + Vite; pin the selected three.js version in `package.json`; use Vitest for the small pure-helper tests. Do not introduce TypeScript, a UI framework, a backend, or other dependencies without a concrete need.
- A desktop browser application with a three.js canvas and `OrbitControls`. Create an XR-ready camera rig/layout and use `renderer.setAnimationLoop`; do not use a separate `requestAnimationFrame` loop. XR entry, `VRButton`, controllers, and immersive interaction are Phase 3.
- A restrained desktop engineering layout: canvas/preview plus a compact parameter/status area and a reserved plot region. This is a proposal, not a locked visual design. Prefer readable labels and an explicit data state over decorative sci-fi styling.
- Show the current supplied textures as a **static asset/texture preview**, in an explicitly labeled row or equivalent neutral arrangement. It is a texture/material preview—not an orrery, not to scale, and not a claim about planetary positions. Do not draw orbit lines or position bodies as if they were at a date. This gives the later orrery a clean replacement path without inventing ephemeris data.
- Inspect a contact sheet or equivalent visual preview before assigning body names to textures 0–8. Preserve the owner's supplied ordering in any manifest; do not derive names from directory listing order. Label 6 as provisional until verified. 9 and 10 may be identified as Moon and Sun. Missing or unsupported textures should degrade to a neutral material and a visible asset status, not crash startup.
- Keep the GLB unused. If a later request calls for it, assess it separately; its size, mesh count, and animation do not make it a source of trustworthy ephemeris or an appropriate Phase 1 orrery.
- The plot region must say plainly that the porkchop plot is unavailable until Phase 2. Result/optimum fields must show “not computed” or equivalent. No sample grid, fake contours, invented transfer date, numeric cost, min marker, or “best launch” output.
- If simple target/date/TOF inputs are included, their explicit state is draft input only and the UI must say those values do not yet calculate a transfer. No Phase 1 control should imply that the target changes positions or that a budget mask exists. The builder may instead defer those controls; keep whichever choice simpler and honest.
- Add only useful, working helpers: immutable/frozen physical constants; small day/second conversion functions; and a small shared state helper with snapshot/update/subscribe/unsubscribe semantics. Keep physics helpers in plain JS modules with **no three.js dependency**. Avoid generalized state frameworks, empty future solver files, and throwing placeholders.
- Keep future-phase filenames and detailed interfaces in this design rather than creating runnable empty modules. Add a module only when it contains real behavior and tests. This avoids misleading imports and fake APIs.
- Validate UTC handling at the UI boundary. A recommended low-level contract is explicit conversion between day counts and seconds (`86,400` seconds/day), with date parsing/formatting in UTC rather than local time. Select exact initial date endpoints only when Phase 2 needs them; “around late 2026” is the contextual Mars-window suggestion, not a license to invent a computed launch opportunity.
- Suggested small structure (the builder may adjust names to fit Vite conventions):

  ```text
  index.html
  vite.config.js
  package.json
  src/
    main.js                 # startup, renderer, camera rig, desktop controls, animation loop
    app/state.js            # small shared state and subscriptions
    physics/constants.js    # frozen constants only
    physics/units.js         # pure unit/date-boundary helpers
    scene/assetPreview.js    # static, explicitly non-ephemeris preview
    styles.css
  tests/
    physics/units.test.js
    physics/constants.test.js
  ```

  `physics/` remains independent of `three`. Keep DOM/UI code small; there is no requirement to create a component system for a few controls and status labels.

**Phase 1 acceptance**

1. A clean install, Vite development server, and production build succeed; the app loads in a desktop browser without console errors.
2. The three.js scene resizes with the viewport, desktop `OrbitControls` work, and the render loop uses `setAnimationLoop`.
3. The preview visibly labels itself as a static asset preview, contains no asserted orbital positions/orbit guides, and does not load the GLB. Unverified texture names are not presented as fact.
4. The plot/output area is visibly unavailable/not computed; no fake numerical output or fabricated scientific visualization is present.
5. Pure helper tests cover seconds/day conversions, UTC boundary behavior if implemented, constants immutability, and meaningful invalid-input cases. The physics helper modules import and run without three.js.
6. State updates notify subscribers, unsubscribe works, and state is not silently mutated by consumers. Keep this test proportional to the tiny helper.
7. No solver, ephemeris, propagator, worker, shader plot, controller input, or `VRButton` is implemented in this phase.

### Phase 2 — ephemeris and validated transfer computation

Implement real numerical behavior and a useful desktop planner before adding XR interaction:

- Add `astronomy-engine` as the offline ephemeris source. Verify exact API names, units, date convention, and frame against its documentation. Convert positions and velocities to km and km/s once at this boundary; obtain heliocentric planet velocity consistently (barycentric planet state minus Sun, or the documented finite-difference alternative). Never mix frames.
- Add a universal-variable, zero-revolution Lambert solver, Stumpff functions, transfer-cost calculation, porkchop grid and discrete-minimum search, and transfer-arc propagation as implemented, tested modules. Keep them pure where possible and independent of three.js.
- Establish transfer direction from the chosen inertial/ecliptic reference plane and its normal. Do not take equatorial z as the ecliptic normal. Prograde does not universally imply short-way; direction/short-way selection must be explicit and reviewed against the coordinate frame.
- Treat the exact 180-degree Lambert case as singular/invalid (NaN/masked result) rather than hiding it with an undocumented nudge. Validate near-Hohmann transfers, and keep a separate analytic circular/coplanar Hohmann calculation as a reference check. The zero-revolution solve must stay on the correct branch below the `4π²` z singularity; it must not jump into a multi-revolution branch.
- Units and model assumptions remain: patched conics, Sun-only two-body transfer arc, impulsive burns, single revolution, no perturbations, planets as point masses at their ephemeris positions.
- Compute `v∞,dep`, `v∞,arr`, and `C3 = v∞,dep²`. Label `v∞,dep + v∞,arr` everywhere as a **transfer-cost proxy** in km/s, not a launch/capture delta-v. The recommended plot colour and minimum-search objective is this proxy. Preserve the context's budget options with an explicitly labelled budget type: proxy limit in km/s or departure C3 limit in km²/s². Budget mode only changes feasibility, not the cost objective. Report both the unconstrained grid minimum and, when a budget is enabled, the lowest-proxy feasible cell; say "no feasible transfer" if none qualifies. Parking-orbit burns remain out of the core unless specifically requested.
- Store failed solves as `NaN`; the plot masks them and rendering remains safe. Identify the minimum as a **discrete grid minimum**, not a continuous/global optimum.
- Recommended initial grid is the context's approximately 60×60 cells. Recompute only when a relevant input changes. Do not add a worker absent a measured desktop hitch.
- Integrate actual values into the desktop UI only after the numerical tests below pass. Phase 2 owns the data-driven desktop orrery (replacing the asset preview), orbit guides, shader/DataTexture plot, axes, cost contours, budget mask, pointer hover/cell picking, selected transfer arc, and spacecraft animation. Planet and spacecraft positions share the same mission time. Phase 3 reuses these visuals in XR rather than implementing them again. Keep any status for uncomputed/stale work explicit.

**Phase 2 verification and acceptance**

- Analytic Hohmann fixture for circular, coplanar 1 AU / 1.524 AU orbits: approximately 259 days, departure `v∞` about 2.9 km/s, arrival `v∞` about 2.6–2.7 km/s, with a few-percent tolerance, as in `CONTEXT.md`.
- Lambert results for valid cases propagate from `(r1, v1)` to `r2` at TOF within a documented numerical tolerance; energy and angular momentum consistency are checked.
- Exact 180-degree input and invalid/bracketing cases are invalid/masked without throwing. Near-Hohmann cases remain finite and plausible. Explicit tests cover the zero-revolution branch boundary and prevent crossing the `4π²` singularity into an unintended revolution branch.
- Ephemeris wrapper tests/fixtures check units, date handling, frame consistency, and the Sun-relative velocity construction. API-specific assumptions are verified from library documentation, not inferred from naming.
- Earth–Mars porkchop over the selected late-2026-centered window has a plausible type-I region and grid minimum (qualitatively consistent with a published comparable plot); invalid values remain `NaN` and do not poison the min search or render.
- Displayed cost, C3, dates, and budgets match the selected grid cell and expose the proxy/model assumptions. Tests distinguish proxy and C3 budget units/feasibility and cover an empty feasible set. “Optimum” snapping names its discrete-grid meaning and uses the feasible minimum when a budget is active.

### Phase 3 — WebXR and immersive engineering interaction

- Add the three.js `VRButton`, XR entry/exit lifecycle, controllers and controller models, ray interaction, hover/selection, and the agreed in-world interaction for selecting a plot cell and changing target/time or snapping to the discrete minimum.
- Adapt the Phase 2 data-driven desktop orrery and selected transfer/spacecraft display to a comfortable tabletop XR arrangement. Keep body exaggeration/scale disclosure visible; use consistent scaling across orrery and trajectory.
- Use in-world canvas/3D labels for information needed in XR; do not rely on HTML overlays as in-world controls. Desktop may retain conventional DOM controls as a fallback.
- Resolve controller mappings from the actual XR input sources and their profiles/capabilities; do not assume the same universal physical button across devices. Confirm the Meta Quest profile through the Chrome Immersive Web Emulator. A Cardboard phone is not assumed to expose a compatible WebXR session.
- Use one `renderer.setAnimationLoop` for desktop and XR. Reuse geometry/materials and avoid per-frame object allocation. Avoid VR post-processing. Reuse Phase 2's GLSL plot, float `DataTexture`, budget rendering, and UV-to-cell conversion; extend hover/picking to controller rays and verify stereo behavior against real Phase 2 data.
- Add measured FPS/frame time, draw calls, and triangle counts (`renderer.info`) for the actual emulator setup. Emulator measurements describe that laptop/emulator combination only. Real hardware can be an optional later confidence check, not a gate for this project given the no-headset constraint.

**Phase 3 verification and acceptance**

- Enter and exit immersive VR in the Meta Immersive Web Emulator without errors; the scene remains usable in desktop mode.
- Verify controller ray-to-UV-to-grid-cell mapping at plot corners and interior cells, hover feedback, selected-cell update, and invalid-cell masking. Verify inputs against the active controller profile rather than a presumed universal layout.
- Selected transfer, body positions, date, TOF, cost proxy, and animated spacecraft remain coherent when selection or time changes. Labels disclose scale exaggeration and physical simplifications.
- Capture emulator measurements and record device/browser/profile, scene conditions, FPS/frame time, and `renderer.info` counts. Do not generalize emulator FPS to a Quest or phone.
- Confirm no post-processing in XR and no regression in the Phase 2 numerical validation suite.

## Proposed architecture and boundaries

The data flow should follow the context's intended direction:

```text
astronomy-engine -> ephemeris boundary (UTC date, AU/AU-day -> km/km/s; one frame)
                 -> Lambert transfer -> v-infinity and C3
                 -> date/TOF grid -> Float32Array with NaN invalid cells
                 -> desktop/XR plot, selected cell, trajectory and scene
```

The app shell owns renderer, scene, camera rig, desktop controls, and state wiring. UI and scene code consume state/results but do not implement astrodynamics. Physics modules consume plain numeric inputs and return plain results; they do not import three.js. Rendering converts those results into reusable geometries/materials. Phase 1 contains only the shell, state helper, constants/unit helpers, and non-ephemeris asset preview. Phase 2 adds numerical modules when implemented, not empty placeholders. Phase 3 adds XR-specific input/rendering around the tested Phase 2 result model.

Recommended shared-state helper is intentionally small: an initial snapshot; a getter; a patch/update operation that replaces rather than mutates the snapshot; `subscribe(listener)` returning an unsubscribe function; and notification after successful state replacement. Do not make this a general event framework. Keep computed results distinguishable from draft parameters, and never derive displayed scientific results from UI defaults alone.

## Engineering UX and proposed defaults

- Use explicit status copy: **asset preview, not ephemeris** in Phase 1; **plot/results unavailable—not computed** until Phase 2; then disclose model assumptions and transfer-cost proxy alongside numeric results.
- The project context proposes Mars as the initial target, a departure window around late 2026, Mars TOF roughly 100–400 days, and about 60×60 grid resolution. Treat these as starting recommendations from `CONTEXT.md`; exact date endpoints and visual/control mechanics remain builder decisions. Do not show calculated launch dates before Phase 2.
- Target options in context are Venus, Mars, and Jupiter with Earth as departure origin. Do not promise other targets in the initial workflow.
- In XR, maintain a clear relationship between the plot cell, selected departure/arrival dates, the trajectory, and the orrery. A budget boundary is a labelled proxy or departure-C3 threshold, not a launch-system capability guarantee.
- Suggested desktop/XR composition (proposal only): orrery as the spatial overview, porkchop panel large enough to read/pick cells, and a compact result strip. The Phase 1 texture preview should not imitate this composition with invented planetary positions.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| User mistakes preview assets or placeholder plot for real mission data | Explicit asset-preview label; no orbital guides or data-like colors; no fake numeric results or optimum. |
| Texture identity inferred from directory ordering | Preserve supplied 0–8 order, make a visual contact sheet before labeling, and keep texture 6 provisional until confirmed. |
| AU/AU-day, UTC/day/second, or frame mismatch | Convert once at ephemeris boundary; keep UTC parsing explicit; pure unit tests; verify library docs and frame. |
| Lambert singularities, bad bracketing, or wrong revolution branch | Separate analytic Hohmann reference, near-Hohmann validation, exact 180-degree masking, and explicit zero-revolution boundary tests. |
| “Total delta-v” proxy mistaken for an actual burn budget | Label the sum of departure/arrival `v∞` values as transfer-cost proxy throughout UI, mask, and report. |
| Emulator results mistaken for hardware performance | Report measured environment and do not claim emulator FPS predicts Quest/phone performance; real hardware is not a blocker. |
| XR input differences or unavailable phone WebXR | Resolve input profiles at runtime and target the confirmed emulator profile; do not promise Cardboard compatibility. |
| Float texture incompatibility | Implement capability checks in Phase 2 and test the XR target in Phase 3; use an explicit supported fallback (e.g. RGBA float/half-float as appropriate) without corrupting invalid-cell masking. |
| Premature optimization or throwaway complexity | Keep grid on main thread initially; move to a worker only after a measured hitch; do not use the GLB or create empty future modules. |

## Decisions left to the builder

These are implementation choices, not new product approvals; record any consequential choice in code/docs and preserve the constraints above:

- Exact pinned Vite/three.js/Vitest versions and the small adjustments to the suggested directory layout.
- Phase 1 visual style, precise desktop panel arrangement, whether the honest draft controls are included, and how texture 0–8 identities are visually verified. Do not infer asset names from file ordering.
- Exact date-range endpoints around the late-2026 Mars-centered starting window when Phase 2 needs them; date-range values must be presented as inputs, not as discovered opportunities.
- Exact numeric tolerances, Lambert bracketing strategy, convergence criteria, and acceptable ephemeris fixtures, documented alongside tests and validated against the references in `CONTEXT.md`.
- The coordinate-frame/prograde convention after confirming `astronomy-engine` output conventions; the frame normal and short/long-way choice must be explicit.
- Whether a measured Phase 2 grid delay warrants a worker; actual emulator-supported float texture format/fallback; and the measured XR composition/scale needed for legibility.
- Final controller-to-action mapping based on the input profile actually exposed by the emulator, with discoverable labels/instructions in-world.

Do not reopen the locked stack, offline `astronomy-engine`, own single-revolution universal-variable Lambert approach, patched-conic scope, no-backend constraint, or emulator-first demo path without asking the owner.
