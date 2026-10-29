# Numerical methods and physical assumptions

This note records the implemented Phase 2 numerical pipeline, its physical
assumptions, and reproducible validation checks. Desktop/browser verification
is recorded separately; numerical closure is not a claim about real mission
accuracy.

## Ephemeris boundary

`src/physics/ephemeris.js` exports:

- `getPlanetState(body, date) -> { r, v }`, with `r` and `v` plain three-number
  arrays in km and km/s.
- `getPlanetPosition(body, date) -> [x, y, z]` in km.
- `FRAME`, human-readable metadata for the output frame, and
  `PROGRADE_NORMAL`, the frozen `[0, 0, 1]` normal for positive angular
  momentum in that frame.

The supported names are Sun and Mercury through Neptune (all eight scene
planets); Pluto is supported as well. Names are case-insensitive. Moon is not
part of this boundary. Each call requires a valid JavaScript `Date` object,
representing a UTC instant. In particular, Unix-millisecond numbers must not
be passed through: Astronomy Engine interprets numeric date inputs as UT days
since noon on 2000-01-01, not as Unix milliseconds. UI/grid epochs may remain
Unix milliseconds internally, but callers convert them to `Date` objects at
this boundary.

Astronomy Engine 2.1.19 documents `HelioState` as a Sun-relative state in J2000
mean equator coordinates (EQJ). Its `StateVector` components are AU for
position and AU/day for velocity. `getPlanetState` applies the fixed
`Rotation_EQJ_ECL()` matrix using `RotateState`, which rotates both components,
then converts with the shared `auToKm` and `auPerDayToKmPerSecond` helpers.
Position-only requests use `HelioVector` followed by `RotateVector` and
`auToKm`. The destination is ECL: fixed, right-handed J2000 mean-ecliptic
axes. This is not the date-varying ecliptic-of-date frame.

This convention makes positive `z` the ecliptic north normal. Prograde motion
therefore has positive `(r × v) · PROGRADE_NORMAL`. The normal does not imply
that every prograde Lambert transfer takes the short-way path; the transfer
solver must make its direction/path choice explicitly from the endpoint
geometry and this reference normal.

The API, units, and rotation were checked against the installed pinned package:

- `node_modules/astronomy-engine/esm/astronomy.js` 2.1.19: `HelioVector`
  (lines 3573–3622), `HelioState` and its EQJ/Sun-relative frame notes
  (3910–3970), `RotateVector` (6431–6448), `RotateState` (6449–6467), and the
  fixed EQJ-to-ECL `Rotation_EQJ_ECL` (6468–6488).
- `node_modules/astronomy-engine/astronomy.d.ts` 2.1.19: `Vector` AU units
  (lines 402–423) and `StateVector` AU/AU-day units (425–447).
- `MakeTime` in the installed JavaScript source (1263–1301) confirms that a
  numeric date is days from the J2000 epoch, whereas a JavaScript `Date` is an
  accepted input.

The ephemeris tests use the installed library rather than mocks. They compare
the rotated state with the independently constructed barycentric planet-minus-
Sun state, compare position-only and full-state paths, check the Sun origin,
and verify an Earth finite-difference velocity over ±60 seconds. The latter
uses UTC `Date` spacing while Astronomy Engine internally accounts for the
UTC-to-TT offset; over this short interval the finite-difference comparison is
an approximation with a documented `1e-4 km/s` tolerance, not an independent
ephemeris accuracy claim.

Focused command: `npm test -- tests/physics/ephemeris.test.js`.

## Transfer model and validation scope

Earth is the departure origin; selected targets use their heliocentric
ephemeris positions at departure and arrival. Transfers use the approved
patched-conic approximation: impulsive maneuvers and a Sun-only two-body
transfer arc, with planets treated as point masses at their ephemeris
positions. The ephemeris is Sun-relative, and Astronomy Engine notes that the
Sun-centered frame is non-inertial because the Sun accelerates under planetary
gravity. The two-body transfer calculation neglects that Sun-relative frame
acceleration; it does not turn the arc into an N-body integration.

The approved objective is the **transfer-cost proxy**
`v∞,departure + v∞,arrival` in km/s, not an unqualified launch/capture
delta-v. Departure `C3` is `v∞,departure²` in km²/s². Optional proxy or C3
budgets constrain feasibility without changing that objective. Failed
physical solves are represented as invalid/NaN results for masking rather than
fabricated values.

The Lambert scope is zero-revolution (single-pass) universal variables.
Exact collinear geometry and transfer angles within approximately `1e-7`
radians of collinearity are masked as invalid/NaN: f/g velocity reconstruction
is ill-conditioned there. Inputs are never silently nudged. A boundary
regression checks accepted near-collinear geometry within a 1 km closure
tolerance; the ordinary near-Hohmann tests use a tighter 0.01 km tolerance.
The zero-revolution branch is
kept below its `4π²` Stumpff-parameter singularity; a solver must not cross it
into an unintended multi-revolution branch. These are implementation and test
contracts. Validation includes
the separate circular/coplanar Hohmann reference, propagation to the requested
endpoint, and orbital-energy/angular-momentum consistency. Actual outcomes
are checked by the numerical suite and the independent validation script.

Every candidate Lambert solution is also propagated to its requested endpoint
before success is returned. Closure must be within 1 km; otherwise the solve
is invalid. This guards against TOF-dependent conditioning beyond the angular
cutoff and adds compute cost intentionally. The independent RK4 validation
still checks the propagation implementation separately.

## Solver and propagation implementation

- `stumpff.js` uses convergent series for `|z| <= 0.5`, trigonometric forms for
  positive z, and hyperbolic forms for negative z, with non-finite guards.
- `lambert.js` nondimensionalizes using the larger endpoint radius and the
  corresponding solar two-body time/velocity scales. It chooses the oriented
  transfer angle against the fixed ecliptic north normal and brackets the
  zero-revolution root before safeguarded bisection. Positive z stays below
  `(2π)²`; negative z is searched with bounded expansion. Velocities are
  reconstructed from Lagrange f/g, converted back to km/s, and closure-checked.
- `propagate.js` independently solves the universal-anomaly time equation and
  evaluates f/g and their derivatives. Elliptic, near-parabolic, hyperbolic,
  zero-time and backward-time states are tested. Trajectory samples include
  both requested endpoints and are propagated points, not a straight line.
- Invalid physical inputs, failed brackets, singular geometry, or failed
  closure yield `valid: false` and NaN vectors/metrics. The ephemeris wrapper
  and grid configuration validation instead reject invalid configuration with
  explicit errors. Sparse vectors are invalid, including at zero time.

Textbook reference results: the Curtis example (`r1 = [5000,10000,2100]` km,
`r2 = [-14600,2500,7000]` km, 3600 seconds, Earth μ) returns departure velocity
approximately `[-5.992495,1.925367,3.245638]` km/s. Circular coplanar 1 AU / 1.524
AU Hohmann reference values are 258.915 days and departure/arrival v∞ of
2.946055 / 2.649982 km/s. Near-Hohmann Lambert tests offset the angle explicitly
by `±1e-4` radians; exact 180° is not secretly altered to make a test pass.

## Grid and budget semantics

`generatePorkchop` samples inclusive UTC departure/TOF endpoints, with
`index = j * departureCount + i`: departure increases rightward and TOF
increases upward. Earth departure states are cached per column. Costs and C3
use Float32Array; epochs and TOFs use Float64Array. Failed cells remain NaN.
Axes are capped at 120 samples each to bound accidental workload.

The cost objective is always the departure-plus-arrival v∞ proxy. Budget
`none` accepts finite valid cells, `cost` imposes `cost <= limit` in km/s, and
`c3` imposes `C3 <= limit` in km²/s². Minima use those stored grid values, so
feasibility and plot masking agree even at a Float32 rounding boundary.
Changing the budget rescans the existing grid; it does not rerun Lambert.

An optimum is the lowest-cost **sampled cell within the configured ranges**,
not a continuous or unrestricted global optimum. Venus/Jupiter presets may
have their cheapest cell at a range boundary; expanding the search can change
the answer. `npm run benchmark:grid -- Mars` (or Venus/Jupiter) prints actual
configuration, timings, invalid counts, and the sampled minimum. Performance
measurements are machine-specific and are not Quest/VR frame-rate estimates.

Phase 3 runs this unchanged grid algorithm in a replaceable browser module
worker. Costs, C3 and both axes are transferred to the main thread, retaining
NaN masks and Float32 feasibility semantics. Superseded searches terminate
their worker and reject with AbortError; errors are visible and retryable,
with no synchronous fallback that could stall immersive rendering. Selected
cell solving and throttled trajectory/planet updates remain on the main
thread. The worker changes scheduling, not the physical model or objective.

The Tudat Earth–Mars transfer-window example
(<https://docs.tudat.space/en/latest/examples/tudatpy-examples/mission_design/earth_mars_transfer_window.html>)
uses 2005 departures and 2006 arrivals. It is useful only as qualitative
context for the shape of a porkchop plot; it is not a same-window quantitative
validation of a 2026 result.

## Independent same-window validation

NASA/TM-2010-216764, *Interplanetary Mission Design Handbook: Earth-to-Mars
Mission Opportunities 2026 to 2045*, Table 2, provides fixed-date ballistic
reference values for the same launch opportunity:
<https://ntrs.nasa.gov/citations/20100037210>.

`npm run validate:physics` compares our solutions at two of those date pairs,
allowing a documented 5% model-difference tolerance for C3 and arrival v∞. It
also integrates the solved initial state with an independent, direct RK4
two-body integrator (8192 steps), which does not share the solver's Stumpff or
universal f/g implementation. Both RK4 and f/g endpoints must be within 1 km
of the requested arrival position. This check is deliberately not used to
tune constants or the solver.

Initial verification:

| Departure → arrival (UTC) | Branch | Our C3 / NASA C3 (km²/s²) | Our / NASA arrival v∞ (km/s) |
|---|---|---|---|
| 2026-11-14 → 2027-08-09 | Type I, 268 days | 11.09597 / 11.11 | 2.91469 / 2.915 |
| 2026-10-31 → 2027-08-19 | Type II, 292 days | 9.18481 / 9.144 | 2.72845 / 2.729 |

Initial independent endpoint errors were below 0.00001 km. This demonstrates
numerical consistency of the Sun-only arc, not metre-level accuracy of the
full mission approximation. The NASA handbook uses a different ephemeris and
objective (departure C3); our discrete cost-proxy minimum need not occur at
the handbook's C3 minimum.
