// G5 headless harness: the ship-dynamics tests of plan 4.4, with numbers (reports/g5/harness.json).
// Usage (from dev/): node scripts/g5Harness.mjs [case ...]
import { mkdirSync, writeFileSync } from 'node:fs';
import * as C from './shipCases.mjs';

const all = { christoffelCheck: C.christoffelCheck, conservationKerr: C.conservationKerr, ksVsBl: C.ksVsBl, circularOrbit: C.circularOrbit,
  isco: C.isco, hover: () => ({ schwarzschild_r3: C.hover(3, 0), kerr_a09_r4: C.hover(4, 0.9) }), geodetic: C.geodetic, hyperbolic: C.hyperbolic, fuzzball: C.fuzzball, frameCost: C.frameCost };
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(all);
const out = {};
for (const n of names) {
  const t0 = performance.now();
  out[n] = all[n]();
  console.log(n, `(${((performance.now() - t0) / 1000).toFixed(1)} s)`, JSON.stringify(out[n], (k, v) => (typeof v === 'number' ? +v.toPrecision(4) : v)));
}
mkdirSync('reports/g5', { recursive: true });
if (names.length === Object.keys(all).length) writeFileSync('reports/g5/harness.json', JSON.stringify(out, null, 1));
