// @ts-check
// FOORT Flight bootstrap. G0: check for WebGPU and show either a ready note or the explanation page (plan Section 3).
import { createGpu, gpuFailed, noWebGPUMessage } from './gpu/device.js';

async function main() {
  const box = /** @type {HTMLElement} */ (document.getElementById('gpu'));
  const g = await createGpu();
  if (gpuFailed(g)) {
    box.innerHTML = noWebGPUMessage(g);
    document.body.dataset.webgpu = 'missing';
    return;
  }
  const name = Object.values(g.info).join(' / ') || 'a GPU (name hidden by the browser)';
  box.innerHTML = `<span class="ok">WebGPU is ready</span> on ${name.replace(/[&<>]/g, '')}` +
    (g.isFallbackAdapter ? ' <span class="bad">(a software fallback adapter: it will be very slow)</span>' : '') + '.';
  document.body.dataset.webgpu = 'ready';
  g.device.destroy();
}

main().catch((e) => {
  /** @type {HTMLElement} */ (document.getElementById('gpu')).textContent = `Start-up failed: ${e}`;
  document.body.dataset.webgpu = 'error';
});
