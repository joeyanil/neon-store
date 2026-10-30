// Support tickets: a thread between one customer and the team, with optional photos (kept in Telegram) and an optional order.
import { ApiError } from './http.js';
import { nowSec } from './orders.js';
import { getSettings } from './orders.js';
import { alertTargets, appButton, getUser, baseUrl } from './notify.js';
import { discardImage, fetchStored, storeImage } from './proofs.js';
import { TelegramError, esc } from './telegram.js';
import { cleanNote, isOrderId } from './validate.js';

export const CATEGORIES = ['failed_order', 'not_received', 'other', 'feedback'];
const CAT_LABEL = { failed_order: 'Failed order', not_received: 'Money / service not received', other: 'Other question', feedback: 'Feedback' };
const MAX_OPEN_TICKETS = 3;
const MAX_MESSAGES = 60;
const MAX_TEXT = 1500;

const ID_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const isTicketId = (v) => typeof v === 'string' && /^TK-[2-9A-HJKMNP-Z]{6}$/.test(v);

function newTicketId() {
  const out = [];
  while (out.length < 6) {
    for (const b of crypto.getRandomValues(new Uint8Array(12))) if (b < 248 && out.length < 6) out.push(ID_ALPHABET[b % 31]);
  }
  return `TK-${out.join('')}`;
}

// ---------- reads ----------

export async function getTicket(db, id) {
  return db.prepare('SELECT * FROM tickets WHERE id = ?').bind(id).first();
}

export async function threadOf(db, ticketId) {
  const { results } = await db
    .prepare('SELECT id, sender, body, r2_key, created_at FROM ticket_messages WHERE ticket_id = ? ORDER BY id')
    .bind(ticketId)
    .all();
  return results.map((m) => ({ id: m.id, sender: m.sender, body: m.body, has_photo: Boolean(m.r2_key), at: m.created_at }));
}

const ticketView = (t) => ({ id: t.id, category: t.category, order_id: t.order_id, status: t.status, created_at: t.created_at, updated_at: t.updated_at });

export async function ticketDetail(db, ticket) {
  return { ticket: ticketView(ticket), messages: await threadOf(db, ticket.id) };
}

export async function listTickets(db, userId) {
  const { results } = await db
    .prepare(
      `SELECT t.*, (SELECT body FROM ticket_messages m WHERE m.ticket_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_body,
              (SELECT sender FROM ticket_messages m WHERE m.ticket_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_sender
       FROM tickets t WHERE t.user_id = ? ORDER BY t.updated_at DESC LIMIT 50`,
    )
    .bind(userId)
    .all();
  return results.map((t) => ({ ...ticketView(t), preview: String(t.last_body || '').slice(0, 90), last_sender: t.last_sender }));
}

// ---------- customer actions ----------

async function addMessage(env, ticketId, sender, adminId, text, photo, now) {
  const db = env.DB;
  const hasPhoto = Boolean(photo) && typeof photo.arrayBuffer === 'function' && photo.size > 0;
  const body = cleanNote(text, MAX_TEXT);
  if (!body && !hasPhoto) throw new ApiError(400, 'no_message', 'Write a message or attach a photo.');
  const image = hasPhoto ? await storeImage(env, ticketId, photo, 'tickets') : null;
  try {
    await db
      .prepare('INSERT INTO ticket_messages (ticket_id, sender, admin_id, body, r2_key, content_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(ticketId, sender, adminId, body, image?.r2_key ?? null, image?.content_type ?? null, now)
      .run();
  } catch (err) {
    if (image) await discardImage(env, image.r2_key);
    throw err;
  }
  return { body, hasPhoto };
}

export async function createTicket(env, tg, userId, { category, orderId, text, photo }) {
  const db = env.DB;
  if (!CATEGORIES.includes(category)) throw new ApiError(400, 'bad_category', 'Choose what this is about.');
  let order = null;
  if (orderId) {
    if (!isOrderId(orderId)) throw new ApiError(400, 'bad_order', 'That order number is not valid.');
    order = await db.prepare('SELECT id, user_id FROM orders WHERE id = ?').bind(orderId).first();
    if (!order || order.user_id !== userId) throw new ApiError(400, 'bad_order', 'That order is not yours.');
  }
  const open = await db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE user_id = ? AND status != 'closed'").bind(userId).first();
  if (open.n >= MAX_OPEN_TICKETS) throw new ApiError(429, 'too_many_tickets', `You already have ${MAX_OPEN_TICKETS} open tickets. Reply to one of them, or wait for it to be closed.`);
  const now = nowSec();
  const id = newTicketId();
  await db.prepare("INSERT INTO tickets (id, user_id, category, order_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'open', ?, ?)").bind(id, userId, category, order?.id ?? null, now, now).run();
  try {
    await addMessage(env, id, 'user', null, text, photo, now);
  } catch (err) {
    await db.prepare('DELETE FROM tickets WHERE id = ?').bind(id).run().catch(() => {});
    throw err;
  }
  await alertTicket(env, tg, id, 'new').catch((err) => console.warn('ticket alert failed', String(err?.message || err)));
  return ticketDetail(db, await getTicket(db, id));
}

export async function customerReply(env, tg, userId, ticketId, { text, photo }) {
  const db = env.DB;
  const t = await getTicket(db, ticketId);
  if (!t || t.user_id !== userId) throw new ApiError(404, 'not_found', 'Ticket not found.');
  const count = await db.prepare('SELECT COUNT(*) AS n FROM ticket_messages WHERE ticket_id = ?').bind(ticketId).first();
  if (count.n >= MAX_MESSAGES) throw new ApiError(429, 'too_many_messages', 'This ticket is full. Open a new one.');
  const now = nowSec();
  await addMessage(env, ticketId, 'user', null, text, photo, now);
  await db.prepare("UPDATE tickets SET status = 'open', updated_at = ? WHERE id = ?").bind(now, ticketId).run(); // a reply reopens a closed ticket
  await alertTicket(env, tg, ticketId, 'reply').catch((err) => console.warn('ticket alert failed', String(err?.message || err)));
  return ticketDetail(db, await getTicket(db, ticketId));
}

// ---------- admin actions ----------

export async function adminListTickets(db, status = 'open') {
  const where = status === 'all' ? '' : status === 'open' ? "WHERE t.status = 'open'" : status === 'answered' ? "WHERE t.status = 'answered'" : "WHERE t.status = 'closed'";
  const { results } = await db
    .prepare(
      `SELECT t.*, u.first_name, u.username,
              (SELECT body FROM ticket_messages m WHERE m.ticket_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_body
       FROM tickets t JOIN users u ON u.id = t.user_id ${where} ORDER BY t.updated_at ${status === 'open' ? 'ASC' : 'DESC'} LIMIT 50`,
    )
    .all();
  const counts = await db.prepare("SELECT status, COUNT(*) AS n FROM tickets GROUP BY status").all();
  const c = Object.fromEntries(counts.results.map((r) => [r.status, r.n]));
  return {
    counts: { open: c.open || 0, answered: c.answered || 0, closed: c.closed || 0 },
    tickets: results.map((t) => ({ ...ticketView(t), customer: { id: t.user_id, first_name: t.first_name, username: t.username }, preview: String(t.last_body || '').slice(0, 90) })),
  };
}

export async function adminTicketDetail(db, id) {
  const t = await getTicket(db, id);
  if (!t) return null;
  const u = await db.prepare('SELECT id, first_name, username FROM users WHERE id = ?').bind(t.user_id).first();
  return { ...(await ticketDetail(db, t)), customer: u };
}

export async function adminReply(env, tg, adminId, ticketId, text) {
  const db = env.DB;
  const t = await getTicket(db, ticketId);
  if (!t) throw new ApiError(404, 'not_found', 'Ticket not found.');
  const now = nowSec();
  const { body } = await addMessage(env, ticketId, 'admin', adminId, text, null, now);
  await db.prepare("UPDATE tickets SET status = 'answered', updated_at = ? WHERE id = ?").bind(now, ticketId).run();
  await notifyCustomer(env, tg, t, body).catch((err) => console.warn('ticket notify failed', String(err?.message || err)));
  await refreshTicketCards(env, tg, ticketId).catch(() => {});
}

export async function adminClose(env, tg, adminId, ticketId) {
  const db = env.DB;
  const t = await getTicket(db, ticketId);
  if (!t) throw new ApiError(404, 'not_found', 'Ticket not found.');
  await db.prepare("UPDATE tickets SET status = 'closed', updated_at = ? WHERE id = ?").bind(nowSec(), ticketId).run();
  await db.prepare('INSERT INTO audit_log (actor, action, detail, created_at) VALUES (?, ?, ?, ?)').bind(adminId, 'ticket.close', ticketId, nowSec()).run();
  await refreshTicketCards(env, tg, ticketId).catch(() => {});
}

// ---------- Telegram messages ----------

const when = { en: { reply: 'Support replied', ticket: 'Ticket', open: 'Open ticket' }, am: { reply: 'ድጋፍ መልሷል', ticket: 'ትኬት', open: 'ትኬቱን ክፈት' } };

async function notifyCustomer(env, tg, ticket, body) {
  const user = await getUser(env.DB, ticket.user_id);
  const w = when[user?.language === 'am' ? 'am' : 'en'];
  try {
    await tg.sendMessage(ticket.user_id, `💬 <b>${w.reply}</b> · <code>${ticket.id}</code>\n\n${esc(body)}`, {
      reply_markup: { inline_keyboard: [[{ text: w.open, web_app: { url: `${baseUrl(env)}/?t=${encodeURIComponent(ticket.id)}` } }]] },
    });
  } catch (err) {
    if (err instanceof TelegramError && (err.status === 403 || err.status === 400)) await env.DB.prepare('UPDATE users SET can_dm = 0 WHERE id = ?').bind(ticket.user_id).run().catch(() => {});
    throw err;
  }
}

export async function ticketCard(db, ticket, kind = 'new') {
  const user = await db.prepare('SELECT id, first_name, username FROM users WHERE id = ?').bind(ticket.user_id).first();
  const last = await db.prepare('SELECT body, r2_key, sender FROM ticket_messages WHERE ticket_id = ? ORDER BY id DESC LIMIT 1').bind(ticket.id).first();
  const who = `<a href="tg://user?id=${user.id}">${esc(user.first_name || 'Customer')}</a>${user.username ? ` @${esc(user.username)}` : ''} · <code>${user.id}</code>`;
  const state = ticket.status === 'closed' ? '✅ Closed' : ticket.status === 'answered' ? '💬 Answered' : '🆕 Needs a reply';
  const lines = [
    `<b>🎫 ${kind === 'reply' ? 'Customer replied' : 'New ticket'} · ${ticket.id}</b>`,
    `${state} · ${esc(CAT_LABEL[ticket.category])}${ticket.order_id ? ` · order <code>${ticket.order_id}</code>` : ''}`,
    '',
    `<b>Customer</b>: ${who}`,
    '',
    esc(String(last?.body || '').slice(0, 900)) || '<i>(photo only)</i>',
  ];
  if (last?.r2_key) lines.push('', '📎 <i>Photo attached. Open the ticket to see it.</i>');
  if (ticket.status !== 'closed') lines.push('', '<i>Reply to this message to answer the customer.</i>');
  return lines.join('\n');
}

const ticketKeyboard = (ticket, open) => {
  const rows = [];
  if (open) rows.push([open]);
  if (ticket.status !== 'closed') rows.push([{ text: '✅ Close ticket', callback_data: `t:${ticket.id}:x` }]);
  return { inline_keyboard: rows };
};

async function alertTicket(env, tg, ticketId, kind) {
  const db = env.DB;
  const ticket = await getTicket(db, ticketId);
  const settings = await getSettings(db);
  const text = await ticketCard(db, ticket, kind);
  for (const chat of await alertTargets(env, settings)) {
    try {
      const open = await appButton(env, tg, settings, chat, '🔎 Open ticket', `k=${encodeURIComponent(ticketId)}`, `k_${ticketId}`);
      const sent = await tg.sendMessage(chat, text, { reply_markup: ticketKeyboard(ticket, open) });
      await db.prepare('INSERT INTO admin_notices (order_id, chat_id, message_id, created_at) VALUES (?, ?, ?, ?)').bind(ticketId, chat, sent.message_id, nowSec()).run();
    } catch (err) {
      console.warn('ticket alert failed', chat, String(err?.message || err));
    }
  }
}

export async function refreshTicketCards(env, tg, ticketId) {
  const db = env.DB;
  const ticket = await getTicket(db, ticketId);
  if (!ticket) return;
  const settings = await getSettings(db);
  const text = await ticketCard(db, ticket, 'new');
  const { results } = await db.prepare('SELECT id, chat_id, message_id FROM admin_notices WHERE order_id = ?').bind(ticketId).all();
  for (const n of results) {
    try {
      const open = await appButton(env, tg, settings, n.chat_id, '🔎 Open ticket', `k=${encodeURIComponent(ticketId)}`, `k_${ticketId}`);
      await tg.editMessageText(n.chat_id, n.message_id, text, ticketKeyboard(ticket, open));
    } catch (err) {
      if (!(err instanceof TelegramError && /not modified/i.test(err.description || ''))) console.warn('ticket card refresh failed', String(err?.message || err));
    }
  }
}

export async function ticketPhoto(env, ticketId, messageId) {
  const row = await env.DB.prepare('SELECT r2_key, content_type FROM ticket_messages WHERE id = ? AND ticket_id = ?').bind(messageId, ticketId).first();
  if (!row?.r2_key) throw new ApiError(404, 'not_found', 'That image is no longer available.');
  const blob = await fetchStored(env, row.r2_key);
  if (!blob) throw new ApiError(404, 'not_found', 'That image is no longer available.');
  return new Response(blob, {
    headers: { 'content-type': row.content_type || 'application/octet-stream', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-disposition': 'inline', 'content-security-policy': "default-src 'none'; sandbox" },
  });
}
