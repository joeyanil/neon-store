// Admin: the order queue, order review (proofs, what to check, what to release), tickets inbox.
import { admin, ApiError, fetchImage, serverNow } from './api.js';
import { S, langPill, topBar } from './components.js';
import { countBubble, flowTop, listRow, textArea, textField } from './form.js';
import { errorText, formatAgo, formatWhen, t } from './i18n.js';
import { confirmDialog, haptic, openTelegramLink, setActions } from './tg.js';
import { copyButton, copyText, etb, h, icon, shrinkImage, skeletons, statusBadge, toast, usdt } from './ui.js';

const FILTERS = [['review', 'To review'], ['release', 'To release'], ['open', 'All open'], ['done', 'Done']];
const REASONS = [['not_received', 'Payment not received'], ['amount_mismatch', 'Amount does not match'], ['unreadable', 'Proof unreadable'], ['other', 'Other reason']];
const plainEtb = (c) => (c / 100).toFixed(2);
const plainUsdt = (m) => (m / 1e6).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
const who = (c) => c.first_name || (c.username ? `@${c.username}` : String(c.id));
const sideDot = (side) => h('span', { class: `side-dot ${side === 'service' ? 'svc' : side}`, 'aria-hidden': 'true' }, icon(side === 'service' ? 'bag' : side === 'buy' ? 'arrowdown' : 'arrowup', 20));
const sideWord = (o) => (o.side === 'service' ? `Service × ${Number(o.quantity).toLocaleString('en-US')}` : `${o.side === 'buy' ? 'Buy' : 'Sell'} ${usdt(o.usdt_micro)} USDT`);

// ---------- queue ----------
export function adminHomeScreen(ctx) {
  let filter = ctx.params.filter || 'review';
  let dead = false;
  let items = [];
  let next = null;
  const summaryBox = h('div', { class: 'tile-grid' });
  const tabs = h('div', { class: 'tabs-scroll', role: 'group', 'aria-label': 'Filter' });
  const list = h('div', { class: 'stack' });
  const links = h('div', { class: 'stack' });
  const banner = h('div', { class: 'stack' });

  const paintTabs = (counts) => tabs.replaceChildren(...FILTERS.map(([f, label]) => h('button', {
    class: 'chip', type: 'button', 'aria-pressed': String(filter === f), 'data-f': f,
    onclick: () => { if (filter !== f) { haptic.select(); filter = f; paintTabs(counts); load(true); } },
  }, label, counts && counts[f] ? ` · ${counts[f]}` : '')));
  paintTabs(null);

  async function loadSummary() {
    try {
      const s = await admin.summary();
      if (dead) return;
      S.adminBadge = s.counts.review + s.counts.release + s.counts.tickets;
      ctx.updateNav();
      paintTabs({ review: s.counts.review, release: s.counts.release, open: s.counts.review + s.counts.release + s.counts.waiting });
      summaryBox.replaceChildren(
        h('div', { class: 'tile' }, h('div', { class: 'tiny' }, 'Needs review'), h('div', { class: 'num big-amount' }, String(s.counts.review))),
        h('div', { class: 'tile' }, h('div', { class: 'tiny' }, 'To release'), h('div', { class: 'num big-amount' }, String(s.counts.release))));
      links.replaceChildren(...[
        listRow({ title: 'Support tickets', sub: s.counts.tickets ? `${s.counts.tickets} waiting for a reply` : 'All answered', badge: countBubble(s.counts.tickets), lead: h('span', { class: 'side-dot svc' }, icon('ticket', 20)), onClick: () => ctx.go('/admin/tickets') }),
        s.role === 'owner' ? listRow({ title: 'Shop settings', sub: s.paused ? 'Shop is paused' : 'Accounts, rates, services, rules, team', lead: h('span', { class: 'side-dot svc' }, icon('settings', 20)), onClick: () => ctx.go('/admin/settings') }) : null].filter(Boolean));
      if (s.role === 'owner') {
        const setup = await admin.setup();
        if (dead) return;
        banner.replaceChildren(...(setup.complete ? [] : [h('button', { class: 'clay tight list-row', type: 'button', onclick: () => ctx.go('/admin/setup') },
          h('span', { class: 'side-dot svc' }, icon('alert', 20)), h('div', { class: 'grow' }, h('div', { class: 'strong' }, 'Finish setting up the shop'), h('div', { class: 'tiny' }, 'A few steps are still missing')), icon('chevron', 20))]));
      }
    } catch { /* the list below shows the error */ }
  }

  function paint() {
    list.replaceChildren();
    if (!items.length) { list.append(h('div', { class: 'clay' }, h('p', { class: 'muted' }, filter === 'review' ? 'Nothing waiting for review.' : filter === 'release' ? 'Nothing waiting to be released.' : 'Nothing here.'))); return; }
    for (const o of items) {
      list.append(h('button', { class: 'clay tight order-card', type: 'button', onclick: () => ctx.go(`/admin/order/${o.id}`) },
        h('div', { class: 'row' }, sideDot(o.side),
          h('div', { class: 'grow' }, h('div', { class: 'num strong' }, sideWord(o)), h('div', { class: 'tiny ellipsis' }, `${o.id} · ${who(o.customer)} · ${formatAgo(o.updated_at, serverNow())}`)), icon('chevron', 20)),
        h('div', { class: 'row between' }, h('span', { class: 'row' }, statusBadge(o.status), o.late ? h('span', { class: 'pill warn' }, 'Late') : null), h('div', { class: 'num small strong' }, `${etb(o.etb_cents)} ETB`))));
    }
    if (next) list.append(h('button', { class: 'btn', type: 'button', onclick: () => load(false) }, t('load_more')));
  }
  async function load(reset) {
    if (reset) { items = []; next = null; list.replaceChildren(...skeletons(96, 96)); }
    try {
      const res = await admin.orders(filter, reset ? null : next);
      if (dead) return;
      items = reset ? res.orders : items.concat(res.orders);
      next = res.next;
      paint();
    } catch (err) {
      if (!dead) list.replaceChildren(h('div', { class: 'notice warn' }, icon('alert', 20), errorText(err)));
    }
  }
  const root = h('div', { class: 'screen' }, topBar({ title: 'Admin', sub: S.boot.role === 'owner' ? 'Owner' : 'Staff', right: langPill(ctx.toggleLang) }), banner, summaryBox, tabs, list, links);
  loadSummary(); load(true);
  const poll = setInterval(() => { if (!document.hidden) { loadSummary(); load(true); } }, 20000);
  return { el: root, refresh: () => { loadSummary(); load(true); }, destroy() { dead = true; clearInterval(poll); } };
}

// ---------- order review ----------
export function adminOrderScreen(ctx) {
  const id = ctx.params.id;
  let detail = null;
  let dead = false;
  let busy = false;
  let rejecting = false;
  let reason = 'not_received';
  const urls = [];
  const body = h('div', { class: 'stack' }, ...skeletons(180, 120));
  const root = h('div', { class: 'screen flow' }, flowTop(ctx, id), body);
  let refField = null;

  const copyRow = (label, value, raw) => h('div', { class: 'well copy-row' }, h('div', { class: 'grow' }, h('div', { class: 'k' }, label), h('div', { class: 'v' }, value)), copyButton(raw ?? value, label));
  const plain = (label, value) => h('div', { class: 'well copy-row' }, h('div', { class: 'grow' }, h('div', { class: 'k' }, label), h('div', { class: 'v' }, value)));

  function checkCard(o) {
    const pay = o.pay;
    if (o.side === 'sell') {
      return h('section', { class: 'clay stack' }, h('h2', { class: 'section-title' }, '1 · Check in Bybit / your wallet'),
        h('p', { class: 'muted small' }, 'Confirm the USDT arrived. Compare the amount and the network.'),
        copyRow('USDT expected', `${usdt(o.usdt_micro)} USDT`, plainUsdt(o.usdt_micro)), plain('Network', pay.label), copyRow('Your deposit address', pay.address));
    }
    return h('section', { class: 'clay stack' }, h('h2', { class: 'section-title' }, '1 · Check in your bank / Telebirr app'),
      h('p', { class: 'muted small' }, 'Confirm the birr arrived in this account for this amount, with the order number or customer name.'),
      copyRow('Birr expected', `${etb(o.etb_cents)} ETB`, plainEtb(o.etb_cents)), plain('Account', `${pay.label_en} · ${pay.account_name}`), copyRow('Account number', pay.account_number));
  }
  function releaseCard(o) {
    if (o.side === 'buy') {
      return h('section', { class: 'clay stack' }, h('h2', { class: 'section-title' }, '2 · Then send the customer their USDT'),
        copyRow('USDT to send', `${usdt(o.usdt_micro)} USDT`, plainUsdt(o.usdt_micro)), plain('Network', o.network_label || o.network), copyRow('Customer address', o.usdt_address));
    }
    if (o.side === 'sell') {
      return h('section', { class: 'clay stack' }, h('h2', { class: 'section-title' }, '2 · Then pay the customer their birr'),
        copyRow('Birr to send', `${etb(o.etb_cents)} ETB`, plainEtb(o.etb_cents)), plain('Via', o.method.label_en), copyRow('Account holder', o.payout_name), copyRow('Account / phone', o.payout_account));
    }
    return h('section', { class: 'clay stack' }, h('h2', { class: 'section-title' }, '2 · Then deliver the service'),
      plain('Service', o.pay.service?.name_en || o.service), plain('Quantity', Number(o.quantity).toLocaleString('en-US')), copyRow('Deliver to', o.target));
  }

  function customerCard(d) {
    const c = d.customer;
    return h('section', { class: 'clay stack' },
      h('div', { class: 'row between' }, h('div', null, h('div', { class: 'strong' }, c.first_name || 'Customer'), h('div', { class: 'tiny' }, `${c.username ? `@${c.username} · ` : ''}ID ${c.id}`)),
        c.blocked ? h('span', { class: 'pill bad' }, 'Blocked') : null),
      h('div', { class: 'tiny' }, `${c.completed_orders} completed of ${c.total_orders} orders · member since ${formatWhen(c.member_since)}`),
      h('div', { class: 'row' },
        c.username ? h('button', { class: 'btn small grow', type: 'button', onclick: () => openTelegramLink(`https://t.me/${c.username}`) }, icon('send', 18), 'Message') : null,
        h('button', { class: `btn small grow ${c.blocked ? '' : 'danger'}`, type: 'button', onclick: () => toggleBlock(c) }, c.blocked ? 'Unblock' : 'Block customer')));
  }

  function proofsCard(o) {
    const items = o.proofs || [];
    if (!items.length) return null;
    const grid = h('div', { class: 'proofs' });
    const texts = [];
    for (const p of items) {
      if (p.text) texts.push(p.text);
      if (p.has_image) {
        const cell = h('button', { type: 'button', 'aria-label': 'Open proof' }, '…');
        grid.append(cell);
        fetchImage(`/api/orders/${id}/proofs/${p.id}`).then((u) => {
          urls.push(u);
          cell.replaceChildren(h('img', { src: u, alt: 'Proof' }));
          cell.onclick = () => lightbox(u);
        }).catch(() => { cell.textContent = 'Unavailable'; });
      } else if (p.removed) grid.append(h('button', { type: 'button', disabled: true }, 'Deleted after retention'));
    }
    return h('section', { class: 'clay stack' }, h('h2', { class: 'section-title' }, `Customer proof (${items.length})`),
      grid.children.length ? grid : null,
      ...texts.map((x) => h('div', { class: 'well copy-row' }, h('div', { class: 'grow' }, h('div', { class: 'k' }, 'Transaction no.'), h('div', { class: 'v' }, x)), copyButton(x, 'Transaction no.'))));
  }

  function lightbox(src) {
    const box = h('div', { class: 'lightbox', role: 'dialog', onclick: () => box.remove() }, h('img', { src, alt: 'Proof' }), h('button', { class: 'btn primary lightbox-close', type: 'button', onclick: () => box.remove() }, 'Close'));
    document.body.append(box);
  }

  function warningsCard(d) {
    const notes = [];
    if (d.order.late) notes.push(h('div', { class: 'notice warn' }, icon('clock', 20), 'Late proof: the customer paid after the payment window closed. The rate was locked at creation; reject if the market moved too far.'));
    for (const w of d.warnings || []) {
      notes.push(h('div', { class: 'notice warn' }, icon('alert', 20), h('div', null, w.kind === 'image' ? 'This exact image was already used on ' : 'This transaction number was already used on ',
        h('button', { class: 'linklike', type: 'button', onclick: () => ctx.go(`/admin/order/${w.order_id}`) }, w.order_id), '. Check carefully before confirming.')));
    }
    return notes.length ? h('div', { class: 'stack' }, ...notes) : null;
  }

  function actionsCard(o) {
    if (o.status === 'evidence_submitted' || o.status === 'awaiting_payment' || o.status === 'expired' || o.status === 'processing') {
      const parts = [];
      if (o.status === 'processing') {
        refField = textField({ label: o.side === 'service' ? 'Note for the customer (optional)' : o.side === 'buy' ? 'Transaction hash / Bybit reference' : 'Bank or Telebirr reference', placeholder: o.side === 'service' ? 'Optional' : 'Required: the customer sees this', hint: o.side === 'service' ? '' : 'Paste it from your app so the customer can check it.' });
        parts.push(refField.el);
      }
      if (rejecting) {
        parts.push(h('div', { class: 'stack' }, h('div', { class: 'label section-title' }, 'Why are you rejecting it?'),
          h('div', { class: 'choices', role: 'radiogroup' }, REASONS.map(([k, label]) => {
            const b = h('button', { class: 'choice', type: 'button', role: 'radio', 'aria-checked': String(reason === k), 'data-k': k }, h('span', { class: 'grow strong' }, label), h('span', { class: 'tick' }, icon('check', 14)));
            b.addEventListener('click', () => { haptic.select(); reason = k; b.parentElement.querySelectorAll('.choice').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.k === k))); });
            return b;
          })),
          h('button', { class: 'btn danger block', type: 'button', onclick: () => doReject(o) }, 'Reject order'),
          h('button', { class: 'btn block', type: 'button', onclick: () => { rejecting = false; render(); } }, t('back'))));
      } else if (o.status !== 'awaiting_payment' && o.status !== 'expired') {
        parts.push(h('button', { class: 'btn danger block', type: 'button', onclick: () => { rejecting = true; render(); } }, 'Reject…'));
      } else {
        parts.push(h('button', { class: 'btn danger block', type: 'button', onclick: () => { rejecting = true; render(); } }, 'Reject…'));
      }
      return h('section', { class: 'clay stack' }, ...parts);
    }
    return null;
  }

  function timeline(o) {
    return h('section', { class: 'clay stack' }, h('h2', { class: 'section-title' }, t('history')),
      h('ol', { class: 'timeline' }, o.events.map((e) => {
        const cls = ['rejected', 'cancelled', 'expired'].includes(e.to) && e.from !== e.to ? 'neg' : e.to === 'completed' && e.from !== e.to ? 'pos' : '';
        const label = e.from === null ? 'Order created' : e.from === e.to ? (e.note || 'Update') : `${e.from.replace('_', ' ')} → ${e.to.replace('_', ' ')}${e.note ? ` (${e.note})` : ''}`;
        const by = e.by === 'admin' ? `admin ${e.by_name || e.by_id || ''}` : e.by;
        return h('li', { class: cls }, h('i', { class: 'pt' }), h('div', { class: 't' }, label), h('div', { class: 'd' }, `${formatWhen(e.at)} · ${by}`));
      })));
  }

  function render() {
    if (!detail) return;
    const o = detail.order;
    body.replaceChildren(
      h('section', { class: 'clay stack' },
        h('div', { class: 'row between' }, statusBadge(o.status), h('span', { class: 'tiny' }, formatWhen(o.created_at))),
        h('div', { class: 'num strong' }, sideWord(o)), h('div', { class: 'num big-amount' }, `${etb(o.etb_cents)} ETB`),
        o.side === 'service' ? null : h('div', { class: 'tiny' }, `Rate ${etb(o.rate_cents)} ETB / USDT, locked at creation`),
        o.reject_reason ? h('div', { class: 'notice warn' }, icon('alert', 20), `Rejected: ${REASONS.find(([k]) => k === o.reject_reason)?.[1] || o.reject_reason}`) : null,
        o.completion_ref ? copyRow('Reference sent', o.completion_ref) : null),
      ...[warningsCard(detail), customerCard(detail), checkCard(o), proofsCard(o), releaseCard(o), actionsCard(o), timeline(o)].filter(Boolean));
    syncActions();
  }

  function syncActions() {
    const o = detail?.order;
    if (!o || rejecting) return setActions(null);
    if (o.status === 'evidence_submitted') return setActions({ text: 'Payment received', loading: busy, onClick: doConfirm });
    if (o.status === 'processing') return setActions({ text: o.side === 'service' ? 'Mark delivered' : 'Mark as released', loading: busy, onClick: doRelease });
    setActions(null);
  }

  async function run(fn) {
    if (busy) return;
    busy = true; syncActions();
    try {
      const res = await fn();
      detail = res;
      if (res.applied === false) toast(res.message, 'error'); else toast(res.message || 'Done', 'ok');
    } catch (err) {
      if (err.code === 'not_applied') await load();
      toast(errorText(err), 'error');
      if (err.extra?.field === 'reference') refField?.error(err.message);
    }
    busy = false; rejecting = false; render();
  }
  async function doConfirm() {
    if (!(await confirmDialog(detail.order.side === 'sell' ? 'Have you seen the USDT arrive?' : detail.order.side === 'service' ? 'Have you seen the birr arrive?' : 'Have you seen the birr arrive in your account?'))) return;
    await run(() => admin.act(id, 'confirm'));
  }
  async function doRelease() {
    const ref = refField?.get() || '';
    if (detail.order.side !== 'service' && ref.length < 3) { refField?.error('Enter the transaction hash or bank reference first.'); haptic.error(); return; }
    if (!(await confirmDialog(detail.order.side === 'service' ? 'Mark this service as delivered?' : 'Have you really sent the money? The customer is told right now.'))) return;
    await run(() => admin.act(id, 'release', { reference: ref }));
  }
  async function doReject() {
    if (!(await confirmDialog('Reject this order? The customer is told.'))) return;
    await run(() => admin.act(id, 'reject', { reason }));
  }
  async function toggleBlock(c) {
    if (!(await confirmDialog(c.blocked ? 'Let this customer order again?' : 'Block this customer from placing new orders?'))) return;
    try { await admin.block(c.id, !c.blocked); toast(c.blocked ? 'Unblocked' : 'Blocked', 'ok'); await load(); } catch (err) { toast(errorText(err), 'error'); }
  }
  async function load() {
    try {
      const d = await admin.order(id);
      if (dead) return;
      detail = d; render();
    } catch (err) {
      if (!dead) body.replaceChildren(h('div', { class: 'notice warn' }, icon('alert', 20), errorText(err)));
    }
  }
  load();
  const poll = setInterval(() => { if (!document.hidden && !busy && !rejecting && !document.activeElement?.matches?.('input, textarea')) load(); }, 10000);
  return { el: root, refresh: load, destroy() { dead = true; clearInterval(poll); urls.forEach((u) => URL.revokeObjectURL(u)); setActions(null); } };
}

// ---------- tickets inbox ----------
export function adminTicketsScreen(ctx) {
  let status = 'open';
  let dead = false;
  const tabs = h('div', { class: 'tabs-scroll' });
  const list = h('div', { class: 'stack' });
  const paintTabs = (counts) => tabs.replaceChildren(...[['open', 'Needs reply'], ['answered', 'Answered'], ['closed', 'Closed']].map(([k, label]) => h('button', {
    class: 'chip', type: 'button', 'aria-pressed': String(status === k), onclick: () => { if (status !== k) { status = k; load(); } },
  }, label, counts?.[k] ? ` · ${counts[k]}` : '')));
  paintTabs();
  async function load() {
    list.replaceChildren(...skeletons(70, 70));
    try {
      const d = await admin.tickets(status);
      if (dead) return;
      paintTabs(d.counts);
      list.replaceChildren(...(d.tickets.length ? d.tickets.map((tk) => listRow({
        title: `${tk.id} · ${tk.customer.first_name || tk.customer.id}`, sub: `${t(`cat_${tk.category}`)} · ${tk.preview}`, onClick: () => ctx.go(`/admin/ticket/${tk.id}`),
      })) : [h('div', { class: 'clay' }, h('p', { class: 'muted' }, 'No tickets here.'))]));
    } catch (err) { if (!dead) list.replaceChildren(h('div', { class: 'notice warn' }, icon('alert', 20), errorText(err))); }
  }
  load();
  return { el: h('div', { class: 'screen' }, flowTop(ctx, 'Support tickets'), tabs, list), refresh: load, destroy: () => { dead = true; } };
}

export function adminTicketScreen(ctx) {
  const id = ctx.params.id;
  let dead = false;
  let busy = false;
  let detail = null;
  const urls = [];
  const thread = h('div', { class: 'thread' });
  const head = h('div', { class: 'stack' });
  const reply = textArea({ placeholder: 'Write your reply. The customer gets it in Telegram.', rows: 4, maxLength: 1500 });
  const root = h('div', { class: 'screen flow' }, flowTop(ctx, id), h('section', { class: 'clay stack' }, head, thread), h('section', { class: 'clay stack' }, reply.el,
    h('button', { class: 'btn block', type: 'button', onclick: close }, 'Close ticket')));
  reply.input.addEventListener('input', sync);

  async function load() {
    try {
      detail = await admin.ticket(id);
      if (dead) return;
      const c = detail.customer;
      head.replaceChildren(h('div', { class: 'row between' }, h('span', { class: 'strong' }, `${c.first_name || ''} ${c.username ? `@${c.username}` : c.id}`), h('span', { class: 'pill' }, t(`ticket_status_${detail.ticket.status}`))),
        h('div', { class: 'tiny' }, t(`cat_${detail.ticket.category}`)),
        detail.ticket.order_id ? h('button', { class: 'btn small', type: 'button', onclick: () => ctx.go(`/admin/order/${detail.ticket.order_id}`) }, `Open order ${detail.ticket.order_id}`) : null);
      thread.replaceChildren(...detail.messages.map((m) => {
        const b = h('div', { class: `bubble-msg ${m.sender === 'admin' ? 'me' : ''}` }, h('div', { class: 'who' }, `${m.sender === 'admin' ? 'Support' : c.first_name || 'Customer'} · ${formatWhen(m.at)}`), m.body || null);
        if (m.has_photo) fetchImage(`/api/admin/tickets/${id}/photos/${m.id}`).then((u) => { urls.push(u); b.append(h('img', { src: u, alt: '' })); }).catch(() => {});
        return b;
      }));
      sync();
    } catch (err) { if (!dead) thread.replaceChildren(h('div', { class: 'notice warn' }, icon('alert', 20), errorText(err))); }
  }
  async function send() {
    if (busy || !reply.get()) return;
    busy = true; sync();
    try { await admin.ticketReply(id, reply.get()); reply.set(''); toast('Sent to the customer', 'ok'); await load(); } catch (err) { toast(errorText(err), 'error'); }
    busy = false; sync();
  }
  async function close() {
    if (!(await confirmDialog('Close this ticket? A new message from the customer reopens it.'))) return;
    try { await admin.ticketClose(id); toast('Closed', 'ok'); await load(); } catch (err) { toast(errorText(err), 'error'); }
  }
  function sync() { setActions({ text: 'Send reply', disabled: !reply.get(), loading: busy, onClick: send }); }
  load();
  return { el: root, refresh: load, destroy() { dead = true; urls.forEach((u) => URL.revokeObjectURL(u)); setActions(null); } };
}
