// The owner's read-only view of the database: live size, what is stored, what will be deleted soon,
// and a CSV copy of the orders sent to the owner's chat before old records are removed.
import { audit, ownerIdList } from './admin.js';
import { ApiError } from './http.js';
import { baseUrl } from './notify.js';
import { getSettings, nowSec, setSetting } from './orders.js';
import { DB_LIMIT_BYTES } from './retention.js';

export const WARN_DAYS = 14;           // owners are told this many days before old records are deleted
const REMIND_EVERY = 7 * 86400;
const PAGE = 4000;                     // orders per CSV file
const MAX_FILES = 5;
const TERMINAL = "('completed','rejected','cancelled','expired')";

/** The database size right now. Cloudflare returns it with every query, so this costs nothing extra. */
export async function liveSize(db, fallback = 0) {
  try {
    const r = await db.prepare('SELECT 1').run();
    const n = Number(r.meta?.size_after);
    return n > 0 ? n : fallback;
  } catch {
    return fallback;
  }
}

const readKey = async (db, key) => Number((await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first())?.value) || 0;

/** Finished orders old enough to be deleted within WARN_DAYS (or already due). */
export async function expiring(db, keepDays, now) {
  const soon = now - Math.max(keepDays - WARN_DAYS, 1) * 86400;
  const r = await db.prepare(`SELECT COUNT(*) AS n, MIN(updated_at) AS oldest FROM orders WHERE status IN ${TERMINAL} AND updated_at < ?`).bind(soon).first();
  return { count: r?.n || 0, oldest: r?.oldest || null, before: soon };
}

export async function storageReport(env) {
  const db = env.DB;
  const now = nowSec();
  const cfg = await getSettings(db);
  const bytes = await liveSize(db, cfg.db_bytes);
  const c = await db.prepare(
    `SELECT (SELECT COUNT(*) FROM orders) AS orders,
            (SELECT COUNT(*) FROM orders WHERE status IN ${TERMINAL}) AS finished,
            (SELECT COUNT(*) FROM orders WHERE created_at >= ?) AS orders_30d,
            (SELECT COUNT(*) FROM order_proofs WHERE r2_key IS NOT NULL AND deleted_at IS NULL) AS receipts,
            (SELECT COUNT(*) FROM tickets) AS tickets,
            (SELECT COUNT(*) FROM audit_log) AS activity,
            (SELECT COUNT(*) FROM games) AS games,
            (SELECT COUNT(*) FROM users) AS customers,
            (SELECT MIN(created_at) FROM orders) AS first_order`).bind(now - 30 * 86400).first();
  const soon = await expiring(db, cfg.data_retention_days, now);
  return {
    bytes, limit: DB_LIMIT_BYTES, keep_days: cfg.data_retention_days, warn_days: WARN_DAYS,
    counts: { orders: c.orders, finished: c.finished, receipts: c.receipts, tickets: c.tickets, activity: c.activity, games: c.games, customers: c.customers },
    orders_per_day: Math.round((c.orders_30d / 30) * 10) / 10,
    expiring: { count: soon.count, oldest: soon.oldest },
    last_export_at: (await readKey(db, 'last_export_at')) || null,
    server_time: now,
  };
}

// ---------- CSV ----------

const addis = (sec) => (sec ? new Date((sec + 3 * 3600) * 1000).toISOString().slice(0, 16).replace('T', ' ') : '');
const money = (micro) => (micro == null ? '' : (micro / 1e6).toFixed(2));
const cents = (c) => (c == null ? '' : (c / 100).toFixed(2));

/** One CSV cell. Quotes are doubled, and a leading = + - @ is defused so Excel never runs customer text as a formula. */
export function cell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const HEAD = ['Order', 'Created (Addis Ababa)', 'Last update (Addis Ababa)', 'Status', 'Type', 'Customer id', 'Customer name', 'Username',
  'Product or service', 'Quantity', 'Link', 'USDT', 'Rate (ETB per USDT)', 'Total ETB', 'Birr method', 'USDT network', 'Customer USDT address',
  'Payout name', 'Payout account', 'Transaction numbers typed', 'Completion reference', 'Receipts sent', 'Rejected because', 'Late proof', 'Stars', 'Review'];

function line(o) {
  return [o.id, addis(o.created_at), addis(o.updated_at), o.status, o.side, o.user_id, o.first_name, o.username ? `@${o.username}` : '',
    o.service_name || (o.side === 'service' ? o.service_code : 'USDT'), o.quantity, o.target, money(o.usdt_micro), cents(o.rate_cents), cents(o.etb_cents),
    o.method_label, o.network_label, o.usdt_address, o.payout_name, o.payout_account, o.refs, o.completion_ref, o.evidence_count,
    o.reject_reason, o.late ? 'yes' : '', o.rating, o.review_text].map(cell).join(',');
}

async function page(db, where, binds, offset) {
  const { results } = await db.prepare(
    `SELECT o.*, u.first_name, u.username, m.label_en AS method_label, n.label AS network_label, s.name_en AS service_name,
            (SELECT group_concat(p.ref_text, ' | ') FROM order_proofs p WHERE p.order_id = o.id AND p.ref_text IS NOT NULL) AS refs
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       LEFT JOIN birr_methods m ON m.code = o.method_code
       LEFT JOIN usdt_networks n ON n.code = o.network_code
       LEFT JOIN service_items s ON s.code = o.service_code
      WHERE ${where} ORDER BY o.created_at, o.id LIMIT ? OFFSET ?`).bind(...binds, PAGE, offset).all();
  return results;
}

/** Builds the CSV files for a scope: 'expiring' (finished orders about to be deleted) or 'all' (every order). */
export async function buildExport(env, scope) {
  const db = env.DB;
  const now = nowSec();
  const cfg = await getSettings(db);
  const where = scope === 'all' ? '1 = 1' : `o.status IN ${TERMINAL} AND o.updated_at < ?`;
  const binds = scope === 'all' ? [] : [(await expiring(db, cfg.data_retention_days, now)).before];
  const files = [];
  let total = 0;
  for (let i = 0; i < MAX_FILES; i += 1) {
    const rows = await page(db, where, binds, i * PAGE);
    if (!rows.length) break;
    total += rows.length;
    files.push({ rows: rows.length, body: `﻿${HEAD.map(cell).join(',')}\r\n${rows.map(line).join('\r\n')}\r\n` });
    if (rows.length < PAGE) break;
  }
  return { files, total, now };
}

/** Sends the CSV file(s) to the owner's private chat with the bot. */
export async function sendExport(env, tg, userId, scope) {
  if (scope !== 'expiring' && scope !== 'all') throw new ApiError(400, 'invalid_field', 'Choose what to download.', { field: 'scope' });
  const { files, total, now } = await buildExport(env, scope);
  if (!total) throw new ApiError(409, 'nothing_to_export', scope === 'all' ? 'There are no orders yet.' : 'No orders are close to being deleted yet.');
  const day = new Date((now + 3 * 3600) * 1000).toISOString().slice(0, 10);
  try {
    for (let i = 0; i < files.length; i += 1) {
      const name = `neon-orders-${scope}-${day}${files.length > 1 ? `-part${i + 1}` : ''}.csv`;
      const caption = `📄 ${files[i].rows} order${files[i].rows === 1 ? '' : 's'} · ${scope === 'all' ? 'all orders' : 'finished orders about to be deleted'}\nContains customer details. Keep it private.`;
      await tg.sendDocument(userId, new Blob([files[i].body], { type: 'text/csv' }), name, caption);
    }
  } catch {
    throw new ApiError(502, 'send_failed', 'The bot could not send the file. Open the bot chat, press Start, and try again.');
  }
  await setSetting(env.DB, 'last_export_at', now, now);
  await audit(env.DB, userId, 'export_orders', `${scope}, ${total} orders`);
  return { sent: total, files: files.length };
}

/** Cron: a private reminder to the owners before old records are deleted. At most once a week, and not right after a download. */
export async function remindExport(env, tg, now) {
  const db = env.DB;
  const cfg = await getSettings(db);
  if (!(cfg.data_retention_days > WARN_DAYS + 3)) return 0;
  const soon = await expiring(db, cfg.data_retention_days, now);
  if (!soon.count) return 0;
  if (now - (await readKey(db, 'last_export_at')) < REMIND_EVERY || now - (await readKey(db, 'export_reminded_at')) < REMIND_EVERY) return 0;
  const days = Math.max(Math.ceil((soon.oldest + cfg.data_retention_days * 86400 - now) / 86400), 0);
  const text = `🗂 <b>Old orders will be deleted soon</b>\n${soon.count} finished order${soon.count === 1 ? '' : 's'} will be removed ${days <= 0 ? 'now' : `in about ${days} day${days === 1 ? '' : 's'}`} to keep storage free.\nKeep a copy first: open Storage and tap <b>Download a copy</b>.`;
  const url = baseUrl(env) ? `${baseUrl(env)}/?s=storage` : '';
  let sent = 0;
  for (const id of ownerIdList(env)) {
    const markup = url ? { inline_keyboard: [[{ text: '🗂 Open Storage', web_app: { url }, style: 'primary' }]] } : undefined;
    if (await tg.sendMessage(id, text, markup ? { reply_markup: markup } : {}).then(() => true, () => false)) sent += 1;
  }
  if (sent) await setSetting(db, 'export_reminded_at', now, now);
  return sent;
}
