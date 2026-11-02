// Social-media services: price list, order form and review.
import { api, newIdemKey } from './api.js';
import { S } from './components.js';
import { flowTop, listRow, textField } from './form.js';
import { errorText, getLang, t } from './i18n.js';
import { cleanTarget } from './rules.js';
import { lockInfo } from './screens-trade.js';
import { haptic, setActions, setClosingConfirmation } from './tg.js';
import { etb, h, icon, methodLabel, toast } from './ui.js';

const PLATFORM_NAME = { telegram: 'Telegram', instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', other: '•••' };
const serviceName = (s) => (getLang() === 'am' ? s.name_am || s.name_en : s.name_en);
const priceText = (s) => t('price_per_1000', { price: etb(s.price_cents_per_1000) });
export const serviceTotal = (qty, price) => Math.ceil((qty * price) / 1000);
const fmt = (n) => Number(n).toLocaleString('en-US');

export function servicesScreen(ctx) {
  const { boot } = S;
  const groups = {};
  for (const s of boot.catalog.services) (groups[s.platform] = groups[s.platform] || []).push(s);
  const body = Object.keys(groups).length
    ? Object.entries(groups).map(([p, list]) => h('section', { class: 'stack' },
      h('h2', { class: 'section-title' }, PLATFORM_NAME[p] || p),
      ...list.map((s) => listRow({ title: serviceName(s), sub: `${priceText(s)} · ${fmt(s.min_qty)}–${fmt(s.max_qty)}`, onClick: () => { haptic.select(); ctx.go(`/service/${s.code}`); } }))))
    : [h('div', { class: 'clay' }, h('p', { class: 'muted' }, t('services_empty')))];
  return { el: h('div', { class: 'screen' }, flowTop(ctx, t('services_title')), ...body) };
}

export function serviceScreen(ctx) {
  const { boot } = S;
  const svc = boot.catalog.services.find((s) => s.code === ctx.params.code);
  if (!svc) { queueMicrotask(() => ctx.replace('/services', { root: true })); return { el: h('div') }; }
  S.drafts.service = S.drafts.service || {};
  const d = S.drafts.service[svc.code] || (S.drafts.service[svc.code] = { qty: '', target: '', method: null });
  const methods = boot.catalog.methods.filter((m) => m.buy);
  const open = (m) => !lockInfo(m, boot.stats);
  if (!methods.some((m) => m.code === d.method && open(m))) d.method = (methods.find(open) || methods[0])?.code;
  return ctx.params.step === 'review' ? review(ctx, svc, d, methods) : form(ctx, svc, d, methods, open);
}

function check(svc, d) {
  const qty = Number(String(d.qty).replace(/[,\s]/g, ''));
  const errors = {};
  const qtyOk = Number.isInteger(qty) && qty >= svc.min_qty && qty <= svc.max_qty;
  if (d.qty && !qtyOk) errors.qty = t('svc_qty_bad', { min: fmt(svc.min_qty), max: fmt(svc.max_qty) });
  const target = d.target ? cleanTarget(svc.platform, d.target) : null;
  if (d.target && !target) errors.target = t('svc_link_bad');
  return { ok: qtyOk && Boolean(target) && Boolean(d.method), qty, target, total: qtyOk ? serviceTotal(qty, svc.price_cents_per_1000) : 0, errors };
}

function form(ctx, svc, d, methods, open) {
  const qty = textField({ label: t('svc_quantity'), value: d.qty, inputMode: 'numeric', hint: t('svc_range', { min: fmt(svc.min_qty), max: fmt(svc.max_qty) }), onInput: (v) => { d.qty = v.replace(/[^\d,]/g, ''); d.idem = null; refresh(); } });
  const link = textField({ label: t('svc_link'), value: d.target, placeholder: t(`svc_link_ph_${svc.platform}`), onInput: (v) => { d.target = v.trim(); d.idem = null; refresh(); } });
  const total = h('div', { class: 'num big-amount' }, '—');
  const methodBox = h('div', { class: 'choices', role: 'radiogroup', 'aria-label': t('svc_pay_with') },
    methods.map((m) => {
      const lock = lockInfo(m, S.boot.stats);
      const b = h('button', { class: 'choice', type: 'button', role: 'radio', 'aria-checked': String(d.method === m.code), 'aria-disabled': lock ? 'true' : null, 'data-code': m.code },
        h('span', { class: 'glyph' }, lock ? icon('lock', 18) : (m.label_en || '').slice(0, 3).toUpperCase()),
        h('span', { class: 'grow' }, h('div', { class: 'strong' }, methodLabel(m, getLang())), lock ? h('div', { class: 'tiny' }, lock) : null),
        h('span', { class: 'tick' }, icon('check', 14)));
      b.addEventListener('click', () => {
        if (lock) { haptic.warn(); toast(t('locked_toast', { rule: lock }), 'error'); return; }
        haptic.select(); d.method = m.code; d.idem = null;
        methodBox.querySelectorAll('.choice').forEach((c) => c.setAttribute('aria-checked', String(c.dataset.code === m.code)));
        refresh();
      });
      return b;
    }));
  const facts = [
    svc.eta_text ? h('div', { class: 'row' }, icon('clock', 18), h('span', null, svc.eta_text)) : null,
    h('div', { class: 'row' }, icon('shield', 18), h('span', null, svc.warranty_days ? t('svc_warranty', { n: svc.warranty_days }) : t('svc_warranty_none'))),
    svc.note ? h('p', { class: 'muted small' }, svc.note) : null,
  ];
  const root = h('div', { class: 'screen flow' },
    flowTop(ctx, serviceName(svc)),
    h('section', { class: 'clay stack' }, h('div', { class: 'row between' }, h('span', { class: 'pill' }, PLATFORM_NAME[svc.platform]), h('span', { class: 'num small strong' }, priceText(svc))), ...facts),
    h('section', { class: 'clay stack' }, qty.el, link.el),
    h('section', { class: 'clay stack' }, h('div', { class: 'label section-title' }, t('svc_pay_with')), methodBox,
      h('div', { class: 'well totalbox' }, h('div', { class: 'tiny' }, t('svc_total')), total)));
  function refresh() {
    const c = check(svc, d);
    total.textContent = c.total ? `${etb(c.total)} ETB` : '—';
    qty.error(c.errors.qty || '');
    link.error(c.errors.target || '');
    setClosingConfirmation(Boolean(d.qty || d.target));
    setActions({ text: t('svc_review'), disabled: !c.ok, onClick: () => { if (check(svc, d).ok) { haptic.press(); ctx.go(`/service/${svc.code}/review`); } } });
  }
  refresh();
  return { el: root, destroy: () => setClosingConfirmation(false) };
}

function review(ctx, svc, d, methods) {
  const c = check(svc, d);
  if (!c.ok) { queueMicrotask(() => ctx.replace(`/service/${svc.code}`)); return { el: h('div') }; }
  const method = methods.find((m) => m.code === d.method);
  const rows = [[t('row_service'), serviceName(svc)], [t('row_quantity'), fmt(c.qty)], [t('row_link'), c.target], [t('row_method'), methodLabel(method, getLang())]];
  const root = h('div', { class: 'screen flow' },
    flowTop(ctx, t('review_title')),
    h('section', { class: 'clay stack' },
      h('div', null, h('div', { class: 'tiny' }, t('row_total_pay')), h('div', { class: 'num big-amount' }, `${etb(c.total)} ETB`)),
      h('div', { class: 'divider' }),
      h('dl', { class: 'kv' }, rows.map(([k, v]) => [h('dt', null, k), h('dd', { class: 'break' }, v)]))),
    h('div', { class: 'notice' }, icon('clock', 20), t('pay_window', { min: S.boot.order_ttl_min })));
  let busy = false;
  const confirm = async () => {
    if (busy) return;
    busy = true;
    setActions({ text: t('creating'), loading: true, onClick() {} });
    d.idem = d.idem || newIdemKey();
    try {
      const { order } = await api.createOrder({ side: 'service', service: svc.code, quantity: c.qty, target: d.target, method: d.method, idem: d.idem });
      delete S.drafts.service[svc.code];
      setClosingConfirmation(false);
      toast(t('order_created'), 'ok');
      ctx.replace(`/order/${order.id}`, { root: true });
    } catch (err) {
      busy = false;
      toast(errorText(err), 'error');
      setActions({ text: t('confirm_order'), onClick: confirm });
    }
  };
  setActions({ text: t('confirm_order'), onClick: confirm });
  return { el: root };
}
