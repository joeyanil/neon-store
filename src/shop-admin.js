// Admin-editable parts of the shop that are not money accounts: the services price list and the policy pages.
import { ApiError } from './http.js';
import { nowSec, OPEN_STATUSES } from './orders.js';
import { PLATFORMS, cleanLabel, cleanNote } from './validate.js';
import { audit, bad, flag, makeCode } from './admin.js';

// ---------- services ----------

/** "0.85" or "85" ETB per 1,000 units -> cents. Whole birr or up to 2 decimals. */
function parsePrice(v) {
  const s = String(v ?? '').trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return null;
  const [w, f = ''] = s.split('.');
  const cents = Number(w) * 100 + Number(f.padEnd(2, '0'));
  return cents > 0 ? cents : null;
}

function readService(body, cur) {
  const platform = body.platform ?? cur?.platform;
  if (!PLATFORMS.includes(platform)) throw bad('platform', 'Choose Telegram, Instagram, TikTok, YouTube or Other.');
  const name_en = cleanLabel(body.name_en ?? cur?.name_en, 60);
  if (!name_en) throw bad('name_en', 'Give the service a name customers will understand, like "Telegram members" (2 to 60 characters).');
  const amRaw = body.name_am ?? cur?.name_am ?? '';
  const name_am = amRaw === '' ? '' : cleanLabel(amRaw, 60);
  if (name_am === null) throw bad('name_am', 'The Amharic name must be 2 to 60 characters, or empty.');
  const price_cents_per_1000 = body.price !== undefined ? parsePrice(body.price) : cur?.price_cents_per_1000;
  if (!price_cents_per_1000) throw bad('price', 'Enter the price in birr for 1,000 units, like 85 or 85.50.');
  const int = (field, v, lo, hi, msg) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < lo || n > hi) throw bad(field, msg);
    return n;
  };
  const min_qty = int('min_qty', body.min_qty ?? cur?.min_qty, 1, 100_000_000, 'Smallest order must be a whole number, 1 or more.');
  const max_qty = int('max_qty', body.max_qty ?? cur?.max_qty, 1, 100_000_000, 'Largest order must be a whole number.');
  if (max_qty < min_qty) throw bad('max_qty', 'The largest order must not be smaller than the smallest.');
  const warranty_days = int('warranty_days', body.warranty_days ?? cur?.warranty_days ?? 0, 0, 3650, 'Warranty must be 0 to 3650 days (0 = none).');
  const eta_text = cleanNote(body.eta_text ?? cur?.eta_text ?? '', 80) ?? '';
  const note = cleanNote(body.note ?? cur?.note ?? '', 240) ?? '';
  const active = flag(body.active, cur?.active ?? 1);
  return { platform, name_en, name_am, price_cents_per_1000, min_qty, max_qty, warranty_days, eta_text, note, active };
}

export async function serviceWithUsage(db, code) {
  const r = await db.prepare('SELECT * FROM service_items WHERE code = ?').bind(code).first();
  if (!r) return null;
  const open = await db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE service_code = ? AND status IN (${OPEN_STATUSES.map(() => '?').join(',')})`).bind(code, ...OPEN_STATUSES).first();
  const used = await db.prepare('SELECT COUNT(*) AS n FROM orders WHERE service_code = ?').bind(code).first();
  return { ...r, open_orders: open.n, total_orders: used.n };
}

export async function listServicesAdmin(db) {
  const { results } = await db.prepare('SELECT * FROM service_items ORDER BY sort, created_at, code').all();
  return results;
}

export async function createService(db, actor, body, now = nowSec()) {
  const v = readService(body, null);
  const sort = (await db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM service_items').first()).n || 1;
  for (let i = 0; i < 5; i++) {
    const code = makeCode(v.name_en);
    try {
      await db
        .prepare(
          `INSERT INTO service_items (code, platform, name_en, name_am, price_cents_per_1000, min_qty, max_qty, eta_text, warranty_days, note, active, sort, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(code, v.platform, v.name_en, v.name_am, v.price_cents_per_1000, v.min_qty, v.max_qty, v.eta_text, v.warranty_days, v.note, v.active, sort, now, now)
        .run();
      await audit(db, actor, 'service.create', `${code} ${v.name_en}`, now);
      return serviceWithUsage(db, code);
    } catch (err) {
      if (!/UNIQUE|PRIMARY/i.test(String(err?.message))) throw err;
    }
  }
  throw new ApiError(500, 'id_collision', 'Could not save. Try again.');
}

export async function updateService(db, actor, code, body, now = nowSec()) {
  const cur = await serviceWithUsage(db, code);
  if (!cur) throw new ApiError(404, 'not_found', 'Service not found.');
  const v = readService(body, cur);
  await db
    .prepare(
      `UPDATE service_items SET platform = ?, name_en = ?, name_am = ?, price_cents_per_1000 = ?, min_qty = ?, max_qty = ?, eta_text = ?,
              warranty_days = ?, note = ?, active = ?, updated_at = ? WHERE code = ?`,
    )
    .bind(v.platform, v.name_en, v.name_am, v.price_cents_per_1000, v.min_qty, v.max_qty, v.eta_text, v.warranty_days, v.note, v.active, now, code)
    .run();
  const changed = Object.keys(v).filter((k) => String(cur[k]) !== String(v[k]));
  await audit(db, actor, 'service.update', `${code}: ${changed.join(', ') || 'no change'}`, now);
  return serviceWithUsage(db, code);
}

export async function deleteService(db, actor, code, now = nowSec()) {
  const cur = await serviceWithUsage(db, code);
  if (!cur) throw new ApiError(404, 'not_found', 'Service not found.');
  if (cur.total_orders > 0) throw new ApiError(409, 'in_use', 'Orders already used this service, so it cannot be deleted. Turn it off instead.');
  await db.prepare('DELETE FROM service_items WHERE code = ?').bind(code).run();
  await audit(db, actor, 'service.delete', `${code} ${cur.name_en}`, now);
}

// ---------- policies ----------

export async function listPolicies(db, { all = false } = {}) {
  const { results } = await db.prepare(`SELECT * FROM policy_sections ${all ? '' : 'WHERE active = 1'} ORDER BY sort, id`).all();
  return results;
}

function readPolicy(body, cur) {
  const title_en = String(body.title_en ?? cur?.title_en ?? '').trim();
  if (title_en.length < 2 || title_en.length > 80) throw bad('title_en', 'Give the section a title (2 to 80 characters).');
  const body_en = String(body.body_en ?? cur?.body_en ?? '').trim();
  if (body_en.length < 2 || body_en.length > 4000) throw bad('body_en', 'Write the text of this section (up to 4000 characters).');
  const title_am = String(body.title_am ?? cur?.title_am ?? '').trim().slice(0, 80);
  const body_am = String(body.body_am ?? cur?.body_am ?? '').trim().slice(0, 4000);
  const active = flag(body.active, cur?.active ?? 1);
  return { title_en, title_am, body_en, body_am, active };
}

export async function createPolicy(db, actor, body, now = nowSec()) {
  const v = readPolicy(body, null);
  const sort = (await db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM policy_sections').first()).n || 1;
  const res = await db
    .prepare('INSERT INTO policy_sections (sort, title_en, title_am, body_en, body_am, active) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(sort, v.title_en, v.title_am, v.body_en, v.body_am, v.active)
    .run();
  const id = res.meta.last_row_id;
  await audit(db, actor, 'policy.create', `${id} ${v.title_en}`, now);
  return db.prepare('SELECT * FROM policy_sections WHERE id = ?').bind(id).first();
}

export async function updatePolicy(db, actor, id, body, now = nowSec()) {
  const cur = await db.prepare('SELECT * FROM policy_sections WHERE id = ?').bind(id).first();
  if (!cur) throw new ApiError(404, 'not_found', 'Section not found.');
  const v = readPolicy(body, cur);
  let sort = cur.sort;
  if (body.sort !== undefined) {
    sort = Number(body.sort);
    if (!Number.isInteger(sort) || sort < 0 || sort > 10_000) throw bad('sort', 'Position must be a whole number.');
  }
  await db.prepare('UPDATE policy_sections SET sort = ?, title_en = ?, title_am = ?, body_en = ?, body_am = ?, active = ? WHERE id = ?').bind(sort, v.title_en, v.title_am, v.body_en, v.body_am, v.active, id).run();
  await audit(db, actor, 'policy.update', `${id} ${v.title_en}`, now);
  return db.prepare('SELECT * FROM policy_sections WHERE id = ?').bind(id).first();
}

export async function deletePolicy(db, actor, id, now = nowSec()) {
  const cur = await db.prepare('SELECT title_en FROM policy_sections WHERE id = ?').bind(id).first();
  if (!cur) throw new ApiError(404, 'not_found', 'Section not found.');
  await db.prepare('DELETE FROM policy_sections WHERE id = ?').bind(id).run();
  await audit(db, actor, 'policy.delete', `${id} ${cur.title_en}`, now);
}
