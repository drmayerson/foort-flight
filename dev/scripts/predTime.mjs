// how long the map's prediction takes to complete (CPU), Kerr a=0.9 circular at r=10 and an eccentric orbit
import { createSpacetime } from '../../js/physics/spacetime.js';
import { shipOn } from '../../js/game/physicalMode.js';
import { Predictor } from '../../js/game/predictor.js';
const S = createSpacetime('kerr', { a: 0.9 });
for (const rep of [0, 1]) for (const [r, v] of [[10, [0, 0, 0]], [10, [0, -0.1, 0]], [30, [0, -0.05, 0]]]) {
  const s = shipOn(S, { r, theta: Math.PI / 2, family: 'circular', v, look: 'prograde' });
  const P = new Predictor(S); P.restart(s);
  const t0 = performance.now(); let calls = 0;
  while (P.cur) { P.work(0.5); calls++; if (calls > 1e5) break; }
  console.log(`r=${r} v=${v}: ${(performance.now() - t0).toFixed(1)} ms CPU, ${calls} frames at 0.5 ms, ${P.points.length} points, event '${P.event}'`);
}
