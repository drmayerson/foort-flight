// @ts-check
// FOORT Flight bootstrap. G0 (plan v1.1): check for WebGL2 with float targets and 6 draw buffers, and show either a
// ready note or the explanation page (plan Section 3).
import { checkWebGL2, noWebGL2Message } from './gl/context.js';

function main() {
  const box = /** @type {HTMLElement} */ (document.getElementById('gpu'));
  const c = checkWebGL2();
  if (!c.ok) {
    box.innerHTML = noWebGL2Message(c);
    document.body.dataset.gl = 'missing';
    return;
  }
  box.innerHTML = `<span class="ok">WebGL2 is ready</span> on ${c.renderer.replace(/[&<>]/g, '')}.`;
  document.body.dataset.gl = 'ready';
}

try { main(); } catch (e) {
  /** @type {HTMLElement} */ (document.getElementById('gpu')).textContent = `Start-up failed: ${e}`;
  document.body.dataset.gl = 'error';
}
