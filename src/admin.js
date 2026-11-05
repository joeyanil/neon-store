// Everything the admin area needs from the database: accounts, networks, team, settings, queue and setup progress.
// No Telegram calls here (see service.js for those).
import { chatOf, parseRef } from './channels.js';
import { DB_LIMIT_BYTES } from './retention.js';
import { ApiError } from './http.js';
import { formatEtb, parseRate, parseUsdt } from './money.js';
import {
  ORDER_SELECT, OPEN_STATUSES, getCatalog, getEvents, getSettings, listMethods, listNetworks, nowSec, orderView, setPaused, setRates, setSetting, sideAvailability,
} from './orders.js';
import { duplicateWarnings, listProofs } from './proofs.js';
import { cleanAccount, cleanAddress, cleanLabel, cleanName, cleanNote, METHOD_KINDS, NETWORK_KINDS } from './validate.js';

// ---------- who is an admin ----------

const ownerIds = (env) => new Set(String(env.ADMIN_IDS || '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isSafeInteger(n) && n > 0));

/** The first owner in ADMIN_IDS, or 0. */
export const firstOwnerId = (env) => [...ownerIds(env)][0] || 0;

/** 'owner' (ids in ADMIN_IDS), 'staff' (added in the app) or null. */
export async function getRole(env, id) {
  if (ownerIds(env).has(id)) return 'owner';
  if (!Number.isSafeInteger(id)) return null;
  const row = await env.DB.prepare('SELECT id FROM admins WHERE id = ?').bind(id).first();
  return row ? 'staff' : null;
}

/** Every admin, for alerts. */
export async function allAdminIds(env) {
  const { results } = await env.DB.prepare('SELECT id FROM admins').all();
  return [...new Set([...ownerIds(env), ...results.map((r) => r.id)])];
}

export async function audit(db, actor, action, detail = '', now = nowSec()) {
  await db.prepare('INSERT INTO audit_log (actor, action, detail, created_at) VALUES (?, ?, ?, ?)').bind(actor, action, String(detail).slice(0, 500), now).run();
}

export async function listAudit(db, limit = 60) {
  const { results } = await db
    .prepare('SELECT a.id, a.actor, a.action, a.detail, a.created_at, u.first_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor ORDER BY a.id DESC LIMIT ?')
    .bind(limit)
    .all();
  return results.map((r) => ({ id: r.id, actor: r.actor, actor_name: r.first_name || null, action: r.action, detail: r.detail, at: r.created_at }));
}

export const bad = (field, message) => new ApiError(400, 'invalid_field', message, { field });
export const flag = (v, fallback) => (v === undefined ? fallback : v === true || v === 1 || v === '1' ? 1 : 0);

// ---------- payment accounts ----------

const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
export function makeCode(label) {
  const base = String(label).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 10) || 'acct';
  const rand = crypto.getRandomValues(new Uint8Array(4));
  return `${base}-${[...rand].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join('')}`;
}

function readMethod(body, current) {
  const kind = body.kind ?? current?.kind;
  if (!METHOD_KINDS.includes(kind)) throw bad('kind', 'Choose bank or mobile money.');
  const label_en = cleanLabel(body.label_en ?? current?.label_en);
  if (!label_en) throw bad('label_en', 'Give this account a name customers will recognise (2 to 40 letters).');
  const amRaw = body.label_am ?? current?.label_am ?? '';
  const label_am = amRaw === '' ? '' : cleanLabel(amRaw);
  if (label_am === null) throw bad('label_am', 'The Amharic name must be 2 to 40 characters, or empty.');
  const accept_buy = flag(body.accept_buy, current?.accept_buy ?? 1);
  const pay_sell = flag(body.pay_sell, current?.pay_sell ?? 1);
  const active = flag(body.active, current?.active ?? 1);
  if (active && !accept_buy && !pay_sell) throw bad('accept_buy', 'Switch on at least one use for this account, or turn the account off.');

  let account_name = String(body.account_name ?? current?.account_name ?? '').trim();
  let account_number = String(body.account_number ?? current?.account_number ?? '').trim();
  if (accept_buy) {
    account_name = cleanName(account_name);
    if (!account_name) throw bad('account_name', 'Enter the name on the account exactly as the bank or Telebirr shows it.');
    account_number = cleanAccount(kind, account_number);
    if (!account_number) throw bad('account_number', kind === 'mobile' ? 'Enter a valid phone number, like 0911 223344.' : 'Enter a valid account number (5 to 30 digits or letters).');
  } else {
    account_name = account_name ? cleanName(account_name) : '';
    account_number = account_number ? cleanAccount(kind, account_number) : '';
    if (account_name === null) throw bad('account_name', 'The account name has characters we cannot use.');
    if (account_number === null) throw bad('account_number', 'That number is not valid for this type of account.');
  }
  const note = cleanNote(body.note ?? current?.note ?? '', 160);
  const int = (field, lo, hi, fallback, msg) => {
    const raw = body[field] ?? fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < lo || n > hi) throw bad(field, msg);
    return n;
  };
  const unlock_orders = int('unlock_orders', 0, 1000, current?.unlock_orders ?? 0, 'Completed orders needed must be a whole number from 0 to 1000 (0 = open to everyone).');
  let unlock_volume_micro = current?.unlock_volume_micro ?? 0;
  if (body.unlock_volume !== undefined) {
    const v = body.unlock_volume === '' || Number(body.unlock_volume) === 0 ? 0 : parseUsdt(body.unlock_volume);
    if (v === null) throw bad('unlock_volume', 'Enter the USDT total a customer must have completed, or 0.');
    unlock_volume_micro = v;
  }
  const unlock_need_ratio = flag(body.unlock_need_ratio, current?.unlock_need_ratio ?? 0);
  return { kind, label_en, label_am, account_name, account_number, note, accept_buy, pay_sell, active, unlock_orders, unlock_volume_micro, unlock_need_ratio };
}

export async function methodWithUsage(db, code) {
  const m = await db.prepare('SELECT * FROM birr_methods WHERE code = ?').bind(code).first();
  if (!m) return null;
  const open = await db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE method_code = ? AND status IN (${OPEN_STATUSES.map(() => '?').join(',')})`).bind(code, ...OPEN_STATUSES).first();
  const used = await db.prepare('SELECT COUNT(*) AS n FROM orders WHERE method_code = ?').bind(code).first();
  return { ...m, open_orders: open.n, total_orders: used.n };
}

export async function listMethodsAdmin(db) {
  const rows = await listMethods(db);
  const { results } = await db.prepare(`SELECT method_code AS code, COUNT(*) AS n FROM orders WHERE status IN (${OPEN_STATUSES.map(() => '?').join(',')}) GROUP BY method_code`).bind(...OPEN_STATUSES).all();
  const open = Object.fromEntries(results.map((r) => [r.code, r.n]));
  return rows.map((m) => ({ ...m, open_orders: open[m.code] || 0 }));
}

export async function createMethod(db, actor, body, now = nowSec()) {
  const v = readMethod(body, null);
  const sort = ((await db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM birr_methods').first()).n) || 1;
  for (let i = 0; i < 5; i++) {
    const code = makeCode(v.label_en);
    try {
      await db
        .prepare(
          `INSERT INTO birr_methods (code, kind, label_en, label_am, account_name, account_number, note, accept_buy, pay_sell, active, sort,
                                     unlock_orders, unlock_volume_micro, unlock_need_ratio, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(code, v.kind, v.label_en, v.label_am, v.account_name, v.account_number, v.note, v.accept_buy, v.pay_sell, v.active, sort, v.unlock_orders, v.unlock_volume_micro, v.unlock_need_ratio, now, now)
        .run();
      await audit(db, actor, 'method.create', `${code} ${v.label_en}`, now);
      return methodWithUsage(db, code);
    } catch (err) {
      if (!/UNIQUE|PRIMARY/i.test(String(err?.message))) throw err;
    }
  }
  throw new ApiError(500, 'id_collision', 'Could not save. Try again.');
}

export async function updateMethod(db, actor, code, body, now = nowSec()) {
  const cur = await methodWithUsage(db, code);
  if (!cur) throw new ApiError(404, 'not_found', 'Account not found.');
  const v = readMethod(body, cur);
  await db
    .prepare(
      `UPDATE birr_methods SET kind = ?, label_en = ?, label_am = ?, account_name = ?, account_number = ?, note = ?,
              accept_buy = ?, pay_sell = ?, active = ?, unlock_orders = ?, unlock_volume_micro = ?, unlock_need_ratio = ?, updated_at = ? WHERE code = ?`,
    )
    .bind(v.kind, v.label_en, v.label_am, v.account_name, v.account_number, v.note, v.accept_buy, v.pay_sell, v.active, v.unlock_orders, v.unlock_volume_micro, v.unlock_need_ratio, now, code)
    .run();
  const changed = ['label_en', 'account_name', 'account_number', 'accept_buy', 'pay_sell', 'active', 'kind', 'note', 'label_am', 'unlock_orders', 'unlock_volume_micro', 'unlock_need_ratio'].filter((k) => String(cur[k]) !== String(v[k]));
  await audit(db, actor, 'method.update', `${code}: ${changed.join(', ') || 'no change'}`, now);
  return methodWithUsage(db, code);
}

export async function deleteMethod(db, actor, code, now = nowSec()) {
  const cur = await methodWithUsage(db, code);
  if (!cur) throw new ApiError(404, 'not_found', 'Account not found.');
  if (cur.total_orders > 0) throw new ApiError(409, 'in_use', 'Orders already used this account, so it cannot be deleted. Turn it off instead.');
  await db.prepare('DELETE FROM birr_methods WHERE code = ?').bind(code).run();
  await audit(db, actor, 'method.delete', `${code} ${cur.label_en}`, now);
}

// ---------- USDT networks ----------

function readNetwork(body, current) {
  const kind = body.kind ?? current?.kind;
  if (!NETWORK_KINDS.includes(kind)) throw bad('kind', 'Choose the type of network.');
  const label = cleanLabel(body.label ?? current?.label, 50);
  if (!label) throw bad('label', 'Give this network a name customers will recognise (2 to 50 characters).');
  const accept_sell = flag(body.accept_sell, current?.accept_sell ?? 1);
  const send_buy = flag(body.send_buy, current?.send_buy ?? 1);
  const active = flag(body.active, current?.active ?? 1);
  if (active && !accept_sell && !send_buy) throw bad('accept_sell', 'Switch on at least one use for this network, or turn it off.');
  const rawAddr = String(body.deposit_address ?? current?.deposit_address ?? '').trim();
  let deposit_address = '';
  if (accept_sell || rawAddr) {
    deposit_address = cleanAddress(kind, rawAddr);
    if (!deposit_address) throw bad('deposit_address', kind === 'bybit_uid' ? 'Enter your Bybit UID (5 to 12 digits).' : kind === 'tron' ? 'Enter a TRON address: it starts with T and has 34 characters.' : kind === 'evm' ? 'Enter an address that starts with 0x followed by 40 characters.' : 'Enter the address customers should send to.');
  }
  return { kind, label, deposit_address, accept_sell, send_buy, active };
}

export async function networkWithUsage(db, code) {
  const n = await db.prepare('SELECT * FROM usdt_networks WHERE code = ?').bind(code).first();
  if (!n) return null;
  const open = await db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE network_code = ? AND status IN (${OPEN_STATUSES.map(() => '?').join(',')})`).bind(code, ...OPEN_STATUSES).first();
  const used = await db.prepare('SELECT COUNT(*) AS n FROM orders WHERE network_code = ?').bind(code).first();
  return { ...n, open_orders: open.n, total_orders: used.n };
}

export async function listNetworksAdmin(db) {
  const rows = await listNetworks(db);
  const { results } = await db.prepare(`SELECT network_code AS code, COUNT(*) AS n FROM orders WHERE status IN (${OPEN_STATUSES.map(() => '?').join(',')}) GROUP BY network_code`).bind(...OPEN_STATUSES).all();
  const open = Object.fromEntries(results.map((r) => [r.code, r.n]));
  return rows.map((n) => ({ ...n, open_orders: open[n.code] || 0 }));
}

export async function createNetwork(db, actor, body, now = nowSec()) {
  const v = readNetwork(body, null);
  const sort = ((await db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM usdt_networks').first()).n) || 1;
  for (let i = 0; i < 5; i++) {
    const code = makeCode(v.label);
    try {
      await db
        .prepare('INSERT INTO usdt_networks (code, kind, label, deposit_address, accept_sell, send_buy, active, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(code, v.kind, v.label, v.deposit_address, v.accept_sell, v.send_buy, v.active, sort, now, now)
        .run();
      await audit(db, actor, 'network.create', `${code} ${v.label}`, now);
      return networkWithUsage(db, code);
    } catch (err) {
      if (!/UNIQUE|PRIMARY/i.test(String(err?.message))) throw err;
    }
  }
  throw new ApiError(500, 'id_collision', 'Could not save. Try again.');
}

export async function updateNetwork(db, actor, code, body, now = nowSec()) {
  const cur = await networkWithUsage(db, code);
  if (!cur) throw new ApiError(404, 'not_found', 'Network not found.');
  const v = readNetwork(body, cur);
  await db
    .prepare('UPDATE usdt_networks SET kind = ?, label = ?, deposit_address = ?, accept_sell = ?, send_buy = ?, active = ?, updated_at = ? WHERE code = ?')
    .bind(v.kind, v.label, v.deposit_address, v.accept_sell, v.send_buy, v.active, now, code)
    .run();
  const changed = ['kind', 'label', 'deposit_address', 'accept_sell', 'send_buy', 'active'].filter((k) => String(cur[k]) !== String(v[k]));
  await audit(db, actor, 'network.update', `${code}: ${changed.join(', ') || 'no change'}`, now);
  return networkWithUsage(db, code);
}

export async function deleteNetwork(db, actor, code, now = nowSec()) {
  const cur = await networkWithUsage(db, code);
  if (!cur) throw new ApiError(404, 'not_found', 'Network not found.');
  if (cur.total_orders > 0) throw new ApiError(409, 'in_use', 'Orders already used this network, so it cannot be deleted. Turn it off instead.');
  await db.prepare('DELETE FROM usdt_networks WHERE code = ?').bind(code).run();
  await audit(db, actor, 'network.delete', `${code} ${cur.label}`, now);
}

// ---------- rates, limits and other settings ----------

export function settingsView(s) {
  return {
    buy_rate_cents: s.buy_rate_cents, sell_rate_cents: s.sell_rate_cents, rate_updated_at: s.rate_updated_at,
    min_usdt_micro: s.min_usdt_micro, max_usdt_micro: s.max_usdt_micro, order_ttl_min: s.order_ttl_min,
    max_open_orders: s.max_open_orders, paused: s.paused, proof_retention_days: s.proof_retention_days, data_retention_days: s.data_retention_days,
    stock_usdt_micro: s.stock_usdt_micro, stock_show: s.stock_show, stock_add_on_sell: s.stock_add_on_sell,
    channel_ref: s.channel_ref, reviews_ref: s.reviews_ref, logs_ref: s.logs_ref,
  };
}

export async function updateSettings(db, actor, body, now = nowSec()) {
  const s = await getSettings(db);
  const changes = [];
  if (body.buy_rate !== undefined || body.sell_rate !== undefined) {
    const buy = body.buy_rate !== undefined ? parseRate(body.buy_rate) : s.buy_rate_cents;
    const sell = body.sell_rate !== undefined ? parseRate(body.sell_rate) : s.sell_rate_cents;
    if (!buy) throw bad('buy_rate', 'Enter the birr price customers pay for 1 USDT, like 168.50.');
    if (!sell) throw bad('sell_rate', 'Enter the birr price you pay customers for 1 USDT, like 163.00.');
    if (sell > buy) throw bad('sell_rate', 'The sell price cannot be higher than the buy price, or you would lose money on every pair of orders.');
    await setRates(db, buy, sell, now);
    changes.push(`rates ${formatEtb(buy)}/${formatEtb(sell)}`);
  }
  if (body.min_usdt !== undefined || body.max_usdt !== undefined) {
    const min = body.min_usdt !== undefined ? parseUsdt(body.min_usdt) : s.min_usdt_micro;
    const max = body.max_usdt !== undefined ? parseUsdt(body.max_usdt) : s.max_usdt_micro;
    if (!min) throw bad('min_usdt', 'Enter the smallest order in USDT.');
    if (!max) throw bad('max_usdt', 'Enter the largest order in USDT.');
    if (min >= max) throw bad('max_usdt', 'The largest order must be bigger than the smallest.');
    await setSetting(db, 'min_usdt_micro', min, now);
    await setSetting(db, 'max_usdt_micro', max, now);
    changes.push('limits');
  }
  const intField = (key, field, lo, hi, label) => {
    if (body[field] === undefined) return null;
    const n = Number(body[field]);
    if (!Number.isInteger(n) || n < lo || n > hi) throw bad(field, `${label} must be a whole number from ${lo} to ${hi}.`);
    return n;
  };
  const ttl = intField('order_ttl_min', 'order_ttl_min', 1, 1440, 'Payment time');
  if (ttl !== null) { await setSetting(db, 'order_ttl_min', ttl, now); changes.push(`ttl ${ttl}`); }
  const maxOpen = intField('max_open_orders', 'max_open_orders', 1, 20, 'Open orders per customer');
  if (maxOpen !== null) { await setSetting(db, 'max_open_orders', maxOpen, now); changes.push(`max_open ${maxOpen}`); }
  const keep = intField('proof_retention_days', 'proof_retention_days', 0, 3650, 'Keep proofs for');
  if (keep !== null) { await setSetting(db, 'proof_retention_days', keep, now); changes.push(`retention ${keep}`); }
  const dataKeep = intField('data_retention_days', 'data_retention_days', 30, 730, 'Keep order records for');
  if (dataKeep !== null) { await setSetting(db, 'data_retention_days', dataKeep, now); changes.push(`records ${dataKeep} days`); }
  if (body.stock_usdt !== undefined) {
    // '' or null switches tracking off; a number (0 allowed) is what the shop holds right now.
    if (body.stock_usdt === '' || body.stock_usdt === null) await setSetting(db, 'stock_usdt_micro', '', now);
    else {
      const v = Number(body.stock_usdt) === 0 ? 0 : parseUsdt(body.stock_usdt);
      if (v === null) throw bad('stock_usdt', 'Enter how much USDT you hold right now, like 2500 or 2500.50.');
      await setSetting(db, 'stock_usdt_micro', v, now);
    }
    changes.push('stock');
  }
  if (body.stock_show !== undefined) { await setSetting(db, 'stock_show', flag(body.stock_show, 1), now); changes.push(`stock_show ${flag(body.stock_show, 1)}`); }
  if (body.stock_add_on_sell !== undefined) { await setSetting(db, 'stock_add_on_sell', flag(body.stock_add_on_sell, 1), now); changes.push(`stock_add_on_sell ${flag(body.stock_add_on_sell, 1)}`); }
  for (const [field, key, label, needsChat] of [['channel', 'channel_ref', 'Channel', false], ['reviews', 'reviews_ref', 'Reviews channel', true], ['logs', 'logs_ref', 'Logs channel', true]]) {
    if (body[field] === undefined) continue;
    const ref = parseRef(body[field]);
    if (ref === null) throw bad(field, `${label}: enter the channel like @mychannel or https://t.me/mychannel.`);
    if (needsChat && ref && !chatOf(ref)) throw bad(field, `${label}: the bot has to post here, so use the public @name or the numeric chat id (an invite link is not enough).`);
    await setSetting(db, key, ref, now);
    changes.push(`${field} ${ref || 'cleared'}`);
  }
  if (body.paused !== undefined) { await setPaused(db, body.paused === true || body.paused === 1, now); changes.push(body.paused ? 'paused' : 'resumed'); }
  if (changes.length) await audit(db, actor, 'settings.update', changes.join('; '), now);
  return settingsView(await getSettings(db));
}

// ---------- team ----------

export async function listTeam(env) {
  const owners = [...ownerIds(env)];
  const { results: staff } = await env.DB.prepare('SELECT id, name, created_at FROM admins ORDER BY created_at').all();
  const ids = [...owners, ...staff.map((s) => s.id)];
  const names = {};
  if (ids.length) {
    const { results } = await env.DB.prepare(`SELECT id, first_name, username FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
    for (const u of results) names[u.id] = { first_name: u.first_name, username: u.username };
  }
  return {
    owners: owners.map((id) => ({ id, ...(names[id] || {}) })),
    staff: staff.map((s) => ({ id: s.id, name: s.name, created_at: s.created_at, ...(names[s.id] || {}) })),
  };
}

export async function addStaff(env, actor, body, now = nowSec()) {
  const id = Number(String(body.id ?? '').trim());
  if (!Number.isSafeInteger(id) || id <= 0) throw bad('id', 'Enter their Telegram number id (they can get it from @userinfobot).');
  if (ownerIds(env).has(id)) throw bad('id', 'This person is already an owner.');
  const name = body.name ? cleanLabel(body.name) : '';
  if (name === null) throw bad('name', 'Name must be 2 to 40 characters.');
  const res = await env.DB.prepare('INSERT OR IGNORE INTO admins (id, name, added_by, created_at) VALUES (?, ?, ?, ?)').bind(id, name, actor, now).run();
  if (res.meta.changes !== 1) throw bad('id', 'This person is already on the team.');
  await audit(env.DB, actor, 'team.add', `${id} ${name}`, now);
  return listTeam(env);
}

export async function removeStaff(env, actor, id, now = nowSec()) {
  const res = await env.DB.prepare('DELETE FROM admins WHERE id = ?').bind(id).run();
  if (res.meta.changes !== 1) throw new ApiError(404, 'not_found', 'That person is not on the team.');
  await audit(env.DB, actor, 'team.remove', String(id), now);
  return listTeam(env);
}

// ---------- the queue ----------

const SUMMARY_STATUS = ['evidence_submitted', 'processing', 'awaiting_payment'];

export async function adminSummary(db) {
  const s = await getSettings(db);
  const { results } = await db.prepare(`SELECT status, COUNT(*) AS n FROM orders WHERE status IN (${SUMMARY_STATUS.map(() => '?').join(',')}) GROUP BY status`).bind(...SUMMARY_STATUS).all();
  const n = Object.fromEntries(results.map((r) => [r.status, r.n]));
  const todayStart = nowSec() - 86400;
  const day = await db.prepare("SELECT COUNT(*) AS orders, COALESCE(SUM(usdt_micro), 0) AS usdt FROM orders WHERE status = 'completed' AND updated_at >= ?").bind(todayStart).first();
  const tickets = await db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE status = 'open'").first();
  const cfg = await getSettings(db);
  const rv = { n: cfg.review_count, avg: cfg.review_count ? cfg.review_sum / cfg.review_count : 0 };
  return {
    counts: { review: n.evidence_submitted || 0, release: n.processing || 0, waiting: n.awaiting_payment || 0, tickets: tickets.n },
    last_24h: { completed: day.orders, usdt_micro: day.usdt },
    reviews: { count: rv.n, average: rv.n ? Math.round(rv.avg * 10) / 10 : null },
    storage: { bytes: cfg.db_bytes, limit: DB_LIMIT_BYTES, keep_days: cfg.data_retention_days },
    rate_updated_at: s.rate_updated_at,
    paused: s.paused,
  };
}

const customerOf = (r) => ({ id: r.user_id, first_name: r.first_name, username: r.username });

function queueRow(r) {
  return {
    id: r.id, side: r.side, status: r.status, usdt_micro: r.usdt_micro, etb_cents: r.etb_cents,
    method: { code: r.method_code, label_en: r.method_label_en, label_am: r.method_label_am || r.method_label_en },
    service: r.service_code, quantity: r.quantity, rating: r.rating || null, late: r.late === 1, evidence_count: r.evidence_count, created_at: r.created_at, updated_at: r.updated_at,
    customer: customerOf(r),
  };
}

export async function adminListOrders(db, filter, before, limit = 30, q = '') {
  const base = `${ORDER_SELECT.replace('FROM orders o', ', u.first_name, u.username FROM orders o')} JOIN users u ON u.id = o.user_id`;
  let where;
  let order;
  const args = [];
  if (filter === 'review') { where = "o.status = 'evidence_submitted'"; order = 'o.updated_at ASC, o.id'; }
  else if (filter === 'release') { where = "o.status = 'processing'"; order = 'o.updated_at ASC, o.id'; }
  else if (filter === 'done') { where = "o.status IN ('completed','rejected','cancelled','expired')"; order = 'o.updated_at DESC, o.id DESC'; }
  else { where = `o.status IN (${OPEN_STATUSES.map(() => '?').join(',')})`; args.push(...OPEN_STATUSES); order = 'o.created_at DESC, o.id DESC'; }
  const term = String(q || '').trim().slice(0, 60);
  if (filter === 'all' || term) { where = '1 = 1'; order = 'o.created_at DESC, o.id DESC'; filter = 'all'; args.length = 0; }
  if (term) {
    const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where += " AND (o.id LIKE ? ESCAPE '\\' OR CAST(o.user_id AS TEXT) = ? OR u.username LIKE ? ESCAPE '\\' OR u.first_name LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM order_proofs p WHERE p.order_id = o.id AND p.ref_text LIKE ? ESCAPE '\\') OR o.completion_ref LIKE ? ESCAPE '\\')";
    args.push(like, term.replace(/^@/, ''), like.replace(/^%@/, '%'), like, like, like);
  }
  const paged = filter === 'done' || filter === 'open' || filter === 'all';
  if (paged && before) { where += filter === 'done' ? ' AND o.updated_at < ?' : ' AND o.created_at < ?'; args.push(Number(before)); }
  const { results } = await db.prepare(`${base} WHERE ${where} ORDER BY ${order} LIMIT ?`).bind(...args, limit + 1).all();
  const page = results.slice(0, limit);
  const key = filter === 'done' ? 'updated_at' : 'created_at';
  return { orders: page.map(queueRow), next: paged && results.length > limit ? page[page.length - 1][key] : null };
}

export async function adminOrderDetail(db, id) {
  const row = await db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).bind(id).first();
  if (!row) return null;
  const [events, proofs, warnings, customer, counts] = await Promise.all([
    getEvents(db, id, { withActors: true }),
    listProofs(db, id),
    duplicateWarnings(db, id),
    db.prepare('SELECT id, first_name, username, language, blocked, created_at FROM users WHERE id = ?').bind(row.user_id).first(),
    db.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(status = 'completed'), 0) AS completed FROM orders WHERE user_id = ?").bind(row.user_id).first(),
  ]);
  const actorIds = [...new Set(events.map((e) => e.by_id).filter(Boolean))];
  const names = {};
  if (actorIds.length) {
    const { results } = await db.prepare(`SELECT id, first_name FROM users WHERE id IN (${actorIds.map(() => '?').join(',')})`).bind(...actorIds).all();
    for (const u of results) names[u.id] = u.first_name;
  }
  const view = orderView(row, events.map((e) => ({ ...e, by_name: e.by_id ? names[e.by_id] || null : null })), proofs);
  return {
    order: view,
    customer: { id: customer.id, first_name: customer.first_name, username: customer.username, blocked: customer.blocked === 1, member_since: customer.created_at, total_orders: counts.total, completed_orders: counts.completed },
    warnings,
  };
}

export async function setBlocked(db, actor, userId, blocked, now = nowSec()) {
  const res = await db.prepare('UPDATE users SET blocked = ? WHERE id = ?').bind(blocked ? 1 : 0, userId).run();
  if (res.meta.changes !== 1) throw new ApiError(404, 'not_found', 'Customer not found.');
  await audit(db, actor, blocked ? 'user.block' : 'user.unblock', String(userId), now);
}

// ---------- setup progress ----------

export async function setupStatus(env) {
  const [s, catalog] = await Promise.all([getSettings(env.DB), getCatalog(env.DB)]);
  const sides = sideAvailability(s, catalog);
  const alertsDone = s.alerts_tested;
  const steps = [
    { key: 'rates', required: true, done: s.buy_rate_cents > 0 && s.sell_rate_cents > 0 },
    { key: 'limits', required: true, done: s.max_usdt_micro > 0 && s.max_usdt_micro > s.min_usdt_micro },
    { key: 'stock', required: false, done: s.stock_usdt_micro !== null },
    { key: 'methods', required: true, done: catalog.methods.some((m) => m.buy || m.sell) },
    { key: 'networks', required: true, done: catalog.networks.some((n) => n.buy || n.sell) },
    { key: 'alerts', required: true, done: alertsDone },
    { key: 'services', required: false, done: catalog.services.length > 0 },
  ];
  return { steps, sides, ready: sides.buy || sides.sell || sides.service, complete: steps.filter((x) => x.required).every((x) => x.done) };
}
