// G0 unit tests: the timing helpers, and the vendored FOORT-GPU snapshot (complete, importable, sane).
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { percentile, median, summarize, roundDeep } from '../../../js/gpu/timing.js';
import { createMetric, METRICS } from '../../../vendor/foort-gpu/js/metrics/registry.js';
import { unitsOf } from '../../../vendor/foort-gpu/js/units.js';
import { TetradCamera } from '../../../vendor/foort-gpu/js/camera/tetradCamera.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const vendor = resolve(root, 'vendor/foort-gpu');

describe('timing helpers', () => {
  it('percentiles interpolate linearly', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(percentile([0, 10], 0.9)).toBeCloseTo(9);
    expect(Number.isNaN(median([]))).toBe(true);
  });
  it('summarize and roundDeep', () => {
    const s = summarize([1, 2, 3, 4, 5]);
    expect(s).toMatchObject({ n: 5, median: 3, min: 1, max: 5, mean: 3 });
    expect(roundDeep({ a: [1.23456789], b: 'x', c: 0 }, 3)).toEqual({ a: [1.23], b: 'x', c: 0 });
  });
});

describe('vendored FOORT-GPU snapshot', () => {
  it('records its commit', () => {
    const v = readFileSync(resolve(vendor, 'VERSION'), 'utf8');
    expect(v).toMatch(/^commit [0-9a-f]{40}$/m);
    expect(v).toMatch(/^date {3}\d{4}-\d\d-\d\d/m);
  });
  it('contains every path the sync script lists', () => {
    const sh = readFileSync(resolve(root, 'tools/sync_foort_gpu.sh'), 'utf8');
    const list = sh.split('PATHS="')[1].split('"')[0].split('\n').map((s) => s.trim()).filter(Boolean);
    expect(list.length).toBeGreaterThan(20);
    for (const p of list) expect(existsSync(resolve(vendor, p)), p).toBe(true);
  });
  it('Kerr g_dd matches Boyer-Lindquist in closed form', () => {
    const a = 0.9, r = 7.3, th = 1.1;
    const g = createMetric('kerr', { a }).g_dd(r, th);
    const s2 = Math.sin(th) ** 2, Sig = r * r + a * a * Math.cos(th) ** 2, Del = r * r - 2 * r + a * a;
    expect(g.gtt).toBeCloseTo(-(1 - 2 * r / Sig), 13);
    expect(g.gtphi).toBeCloseTo(-2 * a * r * s2 / Sig, 13);
    expect(g.gphiphi).toBeCloseTo((r * r + a * a + 2 * a * a * r * s2 / Sig) * s2, 12);
    expect(g.grr).toBeCloseTo(Sig / Del, 13);
    expect(g.gthth).toBeCloseTo(Sig, 13);
  });
  it('ST3Cr is in units of its ADM mass and asymptotically flat', () => {
    const m = createMetric('st3cr', { lambda: 0.005, P: 2, q0: 50 });
    expect(m.massADM).toBeCloseTo(1, 12);
    const r = 2000, g = m.g_dd(r, Math.PI / 2);
    expect(g.gtt).toBeCloseTo(-(1 - 2 / r), 4);
    expect(METRICS.map((e) => e.id)).toEqual(expect.arrayContaining(['kerr', 'st3cr', 'st3crBH']));
  });
  it('units presets (plan 4.1: GM/c^3 = 4.925 µs per solar mass)', () => {
    expect(unitsOf('sgra').tS).toBeCloseTo(21.17, 1);
    expect(unitsOf('m87').lKm / 6.5e9).toBeCloseTo(1.4766, 4);
  });
  it('the tetrad camera module loads', () => {
    expect(typeof TetradCamera).toBe('function');
  });
});
