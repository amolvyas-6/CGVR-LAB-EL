// Independent validation: direct RK4 integration does not use Stumpff or f/g.
import assert from 'node:assert/strict';
import { getPlanetState } from '../src/physics/ephemeris.js';
import { solveLambert } from '../src/physics/lambert.js';
import { propagateState } from '../src/physics/propagate.js';
import { MU_SUN_KM3_S2 } from '../src/physics/constants.js';

function derivative(state) {
  const distance = Math.hypot(...state.slice(0, 3));
  const factor = -MU_SUN_KM3_S2 / distance ** 3;
  return [state[3], state[4], state[5], factor * state[0], factor * state[1], factor * state[2]];
}

function integrateRK4(r, v, seconds, count = 8192) {
  let state = [...r, ...v];
  const step = seconds / count;
  for (let i = 0; i < count; i += 1) {
    const a = derivative(state);
    const b = derivative(state.map((x, j) => x + step * a[j] / 2));
    const c = derivative(state.map((x, j) => x + step * b[j] / 2));
    const d = derivative(state.map((x, j) => x + step * c[j]));
    state = state.map((x, j) => x + step * (a[j] + 2 * b[j] + 2 * c[j] + d[j]) / 6);
  }
  return state;
}

const distance = (a, b) => Math.hypot(...a.map((x, i) => x - b[i]));
const reports = [];
// NASA/TM-2010-216764 Table 2, ballistic/no-deep-space-maneuver rows.
// These published values are a model plausibility reference, not fitting targets.
for (const fixture of [
  { departure: '2026-11-14', arrival: '2027-08-09', c3: 11.11, arrivalVInf: 2.915, type: 'I' },
  { departure: '2026-10-31', arrival: '2027-08-19', c3: 9.144, arrivalVInf: 2.729, type: 'II' },
]) {
  const departure = new Date(`${fixture.departure}T00:00:00Z`);
  const arrival = new Date(`${fixture.arrival}T00:00:00Z`);
  const seconds = (arrival - departure) / 1000;
  const earth = getPlanetState('Earth', departure);
  const mars = getPlanetState('Mars', arrival);
  const solution = solveLambert(earth.r, mars.r, seconds);
  assert.equal(solution.valid, true, solution.reason);
  const departureVInf = distance(solution.v1, earth.v);
  const arrivalVInf = distance(solution.v2, mars.v);
  const c3 = departureVInf ** 2;
  const fg = propagateState(earth.r, solution.v1, seconds);
  assert.equal(fg.valid, true, fg.reason);
  const rk4 = integrateRK4(earth.r, solution.v1, seconds);
  const fgErrorKm = distance(fg.r, mars.r);
  const rk4ErrorKm = distance(rk4.slice(0, 3), mars.r);
  assert.ok(fgErrorKm < 1, `f/g endpoint error: ${fgErrorKm} km`);
  assert.ok(rk4ErrorKm < 1, `Independent RK4 endpoint error: ${rk4ErrorKm} km`);
  assert.ok(Math.abs(c3 / fixture.c3 - 1) < 0.05, `NASA C3 comparison exceeds 5%: ${c3}`);
  assert.ok(Math.abs(arrivalVInf / fixture.arrivalVInf - 1) < 0.05, `NASA arrival v∞ comparison exceeds 5%: ${arrivalVInf}`);
  assert.equal(solution.transferAngle < Math.PI ? 'I' : 'II', fixture.type);
  reports.push({ departure: fixture.departure, arrival: fixture.arrival, tofDays: seconds / 86400, type: fixture.type, c3, nasaC3: fixture.c3, arrivalVInf, nasaArrivalVInf: fixture.arrivalVInf, costProxy: departureVInf + arrivalVInf, fgErrorKm, rk4ErrorKm });
}
console.log(JSON.stringify({ reference: 'NASA/TM-2010-216764, Table 2', reports }, null, 2));
