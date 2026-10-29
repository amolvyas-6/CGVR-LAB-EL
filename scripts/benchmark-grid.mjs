import { generatePorkchop, findGridMinimum } from '../src/physics/porkchop.js';

const target = process.argv[2] ?? 'Mars';
const presets = { Venus: [80, 220], Mars: [100, 400], Jupiter: [450, 1200] };
if (!Object.hasOwn(presets, target)) throw new Error('Target must be Venus, Mars, or Jupiter');
const [tofMinDays, tofMaxDays] = presets[target];
const config = {
  target,
  departureStartMs: Date.parse('2026-07-01T00:00:00Z'),
  departureEndMs: Date.parse('2027-03-01T00:00:00Z'),
  tofMinDays,
  tofMaxDays,
  departureCount: 60,
  tofCount: 60,
};

const measurements = [];
for (let iteration = 0; iteration < 3; iteration += 1) {
  const started = performance.now();
  const grid = generatePorkchop(config);
  const elapsedMs = performance.now() - started;
  const cell = findGridMinimum(grid);
  measurements.push({
    elapsedMs,
    validCount: grid.validCount,
    invalidCount: grid.invalidCount,
    minimum: cell && {
      departureUTC: new Date(cell.departureMs).toISOString(),
      arrivalUTC: new Date(cell.arrivalMs).toISOString(),
      tofDays: cell.tofDays,
      costProxyKmPerSecond: cell.cost,
      departureC3KmSquaredPerSecondSquared: cell.c3,
    },
  });
}
console.log(JSON.stringify({ target, config, environment: `Node ${process.version}; CPU grid computation, not VR frame performance`, measurements }, null, 2));
