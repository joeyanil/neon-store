import { api, newIdemKey } from './api.js';
import { S } from './components.js';
import { errorText, getLang, t } from './i18n.js';
import { etbForUsdt, parseUsdt } from './money.js';
import { cleanAccount, cleanAddress, cleanName } from './rules.js';
import { haptic, setActions, setClosingConfirmation } from './tg.js';
import { etb, h, icon, methodLabel, toast, usdt } from './ui.js';

const shortNet = (n) => n.label;
const glyph = (m) => (m.label_en || m.code).replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || '··';
const ADDR_KEY = { tron: 'TRC20', evm: 'BEP20', bybit_uid: 'BYBIT_UID' };
const addrPlaceholder = (net) => (ADDR_KEY[net?.kind] ? t(`addr_ph_${ADDR_KEY[net.kind]}`) : t('addr_ph_other'));
const addrBad = (net) => (ADDR_KEY[net?.kind] ? t(`addr_bad_${ADDR_KEY[net.kind]}`) : t('addr_bad_other'));
const sideList = (list, side) => list.filter((x) => x[side]);

/** What a payment method still asks of the customer, or null when it is open to them. */
export function lockInfo(method, stats) {
  const u = method.unlock;
  if (!u || !stats) return null;
  const ok = stats.completed >= u.orders && stats.volume_micro >= u.volume_micro && (!u.need_ratio || stats.completed > stats.cancelled);
  if (ok) return null;
  const rule = t('locked_method', { orders: u.orders })
    + (u.volume_micro ? t('locked_volume', { usdt: usdt(u.volume_micro) }) : '')
    + (u.need_ratio ? t('locked_ratio') : '')
    + `. ${t('locked_have', { n: stats.completed })}`;
  return rule;
}

/** One place that decides whether a draft order is good enough to review, and what to tell the customer if not. */
export function checkDraft(side, d, boot) {
  const errors = {};
  const micro = parseUsdt(d.usdt);
  const { min_usdt_micro: min, max_usdt_micro: max } = boot.limits;
  if (d.usdt) {
    if (!micro) errors.amount = t('amount_bad');
    else if (micro < min) errors.amount = t('amount_min', { min: usdt(min) });
    else if (micro > max) errors.amount = t('amount_max', { max: usdt(max) });
    else if (side === 'buy' && boot.stock && micro > boot.stock.available_usdt_micro) errors.amount = t('stock_short', { n: usdt(boot.stock.available_usdt_micro) });
  }
  const amountOk = Boolean(micro) && !errors.amount;
  let fieldsOk;
  if (side === 'buy') {
    const net = boot.catalog.networks.find((n) => n.code === d.network);
    const addrOk = Boolean(net && cleanAddress(net.kind, d.address));
    if (d.address && !addrOk) errors.address = addrBad(net);
    fieldsOk = addrOk;
  } else {
    const nameOk = Boolean(cleanName(d.name));
    const meth = boot.catalog.methods.find((m) => m.code === d.method);
    const acctOk = Boolean(meth && cleanAccount(meth.kind, d.account));
    if (d.name && !nameOk) errors.name = t('name_bad');
    if (d.account && !acctOk) errors.account = t('account_bad');
    fieldsOk = nameOk && acctOk;
  }
  const rate = side === 'buy' ? boot.rates.buy_cents : boot.rates.sell_cents;
  const total = amountOk ? etbForUsdt(micro, rate, side === 'buy' ? 'up' : 'down') : 0;
  return { ok: amountOk && fieldsOk && Boolean(d.method) && Boolean(d.network), micro, rate, total, errors };
}

function flowTop(ctx, title) {
  return h('header', { class: 'top' },
    h('button', { class: 'backbtn', type: 'button', onclick: ctx.back, 'aria-label': t('back') }, icon('back', 22)),
    h('h1', { class: 'grow' }, title));
}

export function tradeScreen(ctx) {
  const side = ctx.params.side === 'sell' ? 'sell' : 'buy';
  const { boot } = S;
  const d = S.drafts[side];
  const methods = sideList(boot.catalog.methods, side);
  const nets = sideList(boot.catalog.networks, side);
  if (!methods.some((m) => m.code === d.method && !(side === 'buy' && lockInfo(m, boot.stats)))) d.method = (methods.find((m) => !(side === 'buy' && lockInfo(m, boot.stats))) || methods[0])?.code;
  if (!nets.some((n) => n.code === d.network)) d.network = nets[0]?.code;
  for (const k of ['usdt', 'address', 'name', 'account']) if (d[k] == null) d[k] = '';
  return ctx.params.step === 'review' ? reviewScreen(ctx, side, d) : formScreen(ctx, side, d);
}

// ---------- step 1: the form ----------
function formScreen(ctx, side, d) {
  const { boot } = S;
  const lang = getLang();
  const refs = {};
  const totalLabel = side === 'buy' ? t('you_pay') : t('you_get');

  const field = (label, control, ...extra) => h('div', { class: 'field' }, h('label', null, label), control, ...extra);
  const input = (key, opts = {}) => {
    const el = h('input', { type: 'text', value: d[key], autocomplete: 'off', autocapitalize: 'off', spellcheck: false, ...opts });
    el.addEventListener('input', () => {
      if (key === 'usdt') {
        el.value = el.value.replace(',', '.').replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
      }
      d[key] = el.value.trim();
      d.idem = null;
      refresh();
    });
    return el;
  };

  // amount
  refs.amount = input('usdt', { inputMode: 'decimal', placeholder: t('amount_ph'), 'aria-label': t('amount_usdt'), id: 'f-amount' });
  refs.amountWrap = h('div', { class: 'well input-wrap big-input' }, refs.amount, h('span', { class: 'suffix' }, 'USDT'));
  refs.amountErr = h('div', { class: 'err', role: 'alert' });
  refs.total = h('div', { class: 'num big-amount' });
  const chips = [50, 100, 250, 500].filter((n) => n * 1e6 >= boot.limits.min_usdt_micro && n * 1e6 <= boot.limits.max_usdt_micro);
  const amountCard = h('section', { class: 'clay stack' },
    h('div', { class: 'field' }, h('label', { for: 'f-amount' }, t('amount_usdt')), refs.amountWrap, refs.amountErr,
      h('div', { class: 'helper' }, t('range_hint', { min: usdt(boot.limits.min_usdt_micro), max: usdt(boot.limits.max_usdt_micro) }))),
    h('div', { class: 'chips' }, chips.map((n) => h('button', { class: 'chip', type: 'button', onclick: () => { haptic.select(); refs.amount.value = String(n); d.usdt = String(n); d.idem = null; refresh(); } }, String(n)))),
    h('div', { class: 'well totalbox' },
      h('div', null, h('div', { class: 'tiny' }, totalLabel), refs.total),
      h('div', { class: 'tiny' }, `${etb(boot.rates[side === 'buy' ? 'buy_cents' : 'sell_cents'])} ETB / USDT`)));

  // method
  const methodBox = h('div', { class: 'choices', role: 'radiogroup', 'aria-label': side === 'buy' ? t('pay_with') : t('receive_via') },
    sideList(boot.catalog.methods, side).map((m) => {
      const lock = side === 'buy' ? lockInfo(m, boot.stats) : null;
      const b = h('button', { class: 'choice', type: 'button', role: 'radio', 'aria-checked': String(d.method === m.code), 'aria-disabled': lock ? 'true' : null, 'data-code': m.code },
        h('span', { class: 'glyph' }, lock ? icon('lock', 18) : glyph(m)),
        h('span', { class: 'grow' }, h('div', { class: 'strong' }, methodLabel(m, lang)), lock ? h('div', { class: 'tiny' }, lock) : null),
        h('span', { class: 'tick' }, icon('check', 14)));
      b.addEventListener('click', () => {
        if (lock) { haptic.warn(); toast(t('locked_toast', { rule: lock }), 'error'); return; }
        haptic.select(); d.method = m.code; d.idem = null;
        methodBox.querySelectorAll('.choice').forEach((c) => c.setAttribute('aria-checked', String(c.dataset.code === m.code)));
        refresh();
      });
      return b;
    }));
  const methodCard = h('section', { class: 'clay stack' }, h('div', { class: 'label section-title' }, side === 'buy' ? t('pay_with') : t('receive_via')), methodBox);

  // network
  refs.netNote = h('div', { class: 'helper' });
  const netSeg = h('div', { class: 'seg', role: 'group', 'aria-label': t('network') },
    sideList(boot.catalog.networks, side).map((n) => h('button', {
      type: 'button', 'aria-pressed': String(d.network === n.code), 'data-code': n.code,
      onclick: () => {
        haptic.select(); d.network = n.code; d.idem = null;
        netSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.code === n.code)));
        if (refs.address) refs.address.placeholder = addrPlaceholder(n);
        refresh();
      },
    }, shortNet(n))));
  const netCard = h('section', { class: 'clay stack' }, h('div', { class: 'label section-title' }, t('network')), netSeg, refs.netNote);

  // details
  let detailCard;
  if (side === 'buy') {
    refs.address = input('address', { placeholder: addrPlaceholder(boot.catalog.networks.find((n) => n.code === d.network)), 'aria-label': t('addr_label'), id: 'f-addr' });
    refs.addressWrap = h('div', { class: 'well input-wrap' }, refs.address);
    refs.addressErr = h('div', { class: 'err', role: 'alert' });
    detailCard = h('section', { class: 'clay stack' },
      h('div', { class: 'field' }, h('label', { for: 'f-addr' }, t('addr_label')), refs.addressWrap, refs.addressErr),
      h('div', { class: 'notice warn' }, icon('alert', 20), t('addr_warn')));
  } else {
    refs.name = input('name', { placeholder: t('holder_ph'), autocomplete: 'name', id: 'f-name' });
    refs.account = input('account', { placeholder: t('account_ph'), inputMode: 'text', id: 'f-acct' });
    refs.nameWrap = h('div', { class: 'well input-wrap' }, refs.name);
    refs.accountWrap = h('div', { class: 'well input-wrap' }, refs.account);
    refs.nameErr = h('div', { class: 'err', role: 'alert' });
    refs.accountErr = h('div', { class: 'err', role: 'alert' });
    detailCard = h('section', { class: 'clay stack' },
      h('div', { class: 'field' }, h('label', { for: 'f-name' }, t('holder_name')), refs.nameWrap, refs.nameErr),
      h('div', { class: 'field' }, h('label', { for: 'f-acct' }, t('account_no')), refs.accountWrap, refs.accountErr));
  }

  const root = h('div', { class: 'screen flow' }, flowTop(ctx, t(`trade_${side}_title`)), amountCard, methodCard, netCard, detailCard);

  function refresh() {
    const c = checkDraft(side, d, boot);
    refs.total.textContent = c.total ? `${etb(c.total)} ETB` : '—';
    refs.amountErr.textContent = c.errors.amount || '';
    refs.amountWrap.classList.toggle('bad', Boolean(c.errors.amount));
    const net = boot.catalog.networks.find((n) => n.code === d.network);
    refs.netNote.textContent = '';
    if (side === 'buy') {
      refs.addressErr.textContent = c.errors.address || '';
      refs.addressWrap.classList.toggle('bad', Boolean(c.errors.address));
    } else {
      refs.nameErr.textContent = c.errors.name || '';
      refs.accountErr.textContent = c.errors.account || '';
      refs.nameWrap.classList.toggle('bad', Boolean(c.errors.name));
      refs.accountWrap.classList.toggle('bad', Boolean(c.errors.account));
    }
    setClosingConfirmation(Boolean(d.usdt || d.address || d.name || d.account));
    setActions({ text: t('review_order'), disabled: !c.ok, onClick: () => { if (checkDraft(side, d, boot).ok) { haptic.press(); ctx.go(`/trade/${side}/review`); } } });
  }
  refresh();
  return { el: root, destroy: () => setClosingConfirmation(false) };
}

// ---------- step 2: check and confirm ----------
function reviewScreen(ctx, side, d) {
  const { boot } = S;
  const lang = getLang();
  const c = checkDraft(side, d, boot);
  if (!c.ok) { queueMicrotask(() => ctx.replace(`/trade/${side}`)); return { el: h('div') }; }
  const method = boot.catalog.methods.find((m) => m.code === d.method);
  const net = boot.catalog.networks.find((n) => n.code === d.network);

  const rows = side === 'buy'
    ? [[t('row_you_buy'), `${usdt(c.micro)} USDT`], [t('rate_label'), `${etb(c.rate)} ETB`], [t('row_method'), methodLabel(method, lang)], [t('row_network'), shortNet(net)], [t('row_address'), d.address]]
    : [[t('row_you_sell'), `${usdt(c.micro)} USDT`], [t('rate_label'), `${etb(c.rate)} ETB`], [t('row_network'), shortNet(net)], [t('row_method'), methodLabel(method, lang)], [t('row_payout'), `${d.name} · ${d.account}`]];

  const root = h('div', { class: 'screen flow' },
    flowTop(ctx, t('review_title')),
    h('section', { class: 'clay stack' },
      h('div', null, h('div', { class: 'tiny' }, side === 'buy' ? t('row_total_pay') : t('row_total_get')), h('div', { class: 'num big-amount' }, `${etb(c.total)} ETB`)),
      h('div', { class: 'divider' }),
      h('dl', { class: 'kv' }, rows.map(([k, v]) => [h('dt', null, k), h('dd', { class: 'break' }, v)]))),
    h('div', { class: 'notice' }, icon('clock', 20), t('rate_lock', { min: boot.order_ttl_min })),
    side === 'buy' ? h('div', { class: 'notice warn' }, icon('alert', 20), t('addr_warn')) : null);

  let busy = false;
  const confirm = async () => {
    if (busy) return;
    busy = true;
    setActions({ text: t('creating'), loading: true, onClick() {} });
    d.idem = d.idem || newIdemKey();
    const body = side === 'buy'
      ? { side, usdt: d.usdt, method: d.method, network: d.network, address: d.address, idem: d.idem }
      : { side, usdt: d.usdt, method: d.method, network: d.network, payout_name: d.name, payout_account: d.account, idem: d.idem };
    try {
      const { order } = await api.createOrder(body);
      S.drafts[side] = {};
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
