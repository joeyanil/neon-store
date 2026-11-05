// Keeps the free database small: finished orders, finished tickets and old activity are deleted after a set number of days.
// Open orders and open tickets are never touched. Everything runs in small batches because a Worker has a call budget per run.
import { alertTargets } from './notify.js';
import { getSettings, setSetting } from './orders.js';

export const DB_LIMIT_BYTES = 500 * 1024 * 1024; // the free plan's size for one database
const TERMINAL = "('completed','rejected','cancelled','expired')";
const marks = (n) => Array.from({ length: n }, () => '?').join(',');

/** Deletes records older than the retention period. Returns how many orders, tickets and log rows were removed. */
export async function purgeOldData(env, now, limit = 10) {
  const { data_retention_days: days } = await getSettings(env.DB);
  if (!(days > 0)) return { orders: 0, tickets: 0, logs: 0 };
  const cutoff = now - days * 86400;
  const db = env.DB;

  // Finished orders whose receipt images are already gone (the image job runs first).
  const { results: orders } = await db.prepare(
    `SELECT o.id FROM orders o WHERE o.status IN ${TERMINAL} AND o.updated_at < ?
       AND NOT EXISTS (SELECT 1 FROM order_proofs p WHERE p.order_id = o.id AND p.r2_key IS NOT NULL AND p.deleted_at IS NULL)
     ORDER BY o.updated_at LIMIT ?`).bind(cutoff, limit).all();
  if (orders.length) {
    const ids = orders.map((o) => o.id);
    const q = marks(ids.length);
    await db.batch([
      db.prepare(`DELETE FROM order_events WHERE order_id IN (${q})`).bind(...ids),
      db.prepare(`DELETE FROM order_proofs WHERE order_id IN (${q})`).bind(...ids),
      db.prepare(`DELETE FROM admin_notices WHERE order_id IN (${q})`).bind(...ids),
      db.prepare(`UPDATE tickets SET order_id = NULL WHERE order_id IN (${q})`).bind(...ids),
      db.prepare(`DELETE FROM orders WHERE id IN (${q})`).bind(...ids),
    ]);
  }

  // Closed tickets with no image left to remove.
  const { results: tickets } = await db.prepare(
    `SELECT t.id FROM tickets t WHERE t.status = 'closed' AND t.updated_at < ?
       AND NOT EXISTS (SELECT 1 FROM ticket_messages m WHERE m.ticket_id = t.id AND m.r2_key IS NOT NULL)
     ORDER BY t.updated_at LIMIT ?`).bind(cutoff, limit).all();
  if (tickets.length) {
    const ids = tickets.map((t) => t.id);
    const q = marks(ids.length);
    await db.batch([
      db.prepare(`DELETE FROM ticket_messages WHERE ticket_id IN (${q})`).bind(...ids),
      db.prepare(`DELETE FROM admin_notices WHERE order_id IN (${q})`).bind(...ids),
      db.prepare(`DELETE FROM tickets WHERE id IN (${q})`).bind(...ids),
    ]);
  }

  const logs = await db.prepare('DELETE FROM audit_log WHERE id IN (SELECT id FROM audit_log WHERE created_at < ? ORDER BY id LIMIT 200)').bind(cutoff).run();
  return { orders: orders.length, tickets: tickets.length, logs: logs.meta?.changes || 0 };
}

/** Records the database size and warns the owners once when it passes 70% and again at 90%. */
export async function checkStorage(env, tg, now) {
  const probe = await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('db_bytes', '0', ?) ON CONFLICT(key) DO UPDATE SET updated_at = excluded.updated_at").bind(now).run();
  const bytes = Number(probe.meta?.size_after);
  if (!(bytes > 0)) return null;
  await setSetting(env.DB, 'db_bytes', bytes, now);
  const pct = Math.round((bytes / DB_LIMIT_BYTES) * 100);
  const level = pct >= 90 ? 90 : pct >= 70 ? 70 : 0;
  const s = await getSettings(env.DB);
  if (level > s.db_warned) {
    const mb = Math.round(bytes / 1048576);
    const text = `⚠️ <b>Storage is ${pct}% full</b>\nThe database uses ${mb} MB of 500 MB.\nFinished orders are deleted after ${s.data_retention_days} days. If this keeps growing, lower "Keep order records for" in Shop settings, Rates, limits and stock.`;
    for (const id of await alertTargets(env, s)) await tg.sendMessage(id, text).catch(() => {});
  }
  if (level !== s.db_warned) await setSetting(env.DB, 'db_warned', level, now);
  return { bytes, pct };
}
