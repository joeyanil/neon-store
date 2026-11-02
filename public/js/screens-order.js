import { api, serverNow } from './api.js';
import { orderTitle, S } from './components.js';
import { errorText, getLang, t } from './i18n.js';
import { confirmDialog, haptic, setActions } from './tg.js';
import { copyButton, copyText, countdown, etb, formatWhen, h, icon, isOpen, methodLabel, shrinkImage, skeletons, statusBadge, toast, usdt } from './ui.js';

const plainEtb = (cents) => (cents / 100).toFixed(2);
const plainUsdt = (micro) => (micro / 1e6).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');

function eventLabel(e, side) {
  if (e.from === null) return t('ev_created');
  if (e.from === e.to) return e.note === 'reference sent to customer' ? t('ev_reference') : t('ev_receipt_more');
  const map = { evidence_submitted: t('ev_receipt'), processing: t(`ev_processing_${side}`), completed: t(`ev_completed_${side}`), rejected: t('ev_rejected'), cancelled: t('ev_cancelled'), expired: t('ev_expired') };
  return map[e.to] || e.to;
}

export function orderScreen(ctx) {
  const id = ctx.params.id;
  let order = null;
  let loadError = null;
  let text = '';
  let file = null;
  let previewUrl = null;
  let busy = false;
  let showMore = false;
  let signature = '';
  let dead = false;
  let timerEl = null;

  const root = h('div', { class: 'screen flow' });
  const body = h('div', { class: 'stack' }, ...skeletons(220, 120));
  root.append(
    h('header', { class: 'top' },
      h('button', { class: 'backbtn', type: 'button', onclick: ctx.back, 'aria-label': t('back') }, icon('back', 22)),
      h('h1', { class: 'grow num' }, id)),
    body);

  // ----- loading -----
  async function load({ quiet = false } = {}) {
    try {
      const res = await api.getOrder(id);
      if (dead) return;
      loadError = null;
      order = res.order;
      const sig = `${order.status}|${order.updated_at}|${order.evidence_count}|${showMore}|${busy}|${getLang()}`;
      if (sig !== signature) { signature = sig; render(); }
      updateCount();
    } catch (err) {
      if (dead) return;
      if (!quiet || !order) { loadError = err; render(); }
    }
  }
  const updateCount = () => {
    // keep the Orders tab badge honest without another request
    if (order && !isOpen(order.status) && S.activeCount > 0 && ctx.openIds?.has(order.id)) { S.activeCount -= 1; ctx.openIds.delete(order.id); ctx.updateNav(); }
    if (order && isOpen(order.status)) { ctx.openIds = ctx.openIds || new Set(); ctx.openIds.add(order.id); }
  };

  // ----- pieces -----
  function summaryCard() {
    return h('section', { class: 'clay stack' },
      h('div', { class: 'row between' }, statusBadge(order.status), h('div', { class: 'tiny' }, formatWhen(order.created_at))),
      h('div', null,
        h('div', { class: 'num strong' }, orderTitle(order)),
        h('div', { class: 'num big-amount' }, `${etb(order.etb_cents)} ETB`)),
      order.side === 'service'
        ? h('dl', { class: 'kv' }, h('dt', null, t('row_service')), h('dd', null, order.pay.service ? (getLang() === 'am' ? order.pay.service.name_am : order.pay.service.name_en) : ''),
            h('dt', null, t('row_quantity')), h('dd', { class: 'num' }, Number(order.quantity).toLocaleString('en-US')),
            h('dt', null, t('row_link')), h('dd', { class: 'break' }, order.target))
        : h('div', { class: 'row between' },
            h('span', { class: 'tiny' }, t('order_rate')), h('span', { class: 'num small strong' }, `${etb(order.rate_cents)} / USDT`)),
      h('div', { class: 'row between' },
        h('span', { class: 'tiny' }, t('order_no')),
        h('span', { class: 'row' }, h('span', { class: 'num small strong' }, order.id),
          h('button', { class: 'iconbtn', type: 'button', 'aria-label': t('copy'), onclick: () => copyText(order.id, t('order_id_copied')) }, icon('copy', 18)))));
  }

  function copyRow(label, value, raw) {
    return h('div', { class: 'well copy-row' },
      h('div', { class: 'grow' }, h('div', { class: 'k' }, label), h('div', { class: 'v' }, value)),
      copyButton(raw ?? value, label));
  }

  function payCard() {
    const buy = order.side !== 'sell'; // buy and service orders: the customer pays birr to us
    const lang = getLang();
    timerEl = h('span', { class: 'timer' });
    tickTimer();
    const rows = buy
      ? [copyRow(t('pay_exact_birr'), `${etb(order.etb_cents)} ETB`, plainEtb(order.etb_cents)),
         h('div', { class: 'well copy-row' }, h('div', { class: 'grow' }, h('div', { class: 'k' }, t('pay_via')), h('div', { class: 'v' }, lang === 'am' ? order.pay.label_am : order.pay.label_en))),
         copyRow(t('pay_to_name'), order.pay.account_name),
         copyRow(t('pay_to_number'), order.pay.account_number)]
      : [copyRow(t('pay_exact_usdt'), `${usdt(order.usdt_micro)} USDT`, plainUsdt(order.usdt_micro)),
         h('div', { class: 'well copy-row' }, h('div', { class: 'grow' }, h('div', { class: 'k' }, t('pay_network')), h('div', { class: 'v' }, order.pay.label))),
         copyRow(t('pay_addr'), order.pay.address)];
    return h('section', { class: 'clay stack' },
      h('div', { class: 'row between' }, h('h2', { class: 'section-title' }, t(order.side === 'service' ? 'pay_title_service' : buy ? 'pay_title_buy' : 'pay_title_sell')),
        h('span', { class: 'row' }, icon('clock', 18), timerEl)),
      ...rows,
      h('div', { class: `notice ${buy ? '' : 'warn'}` }, icon(buy ? 'info' : 'alert', 20), buy ? t(order.side === 'service' ? 'pay_note_service' : 'pay_note_buy') : t('pay_note_sell', { network: order.pay.label })));
  }

  function evidenceCard() {
    const buy = order.side !== 'sell';
    const input = h('input', { type: 'text', value: text, placeholder: t(buy ? 'evidence_ph_buy' : 'evidence_ph_sell'), autocomplete: 'off', 'aria-label': t(buy ? 'evidence_title_buy' : 'evidence_title_sell'), maxLength: 300 });
    input.addEventListener('input', () => { text = input.value; syncActions(); });
    const fileInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/*', class: 'sr', tabIndex: -1, 'aria-hidden': 'true' });
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      file = await shrinkImage(f);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(file);
      haptic.select();
      signature = ''; render(); syncActions();
    });
    const pick = h('button', { class: `upload ${file ? 'has' : ''}`, type: 'button', onclick: () => fileInput.click() },
      file ? h('img', { src: previewUrl, alt: '' }) : h('span', { class: 'ic' }, icon('camera', 24)),
      h('span', { class: 'grow' }, h('div', { class: 'strong' }, file ? t('change_photo') : t('attach_photo')), h('div', { class: 'tiny' }, file ? file.name : t('photo_hint'))));
    return h('section', { class: 'clay stack' },
      h('h2', { class: 'section-title' }, t(buy ? 'evidence_title_buy' : 'evidence_title_sell')),
      pick, fileInput,
      h('div', { class: 'well input-wrap' }, input));
  }

  function timeline() {
    return h('section', { class: 'clay stack' },
      h('h2', { class: 'section-title' }, t('history')),
      h('ol', { class: 'timeline' }, order.events.map((e) => {
        const cls = ['rejected', 'cancelled', 'expired'].includes(e.to) && e.from !== e.to ? 'neg' : e.to === 'completed' && e.from !== e.to ? 'pos' : '';
        const who = t(`by_${e.by === 'user' ? 'you' : e.by}`);
        return h('li', { class: cls }, h('i', { class: 'pt' }), h('div', { class: 't' }, eventLabel(e, order.side)),
          h('div', { class: 'd' }, `${formatWhen(e.at)} · ${who}`));
      })));
  }

  const ended = (titleKey, bodyKey, kind) => h('section', { class: 'clay stack' },
    h('div', { class: `notice ${kind}` }, icon(kind === 'warn' ? 'alert' : 'info', 20), h('div', null, h('div', { class: 'strong' }, t(titleKey)), h('div', null, t(bodyKey)))),
    h('div', { class: 'row' },
      h('button', { class: 'btn grow', type: 'button', onclick: () => ctx.go('/support') }, t('contact_support')),
      h('button', { class: 'btn primary grow', type: 'button', onclick: () => ctx.replace('/') }, t('new_order'))));

  function doneCard() {
    const buy = order.side === 'buy';
    return h('section', { class: 'clay stack' },
      h('div', { class: 'row' }, h('div', { class: 'success-mark' }, icon('check', 40)),
        h('div', { class: 'grow' }, h('h2', { class: 'section-title' }, t(`done_title_${order.side}`)), h('p', { class: 'muted small' }, t(`done_body_${order.side}`)))),
      order.completion_ref ? copyRow(t('reference'), order.completion_ref) : null,
      buy && order.usdt_address ? copyRow(t('row_address'), order.usdt_address) : null);
  }

  // ----- render -----
  function render() {
    timerEl = null;
    body.replaceChildren();
    if (!order) {
      if (loadError) {
        body.append(h('section', { class: 'clay stack' },
          h('div', { class: 'notice warn' }, icon('alert', 20), errorText(loadError)),
          h('button', { class: 'btn', type: 'button', onclick: () => { loadError = null; load(); } }, t('retry'))));
      }
      return;
    }
    body.append(summaryCard());
    const s = order.status;
    if (s === 'awaiting_payment') {
      body.append(payCard(), evidenceCard(),
        h('button', { class: 'btn danger', type: 'button', onclick: cancel }, t('cancel_order')));
    } else if (s === 'evidence_submitted') {
      body.append(h('section', { class: 'clay stack' },
        h('div', { class: 'notice' }, icon('shield', 20), h('div', null, h('div', { class: 'strong' }, t('wait_review_title')), h('div', null, t('wait_review_body'))))));
      if (showMore) body.append(evidenceCard());
      else body.append(h('button', { class: 'btn', type: 'button', onclick: () => { showMore = true; signature = ''; load(); } }, t('add_another')));
    } else if (s === 'processing') {
      body.append(h('section', { class: 'clay stack' },
        h('div', { class: 'notice' }, icon('shield', 20), h('div', null, h('div', { class: 'strong' }, t(`proc_title_${order.side}`)), h('div', null, t(`proc_body_${order.side}`)))),
        order.completion_ref ? copyRow(t('reference'), order.completion_ref) : null));
    } else if (s === 'completed') {
      body.append(doneCard());
    } else if (s === 'rejected') body.append(ended('rejected_title', 'rejected_body', 'warn'));
    else if (s === 'expired') {
      body.append(ended('expired_title', 'expired_body', 'warn'));
      if (lateOk()) body.append(h('div', { class: 'notice' }, icon('info', 20), t('late_paid_hint')), evidenceCard());
    }
    else if (s === 'cancelled') body.append(ended('cancelled_title', 'cancelled_body', ''));
    body.append(timeline());
    syncActions();
  }

  // ----- actions -----
  const lateOk = () => order && order.status === 'expired' && serverNow() < order.expires_at + 86400;
  const canSend = () => order && (order.status === 'awaiting_payment' || (order.status === 'evidence_submitted' && showMore) || lateOk());
  function syncActions() {
    if (!canSend()) return setActions(null);
    const expired = order.status === 'awaiting_payment' && serverNow() >= order.expires_at;
    setActions({ text: t('send_receipt'), loading: busy, disabled: expired || !(text.trim() || file), onClick: send });
  }

  async function send() {
    if (busy || !canSend() || !(text.trim() || file)) return;
    busy = true; syncActions();
    const form = new FormData();
    if (text.trim()) form.append('text', text.trim());
    if (file) form.append('photo', file, file.name || 'receipt.jpg');
    try {
      const res = await api.sendEvidence(id, form);
      order = res.order;
      text = ''; file = null; showMore = false;
      if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
      toast(t('receipt_sent'), 'ok');
      ctx.openIds = ctx.openIds || new Set(); ctx.openIds.add(order.id);
    } catch (err) {
      toast(errorText(err), 'error');
      if (err.code === 'expired' || err.code === 'not_open') await load();
    }
    busy = false; signature = ''; render();
  }

  async function cancel() {
    if (!(await confirmDialog(t('cancel_confirm')))) return;
    try {
      const res = await api.cancelOrder(id);
      order = res.order;
      toast(t('order_cancelled'), 'ok');
      S.activeCount = Math.max(0, S.activeCount - 1); ctx.updateNav();
      signature = ''; render();
    } catch (err) {
      toast(errorText(err), 'error');
      load();
    }
  }

  // ----- clocks -----
  function tickTimer() {
    if (!timerEl || !order || order.status !== 'awaiting_payment') return;
    const left = order.expires_at - serverNow();
    timerEl.textContent = left > 0 ? countdown(left) : t('time_up');
    timerEl.classList.toggle('low', left < 120);
    if (left <= 0 && !tickTimer.fired) { tickTimer.fired = true; load(); syncActions(); }
  }
  const clock = setInterval(tickTimer, 1000);
  const poll = setInterval(() => { if (!document.hidden && order && isOpen(order.status) && !busy) load({ quiet: true }); }, 8000);

  load();
  return {
    el: root,
    refresh: () => load({ quiet: true }),
    destroy() {
      dead = true;
      clearInterval(clock); clearInterval(poll);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
  };
}
