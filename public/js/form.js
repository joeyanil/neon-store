// Form pieces for the admin screens (and the ticket and service forms). Each returns an element and a small API.
import { t } from './i18n.js';
import { haptic } from './tg.js';
import { h, icon } from './ui.js';

let uid = 0;

/** A labelled text input. Returns { el, input, get(), set(v), error(msg) }. */
export function textField({ label, value = '', placeholder = '', hint = '', type = 'text', inputMode, maxLength, suffix, onInput }) {
  const id = `f${++uid}`;
  const input = h('input', { type, id, value, placeholder, autocomplete: 'off', autocapitalize: 'off', spellcheck: false, inputMode, maxLength });
  const wrap = h('div', { class: 'well input-wrap' }, input, suffix ? h('span', { class: 'suffix' }, suffix) : null);
  const err = h('div', { class: 'err', role: 'alert' });
  const el = h('div', { class: 'field' }, h('label', { for: id }, label), wrap, err, hint ? h('div', { class: 'helper' }, hint) : null);
  input.addEventListener('input', () => { api.error(''); onInput?.(input.value); });
  const api = {
    el, input,
    get: () => input.value.trim(),
    set: (v) => { input.value = v ?? ''; },
    error(msg) { err.textContent = msg || ''; wrap.classList.toggle('bad', Boolean(msg)); if (msg) input.focus({ preventScroll: false }); },
  };
  return api;
}

export function textArea({ label, value = '', placeholder = '', hint = '', rows = 4, maxLength }) {
  const id = `f${++uid}`;
  const input = h('textarea', { id, rows, placeholder, maxLength }, value);
  const wrap = h('div', { class: 'well input-wrap' }, input);
  const err = h('div', { class: 'err', role: 'alert' });
  const el = h('div', { class: 'field' }, label ? h('label', { for: id }, label) : null, wrap, err, hint ? h('div', { class: 'helper' }, hint) : null);
  input.addEventListener('input', () => api.error(''));
  const api = {
    el, input,
    get: () => input.value.trim(),
    set: (v) => { input.value = v ?? ''; },
    error(msg) { err.textContent = msg || ''; wrap.classList.toggle('bad', Boolean(msg)); },
  };
  return api;
}

/** A segmented choice: options = [[value, label], ...]. */
export function segField({ label, options, value, onChange }) {
  let current = value;
  const seg = h('div', { class: options.length > 3 ? 'seg wrap' : 'seg', role: 'group', 'aria-label': label },
    options.map(([v, text]) => h('button', {
      type: 'button', 'data-v': v, 'aria-pressed': String(v === current),
      onclick: () => { haptic.select(); current = v; paint(); onChange?.(v); },
    }, text)));
  const paint = () => seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(current))));
  return { el: h('div', { class: 'field' }, label ? h('div', { class: 'label' }, label) : null, seg), get: () => current, set: (v) => { current = v; paint(); } };
}

/** An on/off switch row with a description. */
export function toggleRow({ label, hint = '', value = false, onChange }) {
  let on = Boolean(value);
  const sw = h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(on), 'aria-label': label });
  const row = h('div', { class: 'toggle-row' }, h('div', { class: 'grow' }, h('div', { class: 'strong' }, label), hint ? h('div', { class: 'tiny' }, hint) : null), sw);
  const flip = () => { on = !on; sw.setAttribute('aria-checked', String(on)); haptic.select(); onChange?.(on); };
  sw.addEventListener('click', flip);
  return { el: row, get: () => on, set: (v) => { on = Boolean(v); sw.setAttribute('aria-checked', String(on)); } };
}

/** A tappable list row (title, subtitle, chevron). */
export function listRow({ title, sub, badge, onClick, lead }) {
  return h('button', { class: 'clay tight list-row', type: 'button', onclick: onClick },
    lead || null,
    h('div', { class: 'grow' }, h('div', { class: 'strong' }, title), sub ? h('div', { class: 'tiny' }, sub) : null),
    badge || null,
    icon('chevron', 20));
}

/** A small count bubble. */
export const countBubble = (n) => (n > 0 ? h('span', { class: 'bubble' }, String(n)) : null);

export const primaryButton = (text, onClick, { danger = false, block = true } = {}) =>
  h('button', { class: `btn ${danger ? 'danger' : 'primary'} ${block ? 'block' : ''}`, type: 'button', onclick: onClick }, text);

/** Page header with a back button, used by every sub-screen. */
export function flowTop(ctx, title, right) {
  return h('header', { class: 'top' },
    h('button', { class: 'backbtn', type: 'button', onclick: ctx.back, 'aria-label': t('back') }, icon('back', 22)),
    h('h1', { class: 'grow' }, title), right || null);
}
