// Small DOM helpers, icons, toasts and formatting shared by every screen.
import { formatEtb, formatUsdt } from './money.js';
import { formatWhen, t } from './i18n.js';
import { haptic } from './tg.js';

/** h('div', {class: 'x', onclick: fn}, 'text', childEl, [more, children]) */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v; // only ever used with our own static icon strings
    else if (k in el && k !== 'list' && typeof v !== 'object') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}

const P = {
  market: '<path d="M4 11.2 12 4l8 7.2V19a1.5 1.5 0 0 1-1.5 1.5H15v-5.2H9v5.2H5.5A1.5 1.5 0 0 1 4 19z"/>',
  rates: '<path d="M4 19V5"/><path d="M4 19h16"/><path d="m7.5 14 3.2-3.6 2.6 2.4 4.4-5.3"/>',
  orders: '<rect x="5" y="3.5" width="14" height="17" rx="3"/><path d="M9 8.5h6M9 12.5h6M9 16.5h3.5"/>',
  support: '<path d="M4.5 12a7.5 7.5 0 0 1 15 0v3.8a2 2 0 0 1-2 2H15v-5.3h4.5M4.5 12.5H9v5.3H6.5a2 2 0 0 1-2-2z"/><path d="M12 20.5h3.2"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="3"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  back: '<path d="m15.25 5.5-6.5 6.5 6.5 6.5"/>',
  chevron: '<path d="m8.75 5.5 6.5 6.5-6.5 6.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  note: '<path d="M10 17V6.5l8-2V15"/><circle cx="7.5" cy="17" r="2.5"/><circle cx="15.5" cy="15" r="2.5"/>',
  play: '<rect x="3.5" y="6" width="17" height="12" rx="4"/><path d="m10.5 9.5 4 2.5-4 2.5z"/>',
  star: '<path d="m12 4 2.4 5 5.4.7-4 3.7 1 5.4L12 16.1l-4.8 2.7 1-5.4-4-3.7 5.4-.7z"/>',
  megaphone: '<path d="M4 10v4h3l7 4V6l-7 4z"/><path d="M17.5 9.5a4 4 0 0 1 0 5"/>',
  receipt: '<path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2z"/><path d="M9 8.5h6M9 12h6"/>',
  camera: '<path d="M4 8.5a2 2 0 0 1 2-2h1.6l1.2-1.7h6.4l1.2 1.7H18a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="12.6" r="3.3"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5S14.4 18.1 12 20.5M12 3.5C9.6 5.9 8.4 8.7 8.4 12s1.2 6.1 3.6 8.5"/>',
  alert: '<path d="M12 4 3.5 19h17z"/><path d="M12 10v4M12 16.8v.2"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.2"/>',
  shield: '<path d="M12 3.5 5 6.2v5.3c0 4.2 2.8 7.4 7 9 4.2-1.6 7-4.8 7-9V6.2z"/><path d="m9 12 2.2 2.2L15.2 10"/>',
  arrowdown: '<path d="M12 5v14M6.5 13.5 12 19l5.5-5.5"/>',
  arrowup: '<path d="M12 19V5M6.5 10.5 12 5l5.5 5.5"/>',
  ghost: '<path d="M5.5 20V10.5a6.5 6.5 0 0 1 13 0V20l-2.2-1.7L14 20l-2-1.7L10 20l-2.3-1.7z"/><circle cx="9.6" cy="11" r="1" fill="currentColor" stroke="none"/><circle cx="14.4" cy="11" r="1" fill="currentColor" stroke="none"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  bag: '<path d="M5.5 8.5h13l-1 11h-11z"/><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5"/>',
  admin: '<path d="M12 3.5 5 6.2v5.3c0 4.2 2.8 7.4 7 9 4.2-1.6 7-4.8 7-9V6.2z"/><path d="M9.5 12h5M12 9.5v5"/>',
  ticket: '<path d="M4 8.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1.7a2 2 0 0 0 0 3.6v1.7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1.7a2 2 0 0 0 0-3.6z"/><path d="M14 6.5v11" stroke-dasharray="2 2.4"/>',
  book: '<path d="M5 4.5h10a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h10"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18"/>',
  trash: '<path d="M5 7h14M9.5 7V5h5v2M7 7l.8 12h8.4L17 7"/>',
  edit: '<path d="m5 19 1-4 9.5-9.5 3 3L9 18z"/>',
  send: '<path d="M4 12 20 4l-5 16-3.5-6.5z"/>',
};
export function icon(name, size = 24) {
  const s = document.createElement('span');
  s.style.display = 'inline-flex';
  s.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
  return s.firstElementChild;
}

// ---------- toast ----------
let toastHost;
export function toast(message, kind = '') {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  for (const old of [...toastHost.children]) if (old.textContent === message) old.remove();
  while (toastHost.children.length >= 2) toastHost.firstChild.remove();
  const el = h('div', { class: `toast ${kind}` }, kind === 'ok' ? icon('check', 20) : kind === 'error' ? icon('alert', 20) : null, message);
  toastHost.append(el);
  if (kind === 'error') haptic.error(); else if (kind === 'ok') haptic.success();
  setTimeout(() => el.remove(), 3200);
}

// ---------- clipboard ----------
export async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h('textarea', { value: text, class: 'sr', 'aria-hidden': 'true' });
    document.body.append(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* nothing else to try */ }
    ta.remove();
  }
  haptic.success();
  toast(message || t('copied'), 'ok');
}

export function copyButton(text, label, message) {
  const b = h('button', { class: 'iconbtn', type: 'button', 'aria-label': `${t('copy')}: ${label}` }, icon('copy', 20));
  b.addEventListener('click', async () => {
    await copyText(text, message);
    b.classList.add('ok');
    b.replaceChildren(icon('check', 20));
    setTimeout(() => { b.classList.remove('ok'); b.replaceChildren(icon('copy', 20)); }, 1400);
  });
  return b;
}

// ---------- status ----------
const STATUS_KIND = { awaiting_payment: 'wait', evidence_submitted: 'review', processing: 'review', completed: 'ok', rejected: 'bad', cancelled: 'off', expired: 'off' };
export const isOpen = (s) => s === 'awaiting_payment' || s === 'evidence_submitted' || s === 'processing';
export function statusBadge(status) {
  return h('span', { class: `badge ${STATUS_KIND[status] || 'off'}` }, h('i'), t(`status_${status}`));
}

// ---------- formatting ----------
export const usdt = (micro) => formatUsdt(micro);
export const etb = (cents) => formatEtb(cents);
export { formatWhen };

export function methodLabel(method, lang) {
  return lang === 'am' ? method.label_am || method.label_en : method.label_en;
}

export function countdown(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// ---------- images: shrink phone photos before upload ----------
export async function shrinkImage(file, maxSide = 1600, quality = 0.82) {
  if (!file.type.startsWith('image/') || file.size < 400_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
    return blob && blob.size < file.size ? new File([blob], 'receipt.jpg', { type: 'image/jpeg' }) : file;
  } catch {
    return file;
  }
}

export function skeletons(...heights) {
  return heights.map((hh) => { const d = h('div', { class: 'skeleton' }); d.style.height = `${hh}px`; return d; });
}
