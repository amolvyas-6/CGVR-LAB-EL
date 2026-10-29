# Project Context: WebXR Interplanetary Transfer Planner

> Context file for an AI coding agent. Read fully before making changes. Section 12 lists decisions that are already made and should not be reopened without asking the user.

## 1. Summary

A browser-based VR (WebXR) tool for the course **Computer Graphics and Virtual Reality**. The user tunes mission parameters (target planet, departure window, time of flight, delta-v budget) and the scene shows, in real time:

1. A **porkchop plot** (departure date x time of flight, coloured by transfer cost).
2. A **tabletop orrery** with planet positions from real ephemeris data.
3. The **transfer trajectory** for the selected cell, with an animated spacecraft.
4. The **minimum-cost launch window**, found automatically.

It is **not a game**. It is an engineering tool: tune parameters, read the result, find the cheapest solution.

Owner: Amol, software engineering student at RVCE, Bengaluru. Solo project, no VR headset available. Development and demo go through an emulator, screen recordings, and optionally a phone + Google Cardboard or a borrowed Quest.

## 2. Goals and non-goals

**Goals**

- Very simple, easy to implement, small codebase, no backend.
- Visible computer graphics work: custom GLSL shader, DataTexture, raycast picking, stereo rendering, measured performance.
- Credible, standard mission-design workflow (Lambert + porkchop).
- Runs from a static host (GitHub Pages / Netlify / Vercel, HTTPS).

**Non-goals (do not build unless asked)**

- Gravity assists, multi-revolution Lambert, low-thrust trajectories.
- N-body perturbations, atmospheric entry, launch vehicle modelling.
- Any server, database, or external API calls at runtime.
- Post-processing effects (bloom, SSAO) in VR.
- In-VR text-heavy GUI. Primary controls are ray-picking and thumbstick.

## 3. Tech stack

| Layer                   | Choice                                                      |
| ----------------------- | ----------------------------------------------------------- |
| Language                | JavaScript (TypeScript optional)                            |
| Rendering               | three.js (pin the version in package.json)                  |
| Build / dev server      | Vite (localhost is a secure context, so WebXR works in dev) |
| VR entry                | `VRButton` from `three/addons/webxr/VRButton.js`            |
| Controllers             | `renderer.xr.getController()`, `XRControllerModelFactory`   |
| Ephemeris               | `astronomy-engine` (npm)                                    |
| Lambert solver          | Own implementation (universal variables), no dependencies   |
| Debug UI (desktop only) | `lil-gui`                                                   |
| Perf                    | `stats.js` and `renderer.info`                              |
| Testing                 | Vitest (or plain Node scripts) for the solver               |
| Hosting                 | GitHub Pages / Netlify / Vercel                             |

**VR testing without a headset:** Meta Immersive Web Emulator Chrome extension (WebXR tab in DevTools, pick a Quest profile). The emulator runs on a laptop GPU, so its FPS does not predict Quest or phone performance. Verify at least once on real hardware (phone + Cardboard, or a borrowed headset).

## 4. Data and file formats

- **No data files required.** Planet states come from `astronomy-engine` at runtime (bundled in the page, no network).
- Planet textures (optional): small JPG/PNG, 1024 or 2048 px max. KTX2 only if needed.
- Star background: procedural `Points`, or a small texture.
- Shaders: `.glsl` / `.vert` / `.frag` imported as strings with Vite `?raw`.
- Porkchop data: a `Float32Array` of size `N_dep * N_tof`, uploaded as a single-channel float `DataTexture` (fall back to `RGBA` float if `RedFormat` float is problematic on the target device).
- No 3D model files needed. Planets are spheres, orbits and trajectories are line geometries.

## 5. Architecture

```
astronomy-engine --> planet position r and velocity v at date t
                         |
Lambert solver <---------+   (r1 at t_dep, r2 at t_dep + TOF)
      |
v_inf_dep, v_inf_arr --> C3 and total delta-v
      |
grid over (t_dep, TOF), about 60 x 60 --> Float32Array
      |
DataTexture + colormap/contour fragment shader --> porkchop panel
      |
controller ray picks a cell --> draw transfer conic + animate spacecraft
```

### Suggested file structure

```
vr-transfer-planner/
  index.html
  vite.config.js
  package.json
  src/
    main.js              renderer, scene, XR setup, animation loop
    ephemeris.js         wrapper over astronomy-engine, returns km and km/s
    lambert.js           universal-variable Lambert solver
    transfer.js          delta-v / C3 computation for one (t_dep, TOF)
    porkchop.js          grid generation, min search, Float32Array
    propagate.js         Lagrange f,g propagation to sample the transfer arc
    scene/orrery.js      Sun, planets, orbit lines, scale handling
    scene/porkchop.js    textured plane + ShaderMaterial + picking
    scene/trajectory.js  transfer arc line + spacecraft marker
    xr/controllers.js    rays, select events, thumbstick time scrub
    shaders/porkchop.frag.glsl
    shaders/porkchop.vert.glsl
    utils/perf.js
  tests/
    lambert.test.js
```

## 6. Physics and math (single-revolution, patched-conic, impulsive burns)

### Constants and units

- Work in **km and km/s internally**, convert once at the ephemeris boundary.
- `AU = 149597870.7 km`
- `mu_sun = 1.32712440018e11 km^3/s^2`
- `mu_earth = 398600.4418 km^3/s^2`, Earth radius about 6378 km (for the optional parking-orbit burn)
- `astronomy-engine` returns positions in AU (and velocities in AU/day where state vectors are provided). Verify exact function names and units against the library docs before coding: `HelioVector(body, date)` for heliocentric position, `BaryState(body, date)` for barycentric position and velocity. A planet's heliocentric velocity is `BaryState(planet) - BaryState(Sun)`. Alternatively finite-difference `HelioVector` over a small time step.
- Lambert is frame-independent as long as the frame is inertial and consistent. Use the library's default frame throughout and do not mix frames.

### Per-cell computation

For departure date `t_dep` and time of flight `TOF`:

1. `r1, v_planet1` = departure planet state at `t_dep`; `r2, v_planet2` = target planet state at `t_dep + TOF`.
2. Solve Lambert for `r1, r2, TOF` (prograde, short way chosen by sign of `(r1 x r2).z` relative to motion; pick the direction consistent with prograde heliocentric motion). Get transfer velocities `v1, v2`.
3. `v_inf_dep = |v1 - v_planet1|`, `v_inf_arr = |v2 - v_planet2|`.
4. Report `C3 = v_inf_dep^2` and `total_dv = v_inf_dep + v_inf_arr` (simple metric).
5. Optional: convert to a burn from a circular parking orbit of radius `r_p`: `dv = sqrt(v_inf^2 + 2*mu/r_p) - sqrt(mu/r_p)`. Same idea for capture at the target.
6. Invalid or failed solves are stored as `NaN` (rendered as masked/transparent).

### Lambert solver (universal variables, Curtis Algorithm 5.2 / Bate-Mueller-White)

Outline:

- `A = sin(dtheta) * sqrt(r1*r2 / (1 - cos(dtheta)))`, with `dtheta` from the prograde/retrograde choice.
- Stumpff functions `C(z)`, `S(z)` with series or closed forms handling `z > 0`, `z < 0`, `z ~ 0`.
- `y(z) = r1 + r2 + A*(z*S(z) - 1)/sqrt(C(z))`
- Solve `F(z) = (y/C)^1.5 * S + A*sqrt(y) - sqrt(mu)*TOF = 0` for `z` by Newton or bisection. Require `y > 0`. Bracket carefully; bisection is safer than Newton for a first version.
- `f = 1 - y/r1`, `g = A*sqrt(y/mu)`, `gdot = 1 - y/r2`
- `v1 = (r2 - f*r1)/g`, `v2 = (gdot*r2 - r1)/g`
- Known trouble: transfer angle near 180 degrees (singular `A`); return `NaN` or nudge slightly. Izzo's method is a stretch-goal upgrade for robustness.

### Trajectory sampling

Propagate `(r1, v1)` with Lagrange f and g functions (universal variable form) for N time steps up to `TOF` to get points for the arc line and the spacecraft position.

### Known simplifications (state these in the report)

Patched-conic approximation, impulsive burns, two-body sun-only transfer arc, single revolution, no perturbations or planetary gravity wells during the transfer, planets treated as point masses at their ephemeris positions.

## 7. Parameters the user can tune

| Parameter                         | Notes                                                  |
| --------------------------------- | ------------------------------------------------------ |
| Target planet                     | Venus / Mars / Jupiter (Earth is the origin)           |
| Departure date range              | Default: a window around late 2026 for Mars            |
| TOF range                         | Mars default roughly 100 to 400 days                   |
| Delta-v / C3 budget               | Rendered as a contour or masked region on the porkchop |
| Parking orbit altitude (optional) | Converts v_inf to a departure burn                     |
| Grid resolution                   | Default 60 x 60, adjustable                            |
| Display scale                     | Planet size exaggeration, true-scale toggle            |

Outputs: minimum-cost cell (departure date, TOF, arrival date), delta-v, C3, an "optimum" snap button, and live values for the selected cell.

Context: Earth to Mars opportunities occur about every 26 months, and one opens around late 2026, which makes the default window topical.

## 8. VR interaction design

- **Tabletop orrery** about 1 AU = 0.3 m, placed in front of the user, with a toggle for larger scale.
- **Porkchop panel** as a large plane beside the orrery (wall or table).
- **Controller ray** intersects the panel, UV maps to grid cell `(i, j)`, selecting departure date and TOF. A reticle shows the hover cell.
- **Thumbstick** scrubs time. **Buttons** switch target planet and trigger "snap to optimum".
- Selected cell drives the trajectory arc and spacecraft animation in the orrery.
- Camera and controllers are children of a rig `Group` (dolly) so the player can be moved.
- Use `renderer.setAnimationLoop`, never `requestAnimationFrame`.
- Desktop fallback: `OrbitControls` + `lil-gui` for development outside VR.

## 9. Computer graphics content (for syllabus mapping)

- Custom GLSL fragment shader: colormap, iso-contours (`fract`/`smoothstep`), budget mask, hover highlight.
- `DataTexture` upload of simulation data.
- Raycasting and UV picking.
- Emissive Sun, orbit line shading, optional simple glow.
- Stereo-correct rendering through WebXR, foveation via `renderer.xr.setFoveation(1)`.
- Measured performance report: FPS, frame time, draw calls and triangles from `renderer.info`.

## 10. Performance expectations

- Scene is tiny: a few spheres, a few lines, one textured plane, so only a handful of draw calls.
- Compute cost is the porkchop grid: 3,600 Lambert solves at 60 x 60, expected well under a second in JS (estimate, to be measured). Recompute only when the target planet or ranges change. Move to a Web Worker only if there is a visible hitch.
- VR frame budget is about 11 to 14 ms (72 to 90 Hz on Quest 2, 90 Hz on Quest 3). Do not allocate objects (`new Vector3()`) inside the animation loop. Reuse geometry and materials, and `dispose()` anything removed.
- Avoid post-processing in VR.

## 11. Implementation steps (brief)

1. **Scaffold**: Vite + three.js, renderer with `xr.enabled`, `VRButton`, animation loop, desktop `OrbitControls`.
2. **Ephemeris**: `ephemeris.js` returning `{r, v}` in km, km/s for any planet and date. Place Sun and planets, draw orbit lines, add a date slider.
3. **Lambert solver**: `lambert.js` plus unit tests (see validation below). Do not proceed until tests pass.
4. **Transfer cost**: `transfer.js` computing `v_inf` values, C3, total delta-v for one cell.
5. **Porkchop grid**: `porkchop.js` filling a `Float32Array`, finding the minimum cell.
6. **Porkchop panel**: `DataTexture` + `ShaderMaterial` (colormap, contours, budget mask), axes and labels, hover reticle.
7. **Trajectory**: `propagate.js` samples the arc for the selected cell, draw as a line, animate the spacecraft.
8. **WebXR interaction**: controllers, ray picking on the panel, thumbstick time scrub, buttons for target and optimum, tabletop scale. Test in the Immersive Web Emulator.
9. **Extras**: more target planets, parking-orbit burn, compare mode (design A vs B), optimum snap.
10. **Measure and document**: FPS and `renderer.info` screenshots, emulator screen recording, deploy to HTTPS host, write the report.

## 12. Validation (must pass)

- **Hohmann check**: for circular, coplanar Earth and Mars orbits (a = 1 AU and 1.524 AU), the solver should reproduce roughly: TOF about 259 days, departure v_inf about 2.9 km/s, arrival v_inf about 2.6 to 2.7 km/s. These are textbook approximations; allow a few percent tolerance.
- Energy and angular momentum of the resulting conic are consistent: propagating `(r1, v1)` for `TOF` lands on `r2` within tolerance.
- Porkchop for Earth to Mars shows the characteristic island pattern near a launch opportunity, and the minimum sits in a plausible TOF range (roughly 200 to 300 days for a type I transfer). Compare qualitatively against published porkchop plots for the same window (for example the Tudat Earth-Mars porkchop example).
- Failed solves produce `NaN` and never crash rendering.

## 13. Decisions already made (do not change without asking)

- three.js + WebXR + Meta Immersive Web Emulator extension.
- Interplanetary transfer planner based on Lambert and porkchop plots (user's own "rocket launch to multiple planets using ephemeris data" idea, refined).
- `astronomy-engine` for ephemeris (offline, no API), not JPL Horizons.
- Own universal-variable Lambert solver, not the `lambert-orbit` npm package (heavy mathjs dependency, quality unchecked).
- Single-revolution, impulsive, patched-conic model only.
- No backend, no game mechanics.

## 14. Risks

| Risk                                         | Mitigation                                                         |
| -------------------------------------------- | ------------------------------------------------------------------ |
| Lambert bugs near 180 degree transfers       | Hohmann test, `NaN` masking, optional Izzo upgrade later           |
| Unit and frame mix-ups (AU vs km, days vs s) | Convert once at the ephemeris boundary, use km and km/s everywhere |
| VR scale (planets tiny vs orbits)            | Exaggerated body sizes, scale toggle                               |
| Float texture support on some devices        | Fall back to RGBA float or half-float texture, test on a phone     |
| Emulator FPS not representative              | Check on a phone or borrowed Quest before the final demo           |

## 15. References

- Astronomy Engine: https://github.com/cosinekitty/astronomy
- Porkchop plots and Lambert's problem (KSP forum): https://forum.kerbalspaceprogram.com/topic/156655-porkchop-plots-and-lamberts-problem
- Tudat Earth-Mars porkchop example: https://tudat-space.readthedocs.io/en/latest/_src_getting_started/_src_examples/notebooks/mission_design/earth_mars_transfer_window.html
- Textbook: H. Curtis, Orbital Mechanics for Engineering Students (Lambert, universal variables, Stumpff functions)
