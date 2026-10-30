// The building blocks of the chat mode: one message that is edited in place, saved conversation state, coloured buttons.
import { getRole } from './admin.js';
import { baseUrl } from './notify.js';
import { nowSec } from './orders.js';
import { textFor } from './chat-text.js';
import { TelegramError } from './telegram.js';

/** A button that sends callback data. `style` is 'primary' (blue), 'success' (green) or 'danger' (red). */
export const btn = (text, data, style) => (style ? { text, callback_data: data, style } : { text, callback_data: data });
export const P = 'primary';
export const G = 'success';
export const R = 'danger';

/** Lays buttons out `per` to a row. */
export const grid = (buttons, per = 2) => {
  const rows = [];
  for (let i = 0; i < buttons.length; i += per) rows.push(buttons.slice(i, i + per));
  return rows;
};

/** A progress line like "✅ Method  ▶️ Network  ▫️ Amount". */
export function progress(labels, index) {
  return labels.map((l, i) => (i < index ? `✅ ${l}` : i === index ? `▶️ <b>${l}</b>` : `▫️ ${l}`)).join('  ');
}

export const newIdem = (userId) => `ch-${userId}-${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;

/** Builds the context every chat handler works with. Also makes sure the person exists in the users table. */
export async function makeCtx(env, tg, from, chatId, msgId = null) {
  const db = env.DB;
  const now = nowSec();
  const lang = String(from.language_code || '').startsWith('am') ? 'am' : 'en';
  await db
    .prepare(
      `INSERT INTO users (id, first_name, username, language, can_dm, created_at, last_seen_at) VALUES (?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET first_name = excluded.first_name, username = excluded.username, can_dm = 1, last_seen_at = excluded.last_seen_at`,
    )
    .bind(from.id, String(from.first_name || '').slice(0, 64), from.username ? String(from.username).slice(0, 64) : null, lang, now, now)
    .run();
  const user = await db.prepare('SELECT id, first_name, username, language, can_dm, blocked FROM users WHERE id = ?').bind(from.id).first();
  const row = await db.prepare('SELECT flow, step, data, message_id FROM chat_sessions WHERE user_id = ?').bind(from.id).first();
  const session = row ? { flow: row.flow, step: row.step, data: JSON.parse(row.data || '{}'), message_id: row.message_id } : null;
  return { env, tg, db, from, chatId, msgId, user, lang: user.language, s: textFor(user.language), role: await getRole(env, from.id), session, base: baseUrl(env) };
}

export async function saveSession(ctx) {
  const s = ctx.session;
  if (!s) return;
  await ctx.db
    .prepare(
      `INSERT INTO chat_sessions (user_id, flow, step, data, message_id, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET flow = excluded.flow, step = excluded.step, data = excluded.data, message_id = excluded.message_id, updated_at = excluded.updated_at`,
    )
    .bind(ctx.user.id, s.flow, s.step, JSON.stringify(s.data || {}), ctx.msgId ?? s.message_id ?? null, nowSec())
    .run();
}

export async function clearSession(ctx) {
  ctx.session = null;
  await ctx.db.prepare('DELETE FROM chat_sessions WHERE user_id = ?').bind(ctx.user.id).run();
}

/**
 * Shows a screen: edits the message we are already using, or sends a new one if there is none (or it can no longer be edited).
 * The session, when there is one, remembers the message so a typed answer can update the same screen.
 */
export async function show(ctx, text, rows = []) {
  const markup = { inline_keyboard: rows };
  const body = text.length > 3900 ? `${text.slice(0, 3890)}…` : text;
  const mid = ctx.msgId ?? ctx.session?.message_id ?? null;
  if (mid) {
    try {
      await ctx.tg.editMessageText(ctx.chatId, mid, body, markup);
      ctx.msgId = mid;
    } catch (err) {
      if (err instanceof TelegramError && /not modified/i.test(err.description || '')) ctx.msgId = mid;
      else ctx.msgId = null; // too old, deleted or otherwise not editable: send a fresh one
    }
  }
  if (!ctx.msgId) {
    const sent = await ctx.tg.sendMessage(ctx.chatId, body, { reply_markup: markup });
    ctx.msgId = sent.message_id;
  }
  if (ctx.session) await saveSession(ctx);
  return ctx.msgId;
}

/** Keeps the chat tidy: what the person typed (an address, a name) is removed once we have read it. */
export const tidy = (ctx, messageId) => ctx.tg.deleteMessage(ctx.chatId, messageId).catch(() => {});

export const homeRow = (ctx) => [btn(ctx.s.btn.home, 'c:home')];
