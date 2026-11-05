// The shop's public channels: the main channel, a reviews channel and a logs channel.
// The owner types each one in the app. The bot posts anonymised order logs and customer feedback to the last two.
import { formatEtb, formatUsdt } from './money.js';
import { esc } from './telegram.js';

/** Accepts @name, a t.me link, a bare name, a numeric chat id or an invite link. Returns '' when empty, null when invalid. */
export function parseRef(input) {
  const v = String(input ?? '').trim();
  if (!v) return '';
  if (/^-?\d{6,20}$/.test(v)) return v;
  const invite = v.match(/^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/(\+[\w-]{6,64}|joinchat\/[\w-]{6,64})\/?$/i);
  if (invite) return `https://t.me/${invite[1]}`;
  const m = v.match(/^(?:https?:\/\/)?(?:(?:t|telegram)\.me\/)?@?([A-Za-z][\w]{4,31})\/?$/i);
  return m ? `@${m[1]}` : null;
}

export const chatOf = (ref) => (/^(@[\w]+|-?\d+)$/.test(ref || '') ? ref : '');
export const linkOf = (ref) => (/^@/.test(ref || '') ? `https://t.me/${ref.slice(1)}` : /^https:\/\/t\.me\//.test(ref || '') ? ref : '');

export function links(settings) {
  return { channel: linkOf(settings.channel_ref), reviews: linkOf(settings.reviews_ref), logs: linkOf(settings.logs_ref) };
}

/** 5356910725 becomes 535***25, so the channel never shows who the customer is. */
export function maskId(id) {
  const s = String(id);
  return s.length <= 4 ? `${s[0]}***` : `${s.slice(0, 3)}***${s.slice(-2)}`;
}

function snapshot(order) {
  try { return JSON.parse(order.pay_snapshot || '{}'); } catch { return {}; }
}

/** What was ordered, in one line a stranger can read: "Telegram Members × 1,000" or "Buy 25 USDT". */
export function productLine(order) {
  const pay = snapshot(order);
  if (order.side === 'service') return `${esc(pay.service?.name_en || order.service_code || 'Service')} × ${Number(order.quantity).toLocaleString('en-US')}`;
  return `${order.side === 'buy' ? 'Buy' : 'Sell'} ${formatUsdt(order.usdt_micro)} USDT`;
}

const when = (sec) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Addis_Ababa', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(sec * 1000));
const duration = (sec) => (sec < 90 ? 'under a minute' : sec < 5400 ? `${Math.round(sec / 60)} min` : sec < 172800 ? `${Math.round(sec / 3600)} h` : `${Math.round(sec / 86400)} days`);
const methodName = (order) => order.method_label_en || snapshot(order).label_en || order.method_code || '';

async function post(tg, ref, text) {
  const chat = chatOf(ref);
  if (!chat) return null;
  try {
    return await tg.sendMessage(chat, text);
  } catch (err) {
    console.warn('channel post failed', ref, String(err?.message || err));
    return null;
  }
}

/** The post under "Bot logs". It never names the customer. kind: 'pending' when the order is placed, 'purchase' when it is finished. */
export function logText(kind, order, now = Math.floor(Date.now() / 1000)) {
  const done = kind === 'purchase';
  const lines = [done ? '✅ <b>Order completed</b>' : '🕓 <b>New order, waiting for payment</b>', ''];
  lines.push(`🧾 Order: <code>${esc(order.id)}</code>`, `👤 Customer: <code>${maskId(order.user_id)}</code>`, `📦 ${productLine(order)}`);
  if (order.side !== 'service') lines.push(`🌐 Network: ${esc(order.network_label || order.network_code || '')}`);
  lines.push(`💰 Total: ${formatEtb(order.etb_cents)} ETB${methodName(order) ? ` via ${esc(methodName(order))}` : ''}`);
  lines.push(done ? `⏱ Finished in ${duration(Math.max(0, (order.updated_at || now) - order.created_at))}` : `⏱ Placed: ${when(order.created_at)}`);
  if (done) lines.push(`📅 ${when(order.updated_at || now)}`);
  return lines.join('\n');
}

export async function postLog(tg, settings, kind, order) {
  if (!chatOf(settings.logs_ref)) return false;
  return Boolean(await post(tg, settings.logs_ref, logText(kind, order)));
}

export const STAR_WORDS = ['', 'Bad', 'Poor', 'Okay', 'Good', 'Excellent'];
export const stars = (n) => '⭐'.repeat(n) + '☆'.repeat(5 - n);

export function reviewText(order, rating, comment) {
  const lines = [`${stars(rating)}  <b>${rating} out of 5 · ${STAR_WORDS[rating]}</b>`, '', '📝 <b>New customer review</b>', '',
    `📦 ${productLine(order)}`, `👤 Customer: <code>${maskId(order.user_id)}</code>`, `🧾 Order: <code>${esc(order.id)}</code>`];
  if (comment) lines.push('', `💬 “${esc(comment)}”`);
  return lines.join('\n');
}

/** Posts the review to the reviews channel and returns the message id (so a comment added later can be put on the same post). */
export async function postReview(tg, settings, order, rating, comment) {
  const sent = await post(tg, settings.reviews_ref, reviewText(order, rating, comment));
  return sent?.message_id ?? null;
}

export async function editReview(tg, settings, order, rating, comment, messageId) {
  const chat = chatOf(settings.reviews_ref);
  if (!chat || !messageId) return false;
  try { await tg.editMessageText(chat, messageId, reviewText(order, rating, comment)); return true; } catch (err) { console.warn('review edit failed', String(err?.message || err)); return false; }
}

export const cleanComment = (v) => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);

/**
 * Saves a customer's review once. Only the customer who placed a completed order can leave it, and never anyone on the team.
 * Returns the updated order, or null when it was not allowed or already given.
 */
export async function saveReview(db, userId, orderId, rating, comment, now) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return null;
  const res = await db.prepare("UPDATE orders SET rating = ?, review_text = ?, feedback_at = ? WHERE id = ? AND user_id = ? AND status = 'completed' AND rating IS NULL")
    .bind(rating, comment || null, now, orderId, userId).run();
  if (!res.meta?.changes) return null;
  return db.prepare('SELECT o.*, (SELECT label FROM usdt_networks WHERE code = o.network_code) AS network_label FROM orders o WHERE o.id = ?').bind(orderId).first();
}

export async function addReviewComment(db, userId, orderId, comment) {
  const res = await db.prepare("UPDATE orders SET review_text = ? WHERE id = ? AND user_id = ? AND rating IS NOT NULL AND review_text IS NULL").bind(comment, orderId, userId).run();
  if (!res.meta?.changes) return null;
  return db.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
}
