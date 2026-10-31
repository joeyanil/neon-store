// Small helpers shared by everything that talks to Telegram: where alerts go, and how to link back into the app.
import { allAdminIds } from './admin.js';
import { setSetting } from './orders.js';

export const baseUrl = (env) => String(env.WEBAPP_URL || '').replace(/\/$/, '');
export const orderUrl = (env, orderId) => `${baseUrl(env)}/?o=${encodeURIComponent(orderId)}`;

export async function getUser(db, id) {
  return db.prepare('SELECT id, first_name, username, language, can_dm FROM users WHERE id = ?').bind(id).first();
}

/** Chats that get order alerts: the chat an owner chose, else ADMIN_CHAT_ID, else a private message to every admin. */
export async function alertTargets(env, settings) {
  if (settings.admin_chat_explicit) return settings.admin_chat_id ? [settings.admin_chat_id] : allAdminIds(env); // an owner's choice beats the env default
  const fromEnv = Number(env.ADMIN_CHAT_ID);
  if (Number.isSafeInteger(fromEnv) && fromEnv !== 0) return [fromEnv];
  return allAdminIds(env);
}

export async function botUsername(env, tg, settings) {
  if (settings.bot_username) return settings.bot_username;
  try {
    const me = await tg.getMe();
    if (me?.username) {
      await setSetting(env.DB, 'bot_username', me.username);
      return me.username;
    }
  } catch (err) {
    console.warn('getMe failed', String(err?.message || err));
  }
  return '';
}

/**
 * A button that opens the app at some place. Private chats can open it directly; groups need a t.me link
 * (which needs the bot's Main Mini App to be set in BotFather).
 * `query` is e.g. "a=NG-ABC123"; `startapp` the same thing for the link form, e.g. "a_NG-ABC123".
 */
export async function appButton(env, tg, settings, chatId, text, query, startapp) {
  if (chatId > 0) return { text, web_app: { url: `${baseUrl(env)}/?${query}` }, style: 'primary' };
  const name = await botUsername(env, tg, settings);
  return name ? { text, url: `https://t.me/${name}?startapp=${startapp}`, style: 'primary' } : null;
}
