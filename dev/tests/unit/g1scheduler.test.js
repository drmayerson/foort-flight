// G1: the scheduler's chunking covers every pixel exactly once, centre-out, within the ray budget.
import { describe, it, expect } from 'vitest';
import { bandsCentreOut, TraceJob } from '../../../js/gl/scheduler.js';

describe('chunking', () => {
  it('bands are centre-out and complete', () => {
    const b = bandsCentreOut(100);
    expect(b.length).toBe(7);
    expect(b[0]).toBe(48);
    expect([...b].sort((x, y) => x - y)).toEqual([0, 16, 32, 48, 64, 80, 96]);
  });
  for (const [w, h, rays] of [[512, 512, 30000], [100, 37, 1000], [17, 300, 10], [1024, 1024, 70000]]) {
    it(`${w} x ${h}, ${rays} rays per chunk`, () => {
      const job = new TraceJob(/** @type {any} */ (null), 'p', {}, /** @type {any} */ ({ w, h }));
      const hit = new Uint8Array(w * h);
      let rect, n = 0;
      while ((rect = job.next(rays))) {
        n++;
        expect(rect.w * rect.h).toBeLessThanOrEqual(Math.max(rays, 16 * 16));
        for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) hit[y * w + x]++;
      }
      expect(job.encoded).toBe(true);
      expect(job.raysDone).toBe(w * h);
      expect(hit.every((v) => v === 1)).toBe(true);
      expect(n).toBeGreaterThan(0);
    });
  }
});
