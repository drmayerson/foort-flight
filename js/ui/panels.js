// @ts-check
// The settings panel (plan 7.5): normal and expert controls generated from js/ui/controlList.js. The expert ones are
// shown when "Expert" is ticked. Sliders on a log scale (λ, exposure) map position -> value exponentially.

import { CONTROLS, coerce } from './controlList.js';

/**
 * @param {HTMLElement} root
 * @param {Record<string, any>} settings live object, updated in place
 * @param {(id: string, apply: string) => void} onChange
 */
export function buildPanel(root, settings, onChange) {
  let expert = !!settings.__expert;
  const esc = (/** @type {string} */ s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
  const toPos = (/** @type {any} */ c, /** @type {number} */ v) => (c.log ? Math.log(v / c.min) / Math.log(c.max / c.min) * 1000 : v);
  const fromPos = (/** @type {any} */ c, /** @type {number} */ p) => (c.log ? c.min * Math.exp(p / 1000 * Math.log(c.max / c.min)) : p);
  const fmt = (/** @type {any} */ c, /** @type {any} */ v) => (c.fmt ? c.fmt(v) : typeof v === 'number' ? String(+v.toPrecision(4)) : String(v));

  const render = () => {
    const sections = new Map();
    for (const c of CONTROLS) {
      if (c.group === 'expert' && !expert) continue;
      if (c.visible && !c.visible(settings)) continue;
      const v = settings[c.id];
      let input;
      if (c.type === 'select') input = `<select id="ctl-${c.id}">${(c.options ?? []).map(([ov, ol]) => `<option value="${esc(String(ov))}"${String(ov) === String(v) ? ' selected' : ''}>${esc(ol)}</option>`).join('')}</select>`;
      else if (c.type === 'checkbox') input = `<input type="checkbox" id="ctl-${c.id}"${v ? ' checked' : ''}>`;
      else input = `<input type="range" id="ctl-${c.id}" min="${c.log ? 0 : c.min}" max="${c.log ? 1000 : c.max}" step="${c.log ? 1 : c.step}" value="${toPos(c, v)}"><output id="out-${c.id}">${esc(fmt(c, v))}</output>`;
      const row = `<label class="ctl" title="${esc(c.help ?? '')}"><span>${esc(c.label)}</span>${input}</label>`;
      if (!sections.has(c.section)) sections.set(c.section, []);
      sections.get(c.section).push(row);
    }
    root.innerHTML = [...sections].map(([s, rows]) => `<fieldset><legend>${esc(s)}</legend>${rows.join('')}</fieldset>`).join('')
      + `<label class="ctl expert-toggle"><input type="checkbox" id="ctl-__expert"${expert ? ' checked' : ''}> Expert settings</label>`;
    for (const c of CONTROLS) {
      const el = /** @type {HTMLInputElement|null} */ (root.querySelector(`#ctl-${c.id}`));
      if (!el) continue;
      const ev = c.type === 'range' ? 'input' : 'change';
      el.addEventListener(ev, () => {
        const raw = c.type === 'checkbox' ? el.checked : c.type === 'range' ? fromPos(c, Number(el.value)) : el.value;
        settings[c.id] = coerce(c, raw);
        const out = root.querySelector(`#out-${c.id}`);
        if (out) out.textContent = fmt(c, settings[c.id]);
        // ranges that restart the scene apply on release only
        if (c.type === 'range' && c.apply === 'scene') return;
        onChange(c.id, c.apply);
        if (CONTROLS.some((d) => d.visible)) render();
      });
      if (c.type === 'range' && c.apply === 'scene') el.addEventListener('change', () => { onChange(c.id, c.apply); render(); });
    }
    const ex = /** @type {HTMLInputElement} */ (root.querySelector('#ctl-__expert'));
    ex.addEventListener('change', () => { expert = ex.checked; settings.__expert = expert; render(); onChange('__expert', 'view'); });
  };
  render();
  return { render };
}
