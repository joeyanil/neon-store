// Premium (custom) emoji on the chat bot's buttons.
//
// The owner of a bot that has Telegram Premium can show animated custom emoji in front of button labels
// (Bot API: InlineKeyboardButton.icon_custom_emoji_id). Every button label here starts with an ordinary emoji. The owner
// pairs an ordinary emoji with a custom emoji id (Admin > Shop settings > Button emoji); this file swaps it in when the
// screen is sent. If Telegram refuses (for example the owner has no Premium), the screen is sent again with the
// ordinary emoji, so a button never disappears.
import { audit } from './admin.js';
import { ApiError } from './http.js';
import { setSetting } from './orders.js';
import { textFor } from './chat-text.js';

const KEY = 'button_emoji';
const LEAD = /^((?:\p{Extended_Pictographic}|\p{Regional_Indicator})️?(?:‍\p{Extended_Pictographic}️?)*)\s*/u;
const norm = (e) => e.replace(/️/g, '');
const ID = /^\d{5,25}$/;

/** The ordinary emoji the bot's buttons start with, each with an example label. */
export function knownEmojis() {
  const seen = new Map();
  for (const label of Object.values(textFor('en').btn)) {
    const m = LEAD.exec(label);
    if (m && !seen.has(norm(m[1]))) seen.set(norm(m[1]), { emoji: m[1], example: label.slice(m[0].length) });
  }
  return [...seen.values()];
}

export async function loadMap(db) {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(KEY).first().catch(() => null);
  try {
    const m = JSON.parse(row?.value || '{}');
    return m && typeof m === 'object' && !Array.isArray(m) ? m : {};
  } catch { return {}; }
}

export async function saveMap(db, actor, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError(400, 'invalid_field', 'Send the emoji list as an object.');
  const allowed = new Set(knownEmojis().map((k) => norm(k.emoji)));
  const out = {};
  for (const [emoji, raw] of Object.entries(input)) {
    const id = String(raw ?? '').trim();
    if (!id) continue;
    if (!allowed.has(norm(emoji))) throw new ApiError(400, 'invalid_field', `${emoji} is not used on any button.`, { field: emoji });
    if (!ID.test(id)) throw new ApiError(400, 'invalid_field', 'A premium emoji ID is a long number, like 5368324170671202286. Send a premium emoji to the bot to get it.', { field: emoji });
    out[norm(emoji)] = id;
  }
  await setSetting(db, KEY, JSON.stringify(out));
  await audit(db, actor, 'settings.update', `button emoji: ${Object.keys(out).length} set`);
  return out;
}

/** Rows of buttons with the owner's premium emoji swapped in. Returns the same rows when nothing is set. */
export function decorate(rows, map) {
  if (!map || !Object.keys(map).length) return rows;
  return rows.map((row) => row.map((b) => {
    const m = typeof b.text === 'string' ? LEAD.exec(b.text) : null;
    const id = m && map[norm(m[1])];
    return id ? { ...b, text: b.text.slice(m[0].length) || b.text, icon_custom_emoji_id: id } : b;
  }));
}

/** The custom emoji in a message, as { emoji, id } pairs. */
export function customEmojiIn(msg) {
  const text = msg.text || msg.caption || '';
  return (msg.entities || msg.caption_entities || [])
    .filter((e) => e.type === 'custom_emoji' && e.custom_emoji_id)
    .map((e) => ({ emoji: text.slice(e.offset, e.offset + e.length), id: e.custom_emoji_id }));
}
