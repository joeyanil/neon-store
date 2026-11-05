// Inline XO (tic-tac-toe). Anyone types @bot in any chat, picks "Play XO", and the game message appears there.
// The first person to tap becomes X, the next different person becomes O. Each game is one small row in D1.
import { esc } from './telegram.js';

const DAILY_CAP = 2000; // new games per 24 hours; a safety net for the free plan
const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const MARK = { X: '🔵', O: '🟠', '.': '⬜' };
const PROMO = '🎮 <i>Neon Store · USDT and social media services</i>';

export const nameOf = (u) => String([u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || 'Player').replace(/\s+/g, ' ').trim().slice(0, 20);

export function winnerOf(board) {
  for (const [a, b, c] of LINES) if (board[a] !== '.' && board[a] === board[b] && board[a] === board[c]) return board[a];
  return board.includes('.') ? null : 'D';
}

function view(g) {
  const x = `🔵 ${esc(g.x_name)}`;
  const o = g.o_id ? `🟠 ${esc(g.o_name)}` : '🟠 …';
  if (g.status === 'wait') {
    return { text: `<b>Tic-Tac-Toe</b>\n${x} is waiting for an opponent.\n\n${PROMO}`, markup: { inline_keyboard: [[{ text: '🟠 Join the game', callback_data: 'xo:j' }]] } };
  }
  const rows = [0, 3, 6].map((r) => [0, 1, 2].map((c) => ({ text: MARK[g.board[r + c]], callback_data: `xo:m:${r + c}` })));
  let line;
  if (g.status === 'done') line = g.winner === 'D' ? "🤝 It's a draw!" : `🏆 ${g.winner === 'X' ? esc(g.x_name) : esc(g.o_name)} wins!`;
  else line = `Turn: ${g.turn === 'X' ? x : o}`;
  const kb = [...rows];
  if (g.status === 'done') kb.push([{ text: '🔁 Rematch', callback_data: 'xo:r' }]);
  return { text: `<b>Tic-Tac-Toe</b>\n${x}  vs  ${o}\n\n${line}\n\n${PROMO}`, markup: { inline_keyboard: kb.filter((r) => r.length) } };
}

/** Someone typed @bot in a chat: offer one game. */
export async function handleInlineQuery(env, tg, q) {
  const text = `<b>Tic-Tac-Toe</b>\nTap Play to start. The first person to tap is 🔵, the next is 🟠.\n\n${PROMO}`;
  await tg.answerInlineQuery(q.id, [{
    type: 'article', id: `xo${Date.now().toString(36)}`, title: '🔵🟠 Play XO', description: 'Tic-tac-toe with a friend in this chat',
    input_message_content: { message_text: text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } },
    reply_markup: { inline_keyboard: [[{ text: '▶️ Play', callback_data: 'xo:s' }]] },
  }]);
}

const getGame = (db, id) => db.prepare('SELECT * FROM games WHERE id = ?').bind(id).first();

/** A button on a game message. Returns quickly and touches only the games table. */
export async function handleGameCallback(env, tg, cb) {
  const id = cb.inline_message_id;
  const me = cb.from;
  const now = Math.floor(Date.now() / 1000);
  const say = (t, alert = false) => tg.answerCallbackQuery(cb.id, t, alert).catch(() => {});
  const show = async (g) => { const v = view(g); await tg.editInlineMessage(id, v.text, v.markup).catch(() => {}); };
  const [, act, arg] = String(cb.data || '').split(':');
  let g = await getGame(env.DB, id);

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
    const r = await env.DB.prepare("UPDATE games SET o_id = ?, o_name = ?, status = 'play', updated_at = ? WHERE id = ? AND status = 'wait'").bind(me.id, nameOf(me), now, id).run();
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
  if (act === 'r') {
    if (g.status !== 'done') return say();
    if (me.id !== g.x_id && me.id !== g.o_id) return say('Only the players can start a rematch.', true);
    const r = await env.DB.prepare("UPDATE games SET board = '.........', turn = 'X', status = 'play', winner = NULL, moves = 0, x_id = o_id, x_name = o_name, o_id = x_id, o_name = x_name, updated_at = ? WHERE id = ? AND status = 'done'").bind(now, id).run();
    await say();
    if (!r.meta.changes) return;
    return show(await getGame(env.DB, id));
  }
  return say();
}
