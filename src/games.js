// Inline XO (tic-tac-toe). Anyone types @bot in any chat and picks "XO"; the board appears at once.
// The first person to tap a square is X and plays that square, the next different person is O. Each game is one small row in D1.
import { esc } from './telegram.js';
import { getSettings } from './orders.js';
import { botUsername } from './notify.js';

const DAILY_CAP = 2000; // new games per 24 hours; a safety net for the free plan
const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const MARK = { X: '𝗫', O: '𝗢', '.': '·' }; // bold letters on the squares
const OFFER = 'Neon Store: Exchange USDT to ETBirr';
const GAP = '   ';

export const nameOf = (u) => String([u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || 'Player').replace(/\s+/g, ' ').trim().slice(0, 20);

export function winnerOf(board) {
  for (const [a, b, c] of LINES) if (board[a] !== '.' && board[a] === board[b] && board[a] === board[c]) return board[a];
  return board.includes('.') ? null : 'D';
}

const openApp = (bot) => (bot ? [{ text: '🛍 Open Store', url: `https://t.me/${bot}?start=xo`, style: 'primary' }] : []);

/** The message text: title, X, "vs", O. ▸ marks whose turn it is; after the game 🥇 / 🙌 (or 🤝 for a draw). */
function textOf({ xName, oName, turn, winner }) {
  const side = (s, name) => {
    const who = name == null ? '…' : esc(name);
    if (winner) return `<b>${s}</b> ${who} ${winner === 'D' ? '🤝' : winner === s ? '🥇' : '🙌'}`;
    return `${turn === s ? '▸' : '▹'} <b>${s}</b> ${who}`;
  };
  return `<b>XO</b> · Game\n${side('X', xName)}\n${GAP}vs\n${side('O', oName)}`;
}

function boardRows(board, data) {
  return [0, 3, 6].map((r) => [0, 1, 2].map((c) => ({ text: MARK[board[r + c]], callback_data: data(r + c) })));
}

function view(g, bot) {
  const done = g.status === 'done';
  const text = textOf({ xName: g.x_name, oName: g.o_id ? g.o_name : null, turn: g.turn, winner: done ? g.winner : null });
  const kb = boardRows(g.board, (i) => (done ? 'xo:n' : `xo:m:${i}`));
  if (done) kb.push([{ text: '🔁 Play again', switch_inline_query_current_chat: `again ${g.rid}` }]); // posts a new game below, same two players
  kb.push(openApp(bot));
  return { text, markup: { inline_keyboard: kb.filter((r) => r.length) } };
}

/** Someone typed @bot in a chat: offer one game (or, after "Play again", a new game for the same two players). */
export async function handleInlineQuery(env, tg, q) {
  const settings = await getSettings(env.DB);
  const bot = await botUsername(env, tg, settings);
  const base = String(env.WEBAPP_URL || settings.webapp_url || '').replace(/\/$/, '');
  const again = /^again (\d{1,12})$/.exec(String(q.query || '').trim());
  const old = again ? await env.DB.prepare("SELECT rowid AS rid, * FROM games WHERE rowid = ? AND status = 'done'").bind(Number(again[1])).first() : null;
  const ok = old && (q.from.id === old.x_id || q.from.id === old.o_id);
  // After "Play again" the two players swap sides, so the other person starts.
  const text = ok ? textOf({ xName: old.o_name, oName: old.x_name, turn: 'X' }) : `<b>XO</b> · Game\nTap any square to start`;
  const cells = boardRows('.........', (i) => (ok ? `xo:a:${old.rid}:${i}` : `xo:m:${i}`));
  const result = {
    type: 'article', id: `xo${Date.now().toString(36)}`, title: ok ? 'XO · play again' : 'XO', description: OFFER,
    input_message_content: { message_text: text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } },
    reply_markup: { inline_keyboard: [...cells, openApp(bot)].filter((r) => r.length) },
  };
  if (/^https?:\/\//.test(base)) Object.assign(result, { thumbnail_url: `${base}/xo-thumb.jpg`, thumbnail_width: 320, thumbnail_height: 320 });
  await tg.answerInlineQuery(q.id, [result]);
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
  const [, act, a1, a2] = String(cb.data || '').split(':');
  if (act === 'n') return say('This game is over. Tap Play again to start a new one.');
  if (act !== 'm' && act !== 'a') return say();
  const cell = Number(act === 'a' ? a2 : a1);
  if (!Number.isInteger(cell) || cell < 0 || cell > 8) return say();

  let g = await getGame(env.DB, id);
  if (!g) {
    if (act === 'a') { // a "play again" message: the same two people, the other one starts
      const old = await env.DB.prepare("SELECT * FROM games WHERE rowid = ? AND status = 'done'").bind(Number(a1)).first();
      if (!old) return say('That game is no longer available. Start a new one.', true);
      if (me.id !== old.x_id && me.id !== old.o_id) return say('Only the two players can play again.', true);
      await env.DB.prepare("INSERT OR IGNORE INTO games (id, x_id, x_name, o_id, o_name, status, turn, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'play', 'X', ?, ?)").bind(id, old.o_id, old.o_name, old.x_id, old.x_name, now, now).run();
    } else { // a brand-new game: whoever taps first is X
      const recent = await env.DB.prepare('SELECT COUNT(*) n FROM games WHERE created_at > ?').bind(now - 86400).first();
      if ((recent?.n || 0) >= DAILY_CAP) return say('Games are resting for today. Please try again tomorrow.', true);
      await env.DB.prepare("INSERT OR IGNORE INTO games (id, x_id, x_name, status, turn, created_at, updated_at) VALUES (?, ?, ?, 'play', 'X', ?, ?)").bind(id, me.id, nameOf(me), now, now).run();
    }
    g = await getGame(env.DB, id);
    if (!g) return say();
  }

  if (g.status === 'done') return say('This game is over. Tap Play again to start a new one.');
  if (!g.o_id && me.id !== g.x_id) { // the second person to tap becomes O
    await env.DB.prepare('UPDATE games SET o_id = ?, o_name = ? WHERE id = ? AND o_id IS NULL').bind(me.id, nameOf(me), id).run();
    g = await getGame(env.DB, id);
  }
  if (me.id !== g.x_id && me.id !== g.o_id) return say('This game already has two players.', true);
  if (!g.o_id) { // X has played and is waiting; X cannot play both sides
    if (g.board[cell] === '.' && g.moves === 0) { /* first move of a new game, handled below */ } else return say('Waiting for a friend to play.');
  }
  if (g.o_id && me.id !== (g.turn === 'X' ? g.x_id : g.o_id)) { await say('Not your turn.'); return show(g); }
  if (g.board[cell] !== '.') return say('That square is taken.');

  const board = g.board.slice(0, cell) + g.turn + g.board.slice(cell + 1);
  const w = winnerOf(board);
  const r = await env.DB.prepare('UPDATE games SET board = ?, turn = ?, status = ?, winner = ?, moves = moves + 1, updated_at = ? WHERE id = ? AND board = ? AND status = ?')
    .bind(board, g.turn === 'X' ? 'O' : 'X', w ? 'done' : 'play', w, now, id, g.board, 'play').run();
  await say();
  if (!r.meta.changes) return;
  return show(await getGame(env.DB, id));
}
