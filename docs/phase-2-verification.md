# Phase 2 verification

Verified on 2026-10-28 with Node.js 26.12.1 and Chromium 156 on Linux.
Browser automation used a temporary Playwright harness and software WebGL;
its frame rate is not a Quest or emulator performance estimate.

## Numerical and build checks

- `npm test`: 12 files, 76 tests pass, including all Phase 1 regressions.
- `TZ=Asia/Kolkata npm test`: the same suite passes outside a UTC timezone.
- `npm run validate:physics`: NASA fixed-date comparisons and independent RK4
  integration pass. C3 differs from the two Table 2 references by less than
  0.5%; independent endpoint errors are below 0.00001 km.
- `npm run build`: production build succeeds. The non-fatal large-chunk warning
  remains (approximately 706 kB minified / 190 kB gzip JavaScript).
- Runtime dependency audit reports no vulnerabilities.
- All 13 supplied context/model/texture files remain unchanged.

The solver is checked against the Curtis worked example, circular Hohmann
reference, explicitly offset near-Hohmann transfers, orbital invariants,
elliptic/parabolic/hyperbolic propagation, backwards time, invalid inputs,
and zero-revolution branch boundaries. Sparse vectors are rejected. Every
Lambert candidate must pass a propagated endpoint-closure check within 1 km
before being returned as valid; extremely ill-conditioned geometry is masked.

## Actual default Mars result

Search: departure 2026-07-01 through 2027-03-01 (UTC), TOF 100–400 days,
60×60 samples. All 3,600 cells are valid in this particular grid.

| Output | Discrete grid minimum |
|---|---|
| Departure UTC | 2026-11-01T13:25:25.423Z |
| Arrival UTC | 2027-09-06T00:48:48.813Z |
| TOF | 308.474576 days |
| Transfer branch | Type II (prograde, long way) |
| Cost proxy | 5.614598 km/s |
| Departure C3 | 9.272877 km²/s² |
| Departure / arrival v∞ | 3.045140 / 2.569459 km/s |

These are computed results, not fixtures displayed by the application. The
minimum is restricted to the configured samples/ranges; it is not a continuous
or global optimum. The proxy is not a parking-orbit or launch-vehicle burn.
The independent NASA comparison uses fixed mission dates and departure C3,
not this grid's different proxy objective. See `numerical-methods.md`.

## Desktop/browser checks

Development and production hosted strictly under `/planner/` pass:

- Real orrery and float-texture porkchop render without uncaught errors.
- Mouse picking and keyboard selection work; opposite plot corners select the
  expected departure/TOF endpoints (including the vertical-axis direction).
- Venus, Mars and Jupiter target presets compute real grids and update results.
- Proxy and C3 budgets share CPU/shader units and feasibility. Budget changes
  do not recompute the grid; a zero proxy budget gives no feasible cell.
- Snap selects the appropriate grid minimum. Invalid budget input keeps Snap
  disabled even after recomputation; feasibility is explicitly unavailable.
- Time scrub, explicit playback, pause, and replay from arrival work. Mission
  dates match the selected departure/arrival. Planet and craft updates share
  that epoch and use ephemeris/propagation, respectively.
- Body-size settings change geometry and the physical/exaggerated-size caption.
- Responsive layouts at 1440×1000, 768×1024 and 390×844 have no horizontal
  overflow. Screenshots inspected; labels and body markers are readable.
- Position-only viewport shrink clears its old pixels (pixel regression check),
  rather than leaving a ghost image under the new layout.
- Single-channel float and RGBA-float modes both render. The RGBA test verifies
  an actual RGBA32F upload, not merely an unchanged alternate page URL.
- Missing Earth imagery retains a visible error despite other successful image
  loads and falls back to a neutral surface without invalidating calculations.
- Unsupported WebGL leaves numerical planning usable and displays the spatial
  failure notice. A test-only failed-solver injection masks all cells and
  disables optimum selection without crashing (development fixture only).
- Normal rendering makes no external runtime HTTP requests.

Independent Luna-high reviews covered numerical conditioning, grids/budgets,
renderer lifecycle and UI state. Findings were corrected by the supervisor and
retested; no reported blocker remains.

## Known limitations / Phase 3 handoff

- Grid generation currently runs synchronously after displaying a computation
  status and pausing playback. With endpoint validation, default grids take
  roughly 0.2–0.35 s on this machine; 120×120 is more expensive. Recheck whether
  a worker is needed to keep the immersive render loop responsive in Phase 3.
- Venus/Jupiter presets can place their minimum at a search boundary. Expand
  the range when exploring beyond the default search; no unrestricted optimum
  is claimed.
- Plot contours are display guides over nearest-sampled costs, not an
  independent continuous optimization or new Lambert solution.
- Body radii and spacecraft markers are visualization aids, with scale disclosed.
  Ephemeris-sampled orbit guides are not exact static Kepler ellipses.
- XR entry, in-world controls/labels, controller mapping and Meta Immersive Web
  Emulator acceptance are Phase 3; none is claimed as tested here.
