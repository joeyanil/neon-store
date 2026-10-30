// Proof of payment: images are stored in a private R2 bucket (env.PROOFS). Nothing here is ever served publicly;
// the API streams a file only to the customer who uploaded it or to an admin.
import { ApiError } from './http.js';
import { nowSec } from './orders.js';

export const MAX_PROOF_BYTES = 6 * 1024 * 1024;

/** The real type of an image, read from its first bytes. A phone's claimed type is never trusted. */
export function sniffImage(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return { type: 'image/png', ext: 'png' };
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return { type: 'image/webp', ext: 'webp' };
  return null;
}

async function sha256Hex(buffer) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function bucket(env) {
  if (!env.PROOFS) throw new ApiError(503, 'storage_unavailable', 'Receipts cannot be saved right now. Try again later.');
  return env.PROOFS;
}

/** Validates an uploaded image and puts it in R2. Returns what to record in order_proofs. */
export async function storeImage(env, orderId, file, prefix = 'proofs') {
  if (file.size > MAX_PROOF_BYTES) throw new ApiError(413, 'photo_too_large', 'That image is too large. Use one under 6 MB.');
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > MAX_PROOF_BYTES) throw new ApiError(413, 'photo_too_large', 'That image is too large. Use one under 6 MB.');
  const kind = sniffImage(new Uint8Array(buffer, 0, Math.min(16, buffer.byteLength)));
  if (!kind) throw new ApiError(400, 'bad_photo', 'Use a JPG, PNG or WebP image.');
  const sha256 = await sha256Hex(buffer);
  const key = `${prefix}/${orderId}/${crypto.randomUUID()}.${kind.ext}`;
  try {
    await bucket(env).put(key, buffer, { httpMetadata: { contentType: kind.type }, customMetadata: { order: orderId } });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    console.error('R2 put failed', String(err?.message || err));
    throw new ApiError(503, 'storage_unavailable', 'Receipts cannot be saved right now. Try again later.');
  }
  return { r2_key: key, content_type: kind.type, size: buffer.byteLength, sha256 };
}

export async function discardImage(env, key) {
  try {
    await env.PROOFS?.delete(key);
  } catch (err) {
    console.warn('R2 delete failed', key, String(err?.message || err));
  }
}

export async function addProofRow(db, { orderId, userId, image, refText, now = nowSec() }) {
  const res = await db
    .prepare('INSERT INTO order_proofs (order_id, user_id, r2_key, content_type, size, sha256, ref_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(orderId, userId, image?.r2_key ?? null, image?.content_type ?? null, image?.size ?? 0, image?.sha256 ?? null, refText || null, now)
    .run();
  return res.meta.last_row_id;
}

/** Proofs of one order for the app. Customers get only their own order's proofs; storage keys never leave the server. */
export async function listProofs(db, orderId) {
  const { results } = await db
    .prepare('SELECT id, content_type, size, ref_text, created_at, r2_key, deleted_at FROM order_proofs WHERE order_id = ? ORDER BY id')
    .bind(orderId)
    .all();
  return results.map((p) => ({ id: p.id, has_image: Boolean(p.r2_key) && !p.deleted_at, removed: Boolean(p.deleted_at), text: p.ref_text, at: p.created_at }));
}

/**
 * Warnings for the admin: the same image or the same typed transaction number already used on another order.
 * @returns {Promise<{kind: 'image' | 'text', order_id: string}[]>}
 */
export async function duplicateWarnings(db, orderId) {
  const out = [];
  const seen = new Set();
  const { results: mine } = await db.prepare('SELECT sha256, ref_text FROM order_proofs WHERE order_id = ?').bind(orderId).all();
  for (const p of mine) {
    if (p.sha256) {
      const { results } = await db.prepare('SELECT DISTINCT order_id FROM order_proofs WHERE sha256 = ? AND order_id != ? LIMIT 5').bind(p.sha256, orderId).all();
      for (const r of results) if (!seen.has(`i${r.order_id}`)) { seen.add(`i${r.order_id}`); out.push({ kind: 'image', order_id: r.order_id }); }
    }
    if (p.ref_text) {
      const { results } = await db.prepare('SELECT DISTINCT order_id FROM order_proofs WHERE lower(ref_text) = lower(?) AND order_id != ? LIMIT 5').bind(p.ref_text, orderId).all();
      for (const r of results) if (!seen.has(`t${r.order_id}`)) { seen.add(`t${r.order_id}`); out.push({ kind: 'text', order_id: r.order_id }); }
    }
  }
  return out;
}

/** Streams one proof image. The caller has already checked who is asking. */
export async function proofResponse(env, db, orderId, proofId) {
  const row = await db.prepare('SELECT r2_key, content_type, deleted_at FROM order_proofs WHERE id = ? AND order_id = ?').bind(proofId, orderId).first();
  if (!row || !row.r2_key || row.deleted_at) throw new ApiError(404, 'not_found', 'That image is no longer available.');
  const obj = await bucket(env).get(row.r2_key);
  if (!obj) throw new ApiError(404, 'not_found', 'That image is no longer available.');
  return new Response(obj.body, {
    headers: {
      'content-type': row.content_type || 'application/octet-stream',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'content-disposition': 'inline',
      'content-security-policy': "default-src 'none'; sandbox",
    },
  });
}

/** Retention job: delete the images of long-finished orders. The order record and history stay. */
export async function purgeOldProofs(env, now = nowSec(), limit = 50) {
  const { results: setting } = await env.DB.prepare("SELECT value FROM settings WHERE key = 'proof_retention_days'").all();
  const days = Number(setting[0]?.value ?? 90);
  if (!(days > 0) || !env.PROOFS) return 0;
  const cutoff = now - days * 86400;
  const { results } = await env.DB
    .prepare(
      `SELECT p.id, p.r2_key FROM order_proofs p JOIN orders o ON o.id = p.order_id
       WHERE p.r2_key IS NOT NULL AND p.deleted_at IS NULL AND o.status IN ('completed','rejected','cancelled','expired') AND o.updated_at < ?
       ORDER BY p.id LIMIT ?`,
    )
    .bind(cutoff, limit)
    .all();
  for (const p of results) {
    await discardImage(env, p.r2_key);
    await env.DB.prepare('UPDATE order_proofs SET deleted_at = ? WHERE id = ?').bind(now, p.id).run();
  }
  // Photos in closed support tickets follow the same retention.
  const { results: tp } = await env.DB
    .prepare(
      `SELECT m.id, m.r2_key FROM ticket_messages m JOIN tickets t ON t.id = m.ticket_id
       WHERE m.r2_key IS NOT NULL AND t.status = 'closed' AND t.updated_at < ? ORDER BY m.id LIMIT ?`,
    )
    .bind(cutoff, limit)
    .all();
  for (const m of tp) {
    await discardImage(env, m.r2_key);
    await env.DB.prepare('UPDATE ticket_messages SET r2_key = NULL, content_type = NULL WHERE id = ?').bind(m.id).run();
  }
  return results.length + tp.length;
}
