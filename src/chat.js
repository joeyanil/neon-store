// Chat mode of the bot: everything the Mini App does, as guided conversations inside Telegram.
// One message is edited as the person moves along; typed answers are removed to keep the chat tidy.
import { createOrder } from './create.js';
import { ApiError } from './http.js';
import { etbForUsdt, parseUsdt } from './money.js';
import { cleanAccount, cleanAddress, cleanName, cleanNote, cleanTarget, isOrderId } from './validate.js';
import { OPEN_STATUSES, customerStats, getCatalog, getOrderRow, getSettings, listOrders, nowSec, orderView, sideAvailability, stockInfo, unlockProgress } from './orders.js';
import { cancelOrder, submitEvidence } from './service.js';
import { listPolicies } from './shop-admin.js';
import { createTicket, customerReply, getTicket, isTicketId, listTickets, threadOf } from './tickets.js';
import { BTN_ADMIN, handleAdminCallback, handleAdminInput } from './chat-admin.js';
import { G, P, R, W, btn, clearSession, grid, homeRow, makeCtx, newIdem, progress, saveSession, show, tidy } from './chat-core.js';
import { etb, usdt } from './chat-text.js';
import { esc } from './telegram.js';

const STEPS = {
  buy: ['method', 'network', 'amount', 'wallet', 'confirm'],
  sell: ['network', 'method', 'amount', 'name', 'account', 'confirm'],
  svc: ['platform', 'service', 'qty', 'link', 'method', 'confirm'],
};
const STEP_LABEL = {
  buy: { method: 'method', network: 'network', amount: 'amount', wallet: 'wallet', confirm: 'confirm' },
  sell: { network: 'network', method: 'payout', amount: 'amount', name: 'name', account: 'account', confirm: 'confirm' },
  svc: { platform: 'platform', service: 'service', qty: 'qty', link: 'link', method: 'pay', confirm: 'confirm' },
};
const STATUS_ICON = { awaiting_payment: '⏳', evidence_submitted: '🔎', processing: '⚙️', completed: '✅', rejected: '❌', cancelled: '🚫', expired: '⌛' };
const microToInput = (m) => (m / 1e6).toFixed(6);

const methodLabel = (ctx, m) => (ctx.lang === 'am' ? m.label_am || m.label_en : m.label_en);
const serviceName = (ctx, sv) => (ctx.lang === 'am' ? sv.name_am || sv.name_en : sv.name_en);

async function shop(ctx) {
  const [settings, catalog, stats] = await Promise.all([getSettings(ctx.db), getCatalog(ctx.db), customerStats(ctx.db, ctx.user.id)]);
  return { settings, catalog, avail: sideAvailability(settings, catalog), stats };
}

// ---------- menu ----------

export async function showMenu(ctx, note = '') {
  await clearSession(ctx);
  const b = ctx.s.btn;
  const rows = [
    [btn(b.buy, 'c:buy', G), btn(b.sell, 'c:sell', P)],
    [btn(b.services, 'c:svc', P), btn(b.rates, 'c:rates', W)],
    [btn(b.orders, 'c:ol:active:0', W), btn(b.support, 'c:sup', P)],
    [btn(b.policies, 'c:pol', W)],
  ];
  if (ctx.base && ctx.chatId > 0) rows.push([{ text: b.app, web_app: { url: `${ctx.base}/` } }]);
  if (ctx.role) rows.push([btn(b.admin, BTN_ADMIN, P)]);
  return show(ctx, `<b>${ctx.s.menuTitle}</b>\n${ctx.s.menuIntro}${note ? `\n\n${note}` : ''}`, rows);
}

// ---------- rates ----------

async function showRates(ctx) {
  const { settings, avail } = await shop(ctx);
  const st = await stockInfo(ctx.db, settings);
  const rows = [];
  if (avail.buy) rows.push(btn(ctx.s.btn.buyNow, 'c:buy', G));
  if (avail.sell) rows.push(btn(ctx.s.btn.sellNow, 'c:sell', P));
  const text = settings.max_usdt_micro > 0 && settings.buy_rate_cents > 0
    ? ctx.s.rateCard({ buy: settings.buy_rate_cents, sell: settings.sell_rate_cents, min: settings.min_usdt_micro, max: settings.max_usdt_micro, stock: st.tracking && st.show ? st.available : null, updated: ctx.s.ago(nowSec() - settings.rate_updated_at) })
    : ctx.s.shopClosed;
  return show(ctx, text, [rows, homeRow(ctx)].filter((r) => r.length));
}

// ---------- the buy / sell / service flows ----------

async function startFlow(ctx, flow) {
  const { settings, avail } = await shop(ctx);
  const open = flow === 'buy' ? avail.buy : flow === 'sell' ? avail.sell : avail.service;
  if (settings.paused) return show(ctx, ctx.s.paused, [homeRow(ctx)]);
  if (!open) return show(ctx, ctx.s.shopClosed, [homeRow(ctx)]);
  ctx.session = { flow, step: STEPS[flow][0], data: { idem: newIdem(ctx.user.id) } };
  return renderStep(ctx);
}

const head = (ctx, err) => {
  const { flow, step } = ctx.session;
  const title = flow === 'buy' ? ctx.s.btn.buy : flow === 'sell' ? ctx.s.btn.sell : ctx.s.btn.services;
  const labels = STEPS[flow].map((st) => ctx.s.steps[STEP_LABEL[flow][st]]);
  const preview = ctx.session.data.preview && step !== 'amount' ? `🧮 ${ctx.session.data.preview}\n\n` : '';
  return `<b>${title}</b>\n${progress(labels, STEPS[flow].indexOf(step))}\n\n${preview}${err ? `${ctx.s.err(err)}\n\n` : ''}`;
};

const PLATFORM_ICON = { telegram: '✈️', instagram: '📸', tiktok: '🎵', youtube: '▶️', other: '🔹' };
const navRow = (ctx) => [btn(ctx.s.btn.back, 'c:back'), btn(ctx.s.btn.cancel, 'c:x', R)];

/** Draws the screen for the current step. */
async function renderStep(ctx, err = '') {
  const { flow, step, data } = ctx.session;
  const { settings, catalog, stats } = await shop(ctx);
  const s = ctx.s;
  const h = head(ctx, err);

  if (step === 'method') {
    const side = flow === 'sell' ? 'sell' : 'buy';
    const list = catalog.methods.filter((m) => m[side]);
    const buttons = list.map((m) => {
      const lock = side === 'buy' ? unlockProgress(m.unlock, stats) : null;
      return btn(`${lock ? '🔒' : m.kind === 'bank' ? '🏦' : '📱'} ${methodLabel(ctx, m)}`, `c:pm:${m.code}`, lock ? W : P);
    });
    const info = flow === 'svc' ? '' : `💱 1 USDT = ${etb(flow === 'buy' ? settings.buy_rate_cents : settings.sell_rate_cents)} ETB\n\n`;
    return show(ctx, `${h}${info}${side === 'buy' ? s.pickMethodBuy : s.pickMethodSell}`, [...grid(buttons), navRow(ctx)]);
  }
  if (step === 'network') {
    const side = flow === 'sell' ? 'sell' : 'buy';
    const buttons = catalog.networks.filter((n) => n[side]).map((n) => btn(`🌐 ${n.label}`, `c:pn:${n.code}`));
    return show(ctx, `${h}${s.pickNetwork}`, [...grid(buttons), navRow(ctx)]);
  }
  if (step === 'amount') {
    const st = await stockInfo(ctx.db, settings);
    const stockLine = flow === 'buy' && st.tracking && st.show ? `\n📦 ${usdt(st.available)} USDT available` : '';
    const ask = flow === 'buy' ? s.askAmountBuy(settings.min_usdt_micro, settings.max_usdt_micro) : s.askAmountSell(settings.min_usdt_micro, settings.max_usdt_micro);
    return show(ctx, `${h}💱 1 USDT = ${etb(flow === 'buy' ? settings.buy_rate_cents : settings.sell_rate_cents)} ETB\n\n${ask}${stockLine}`, [navRow(ctx)]);
  }
  if (step === 'wallet') {
    const net = catalog.networks.find((n) => n.code === data.network);
    return show(ctx, `${h}${s.askWallet(net?.label || '')}`, [navRow(ctx)]);
  }
  if (step === 'name') return show(ctx, `${h}${s.askName}`, [navRow(ctx)]);
  if (step === 'account') {
    const m = catalog.methods.find((x) => x.code === data.method);
    return show(ctx, `${h}${s.askAccount(m?.kind === 'mobile')}`, [navRow(ctx)]);
  }
  if (step === 'platform') {
    const platforms = [...new Set(catalog.services.map((x) => x.platform))];
    return show(ctx, `${h}${s.askPlatform}`, [...grid(platforms.map((p) => btn(`${PLATFORM_ICON[p] || '🔹'} ${s.platforms[p] || p}`, `c:sp:${p}`))), navRow(ctx)]);
  }
  if (step === 'service') {
    const list = catalog.services.filter((x) => x.platform === data.platform);
    return show(ctx, `${h}${s.askService}`, [...list.map((x) => [btn(`${PLATFORM_ICON[x.platform] || '🔹'} ${s.serviceLine({ name: serviceName(ctx, x), price: x.price_cents_per_1000 })}`, `c:ss:${x.code}`)]), navRow(ctx)]);
  }
  if (step === 'qty') {
    const sv = catalog.services.find((x) => x.code === data.service);
    return show(ctx, `${h}${s.askQty({ min: sv.min_qty, max: sv.max_qty, price: sv.price_cents_per_1000, eta: sv.eta_text, warranty: sv.warranty_days, note: sv.note })}`, [navRow(ctx)]);
  }
  if (step === 'link') return show(ctx, `${h}${s.askLink(s.platforms[data.platform] || data.platform)}`, [navRow(ctx)]);
  if (step === 'confirm') return renderConfirm(ctx, h, settings, catalog);
}

function renderConfirm(ctx, h, settings, catalog) {
  const { flow, data } = ctx.session;
  const s = ctx.s;
  const method = catalog.methods.find((m) => m.code === data.method);
  const network = catalog.networks.find((n) => n.code === data.network);
  let body;
  if (flow === 'buy') {
    body = s.confirmBuy({ usdtMicro: data.usdt, total: etbForUsdt(data.usdt, settings.buy_rate_cents, 'up'), rate: settings.buy_rate_cents, method: methodLabel(ctx, method), network: network.label, address: data.address });
  } else if (flow === 'sell') {
    body = s.confirmSell({ usdtMicro: data.usdt, total: etbForUsdt(data.usdt, settings.sell_rate_cents, 'down'), rate: settings.sell_rate_cents, method: methodLabel(ctx, method), network: network.label, name: data.name, account: data.account });
  } else {
    const sv = catalog.services.find((x) => x.code === data.service);
    body = s.confirmService({ service: serviceName(ctx, sv), platform: s.platforms[sv.platform] || sv.platform, qty: data.qty, target: data.target, total: Math.ceil((data.qty * sv.price_cents_per_1000) / 1000), method: methodLabel(ctx, method) });
  }
  return show(ctx, `${h}${body}`, [[btn(s.btn.confirm, 'c:ok', G)], [btn(s.btn.change, `c:${flow}`, P), btn(s.btn.cancel, 'c:x', R)]]);
}

/** Moves to the next step (or back) and redraws. */
async function goStep(ctx, to, err = '') {
  ctx.session.step = to;
  return renderStep(ctx, err);
}
const nextStep = (ctx) => STEPS[ctx.session.flow][STEPS[ctx.session.flow].indexOf(ctx.session.step) + 1];

async function pickMethod(ctx, cb, code) {
  const { flow, data } = ctx.session;
  const { catalog, stats } = await shop(ctx);
  const m = catalog.methods.find((x) => x.code === code && (flow === 'sell' ? x.sell : x.buy));
  if (!m) return renderStep(ctx);
  const lock = flow === 'sell' ? null : unlockProgress(m.unlock, stats);
  if (lock) {
    await ctx.tg.answerCallbackQuery(cb.id, ctx.s.locked(methodLabel(ctx, m), lock.have, lock.need).replace(/<[^>]+>/g, ''), true).catch(() => {});
    return null;
  }
  data.method = code;
  return goStep(ctx, nextStep(ctx));
}

/** Typed answers for the step the person is on. */
async function handleFlowText(ctx, text) {
  const { flow, step, data } = ctx.session;
  const { settings, catalog } = await shop(ctx);
  const s = ctx.s;
  if (step === 'amount') {
    const u = parseUsdt(String(text).replace(/,/g, '').trim());
    if (!u) return renderStep(ctx, s.badAmount.replace(/^/, ''));
    if (u < settings.min_usdt_micro || u > settings.max_usdt_micro) return renderStep(ctx, s.outOfRange(settings.min_usdt_micro, settings.max_usdt_micro));
    if (flow === 'buy') {
      const st = await stockInfo(ctx.db, settings);
      if (st.tracking && u > st.available) return renderStep(ctx, st.show ? `Only ${usdt(st.available)} USDT is available right now.` : s.stockShort);
    }
    data.usdt = u;
    const preview = s.preview(u, etbForUsdt(u, flow === 'buy' ? settings.buy_rate_cents : settings.sell_rate_cents, flow === 'buy' ? 'up' : 'down'), flow);
    data.preview = preview;
    return goStep(ctx, nextStep(ctx));
  }
  if (step === 'wallet') {
    const net = catalog.networks.find((n) => n.code === data.network);
    const addr = cleanAddress(net?.kind, text);
    if (!addr) return renderStep(ctx, s.badWallet(net?.label || ''));
    data.address = addr;
    return goStep(ctx, nextStep(ctx));
  }
  if (step === 'name') {
    const name = cleanName(text);
    if (!name) return renderStep(ctx, s.badName);
    data.name = name;
    return goStep(ctx, nextStep(ctx));
  }
  if (step === 'account') {
    const m = catalog.methods.find((x) => x.code === data.method);
    const acct = cleanAccount(m?.kind, text);
    if (!acct) return renderStep(ctx, s.badAccount(m?.kind === 'mobile'));
    data.account = acct;
    return goStep(ctx, nextStep(ctx));
  }
  if (step === 'qty') {
    const sv = catalog.services.find((x) => x.code === data.service);
    const n = Number(String(text).replace(/[,\s]/g, ''));
    if (!Number.isInteger(n) || n < sv.min_qty || n > sv.max_qty) return renderStep(ctx, s.badQty({ min: sv.min_qty, max: sv.max_qty }));
    data.qty = n;
    return goStep(ctx, nextStep(ctx));
  }
  if (step === 'link') {
    const target = cleanTarget(data.platform, text);
    if (!target) return renderStep(ctx, s.badLink);
    data.target = target;
    return goStep(ctx, nextStep(ctx));
  }
  return renderStep(ctx);
}

async function confirmOrder(ctx) {
  const { flow, data } = ctx.session;
  const body = { idem: data.idem };
  if (flow === 'buy') Object.assign(body, { side: 'buy', usdt: microToInput(data.usdt), method: data.method, network: data.network, address: data.address });
  else if (flow === 'sell') Object.assign(body, { side: 'sell', usdt: microToInput(data.usdt), method: data.method, network: data.network, payout_name: data.name, payout_account: data.account });
  else Object.assign(body, { side: 'service', service: data.service, quantity: data.qty, target: data.target, method: data.method });
  try {
    const row = await createOrder(ctx.db, ctx.user.id, body);
    await clearSession(ctx);
    return showPayment(ctx, orderView(row), true);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    if (err.code === 'insufficient_stock' || err.code === 'method_locked' || err.code === 'too_many_open' || err.code === 'blocked' || err.code === 'paused' || err.code === 'not_open') {
      await clearSession(ctx);
      return show(ctx, ctx.s.err(err.message), [homeRow(ctx)]);
    }
    return renderStep(ctx, err.message);
  }
}

// ---------- payment screen, proof and orders ----------

async function showPayment(ctx, o, fresh = false) {
  const s = ctx.s;
  const mins = Math.max(1, Math.ceil((o.expires_at - nowSec()) / 60));
  const pay = o.pay;
  const methodName = ctx.lang === 'am' ? pay.label_am || pay.label_en : pay.label_en;
  let body;
  if (o.side === 'sell') body = s.paySell({ usdtMicro: o.usdt_micro, network: pay.label, address: pay.address, total: o.etb_cents, mins });
  else body = s.payBuy({ total: o.etb_cents, method: methodName, holder: pay.account_name, number: pay.account_number, note: pay.note, mins });
  const extra = o.side === 'service' ? `\n\n🛍 ${esc(ctx.lang === 'am' ? pay.service?.name_am : pay.service?.name_en)} × ${o.quantity.toLocaleString('en-US')}\n🔗 ${esc(o.target)}` : '';
  const paidBtn = o.side === 'sell' ? s.btn.sent : s.btn.paid;
  return show(ctx, `${fresh ? `${s.created(o.id)}\n\n` : ''}${body}${extra}`, [[btn(paidBtn, `c:op:${o.id}`, G)], [btn(s.btn.cancelOrder, `c:oc:${o.id}`, R)], homeRow(ctx)]);
}

async function ownOrder(ctx, id) {
  if (!isOrderId(id)) return null;
  const row = await getOrderRow(ctx.db, id);
  return row && row.user_id === ctx.user.id ? row : null;
}

async function startProof(ctx, id) {
  const row = await ownOrder(ctx, id);
  if (!row) return showMenu(ctx);
  if (!['awaiting_payment', 'evidence_submitted', 'expired'].includes(row.status)) return showOrder(ctx, id);
  ctx.session = { flow: 'proof', step: 'wait', data: { order: id } };
  return show(ctx, `<b>${row.id}</b>\n\n${ctx.s.askProof(row.side)}`, [[btn(ctx.s.btn.back, `c:ov:${id}`), btn(ctx.s.btn.cancel, 'c:x', R)]]);
}

async function photoOf(ctx, msg) {
  if (!msg.photo?.length) return null;
  const biggest = msg.photo[msg.photo.length - 1];
  return ctx.tg.downloadFile(biggest.file_id).catch(() => null);
}

async function handleProofInput(ctx, msg) {
  const id = ctx.session.data.order;
  const text = msg.text || msg.caption || '';
  const photo = await photoOf(ctx, msg);
  if (!text.trim() && !photo) return show(ctx, `<b>${id}</b>\n\n${ctx.s.proofNeeds}`, [[btn(ctx.s.btn.cancel, 'c:x', R)]]);
  try {
    await submitEvidence(ctx.env, ctx.tg, ctx.user.id, id, { text, photo });
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    return show(ctx, `<b>${id}</b>\n\n${ctx.s.proofBad(err.message)}`, [[btn(ctx.s.btn.back, `c:ov:${id}`)], homeRow(ctx)]);
  }
  await clearSession(ctx);
  tidy(ctx, msg.message_id);
  return show(ctx, ctx.s.proofOk(id), [[btn(ctx.s.btn.moreProof, `c:op:${id}`)], [btn(ctx.s.btn.orders, 'c:ol:active:0')], homeRow(ctx)]);
}

async function showOrders(ctx, filter, before) {
  const page = await listOrders(ctx.db, ctx.user.id, filter, Number(before) || null, 6);
  const s = ctx.s;
  const rows = [[btn(s.btn.open, 'c:ol:active:0', filter === 'active' ? P : W), btn(s.btn.finished, 'c:ol:done:0', filter === 'done' ? P : W)]];
  for (const o of page.orders) {
    const what = o.side === 'service' ? `🛍 ${o.quantity.toLocaleString('en-US')}` : `${usdt(o.usdt_micro)} USDT`;
    rows.push([btn(`${STATUS_ICON[o.status]} ${o.id} · ${o.side === 'buy' ? '🟢' : o.side === 'sell' ? '🔴' : ''} ${what}`.replace(/\s+/g, ' '), `c:ov:${o.id}`, W)]);
  }
  if (page.next) rows.push([btn(s.btn.more, `c:ol:${filter}:${page.next}`, W)]);
  rows.push(homeRow(ctx));
  return show(ctx, `${s.ordersHead(filter)}${page.orders.length ? '' : `\n\n${s.nothing}`}`, rows);
}

async function showOrder(ctx, id) {
  const row = await ownOrder(ctx, id);
  if (!row) return showMenu(ctx);
  const o = orderView(row);
  const s = ctx.s;
  if (o.status === 'awaiting_payment') return showPayment(ctx, o);
  const lines = [s.orderCard({ ...o, reason: s.reasons[o.reject_reason] }, `${STATUS_ICON[o.status]} ${s.status[o.status]}`)];
  if (o.side === 'service') lines.push(`🛍 ${esc(ctx.lang === 'am' ? o.pay.service?.name_am : o.pay.service?.name_en)} × ${o.quantity.toLocaleString('en-US')}`, `🔗 ${esc(o.target)}`);
  else lines.push(`${usdt(o.usdt_micro)} USDT ⇄ ${etb(o.etb_cents)} ETB`);
  const rows = [];
  if (['evidence_submitted', 'expired'].includes(o.status)) rows.push([btn(o.side === 'sell' ? s.btn.sent : s.btn.paid, `c:op:${id}`, G)]);
  rows.push([btn(s.btn.refresh, `c:ov:${id}`, W), btn(s.btn.help, `c:th:${id}`)]);
  rows.push([btn(s.btn.back, 'c:ol:active:0')], homeRow(ctx));
  return show(ctx, lines.join('\n'), rows);
}

// ---------- support ----------

async function showSupport(ctx) {
  const s = ctx.s;
  const CAT_ICON = { failed_order: '⚠️', not_received: '📭', other: '💬', feedback: '⭐' };
  const rows = Object.keys(s.cats).map((c) => [btn(`${CAT_ICON[c] || '💬'} ${s.cats[c]}`, `c:tc:${c}`)]);
  rows.push([btn(s.btn.myTickets, 'c:tl')], homeRow(ctx));
  return show(ctx, s.supportHead, rows);
}

async function startTicket(ctx, category, orderId = null) {
  const s = ctx.s;
  ctx.session = { flow: 'ticket', step: 'order', data: { category, order: orderId } };
  if (!orderId && ['failed_order', 'not_received'].includes(category)) {
    const page = await listOrders(ctx.db, ctx.user.id, 'all', null, 5);
    if (page.orders.length) {
      const rows = page.orders.map((o) => [btn(`${STATUS_ICON[o.status]} ${o.id} · ${o.side === 'service' ? '🛍' : `${usdt(o.usdt_micro)} USDT`}`, `c:to:${o.id}`, W)]);
      rows.push([btn(s.btn.skip, 'c:to:0', W), btn(s.btn.cancel, 'c:x', R)]);
      return show(ctx, `${s.pickOrder}`, rows);
    }
  }
  ctx.session.step = 'write';
  return show(ctx, `<b>${s.cats[category]}</b>${orderId ? ` · <code>${orderId}</code>` : ''}\n\n${s.askTicket}`, [[btn(s.btn.cancel, 'c:x', R)]]);
}

async function handleTicketInput(ctx, msg) {
  const { category, order } = ctx.session.data;
  const text = msg.text || msg.caption || '';
  const photo = await photoOf(ctx, msg);
  try {
    const d = await createTicket(ctx.env, ctx.tg, ctx.user.id, { category, orderId: order, text, photo });
    await clearSession(ctx);
    tidy(ctx, msg.message_id);
    return show(ctx, ctx.s.ticketMade(d.ticket.id), [[btn(ctx.s.btn.myTickets, 'c:tl')], homeRow(ctx)]);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    return show(ctx, `${ctx.s.err(err.message)}\n\n${ctx.s.askTicket}`, [[btn(ctx.s.btn.cancel, 'c:x', R)]]);
  }
}

async function showTickets(ctx) {
  const list = await listTickets(ctx.db, ctx.user.id);
  const rows = list.slice(0, 8).map((t) => [btn(ctx.s.ticketLine({ ...t, preview: t.preview.slice(0, 28) }), `c:tv:${t.id}`, W)]);
  rows.push([btn(ctx.s.btn.newTicket, 'c:sup')], homeRow(ctx));
  return show(ctx, `🎫 <b>${ctx.s.btn.myTickets.replace('🎫 ', '')}</b>${list.length ? '' : `\n\n${ctx.s.nothing}`}`, rows);
}

export async function threadText(ctx, ticket, youLabel, teamLabel) {
  const msgs = (await threadOf(ctx.db, ticket.id)).slice(-6);
  const lines = msgs.map((m) => `<b>${m.sender === 'user' ? youLabel : teamLabel}</b>: ${esc(m.body) || '📎'}${m.has_photo && m.body ? ' 📎' : ''}`);
  return lines.join('\n\n');
}

async function showTicket(ctx, id) {
  if (!isTicketId(id)) return showTickets(ctx);
  const t = await getTicket(ctx.db, id);
  if (!t || t.user_id !== ctx.user.id) return showTickets(ctx);
  const rows = [[btn(ctx.s.btn.reply, `c:tr:${id}`, P)], [btn(ctx.s.btn.back, 'c:tl')], homeRow(ctx)];
  return show(ctx, `${ctx.s.ticketHead(t)}\n\n${await threadText(ctx, t, ctx.s.you, ctx.s.team)}`, rows);
}

async function handleTicketReplyInput(ctx, msg) {
  const id = ctx.session.data.ticket;
  const text = msg.text || msg.caption || '';
  const photo = await photoOf(ctx, msg);
  try {
    await customerReply(ctx.env, ctx.tg, ctx.user.id, id, { text, photo });
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    return show(ctx, `${ctx.s.err(err.message)}\n\n${ctx.s.ticketReplyAsk}`, [[btn(ctx.s.btn.cancel, 'c:x', R)]]);
  }
  await clearSession(ctx);
  tidy(ctx, msg.message_id);
  return showTicket(ctx, id);
}

// ---------- policies and language ----------

async function showPolicies(ctx) {
  const list = await listPolicies(ctx.db);
  const rows = list.map((p) => [btn(`📄 ${p.title_en}`, `c:ps:${p.id}`)]);
  rows.push(homeRow(ctx));
  return show(ctx, ctx.s.policiesHead, rows);
}

async function showPolicy(ctx, id) {
  const list = await listPolicies(ctx.db);
  const p = list.find((x) => x.id === Number(id));
  if (!p) return showPolicies(ctx);
  const am = ctx.lang === 'am';
  return show(ctx, `<b>${esc(am ? p.title_am || p.title_en : p.title_en)}</b>\n\n${esc(am ? p.body_am || p.body_en : p.body_en)}`, [[btn(ctx.s.btn.back, 'c:pol')], homeRow(ctx)]);
}

// ---------- entry points ----------

/** Handles a tap on a chat button. Returns true when the callback belonged to the chat mode. */
export async function handleChatCallback(env, tg, cb) {
  const data = String(cb.data || '');
  if (!/^[ca]:/.test(data)) return false;
  const chatId = cb.message?.chat?.id ?? cb.from.id;
  const ctx = await makeCtx(env, tg, cb.from, chatId, cb.message?.message_id ?? null);
  const done = () => tg.answerCallbackQuery(cb.id).catch(() => {});

  if (data.startsWith('a:')) {
    if (!ctx.role) {
      await tg.answerCallbackQuery(cb.id, 'Admins only.', true).catch(() => {});
      return true;
    }
    await handleAdminCallback(ctx, cb, data.slice(2));
    await done();
    return true;
  }

  const [, verb, a, b] = data.split(':');
  const inFlow = ctx.session && STEPS[ctx.session.flow];
  try {
    switch (verb) {
      case 'home': await showMenu(ctx); break;
      case 'x': await showMenu(ctx, ctx.s.cancelled); break;
      case 'buy': case 'sell': await startFlow(ctx, verb); break;
      case 'svc': await startFlow(ctx, 'svc'); break;
      case 'rates': await showRates(ctx); break;
      case 'back': {
        if (!inFlow) { await showMenu(ctx); break; }
        const steps = STEPS[ctx.session.flow];
        const i = steps.indexOf(ctx.session.step);
        if (i <= 0) await showMenu(ctx);
        else await goStep(ctx, steps[i - 1]);
        break;
      }
      case 'pm': if (inFlow) { const r = await pickMethod(ctx, cb, a); if (r === null) return true; } else await showMenu(ctx); break;
      case 'pn':
        if (!inFlow) { await showMenu(ctx); break; }
        if (!(await shop(ctx)).catalog.networks.some((n) => n.code === a)) { await renderStep(ctx); break; }
        ctx.session.data.network = a;
        await goStep(ctx, nextStep(ctx));
        break;
      case 'sp': if (inFlow) { ctx.session.data.platform = a; await goStep(ctx, nextStep(ctx)); } else await showMenu(ctx); break;
      case 'ss':
        if (!inFlow) { await showMenu(ctx); break; }
        if (!(await shop(ctx)).catalog.services.some((x) => x.code === a)) { await renderStep(ctx); break; }
        ctx.session.data.service = a;
        await goStep(ctx, nextStep(ctx));
        break;
      case 'ok': if (inFlow && ctx.session.step === 'confirm') await confirmOrder(ctx); else await showMenu(ctx); break;
      case 'op': await startProof(ctx, a); break;
      case 'ol': await showOrders(ctx, a === 'done' ? 'done' : 'active', b); break;
      case 'ov': await clearSession(ctx); await showOrder(ctx, a); break;
      case 'oc': {
        if (!(await ownOrder(ctx, a))) { await showMenu(ctx); break; }
        await show(ctx, ctx.s.cancelAsk(a), [[btn(ctx.s.btn.yesCancel, `c:ocy:${a}`, R), btn(ctx.s.btn.keep, `c:ov:${a}`, G)]]);
        break;
      }
      case 'ocy': {
        try {
          await cancelOrder(env, ctx.user.id, a);
          await show(ctx, ctx.s.cancelDone(a), [[btn(ctx.s.btn.orders, 'c:ol:active:0')], homeRow(ctx)]);
        } catch (err) {
          if (!(err instanceof ApiError)) throw err;
          await show(ctx, ctx.s.cannotCancel, [[btn(ctx.s.btn.back, `c:ov:${a}`)], homeRow(ctx)]);
        }
        break;
      }
      case 'sup': await showSupport(ctx); break;
      case 'tc': if (a in ctx.s.cats) await startTicket(ctx, a); else await showSupport(ctx); break;
      case 'th': await startTicket(ctx, 'failed_order', (await ownOrder(ctx, a)) ? a : null); break;
      case 'to':
        if (ctx.session?.flow !== 'ticket') { await showSupport(ctx); break; }
        ctx.session.data.order = a !== '0' && (await ownOrder(ctx, a)) ? a : null;
        ctx.session.step = 'write';
        await show(ctx, `<b>${ctx.s.cats[ctx.session.data.category]}</b>${ctx.session.data.order ? ` · <code>${ctx.session.data.order}</code>` : ''}\n\n${ctx.s.askTicket}`, [[btn(ctx.s.btn.cancel, 'c:x', R)]]);
        break;
      case 'tl': await showTickets(ctx); break;
      case 'tv': await clearSession(ctx); await showTicket(ctx, a); break;
      case 'tr': {
        const t = isTicketId(a) ? await getTicket(ctx.db, a) : null;
        if (!t || t.user_id !== ctx.user.id) { await showTickets(ctx); break; }
        ctx.session = { flow: 'tkreply', step: 'write', data: { ticket: a } };
        await show(ctx, ctx.s.ticketReplyAsk, [[btn(ctx.s.btn.cancel, 'c:x', R)]]);
        break;
      }
      case 'pol': await showPolicies(ctx); break;
      case 'ps': await showPolicy(ctx, a); break;
      default: await showMenu(ctx);
    }
  } catch (err) {
    if (err instanceof ApiError) await show(ctx, ctx.s.err(err.message), [homeRow(ctx)]).catch(() => {});
    else throw err;
  }
  await done();
  return true;
}

/** Handles a typed message or photo that answers the screen the person is on. Returns true when it did. */
export async function handleChatInput(env, tg, msg) {
  if (msg.chat.type !== 'private' || !msg.from || msg.from.is_bot) return false;
  const ctx = await makeCtx(env, tg, msg.from, msg.chat.id);
  const sess = ctx.session;
  if (!sess) return false;
  const text = (msg.text || '').trim();

  if (sess.flow.startsWith('a_')) return handleAdminInput(ctx, msg, text);
  if (STEPS[sess.flow]) {
    if (!text) return true;
    tidy(ctx, msg.message_id);
    await handleFlowText(ctx, text);
    return true;
  }
  if (sess.flow === 'proof') return (await handleProofInput(ctx, msg), true);
  if (sess.flow === 'ticket' && sess.step === 'write') return (await handleTicketInput(ctx, msg), true);
  if (sess.flow === 'tkreply') return (await handleTicketReplyInput(ctx, msg), true);
  return false;
}

/** /start and friends. */
export async function handleChatCommand(env, tg, msg, cmd) {
  if (msg.chat.type !== 'private') return false;
  const ctx = await makeCtx(env, tg, msg.from, msg.chat.id);
  const map = { '/start': showMenu, '/menu': showMenu, '/help': showMenu, '/rates': showRates, '/orders': (c) => showOrders(c, 'active', 0), '/support': showSupport, '/policies': showPolicies };
  if (cmd === '/buy' || cmd === '/sell') return (await startFlow(ctx, cmd.slice(1)), true);
  if (cmd === '/services') return (await startFlow(ctx, 'svc'), true);
  const fn = map[cmd];
  if (!fn) return false;
  ctx.msgId = null; // a command always opens a fresh screen at the bottom of the chat
  if (ctx.session) await clearSession(ctx);
  await fn(ctx);
  return true;
}
