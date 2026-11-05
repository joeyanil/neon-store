// Business flows that touch both the database and Telegram: proof submission, admin actions,
// alerts and customer notifications, expiry, and the bot's webhook.
import { adminSummary, allAdminIds, audit, getRole } from './admin.js';
import { addReviewComment, cleanComment, editReview, postLog, postReview, saveReview } from './channels.js';
import { ApiError } from './http.js';
import { adminCard, adminKeyboard, copy } from './messages.js';
import { formatEtb, formatUsdt, parseRate, parseUsdt } from './money.js';
import {
  LATE_PROOF_SEC, findExpired, getEvents, getOrderRow, getSettings, logEvent, nowSec, orderView, patchOrder, setPaused, setRates, setSetting, transition,
} from './orders.js';
import { alertTargets, appButton, baseUrl, getUser, orderUrl } from './notify.js';
import { addProofRow, discardImage, duplicateWarnings, listProofs, storeImage } from './proofs.js';
import { TelegramError, esc } from './telegram.js';
import { customEmojiIn } from './emoji.js';
import { handleChatCallback, handleChatCommand, handleChatFallback, handleChatInput } from './chat.js';
import { adminClose, adminReply, getTicket } from './tickets.js';
import { cleanNote } from './validate.js';

// ---------- small helpers ----------

/** The order as the customer's own app sees it: history and the proofs they sent. */
export async function customerOrderView(db, row) {
  const [events, proofs] = await Promise.all([getEvents(db, row.id), listProofs(db, row.id)]);
  return orderView(row, events, proofs);
}

// ---------- notifications to customers (best effort: a failed message never fails the action) ----------

export async function notifyUser(env, tg, userId, kind, order, ref) {
  try {
    const user = await getUser(env.DB, userId);
    const c = copy(user?.language);
    const text = kind === 'reference' ? c.reference(order, ref) : c[kind](order, ref);
    const rows = [[{ text: c.open_order, web_app: { url: orderUrl(env, order.id) } }]];
    const canRate = kind === 'completed' && !order.rating && !(await getRole(env, userId));
    if (canRate) rows.unshift([1, 2, 3, 4, 5].map((n) => ({ text: `${n}⭐`, callback_data: `c:rv:${order.id}:${n}` })));
    await tg.sendMessage(userId, esc(text) + (canRate ? `\n\n${c.rate_prompt}` : ''), { reply_markup: { inline_keyboard: rows } });
  } catch (err) {
    if (err instanceof TelegramError && (err.status === 403 || err.status === 400)) {
      await env.DB.prepare('UPDATE users SET can_dm = 0 WHERE id = ?').bind(userId).run().catch(() => {});
    }
    console.warn('notifyUser failed', userId, kind, String(err?.message || err));
  }
}

// ---------- alerts to admins ----------

const openButton = (env, tg, settings, chatId, orderId) => appButton(env, tg, settings, chatId, '🔎 Review in app', `a=${encodeURIComponent(orderId)}`, `a_${orderId}`);

/** Sends the alert (text only: proofs stay private in the app). Returns how many admins were reached. */
export async function alertAdmins(env, tg, orderId) {
  const db = env.DB;
  const row = await getOrderRow(db, orderId);
  if (!row) return 0;
  const [user, settings, dups] = await Promise.all([getUser(db, row.user_id), getSettings(db), duplicateWarnings(db, orderId)]);
  const targets = await alertTargets(env, settings);
  const text = adminCard(row, user, { duplicates: dups.map((d) => d.order_id).join(', ') });
  let reached = 0;
  for (const chat of targets) {
    try {
      const open = await openButton(env, tg, settings, chat, orderId);
      const sent = await tg.sendMessage(chat, text, { reply_markup: adminKeyboard(row, open) });
      await db.prepare('INSERT INTO admin_notices (order_id, chat_id, message_id, created_at) VALUES (?, ?, ?, ?)').bind(orderId, chat, sent.message_id, nowSec()).run();
      reached++;
    } catch (err) {
      console.warn('alert failed', chat, String(err?.message || err));
    }
  }
  if (reached && !row.alerted_at) await patchOrder(db, orderId, { alerted_at: nowSec() });
  return reached;
}

/** Brings every copy of the alert up to date, wherever the action happened (chat button or app). */
export async function refreshAdminCards(env, tg, orderId) {
  const db = env.DB;
  const row = await getOrderRow(db, orderId);
  if (!row) return;
  const [user, settings, dups] = await Promise.all([getUser(db, row.user_id), getSettings(db), duplicateWarnings(db, orderId)]);
  const { results: notices } = await db.prepare('SELECT id, chat_id, message_id FROM admin_notices WHERE order_id = ?').bind(orderId).all();
  const text = adminCard(row, user, { duplicates: dups.map((d) => d.order_id).join(', ') });
  for (const n of notices) {
    try {
      const open = await openButton(env, tg, settings, n.chat_id, orderId);
      await tg.editMessageText(n.chat_id, n.message_id, text, adminKeyboard(row, open));
    } catch (err) {
      const gone = err instanceof TelegramError && /not found|can't be edited|deleted/i.test(err.description || '');
      if (gone) await db.prepare('DELETE FROM admin_notices WHERE id = ?').bind(n.id).run().catch(() => {});
      else if (!(err instanceof TelegramError && /not modified/i.test(err.description || ''))) console.warn('card refresh failed', String(err?.message || err));
    }
  }
}

// ---------- customer submits proof ----------

const MAX_EVIDENCE = 5;

export async function submitEvidence(env, tg, userId, orderId, { text, photo }) {
  const db = env.DB;
  const row = await getOrderRow(db, orderId);
  if (!row || row.user_id !== userId) throw new ApiError(404, 'not_found', 'Order not found.');
  const now = nowSec();

  let late = false;
  if (row.status === 'expired') {
    if (now > row.expires_at + LATE_PROOF_SEC) throw new ApiError(409, 'expired', 'This order expired more than a day ago. Open Support and mention the order number.');
    late = true;
  } else if (row.status === 'awaiting_payment') {
    late = now >= row.expires_at; // paid just after the window closed: accept it, but mark it for the admin
  } else if (row.status !== 'evidence_submitted') {
    throw new ApiError(409, 'not_open', 'This order is no longer waiting for payment details.');
  }
  if (row.evidence_count >= MAX_EVIDENCE) throw new ApiError(429, 'too_many_evidence', 'You have reached the limit for this order. Contact Support.');

  const note = cleanNote(text);
  const hasPhoto = Boolean(photo) && typeof photo.arrayBuffer === 'function' && photo.size > 0;
  if (!note && !hasPhoto) throw new ApiError(400, 'no_evidence', row.side === 'buy' ? 'Attach your payment receipt.' : 'Add the transaction ID or a screenshot.');

  const image = hasPhoto ? await storeImage(env, orderId, photo) : null; // validates the real file type and size
  let proofId;
  try {
    proofId = await addProofRow(db, { orderId, userId, image, refText: note, now });
    const set = { evidence_count: row.evidence_count + 1 };
    if (note) set.evidence_text = note;
    if (late) set.late = 1;
    // Several proofs sent at the same moment (a retry on a slow connection): the first moves the order into review,
    // the others are added to it. The counter is incremented in SQL so two at once cannot both slip past the limit.
    const addMore = async () => {
      const res = await db
        .prepare(`UPDATE orders SET evidence_count = evidence_count + 1, ${note ? 'evidence_text = ?, ' : ''}updated_at = ? WHERE id = ? AND status = 'evidence_submitted' AND evidence_count < ?`)
        .bind(...(note ? [note] : []), now, orderId, MAX_EVIDENCE)
        .run();
      if (res.meta.changes !== 1) {
        const cur = await getOrderRow(db, orderId);
        if (cur?.status === 'evidence_submitted') throw new ApiError(429, 'too_many_evidence', 'You have reached the limit for this order. Contact Support.');
        throw new ApiError(409, 'not_open', 'This order changed while you were sending. Refresh and check its status.');
      }
      await logEvent(db, orderId, 'evidence_submitted', `user:${userId}`, 'additional evidence');
    };

    if (row.status === 'evidence_submitted') {
      await addMore();
    } else {
      let res;
      if (row.status === 'awaiting_payment' && late) {
        await transition(db, orderId, 'awaiting_payment', 'expired', 'system', { now });
        res = await transition(db, orderId, 'expired', 'evidence_submitted', `user:${userId}`, { set, note: 'late proof', now });
      } else if (row.status === 'expired') {
        res = await transition(db, orderId, 'expired', 'evidence_submitted', `user:${userId}`, { set, note: 'late proof', now });
      } else {
        res = await transition(db, orderId, 'awaiting_payment', 'evidence_submitted', `user:${userId}`, { set, now });
      }
      if (!res.ok) {
        // Lost the race to another proof of the same customer: add this one to the order instead of failing.
        const cur = await getOrderRow(db, orderId);
        if (cur?.status === 'evidence_submitted') await addMore();
        else throw new ApiError(409, 'not_open', 'This order changed while you were sending. Refresh and check its status.');
      }
    }
  } catch (err) {
    if (proofId) await db.prepare('DELETE FROM order_proofs WHERE id = ?').bind(proofId).run().catch(() => {});
    if (image) await discardImage(env, image.r2_key);
    throw err;
  }

  // The proof is safe in storage and the order is in the admin queue. Telling the admins is best effort: the cron retries.
  await alertAdmins(env, tg, orderId).catch((err) => console.warn('alertAdmins failed', String(err?.message || err)));
  const fresh = await getOrderRow(db, orderId);
  return customerOrderView(db, fresh);
}

// ---------- customer cancels ----------

export async function cancelOrder(env, userId, orderId) {
  const row = await getOrderRow(env.DB, orderId);
  if (!row || row.user_id !== userId) throw new ApiError(404, 'not_found', 'Order not found.');
  const res = await transition(env.DB, orderId, 'awaiting_payment', 'cancelled', `user:${userId}`);
  if (!res.ok) throw new ApiError(409, 'not_cancellable', 'This order can no longer be cancelled because payment details were already sent.');
  return customerOrderView(env.DB, await getOrderRow(env.DB, orderId));
}

// ---------- scheduled jobs ----------

export async function expireStaleOrders(env, tg, now = nowSec()) {
  const stale = await findExpired(env.DB, now);
  let n = 0;
  for (const { id, user_id: userId } of stale) {
    const res = await transition(env.DB, id, 'awaiting_payment', 'expired', 'system', { now });
    if (!res.ok) continue;
    n++;
    const row = await getOrderRow(env.DB, id);
    await notifyUser(env, tg, userId, 'expired', row);
  }
  return n;
}

/** Orders whose alert never reached anyone (Telegram down, admin had not started the bot) are tried again. */
export async function retryAlerts(env, tg, limit = 4) {
  const { results } = await env.DB
    .prepare("SELECT id FROM orders WHERE status = 'evidence_submitted' AND alerted_at IS NULL ORDER BY updated_at LIMIT ?")
    .bind(limit)
    .all();
  let n = 0;
  for (const { id } of results) if (await alertAdmins(env, tg, id).catch(() => 0)) n++;
  return n;
}

// ---------- admin actions (chat buttons and the app share this) ----------

export const REJECT_REASONS = ['not_received', 'amount_mismatch', 'unreadable', 'other'];

const ACTIONS = {
  confirm: { from: ['evidence_submitted'], to: 'processing', notify: 'processing', done: 'Payment confirmed' },
  release: { from: ['processing'], to: 'completed', notify: 'completed', done: 'Marked as released' },
  reject: { from: ['awaiting_payment', 'evidence_submitted', 'processing', 'expired'], to: 'rejected', notify: 'rejected', done: 'Order rejected' },
};

/**
 * @param {'confirm' | 'release' | 'reject'} action
 * @returns {Promise<{ok: boolean, order: object, message: string}>}  ok=false means the order had already moved on.
 */
export async function adminAct(env, tg, actorId, orderId, action, { reference, reason } = {}) {
  const spec = ACTIONS[action];
  const before = await getOrderRow(env.DB, orderId);
  if (!before) throw new ApiError(404, 'not_found', 'Order not found.');

  const set = {};
  let note;
  if (action === 'release' && reference) set.completion_ref = cleanNote(reference, 200);
  if (action === 'reject') {
    if (reason && !REJECT_REASONS.includes(reason)) throw new ApiError(400, 'invalid_field', 'Choose a reason from the list.', { field: 'reason' });
    if (reason) { set.reject_reason = reason; note = reason; }
  }
  const res = await transition(env.DB, orderId, spec.from, spec.to, `admin:${actorId}`, { set, note });
  const row = await getOrderRow(env.DB, orderId);
  await refreshAdminCards(env, tg, orderId).catch(() => {});
  if (!res.ok) return { ok: false, order: row, message: `Not applied: order is already ${row.status.replace('_', ' ')}.` };
  await notifyUser(env, tg, row.user_id, spec.notify, row, set.completion_ref);
  if (spec.to === 'completed') await postLog(tg, await getSettings(env.DB), 'purchase', row).catch(() => {});
  return { ok: true, order: row, message: spec.done };
}

async function handleCallback(env, tg, cb) {
  if (await handleChatCallback(env, tg, cb)) return;
  const answer = (text, alert = false) => tg.answerCallbackQuery(cb.id, text, alert).catch(() => {});
  if (!(await getRole(env, cb.from.id))) return answer('Admins only.', true);
  const tk = /^t:(TK-[2-9A-HJKMNP-Z]{6}):x$/.exec(cb.data || '');
  if (tk) {
    try {
      await adminClose(env, tg, cb.from.id, tk[1]);
      return answer('Ticket closed');
    } catch (err) {
      if (err instanceof ApiError) return answer(err.message, true);
      throw err;
    }
  }
  const m = /^o:(NG-[2-9A-HJKMNP-Z]{6}):([cdr])$/.exec(cb.data || '');
  if (!m) return answer('Unknown action.');
  const [, orderId, code] = m;
  const action = { c: 'confirm', d: 'release', r: 'reject' }[code];
  try {
    const res = await adminAct(env, tg, cb.from.id, orderId, action);
    return answer(res.message, !res.ok);
  } catch (err) {
    if (err instanceof ApiError) return answer(err.message, true);
    throw err;
  }
}

/** Marks the alert check as passed when the alerts would go to this very chat. */
async function markAlertsReachable(env, chatId) {
  const settings = await getSettings(env.DB);
  if (settings.alerts_tested) return;
  if ((await alertTargets(env, settings)).includes(chatId)) await setSetting(env.DB, 'alerts_tested', 1);
}

// ---------- the bot's own messages ----------

async function handleMessage(env, tg, msg) {
  const from = msg.from;
  if (!from || from.is_bot) return;
  const text = (msg.text || '').trim();
  const role = await getRole(env, from.id);

  // An admin replying to an order alert with a reference sends that reference to the customer.
  if (role && msg.reply_to_message && text && !text.startsWith('/')) {
    const source = msg.reply_to_message.text || msg.reply_to_message.caption || '';
    const tid = /TK-[2-9A-HJKMNP-Z]{6}/.exec(source)?.[0];
    if (tid) {
      const reply = (t) => tg.sendMessage(msg.chat.id, t, { reply_parameters: { message_id: msg.message_id } });
      if (!(await getTicket(env.DB, tid))) return reply('Ticket not found.');
      await adminReply(env, tg, from.id, tid, text);
      return reply('Sent to the customer ✓');
    }
    const id = /NG-[2-9A-HJKMNP-Z]{6}/.exec(source)?.[0];
    if (id) return handleReference(env, tg, msg, id, text);
  }

  // The owner sends a premium emoji to the bot and gets its ID back, to paste in Admin > Shop settings > Button emoji.
  if (role === 'owner' && msg.chat.type === 'private') {
    const found = customEmojiIn(msg);
    if (found.length) {
      const lines = found.slice(0, 20).map((e) => `${e.emoji}  <code>${e.id}</code>`).join('\n');
      return tg.sendMessage(msg.chat.id, `<b>Premium emoji ID${found.length > 1 ? 's' : ''}</b>\n${lines}\n\nOpen the app: Admin, Shop settings, Button emoji. Paste the ID next to the ordinary emoji it should replace.`);
    }
  }
  if (!text.startsWith('/') && (await handleChatInput(env, tg, msg))) return;
  if (!text.startsWith('/')) {
    // A photo or text the bot was not waiting for: show the menu so the person is never left without an answer.
    if (msg.chat.type === 'private' && (text || msg.photo || msg.document)) await handleChatFallback(env, tg, msg, 'Use the buttons below to buy, sell or get help.').catch(() => {});
    return;
  }
  const [rawCmd, ...args] = text.split(/\s+/);
  const cmd = rawCmd.split('@')[0].toLowerCase();

  // An admin who writes to the bot in private has proven the bot can message them, so alerts to private messages work.
  if (role && msg.chat.type === 'private' && (cmd === '/start' || cmd === '/menu')) await markAlertsReachable(env, msg.chat.id).catch(() => {});

  if (await handleChatCommand(env, tg, msg, cmd)) return;

  const OWNER_COMMANDS = ['/alerts', '/setrate', '/ttl', '/limits', '/pause', '/resume'];
  if (role !== 'owner') {
    // Not an owner command and not a known customer command: say so and show the menu.
    if (msg.chat.type === 'private') await handleChatFallback(env, tg, msg, OWNER_COMMANDS.includes(cmd) ? 'That command is only for the shop owner.' : 'I do not know that command. Use the buttons below.').catch(() => {});
    return; // the commands below change the shop's settings
  }
  if (!OWNER_COMMANDS.includes(cmd) && msg.chat.type === 'private') return handleChatFallback(env, tg, msg, 'I do not know that command. Use the buttons below.');

  if (cmd === '/alerts') {
    const here = msg.chat.type === 'private' ? 0 : msg.chat.id;
    await setSetting(env.DB, 'admin_chat_id', here);
    await setSetting(env.DB, 'alerts_tested', 1);
    await audit(env.DB, from.id, 'alerts.destination', here ? `chat ${here}` : 'private messages');
    return tg.sendMessage(msg.chat.id, here ? 'Order alerts will now be sent in this chat. Make sure only people you trust are in it.' : 'Order alerts will now be sent to each admin as a private message.');
  }
  if (cmd === '/setrate') {
    const buy = parseRate(args[0]);
    const sell = parseRate(args[1]);
    if (!buy || !sell) return tg.sendMessage(msg.chat.id, 'Usage: <code>/setrate BUY SELL</code>\nExample: <code>/setrate 168.50 163</code>\nBUY is what a customer pays per USDT. SELL is what a customer receives per USDT.');
    if (sell > buy) return tg.sendMessage(msg.chat.id, 'The sell rate cannot be higher than the buy rate. Nothing was changed.');
    await setRates(env.DB, buy, sell);
    await audit(env.DB, from.id, 'settings.update', `rates ${formatEtb(buy)}/${formatEtb(sell)} (chat)`);
    return tg.sendMessage(msg.chat.id, `Rates updated.\nCustomers <b>buy</b> at ${formatEtb(buy)} ETB and <b>sell</b> at ${formatEtb(sell)} ETB per USDT.`);
  }
  if (cmd === '/ttl') {
    const minutes = Number(args[0]);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) return tg.sendMessage(msg.chat.id, 'Usage: <code>/ttl MINUTES</code> (1 to 1440). This is how long a customer has to pay or send USDT.');
    await setSetting(env.DB, 'order_ttl_min', minutes);
    return tg.sendMessage(msg.chat.id, `Customers now have ${minutes} minutes to pay. Orders already open keep their old deadline.`);
  }
  if (cmd === '/limits') {
    const min = parseUsdt(args[0]);
    const max = parseUsdt(args[1]);
    if (!min || !max || min >= max) return tg.sendMessage(msg.chat.id, 'Usage: <code>/limits MIN MAX</code> in USDT. Example: <code>/limits 10 5000</code>');
    await setSetting(env.DB, 'min_usdt_micro', min);
    await setSetting(env.DB, 'max_usdt_micro', max);
    return tg.sendMessage(msg.chat.id, `Order size is now ${formatUsdt(min)} to ${formatUsdt(max)} USDT.`);
  }
  if (cmd === '/rates') {
    const s = await getSettings(env.DB);
    if (!s.buy_rate_cents) return tg.sendMessage(msg.chat.id, 'Rates are not set. Use <code>/setrate BUY SELL</code>.');
    return tg.sendMessage(msg.chat.id, `Buy ${formatEtb(s.buy_rate_cents)} · Sell ${formatEtb(s.sell_rate_cents)} ETB per USDT${s.paused ? '\n<b>Trading is paused.</b>' : ''}`);
  }
  if (cmd === '/pause' || cmd === '/resume') {
    await setPaused(env.DB, cmd === '/pause');
    return tg.sendMessage(msg.chat.id, cmd === '/pause' ? 'Trading paused. Customers cannot create new orders.' : 'Trading resumed.');
  }
  if (cmd === '/orders') {
    const sum = await adminSummary(env.DB);
    const { results } = await env.DB
      .prepare("SELECT id, side, status FROM orders WHERE status IN ('awaiting_payment','evidence_submitted','processing') ORDER BY created_at DESC LIMIT 15")
      .all();
    if (!results.length) return tg.sendMessage(msg.chat.id, 'No open orders.');
    const lines = results.map((o) => `${o.side === 'buy' ? '🟢' : '🔴'} <code>${o.id}</code> · ${o.status.replace('_', ' ')}`);
    return tg.sendMessage(msg.chat.id, `<b>Open orders</b> (${sum.counts.review} to review, ${sum.counts.release} to release)\n${lines.join('\n')}`);
  }
}

async function handleReference(env, tg, msg, orderId, text) {
  const row = await getOrderRow(env.DB, orderId);
  const reply = (t) => tg.sendMessage(msg.chat.id, t, { reply_parameters: { message_id: msg.message_id } });
  if (!row) return reply('Order not found.');
  if (row.status !== 'processing' && row.status !== 'completed') return reply('Confirm the payment first, then send the reference.');
  const ref = cleanNote(text, 200);
  if (!ref) return;
  await patchOrder(env.DB, orderId, { completion_ref: ref });
  await logEvent(env.DB, orderId, row.status, `admin:${msg.from.id}`, 'reference sent to customer');
  await notifyUser(env, tg, row.user_id, 'reference', row, ref);
  return reply('Reference sent to the customer ✓');
}

/** Entry point for Telegram webhook updates. Never throws, so Telegram does not retry in a loop. */
import { handleGameCallback, handleInlineQuery } from './games.js';

export async function handleUpdate(env, tg, update) {
  try {
    if (update.inline_query) await handleInlineQuery(env, tg, update.inline_query);
    else if (update.callback_query?.inline_message_id) await handleGameCallback(env, tg, update.callback_query);
    else if (update.callback_query) await handleCallback(env, tg, update.callback_query);
    else if (update.message) await handleMessage(env, tg, update.message);
  } catch (err) {
    console.error('update failed', update.update_id, String(err?.stack || err));
  }
}




// ---------- reviews ----------

/**
 * A customer rates a finished order from 1 to 5 stars, with an optional short comment.
 * Only the person who placed the order can do it, only once, and never someone on the team.
 */
export async function leaveReview(env, tg, userId, orderId, rating, comment) {
  if ((await getRole(env, userId))) throw new ApiError(403, 'team_cannot_review', 'Team members cannot review orders.');
  const row = await getOrderRow(env.DB, orderId);
  if (!row || row.user_id !== userId) throw new ApiError(404, 'not_found', 'Order not found.');
  if (row.status !== 'completed') throw new ApiError(409, 'not_completed', 'You can review an order once it is completed.');
  const r = Number(rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) throw new ApiError(400, 'invalid_field', 'Choose 1 to 5 stars.', { field: 'rating' });
  const text = cleanComment(comment);
  const saved = await saveReview(env.DB, userId, orderId, r, text, nowSec());
  if (!saved) throw new ApiError(409, 'already_reviewed', 'You already reviewed this order.');
  const settings = await getSettings(env.DB);
  const msgId = await postReview(tg, settings, { ...saved, method_label_en: row.method_label_en }, r, text).catch(() => null);
  if (msgId) await env.DB.prepare('UPDATE orders SET review_msg_id = ? WHERE id = ?').bind(msgId, orderId).run(); // not patchOrder: that would move the order's finish time
  return { ...row, rating: r, review_text: text || null };
}

/** A comment sent after the stars. It is added to the same post in the reviews channel. */
export async function addComment(env, tg, userId, orderId, comment) {
  const text = cleanComment(comment);
  if (!text) return null;
  const row = await addReviewComment(env.DB, userId, orderId, text);
  if (!row) return null;
  await editReview(tg, await getSettings(env.DB), row, row.rating, text, row.review_msg_id);
  return row;
}
