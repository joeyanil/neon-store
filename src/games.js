// Inline XO (tic-tac-toe). Anyone types @bot in any chat, picks "Play XO", and the game message appears there.
// The first person to tap becomes X, the next different person becomes O. Each game is one small row in D1.
import { esc } from './telegram.js';
import { getSettings } from './orders.js';
import { botUsername } from './notify.js';

const DAILY_CAP = 2000; // new games per 24 hours; a safety net for the free plan
const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const MARK = { X: '𝗫', O: '𝗢', '.': '·' }; // bold letters for the squares
const OFFER = 'Neon Store: Exchange USDT to ETBirr';

export const nameOf = (u) => String([u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || 'Player').replace(/\s+/g, ' ').trim().slice(0, 20);

export function winnerOf(board) {
  for (const [a, b, c] of LINES) if (board[a] !== '.' && board[a] === board[b] && board[a] === board[c]) return board[a];
  return board.includes('.') ? null : 'D';
}

const openApp = (bot) => (bot ? [{ text: '🛍 Open Store', url: `https://t.me/${bot}?start=xo` }] : []);

function view(g, bot) {
  const done = g.status === 'done';
  const mark = (side) => (done ? (g.winner === side ? '🏆 ' : '') : g.status === 'play' && g.turn === side ? '▸ ' : '');
  const players = `${mark('X')}<b>X</b> ${esc(g.x_name)}  vs  ${mark('O')}<b>O</b> ${g.o_id ? esc(g.o_name) : '…'}`;
  const text = `<b>XO</b> · Game\n${players}`;
  const app = openApp(bot);
  if (g.status === 'wait') {
    return { text, markup: { inline_keyboard: [
      [{ text: 'Join · I go first', callback_data: 'xo:j:o' }, { text: `Join · ${g.x_name} goes first`, callback_data: 'xo:j:x' }], app] } };
  }
  const rows = [0, 3, 6].map((r) => [0, 1, 2].map((c) => ({ text: MARK[g.board[r + c]], callback_data: done ? 'xo:n' : `xo:m:${r + c}` })));
  const kb = [...rows];
  if (done) kb.push([{ text: '🔁 Play again', switch_inline_query_current_chat: `again ${g.rid}` }]); // posts a new game below, same two players
  kb.push(app);
  return { text, markup: { inline_keyboard: kb.filter((r) => r.length) } };
}

/** Someone typed @bot in a chat: offer one game (or, after "Play again", a new game for the same two players). */
export async function handleInlineQuery(env, tg, q) {
  const bot = await botUsername(env, tg, await getSettings(env.DB));
  const again = /^again (\d{1,12})$/.exec(String(q.query || '').trim());
  let old = null;
  if (again) old = await env.DB.prepare("SELECT rowid AS rid, * FROM games WHERE rowid = ? AND status = 'done'").bind(Number(again[1])).first();
  const ok = old && (q.from.id === old.x_id || q.from.id === old.o_id);
  const text = ok
    ? `<b>XO</b> · Game\n<b>X</b> ${esc(old.o_name)}  vs  <b>O</b> ${esc(old.x_name)}`
    : `<b>XO</b> · Game\ntap Play to start`;
  await tg.answerInlineQuery(q.id, [{
    type: 'article', id: `xo${Date.now().toString(36)}`, title: ok ? 'XO · play again' : 'XO', description: OFFER,
    input_message_content: { message_text: text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } },
    reply_markup: { inline_keyboard: [[{ text: '▶️ Play', callback_data: ok ? `xo:p:${old.rid}` : 'xo:s' }], openApp(bot)] },
  }]);
}

const getGame = (db, id) => db.prepare('SELECT rowid AS rid, * FROM games WHERE id = ?').bind(id).first();

/** A button on a game message. Returns quickly and touches only the games table. */
export async function handleGameCallback(env, tg, cb) {
  const id = cb.inline_message_id;
  const me = cb.from;
  const now = Math.floor(Date.now() / 1000);
  const say = (t, alert = false) => tg.answerCallbackQuery(cb.id, t, alert).catch(() => {});
  const bot = await botUsername(env, tg, await getSettings(env.DB));
  const show = async (g) => { const v = view(g, bot); await tg.editInlineMessage(id, v.text, v.markup).catch(() => {}); };
  const [, act, arg] = String(cb.data || '').split(':');
  let g = await getGame(env.DB, id);

  if (act === 'p') { // "Play again": a new message below the old one, same two players, sides swapped so the other person starts
    if (g) return say('This game already started.');
    const old = await env.DB.prepare("SELECT * FROM games WHERE rowid = ? AND status = 'done'").bind(Number(arg)).first();
    if (!old) return say('That game is no longer available. Start a new one.', true);
    if (me.id !== old.x_id && me.id !== old.o_id) return say('Only the two players can play again.', true);
    await env.DB.prepare("INSERT OR IGNORE INTO games (id, x_id, x_name, o_id, o_name, status, turn, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'play', 'X', ?, ?)").bind(id, old.o_id, old.o_name, old.x_id, old.x_name, now, now).run();
    await say();
    return show(await getGame(env.DB, id));
  }
  if (act === 's') {
    if (g) return say('This game already started.');
    const recent = await env.DB.prepare('SELECT COUNT(*) n FROM games WHERE created_at > ?').bind(now - 86400).first();
    if ((recent?.n || 0) >= DAILY_CAP) return say('Games are resting for today. Please try again tomorrow.', true);
    await env.DB.prepare("INSERT OR IGNORE INTO games (id, x_id, x_name, status, created_at, updated_at) VALUES (?, ?, ?, 'wait', ?, ?)").bind(id, me.id, nameOf(me), now, now).run();
    await say();
    return show(await getGame(env.DB, id));
  }
  if (!g) return say('This game has expired. Start a new one with the bot name in any chat.', true);

  if (act === 'j') {
    if (g.status !== 'wait') return say('Already full.');
    if (g.x_id === me.id) return say('Wait for a friend to join.', true);
    const first = arg === 'x' ? 'X' : 'O'; // the person who joins decides who starts
    const r = await env.DB.prepare("UPDATE games SET o_id = ?, o_name = ?, turn = ?, status = 'play', updated_at = ? WHERE id = ? AND status = 'wait'").bind(me.id, nameOf(me), first, now, id).run();
    await say();
    if (!r.meta.changes) return;
    return show(await getGame(env.DB, id));
  }
  if (act === 'm') {
    const i = Number(arg);
    if (g.status !== 'play') return say(g.status === 'done' ? 'This game is over.' : 'Waiting for an opponent.');
    if (me.id !== g.x_id && me.id !== g.o_id) return say('This game already has two players.', true);
    if (me.id !== (g.turn === 'X' ? g.x_id : g.o_id)) return say('Not your turn.');
    if (!Number.isInteger(i) || i < 0 || i > 8 || g.board[i] !== '.') return say('That square is taken.');
    const board = g.board.slice(0, i) + g.turn + g.board.slice(i + 1);
    const w = winnerOf(board);
    const r = await env.DB.prepare('UPDATE games SET board = ?, turn = ?, status = ?, winner = ?, moves = moves + 1, updated_at = ? WHERE id = ? AND board = ? AND status = ?')
      .bind(board, g.turn === 'X' ? 'O' : 'X', w ? 'done' : 'play', w, now, id, g.board, 'play').run();
    await say();
    if (!r.meta.changes) return;
    return show(await getGame(env.DB, id));
  }
  if (act === 'n') return say('This game is over. Tap Play again to start a new one.');
  return say();
}
