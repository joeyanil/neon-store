// The admin side of the chat mode: queue, tickets, pause, rates and stock. Order alerts already carry their own buttons (service.js).
import { adminListOrders, adminSummary, audit, updateSettings } from './admin.js';
import { adminCard, adminKeyboard } from './messages.js';
import { getOrderRow, getSettings, nowSec } from './orders.js';
import { appButton, getUser } from './notify.js';
import { duplicateWarnings } from './proofs.js';
import { ApiError } from './http.js';
import { adminClose, adminListTickets, adminReply, getTicket, isTicketId, threadOf } from './tickets.js';
import { P, R, btn, clearSession, homeRow, show, tidy } from './chat-core.js';
import { esc } from './telegram.js';
import { isOrderId } from './validate.js';

export const BTN_ADMIN = 'a:home';

const back = (ctx) => [btn(ctx.s.btn.back, 'a:home'), ...homeRow(ctx)];
const needOwner = (ctx) => ctx.role === 'owner';

async function showAdmin(ctx) {
  await clearSession(ctx);
  const sum = await adminSummary(ctx.db);
  const a = ctx.s.admin;
  const rows = [
    [btn(a.review(sum.counts.review), 'a:q:review', P), btn(a.release(sum.counts.release), 'a:q:release', P)],
    [btn(a.tickets(sum.counts.tickets), 'a:tl')],
  ];
  if (needOwner(ctx)) rows.push([btn(sum.paused ? a.resume : a.pause, 'a:p', sum.paused ? undefined : R)], [btn(a.rates, 'a:rt'), btn(a.stock, 'a:st')]);
  rows.push(homeRow(ctx));
  return show(ctx, a.head(sum.counts) + (sum.paused ? '\n⏸ <b>Shop is paused</b>' : ''), rows);
}

async function showQueue(ctx, filter) {
  const { orders } = await adminListOrders(ctx.db, filter, null, 10);
  const rows = orders.map((o) => [btn(`${o.side === 'service' ? '🛍' : o.side === 'buy' ? '🟢' : '🔴'} ${o.id} · ${o.customer.first_name || o.customer.id}${o.late ? ' ⏰' : ''}`, `a:v:${o.id}`)]);
  rows.push(back(ctx));
  return show(ctx, ctx.s.admin.listHead[filter] + (orders.length ? '' : `\n\n${ctx.s.nothing}`), rows);
}

/** Sends the order card as its own message (not an edit), and registers it so later actions refresh it. */
async function sendCard(ctx, id) {
  if (!isOrderId(id)) return;
  const row = await getOrderRow(ctx.db, id);
  if (!row) return;
  const [user, dups, settings] = await Promise.all([getUser(ctx.db, row.user_id), duplicateWarnings(ctx.db, id), getSettings(ctx.db)]);
  const open = await appButton(ctx.env, ctx.tg, settings, ctx.chatId, '🔎 Review in app', `a=${encodeURIComponent(id)}`, `a_${id}`);
  const sent = await ctx.tg.sendMessage(ctx.chatId, adminCard(row, user, { duplicates: dups.map((d) => d.order_id).join(', ') }), { reply_markup: adminKeyboard(row, open) });
  await ctx.db.prepare('INSERT INTO admin_notices (order_id, chat_id, message_id, created_at) VALUES (?, ?, ?, ?)').bind(id, ctx.chatId, sent.message_id, nowSec()).run();
}

async function showTickets(ctx) {
  const { tickets, counts } = await adminListTickets(ctx.db, 'open');
  const rows = tickets.slice(0, 10).map((t) => [btn(`🕐 ${t.id} · ${t.customer.first_name || t.customer.id} · ${t.preview.slice(0, 20)}`, `a:tv:${t.id}`)]);
  rows.push(back(ctx));
  return show(ctx, `${ctx.s.admin.ticketsHead} (${counts.open})${tickets.length ? '' : `\n\n${ctx.s.nothing}`}`, rows);
}

async function showTicket(ctx, id) {
  const t = isTicketId(id) ? await getTicket(ctx.db, id) : null;
  if (!t) return showTickets(ctx);
  const user = await getUser(ctx.db, t.user_id);
  const msgs = (await threadOf(ctx.db, id)).slice(-6).map((m) => `<b>${m.sender === 'user' ? esc(user?.first_name || 'Customer') : ctx.s.team}</b>: ${esc(m.body) || '📎'}${m.has_photo && m.body ? ' 📎' : ''}`);
  const rows = [[btn(ctx.s.btn.reply, `a:tr:${id}`, P)]];
  if (t.status !== 'closed') rows.push([btn(ctx.s.admin.close, `a:tc:${id}`)]);
  rows.push([btn(ctx.s.btn.back, 'a:tl')]);
  return show(ctx, `${ctx.s.ticketHead(t)}\n\n${msgs.join('\n\n')}`, rows);
}

export async function handleAdminCallback(ctx, cb, data) {
  const [verb, a] = data.split(':');
  const a_ = ctx.s.admin;
  switch (verb) {
    case 'home': return showAdmin(ctx);
    case 'q': return showQueue(ctx, a === 'release' ? 'release' : 'review');
    case 'v': return sendCard(ctx, a);
    case 'tl': return showTickets(ctx);
    case 'tv': await clearSession(ctx); return showTicket(ctx, a);
    case 'tr':
      if (!isTicketId(a)) return showTickets(ctx);
      ctx.session = { flow: 'a_treply', step: 'write', data: { ticket: a } };
      return show(ctx, a_.replyAsk, [[btn(ctx.s.btn.cancel, 'a:home', R)]]);
    case 'tc':
      await adminClose(ctx.env, ctx.tg, ctx.from.id, a).catch(() => {});
      return showTickets(ctx);
    case 'p': {
      if (!needOwner(ctx)) return void (await ctx.tg.answerCallbackQuery(cb.id, a_.ownerOnly, true).catch(() => {}));
      const s = await getSettings(ctx.db);
      await updateSettings(ctx.db, ctx.from.id, { paused: !s.paused });
      return showAdmin(ctx);
    }
    case 'rt':
    case 'st':
      if (!needOwner(ctx)) return void (await ctx.tg.answerCallbackQuery(cb.id, a_.ownerOnly, true).catch(() => {}));
      ctx.session = { flow: verb === 'rt' ? 'a_rates' : 'a_stock', step: 'write', data: {} };
      return show(ctx, verb === 'rt' ? a_.askRates : a_.askStock, [[btn(ctx.s.btn.cancel, 'a:home', R)]]);
    default: return showAdmin(ctx);
  }
}

/** Typed answers in admin flows. */
export async function handleAdminInput(ctx, msg, text) {
  const { flow, data } = ctx.session;
  if (!ctx.role) return false;
  tidy(ctx, msg.message_id);
  const a = ctx.s.admin;
  try {
    if (flow === 'a_treply') {
      await adminReply(ctx.env, ctx.tg, ctx.from.id, data.ticket, text);
      await clearSession(ctx);
      return (await showTicket(ctx, data.ticket), true);
    }
    if (!needOwner(ctx)) return true;
    if (flow === 'a_rates') {
      const [buy, sell] = text.split(/[\s,/]+/);
      await updateSettings(ctx.db, ctx.from.id, { buy_rate: buy, sell_rate: sell });
      await audit(ctx.db, ctx.from.id, 'settings.update', 'rates (chat menu)');
    } else if (flow === 'a_stock') {
      await updateSettings(ctx.db, ctx.from.id, { stock_usdt: /^(off|none|no)$/i.test(text) ? '' : text.replace(/,/g, '') });
    }
    await clearSession(ctx);
    ctx.msgId = null;
    await ctx.tg.sendMessage(ctx.chatId, a.saved);
    return (await showAdmin(ctx), true);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    await show(ctx, `${ctx.s.err(err.message)}\n\n${flow === 'a_rates' ? a.askRates : flow === 'a_stock' ? a.askStock : a.replyAsk}`, [[btn(ctx.s.btn.cancel, 'a:home', R)]]);
    return true;
  }
}
