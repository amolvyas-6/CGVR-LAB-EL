# Phase 2 desktop renderer contract

This document is the integration boundary between the Phase 2 renderer and the
application shell. The renderer owns the data-driven orrery, selected transfer
geometry, scientific porkchop shader, one WebGL canvas, and desktop picking. The
main module owns UI/state, numerical grid generation, transfer solving and
propagation, visible scientific labels/axes/legend, performance monitoring,
and the animation loop. XR, `VRButton`, and controller input are Phase 3 and are
not part of this API.

## Factory and returned API

```js
import { createPlannerScene } from './scene/plannerScene.js';

const planner = createPlannerScene({
  surface,                 // shared relative graphics container
  orreryViewport,          // transparent DOM input viewport
  plotViewport,            // transparent DOM input viewport
  onSelect,                // optional ({ i, j }) => void
  onHover,                 // optional ({ i, j } | null) => void
  onAssetStatus,           // optional status callback, shape below
  textureFormat: 'red',    // optional: 'red' (default) or 'rgba'
});
```

The factory returns:

```ts
{
  renderer: THREE.WebGLRenderer,
  render(): void,
  setGrid(grid: PorkchopGrid | null): void,
  setBudget(budget: { type: 'none' | 'cost' | 'c3', limit?: number }): void,
  setSelection(cell: { i: number, j: number } | null): void,
  setHover(cell: { i: number, j: number } | null): void,
  setTransfer(transfer: Transfer | null, samples: TrajectorySamples | null): void,
  setMissionTime(epochMs: number, spacecraftPositionKm: [number, number, number] | null): void,
  setTarget(target: 'venus' | 'mars' | 'jupiter', departureMs: number): void,
  setBodyScale(exaggerated: boolean): void,
  resetView(): void,
  getColorRange(): { min: number, max: number } | null,
  destroy(): void
}
```

`getColorRange()` is an additional read-only helper for the DOM legend. It
returns the exact proxy-cost limits currently supplied to the fragment shader,
or `null` before a grid is installed. `renderer.setAnimationLoop` is **not**
called here. The main module calls it once and calls `planner.render()` from
that loop.

Construction throws if WebGL2 is unavailable, required DOM elements are
missing, or the requested float-texture mode cannot be supported. Let the
application's existing renderer-unavailable handler report that failure. A
missing *body image* is non-fatal and is reported through `onAssetStatus`.

## DOM and CSS contract

`surface` is the shared graphics container. Both viewport elements must be
descendants of it, have measurable non-zero dimensions, and be laid out where
their rendered views should appear. Keep labels, axis text, controls, and the
plot legend in adjacent DOM elements, not inside either input viewport. The
plot viewport's bounds define the UV picking rectangle.

```html
<div class="planner-surface">
  <div
    class="orrery-viewport"
    tabindex="0"
    role="group"
    aria-label="Ephemeris orrery. Use arrows to rotate, plus or minus to zoom, and Home to reset."
  ></div>
  <div
    class="plot-viewport"
    tabindex="0"
    role="group"
    aria-label="Porkchop plot. Use arrow keys to move the hover cell and Enter to select it."
  ></div>
</div>
<div class="plot-axes-and-legend">
  <!-- DOM-owned axis labels, color legend, and keyboard instructions -->
</div>
```

The module appends exactly one WebGL canvas to `surface`. The following styles
are required (adapt dimensions/layout to the page, but preserve positioning,
stacking, transparency, and pointer behavior):

```css
.planner-surface {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
  gap: 1rem;
  min-height: 26rem;
  overflow: hidden;
  isolation: isolate;
  /* Keep padding/borders on an outer wrapper, not on this measured surface. */
}

.planner-surface > canvas {
  position: absolute;
  inset: 0;
  z-index: 0;
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.orrery-viewport,
.plot-viewport {
  position: relative;
  z-index: 1;
  min-width: 0;
  min-height: 24rem;
  background: transparent;
  touch-action: none;
}

.orrery-viewport { cursor: grab; }
.orrery-viewport:active { cursor: grabbing; }
.plot-viewport { cursor: crosshair; }
```

The viewports must remain transparent so the shared canvas is visible below
them; do not put an opaque background on either viewport. Give the surface a
positioned containing block, and avoid padding/borders on it so DOM bounds and
the canvas inset share the same origin. A `ResizeObserver` watches the surface
and both viewports. The renderer also reads their DOM rectangles on render to
handle position-only layout changes; page scrolling needs no canvas translation
because the canvas is local to `surface`.

## Data shapes and meanings

### Grid

`setGrid(grid)` consumes the Phase 2 numerical grid:

```ts
{
  config: object,
  departureCount: number,
  tofCount: number,
  costs: Float32Array,
  c3: Float32Array,
  departureEpochs: Float64Array, // `epochs` is also accepted
  tofDays: Float64Array
}
```

Arrays are row-major: `index = j * departureCount + i`; `i` is departure/x and
`j` is TOF/y. `v = 0` is the lowest TOF (bottom edge). The grid's `NaN` values
remain untouched in CPU memory. Upload copies replace non-finite or negative
values with finite `-1` invalid sentinels; the shader masks those sentinels and
never relies on GPU NaN comparisons. Texture sampling is nearest-neighbor,
with no mipmaps, `flipY = false`, and `NoColorSpace`.
Invalid cells remain transparent, but selected/hovered invalid cells still
show their outline so the main module can explain why no transfer is drawn.

`textureFormat: 'red'` uploads single-channel `RedFormat` float data. The
`'rgba'` compatibility mode copies each source value to the red channel of an
RGBA float texel (other channels are `0, 0, 1`); the shader reads `.r` in both
modes. This is a WebGL2 texture-sampling path and does not require float
render-target support. Unsupported WebGL2/texture dimensions fail rather than
silently corrupting cell validity.

The plot is a discrete inspection surface, not a bilinear scientific
interpolator. Clicking or keyboard-selecting returns the exact grid cell; shader
contours are visual guides computed from the nearest-sampled proxy cost and do
not create intermediate transfer solutions.

### Selection, hover, and callbacks

Cells passed to `setSelection`, `setHover`, `onSelect`, and non-null `onHover`
are `{ i, j }`, with zero-based integer indices. `setSelection(null)` and
`setHover(null)` clear their outlines. A missing/out-of-range cell also clears
that outline. Installing a new grid clears old selection and hover because the
indices belong to the previous grid.

- `onHover({ i, j })` fires only when the hovered cell changes.
- `onHover(null)` fires when pointer hover leaves the plot, or when a grid
  replacement invalidates an existing hover.
- `onSelect({ i, j })` fires on a plot click with at most 5 CSS pixels of
  pointer movement, or Enter while the plot has a hovered cell. It does not
  include a computed cell or invoke numerical work.
- Keyboard arrows move the hover cell: left/right change departure `i`,
  down/up change TOF `j`; movement clamps to grid edges. Enter selects.
- Ctrl/Meta modified keys are left to the browser/application.

The main module resolves callbacks with the existing grid helpers, updates the
selected transfer, and then calls the setters below. The renderer never solves
a transfer or computes a porkchop cell.

### Budget and color legend

`setBudget` accepts `{ type: 'none' }`, `{ type: 'cost', limit }`, or
`{ type: 'c3', limit }`. `cost` compares the **transfer-cost proxy**
`v∞,dep + v∞,arr` in km/s; `c3` compares departure C3 in km²/s². The proxy is
always the plot color and minimum-search objective. A budget only changes
feasibility; above-limit cells remain visible and pickable but are dimmed.

`getColorRange()` returns `{ min, max }` in the cost unit `km/s`. `min` is the
smallest finite, non-negative cost. `max` is capped at the 95th percentile when
that gives a wider range than the minimum; it falls back to the true maximum
when needed. A constant-valued grid gets a readable positive range extension.
The main module should use these exact two numbers for its legend. The
blue-to-amber stops, in order, are `#315f86`, `#83adbf`, `#e8cc88`, `#c77e39`.
Above-range values map to the top stop. The legend must label proxy cost, not
delta-v.

### Transfer, spacecraft, time, and target

`setTransfer(transfer, samples)` expects the real numerical result and
`sampleTrajectory` result, with km positions:

```ts
transfer: { valid: boolean, target?: string, /* transfer result fields */ }
samples: { valid: boolean, points: [number, number, number][] }
```

The trajectory is the sampled propagated two-body conic, not a straight
interpolation. Invalid/missing transfer or sample data, a target mismatch, or a
non-finite point immediately hides both the old arc and spacecraft marker; an
old valid arc is never retained under a new cell. The final sample is expected
to coincide with the target at arrival within the propagation solver's
documented tolerance. The marker is a small visualization marker, not a
spacecraft model and not evidence of velocity/thrust.

`setMissionTime(epochMs, spacecraftPositionKm)` takes a valid Unix-millisecond
epoch and the already-propagated heliocentric spacecraft position in km (or
`null`). Orrery bodies update only when the epoch changes; the spacecraft marker
updates only for a finite 3-vector and a currently valid transfer, otherwise it
is hidden. Call this when mission time/propagation state changes (typically
10–30 Hz or less), not from every render callback.

`setTarget(target, departureMs)` takes case-insensitive `venus`, `mars`, or
`jupiter` and the selected departure epoch in Unix milliseconds. It updates the
visible target, rebuilds target/Earth guides, resets the mission scene to that
departure, clears the current transfer, and frames the current target's orbit.
Guides contain 128 actual ephemeris samples across approximate periods
(Earth 365.256 d, Venus 224.701 d, Mars 686.98 d, Jupiter 4332.59 d), beginning
at the selected departure. They are not analytic fixed Kepler ellipses. Guides
are rebuilt only when target or departure changes, never while scrubbing scene
time. The Jupiter frame includes the roughly 5.2 AU orbit.

Texture maps are loaded only for the visible Sun, Earth, and selected target,
and unused target maps are released on target changes. Earth uses supplied map
2, Venus 1, Mars 3, Jupiter 4, and the self-lit Sun uses 10. Missing images
leave a neutral body surface and report an error; no other supplied texture is
guessed as a planetary map. Callback payload:

```ts
onAssetStatus?.({
  assetId: 'earth', // 'sun', 'earth', 'venus', 'mars', or 'jupiter'
  label: 'Earth',
  status: 'loading' | 'ready' | 'error',
  message: string
});
```

The Sun is self-lit and point-lights the planets, with soft ambient fill. Body
sizes default to exaggerated and must be disclosed by the UI. Calling
`setBodyScale(false)` restores each mapped body's physical radius while keeping
1 scene unit = 1 AU; at that setting the planets are expected to be nearly
invisible. Scene coordinates convert fixed heliocentric J2000 mean-ecliptic
vectors from km as `[x / AU, z / AU, -y / AU]`, preserving a right-handed
rotation into Three.js Y-up coordinates.

## Recommended main-module call order

1. Create the DOM surface and two viewport elements, then construct the planner
   once. The constructor creates the initial Mars view and default-date guides.
2. When numerical computation completes, call `setGrid(grid)` and
   `setBudget(budget)`, then read `getColorRange()` to update the DOM legend.
3. Resolve the selected grid cell in the main module. Call `setTarget(target,
   selectedDepartureMs)` before installing that cell's transfer, then call
   `setSelection({ i, j })` and `setTransfer(transfer, samples)`.
4. Call `setMissionTime(epochMs, spacecraftPositionKm)` whenever the scene time
   or propagated spacecraft state changes. Invalid selections must call
   `setTransfer(null, null)` (or pass invalid records) to clear the old arc.
5. Use `renderer.setAnimationLoop(() => planner.render())` as the only render
   loop. A main-owned performance monitor reads `renderer.info` after
   `planner.render()`.
6. Before unloading/HMR teardown, stop the main-owned animation loop, then call
   `planner.destroy()` exactly once (it is idempotent).

Changing budget, hover, or selection does not rebuild the grid. Changing only
mission time does not rebuild orbit guides. `setTarget` clears a transfer when
its target/departure inputs change; selection changes should always replace or
clear transfer data explicitly.

## Renderer and lifecycle guarantees

- One `THREE.WebGLRenderer`, two `THREE.Scene`s, an orrery camera rig, a
  perspective orrery camera, and an orthographic plot camera. Viewports use
  renderer viewport/scissor rectangles; the shared transparent canvas is
  pointer-inert and sits below both active DOM input elements.
- The renderer is alpha-enabled, XR-disabled, and capped at device pixel ratio
  1.5. It does not call `setAnimationLoop`, use post-processing, or create
  controller/XR objects.
- `renderer.info.autoReset` is false. `render()` resets the counters once, then
  draws both viewports so reads after that call aggregate their draw calls and
  triangles.
- Render-time layout checks allocate no Three.js vectors. Resize observation,
  texture loads, pointer listeners, controls, geometries, materials, and
  textures are disposed by `destroy()`. Stale asynchronous texture completions
  are disposed rather than attached after a target change or teardown.
- The entire transparent surface is cleared before drawing scissored viewports,
  so moved or shrunken viewports cannot leave old pixels behind. Exaggerated
  body/label sizes adapt to target-orbit framing; physical radii do not.
- Orrery keyboard controls are bound to the orrery DOM viewport: arrows rotate,
  `+`/`=` and `-` zoom, Home resets. Modifier-key combinations are ignored.
  `OrbitControls` is bound to that viewport, not the full-size WebGL canvas.

Known Phase 2 visualization limitations: the body radii are exaggerated unless
the true-size control is active; ephemeris guides are sampled visual guides;
plot contours are display aids over discrete nearest-sampled cell values; and
the spacecraft marker communicates position only. No visual element changes
the numerical model or constitutes a continuous optimum.
