# Phase 3 scene and workbench contract

This file records the scene/panel implementation boundary from the approved
Phase 3 plan. The existing desktop planner remains the same renderer and keeps
its Phase 2 method signatures; XR reparents its real plot plane and orrery
content instead of creating a second scientific model.

## Scene API

`createPlannerScene` accepts the existing arguments plus optional
`onXRAction(action)`. Its existing desktop return members remain available:
`renderer`, `render`, `setGrid`, `setBudget`, `setSelection`, `setHover`,
`setTransfer`, `setMissionTime`, `setTarget`, `setBodyScale`, `resetView`,
`getColorRange`, and `destroy`.

The scene additionally returns:

- `xrScene`, `xrCamera`, and `xrRig` for one stereo XR render branch.
- `setImmersive(bool)` to move/restore the shared orrery content group and
  porkchop plane, and disable/restore desktop OrbitControls.
- `updateXR(deltaSeconds, nowMs)` to update active controllers and throttled
  dynamic panel text before the application's physical update.
- `setXRState(snapshot)` to pass plain main-owned metadata only; the workbench
  never reads desktop DOM state or performs mission calculations.
- `getXRDiagnostics()` with the plot's world-space four corners/normal, plot
  shader color range, ray-pickable control IDs/world centers/normals, scale,
  session/reference-space status, and controller diagnostics.

The renderer enables WebXR, requests `local-floor` (with `local` fallback),
sets foveation to 1 when supported, and draws the XR scene once when
`renderer.xr.isPresenting`. XR rendering bypasses desktop bounds measurement,
DOM resize, scissor layout and desktop camera controls. Session start/end and
the explicit scene lifecycle both enter/leave the workbench; reparenting is
idempotent. Destruction restores parents/transforms before scene-owned model
resources are disposed.

## World layout and scale

The default floor-relative layout is defined in `src/xr/layout.js`:

| Element | Center (m) | Size / mapping |
| --- | --- | --- |
| Porkchop chart | `(0.60, 2.02, -1.82)` | `1.42 × 0.90 m` upright |
| Results/time strip | `(0.60, 1.25, -1.80)` | `1.42 × 0.62 m` |
| Mission controls | `(0.60, 0.53, -1.76)` | `1.42 × 0.82 m`, tilted up 18°; separated from results |
| Orrery/table | `(-0.85, 0.73, -1.50)` | horizontal; 0.96 m table radius |

For local-floor, those positions are floor-relative. With viewer-relative
`local`, the stationary layout is lowered by the nominal 1.6 m eye height; the
viewer/controller rig remains at the XR pose with no application locomotion.
The scene does not move the camera to follow selections or time playback.

Venus/Mars use 0.300 m/AU. Jupiter is explicitly fitted to a 0.680 m orbital
radius at 5.204 AU (`0.131 m/AU`); the larger-system control multiplies all
orrery geometry/positions/guides/conic/spacecraft together by 1.35. Planetary
radius mode is separate: existing `setBodyScale` controls exaggerated versus
physical body radii without changing ephemeris or transfer geometry. The
current snapshot's `scaleExaggerated` field represents this body-radius mode;
the optional `modelScaleExaggerated` field represents the whole-model size
toggle. Main should send both booleans when available. The point-light
intensity is scaled by the square of the tabletop metres/AU factor to preserve
inverse-square illumination under the shared group transform.

## Ray hits and actions

`hitTest(raycaster)` returns one reused record with `{object, point, uv, kind,
i, j, action, progress}` or `null`. It clears and reuses its intersections
array; plot cell coordinates are computed into a reused `{i,j}` record.
`kind` is `plot`, `action`, or `time`. The plot uses the Phase 2 plane and UV
orientation. Invalid/masked cells remain selectable. Action meshes and the
timebar use opaque-panel, front-facing placement and do not accept rays through
their backs.

Ray button action IDs and callbacks are:

| Control | Action |
| --- | --- |
| Venus/Mars/Jupiter | `{type:'target', target}` |
| Departure start/end | `{type:'step', field, delta}`; delta is ±7 days |
| TOF min/max | `{type:'step', field, delta}`; delta is ±10 days |
| Grid resolution | `{type:'step', field:'resolution', delta}`; delta is ±10 |
| No budget/cost/C3 | `{type:'budgetType', value}` |
| Budget threshold | `{type:'budgetStep', delta}`; delta is ±0.5 cost or ±5 C3 units |
| Compute, snap, play/pause, scale, radii, reset, exit | `{type:'compute'}`, `{type:'snap'}`, `{type:'play'}`, `{type:'scale'}`, `{type:'radii'}`, `{type:'reset'}`, `{type:'exit'}` |
| Reset mission inputs | `{type:'defaults'}`; explicit recovery of default mission/budget, not automatic computation |
| Plot cell | `onSelect({i,j})`, preserving the plot's canonical row/column mapping |
| Timebar | `{type:'scrub', progress}` with bounded 0–100 progress |
| Horizontal stick | `{type:'scrubDelta', delta}` |
| Profile-confirmed shortcuts | `{type:'nextTarget'}` or `{type:'snap'}` |

The action panels keep target/range/budget editing available without a headset
exit. Invalid mission ranges disable Compute; invalid/no-feasible budgets
disable Snap, and absent selections disable playback/time scrubbing. Budget
threshold controls are disabled for `none`. The panel exposes target presets,
UTC dates, TOF ranges, resolution, budget type/units/threshold, Compute, Snap,
Play/Pause, the 0/100 timebar, model scale, body radii, reset and exit.

The in-world chart includes departure/TOF axes from the current grid, color
legend and values from the same `plot.getColorRange()` used by the shader, plus
selected transfer, hover, feasibility, minimum, progress, controller
instructions, worker/status, telemetry, asset warnings and concise model/scale
disclosures. Canvas labels use local system fonts; no remote font or runtime
asset request is introduced. Canvas textures are repainted only on metadata
changes, with playback/telemetry text throttled to at most 4 Hz.

Hover readout repainting shares that throttle while reticles and cell highlights
remain immediate. Invisible action/time hitboxes use a ray-only layer excluded
from the stereo cameras. The original desktop plot transform is preserved
until entry and restored on exit. At entry the layout's floor/eye-height offset
is synchronized with the actual reference-space choice.

`setXRState` consumes the plan's plain snapshot fields: `inputs`, `budgetInput`,
`budgetValid`, `status`, `hasGrid`, `computing`, `selection`, `hoverSummary`,
`missionDate`, `progress`, `playing`, `canSnap`, `canPlay`, `minimumSummary`,
`assetStatus`, `scaleExaggerated`, and `telemetry`. `modelScaleExaggerated` and
`radiiExaggerated` are accepted as explicit aliases/additions for independent
visual scale state. Mission math, worker state, selected-cell solves and
playback remain owned by the main/application layer.

## Verification boundary

`tests/xr/layout.test.js` is pure layout/math coverage with no renderer/WebGL:
Mars/Venus and Jupiter fitting, whole-model scaling, front-face ray direction,
plane UV bounds, plot grid corners/interior and angular chart fit. The XR
scene itself still requires the supervisor's browser/emulator acceptance:
verify entry/exit/re-entry, stereo eye placement, rays against diagnostic
world-space corners/control centers, and a production-subpath build with the
controller profile assets. No headset or emulator runtime test is claimed by
this scene implementation.
