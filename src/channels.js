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

export function productLine(order) {
  let pay = {};
  try { pay = JSON.parse(order.pay_snapshot || '{}'); } catch { /* old rows */ }
  if (order.side === 'service') return `${esc(pay.service?.name_en || order.service_code || 'Service')} × ${Number(order.quantity).toLocaleString('en-US')}`;
  return `${order.side === 'buy' ? 'Buy' : 'Sell'} ${formatUsdt(order.usdt_micro)} USDT`;
}

async function post(tg, ref, text) {
  const chat = chatOf(ref);
  if (!chat) return false;
  try {
    await tg.sendMessage(chat, text);
    return true;
  } catch (err) {
    console.warn('channel post failed', ref, String(err?.message || err));
    return false;
  }
}

/** kind: 'pending' when the order is placed, 'purchase' when it is completed. */
export async function postLog(tg, settings, kind, order) {
  if (!chatOf(settings.logs_ref)) return false;
  const title = kind === 'purchase' ? '✅ <b>New purchase</b>' : '🕓 <b>New pending order</b>';
  return post(tg, settings.logs_ref, [title, `Customer: <code>${maskId(order.user_id)}</code>`, `Product: ${productLine(order)}`, `Total: ${formatEtb(order.etb_cents)} ETB`].join('\n'));
}

export async function postFeedback(tg, settings, order, good) {
  if (!chatOf(settings.reviews_ref)) return false;
  return post(tg, settings.reviews_ref, [good ? '👍 <b>New feedback: good</b>' : '👎 <b>New feedback: bad</b>', `Customer: <code>${maskId(order.user_id)}</code>`, `Product: ${productLine(order)}`, `Order: ${esc(order.id)}`].join('\n'));
}

/** Saves the customer's verdict once. Returns the order when this call saved it, otherwise null. */
export async function saveFeedback(db, userId, orderId, good, now) {
  const res = await db.prepare("UPDATE orders SET feedback = ?, feedback_at = ? WHERE id = ? AND user_id = ? AND status = 'completed' AND feedback IS NULL")
    .bind(good ? 'good' : 'bad', now, orderId, userId).run();
  if (!res.meta?.changes) return null;
  return db.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
}
