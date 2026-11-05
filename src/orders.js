// Orders: validation, creation, the status state machine and the audit trail. DB only, no Telegram calls.

export const OPEN_STATUSES = ['awaiting_payment', 'evidence_submitted', 'processing'];
export const DONE_STATUSES = ['completed', 'rejected', 'cancelled', 'expired'];

/** Who may move an order from one status to the next. This table is the only source of truth. */
export const TRANSITIONS = {
  awaiting_payment: { evidence_submitted: ['user'], cancelled: ['user'], expired: ['system'], rejected: ['admin'] },
  // A customer who paid just after the window closed can still send the receipt for a day; an admin then decides.
  expired: { evidence_submitted: ['user'], rejected: ['admin'] },
  evidence_submitted: { processing: ['admin'], rejected: ['admin'] },
  processing: { completed: ['admin'], rejected: ['admin'] },
};

export function canTransition(from, to, actorKind) {
  return Boolean(TRANSITIONS[from]?.[to]?.includes(actorKind));
}

export const nowSec = () => Math.floor(Date.now() / 1000);

// ---------- settings ----------

export const LATE_PROOF_SEC = 24 * 3600;

export async function getSettings(db) {
  const { results } = await db.prepare('SELECT key, value FROM settings').all();
  const raw = Object.fromEntries(results.map((r) => [r.key, r.value]));
  const n = (k, d = 0) => (raw[k] !== undefined && raw[k] !== '' && Number.isFinite(Number(raw[k])) ? Number(raw[k]) : d);
  return {
    buy_rate_cents: n('buy_rate_cents'),
    sell_rate_cents: n('sell_rate_cents'),
    rate_updated_at: n('rate_updated_at'),
    min_usdt_micro: n('min_usdt_micro', 5_000_000),
    max_usdt_micro: n('max_usdt_micro', 0), // 0 = the owner has not entered one yet
    stock_usdt_micro: raw.stock_usdt_micro !== undefined && raw.stock_usdt_micro !== '' ? Number(raw.stock_usdt_micro) : null, // null = not tracked
    stock_show: n('stock_show', 1) === 1,
    stock_add_on_sell: n('stock_add_on_sell', 1) === 1,
    order_ttl_min: n('order_ttl_min', 30),
    max_open_orders: n('max_open_orders', 3),
    paused: n('paused') === 1,
    proof_retention_days: n('proof_retention_days', 90),
    data_retention_days: n('data_retention_days', 120),
    db_bytes: n('db_bytes', 0),
    db_warned: n('db_warned', 0),
    review_count: n('review_count', 0),
    review_sum: n('review_sum', 0),
    admin_chat_id: n('admin_chat_id', 0),
    admin_chat_explicit: raw.admin_chat_id !== undefined && raw.admin_chat_id !== '',
    alerts_tested: n('alerts_tested') === 1,
    bot_username: raw.bot_username || '',
    channel_ref: raw.channel_ref || '',
    reviews_ref: raw.reviews_ref || '',
    logs_ref: raw.logs_ref || '',
  };
}

export async function setRates(db, buyCents, sellCents, now = nowSec()) {
  await db.batch([
    setSettingStmt(db, 'buy_rate_cents', buyCents, now),
    setSettingStmt(db, 'sell_rate_cents', sellCents, now),
    setSettingStmt(db, 'rate_updated_at', now, now),
  ]);
}

const setSettingStmt = (db, key, value, now) =>
  db
    .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(key, String(value), now);

export async function setSetting(db, key, value, now = nowSec()) {
  await setSettingStmt(db, key, value, now).run();
}

export async function setPaused(db, paused, now = nowSec()) {
  await setSetting(db, 'paused', paused ? '1' : '0', now);
}

// ---------- payment accounts and networks ----------

const usableMethod = (m) => m.active === 1 && Boolean(m.account_name) && Boolean(m.account_number);
const usableNetwork = (n) => n.active === 1;

export async function listMethods(db) {
  const { results } = await db.prepare('SELECT * FROM birr_methods ORDER BY sort, created_at, code').all();
  return results;
}
export async function listNetworks(db) {
  const { results } = await db.prepare('SELECT * FROM usdt_networks ORDER BY sort, created_at, code').all();
  return results;
}

export async function listServices(db) {
  const { results } = await db.prepare('SELECT * FROM service_items ORDER BY sort, created_at, code').all();
  return results;
}

/** The trust rule of a payment method, or null when it is open to everyone. */
export const unlockRule = (m) => (m.unlock_orders || m.unlock_volume_micro || m.unlock_need_ratio ? { orders: m.unlock_orders, volume_micro: m.unlock_volume_micro, need_ratio: m.unlock_need_ratio === 1 } : null);

/**
 * What the app needs to render the order forms. Account numbers and deposit addresses are NOT included here;
 * the customer gets them only inside an order, after creating it.
 * `buy` / `sell` say on which side of the shop each entry can be used.
 */
export async function getCatalog(db) {
  const [methods, networks, services] = await Promise.all([listMethods(db), listNetworks(db), listServices(db)]);
  const m = methods
    .map((x) => ({ code: x.code, kind: x.kind, label_en: x.label_en, label_am: x.label_am || x.label_en, buy: usableMethod(x) && x.accept_buy === 1, sell: x.active === 1 && x.pay_sell === 1, unlock: unlockRule(x) }))
    .filter((x) => x.buy || x.sell);
  const n = networks
    .map((x) => ({ code: x.code, kind: x.kind, label: x.label, buy: usableNetwork(x) && x.send_buy === 1, sell: usableNetwork(x) && x.accept_sell === 1 && Boolean(x.deposit_address) }))
    .filter((x) => x.buy || x.sell);
  const sv = services
    .filter((x) => x.active === 1)
    .map((x) => ({ code: x.code, platform: x.platform, name_en: x.name_en, name_am: x.name_am || x.name_en, price_cents_per_1000: x.price_cents_per_1000, min_qty: x.min_qty, max_qty: x.max_qty, eta_text: x.eta_text, warranty_days: x.warranty_days, note: x.note }));
  return { methods: m, networks: n, services: sv };
}

/** Which parts of the shop can take an order right now. */
export function sideAvailability(settings, catalog) {
  const limitsOk = settings.max_usdt_micro > 0 && settings.max_usdt_micro >= settings.min_usdt_micro;
  const usdt = (rate, side) => limitsOk && rate > 0 && catalog.methods.some((x) => x[side]) && catalog.networks.some((x) => x[side]);
  return {
    buy: usdt(settings.buy_rate_cents, 'buy'),
    sell: usdt(settings.sell_rate_cents, 'sell'),
    service: catalog.services.length > 0 && catalog.methods.some((x) => x.buy),
  };
}

// ---------- stock ----------

/** USDT the shop can still promise to buyers: what it holds minus what open buy orders have already claimed. */
export async function stockInfo(db, settings) {
  if (settings.stock_usdt_micro === null) return { tracking: false, show: settings.stock_show, available: null };
  const r = await db
    .prepare(`SELECT COALESCE(SUM(usdt_micro), 0) AS n FROM orders WHERE side = 'buy' AND status IN (${OPEN_STATUSES.map(() => '?').join(',')})`)
    .bind(...OPEN_STATUSES)
    .first();
  return { tracking: true, show: settings.stock_show, available: Math.max(0, settings.stock_usdt_micro - r.n) };
}

/** What the customer's own history says, for the "unlocks after N orders" rule of a payment method. */
export async function customerStats(db, userId) {
  const r = await db
    .prepare(`SELECT COALESCE(SUM(status = 'completed'), 0) AS completed, COALESCE(SUM(status = 'cancelled'), 0) AS cancelled,
                     COALESCE(SUM(CASE WHEN status = 'completed' THEN usdt_micro ELSE 0 END), 0) AS volume FROM orders WHERE user_id = ?`)
    .bind(userId)
    .first();
  return { completed: r.completed, cancelled: r.cancelled, volume_micro: r.volume };
}

/** null when the customer may use the method; otherwise what is still missing. */
export function unlockProgress(rule, stats) {
  if (!rule) return null;
  const ok = stats.completed >= rule.orders && stats.volume_micro >= rule.volume_micro && (!rule.need_ratio || stats.completed > stats.cancelled);
  return ok ? null : { need: rule, have: { orders: stats.completed, volume_micro: stats.volume_micro, cancelled: stats.cancelled } };
}

// ---------- ids ----------

const ID_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // 31 characters, no 0/1/I/L/O

export function newOrderId() {
  const out = [];
  while (out.length < 6) {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    for (const b of bytes) {
      if (b < 248 && out.length < 6) out.push(ID_ALPHABET[b % 31]); // 248 = 31 * 8, no modulo bias
    }
  }
  return `NG-${out.join('')}`;
}

// ---------- reads ----------

export const ORDER_SELECT = `SELECT o.*, m.label_en AS method_label_en, m.label_am AS method_label_am, m.kind AS method_kind,
                      (SELECT label FROM usdt_networks WHERE code = o.network_code) AS network_label
                      FROM orders o JOIN birr_methods m ON m.code = o.method_code`;

export async function getOrderRow(db, id) {
  return db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).bind(id).first();
}

/** `withActors` is for admins only: it adds the id of whoever acted, so staff actions can be traced. */
export async function getEvents(db, orderId, { withActors = false } = {}) {
  const { results } = await db
    .prepare('SELECT from_status, to_status, actor, note, created_at FROM order_events WHERE order_id = ? ORDER BY id')
    .bind(orderId)
    .all();
  return results.map((e) => ({
    from: e.from_status,
    to: e.to_status,
    by: String(e.actor).split(':')[0], // 'user' | 'admin' | 'system' (ids reach admins only)
    ...(withActors ? { by_id: Number(String(e.actor).split(':')[1]) || null } : {}),
    note: e.note,
    at: e.created_at,
  }));
}

/** The shape the app receives. Admin message ids and other internals stay on the server. */
export function orderView(row, events, proofs) {
  const view = {
    id: row.id,
    side: row.side,
    status: row.status,
    usdt_micro: row.usdt_micro,
    rate_cents: row.rate_cents,
    etb_cents: row.etb_cents,
    method: { code: row.method_code, kind: row.method_kind, label_en: row.method_label_en, label_am: row.method_label_am || row.method_label_en },
    network: row.network_code,
    network_label: row.network_label || row.network_code,
    pay: JSON.parse(row.pay_snapshot),
    usdt_address: row.usdt_address,
    payout_name: row.payout_name,
    payout_account: row.payout_account,
    evidence_count: row.evidence_count,
    service: row.service_code,
    quantity: row.quantity,
    target: row.target,
    late: row.late === 1,
    reject_reason: row.reject_reason,
    completion_ref: row.completion_ref,
    rating: row.rating || null,
    review_text: row.review_text || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    expires_at: row.expires_at,
  };
  if (events) view.events = events;
  if (proofs) view.proofs = proofs;
  return view;
}

export async function listOrders(db, userId, filter = 'all', before = null, limit = 30) {
  const where = ['o.user_id = ?'];
  const args = [userId];
  if (filter === 'active') where.push(`o.status IN (${OPEN_STATUSES.map(() => '?').join(',')})`), args.push(...OPEN_STATUSES);
  else if (filter === 'done') where.push(`o.status IN (${DONE_STATUSES.map(() => '?').join(',')})`), args.push(...DONE_STATUSES);
  if (before) where.push('o.created_at < ?'), args.push(Number(before));
  const { results } = await db
    .prepare(`${ORDER_SELECT} WHERE ${where.join(' AND ')} ORDER BY o.created_at DESC, o.id DESC LIMIT ?`)
    .bind(...args, limit + 1)
    .all();
  const page = results.slice(0, limit);
  return { orders: page.map((r) => orderView(r)), next: results.length > limit ? page[page.length - 1].created_at : null };
}

// ---------- transitions ----------

const SETTABLE = new Set(['evidence_text', 'evidence_count', 'late', 'reject_reason', 'alerted_at', 'completion_ref']);

/**
 * Move an order to a new status if (and only if) it is still in one of the expected statuses.
 * The status check, the update and the audit row happen in one batch, so two admins pressing at the
 * same time cannot both win and every change leaves a history row.
 * @returns {{ok: true, from: string} | {ok: false, current: string | null}}
 */
export async function transition(db, orderId, expectedFrom, to, actor, opts = {}) {
  const expected = Array.isArray(expectedFrom) ? expectedFrom : [expectedFrom];
  const actorKind = String(actor).split(':')[0];
  for (const f of expected) {
    if (!canTransition(f, to, actorKind)) throw new Error(`Illegal transition ${f} -> ${to} by ${actorKind}`);
  }
  const cur = await db.prepare('SELECT status, side, usdt_micro FROM orders WHERE id = ?').bind(orderId).first();
  if (!cur) return { ok: false, current: null };
  if (!expected.includes(cur.status)) return { ok: false, current: cur.status };

  const now = opts.now ?? nowSec();
  const cols = Object.keys(opts.set || {});
  for (const c of cols) if (!SETTABLE.has(c)) throw new Error(`Column not settable: ${c}`);
  const assignments = ['status = ?', 'updated_at = ?', ...cols.map((c) => `${c} = ?`)].join(', ');

  const statements = [
    db.prepare(`UPDATE orders SET ${assignments} WHERE id = ? AND status = ?`).bind(to, now, ...cols.map((c) => opts.set[c]), orderId, cur.status),
    db
      .prepare('INSERT INTO order_events (order_id, from_status, to_status, actor, note, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE changes() > 0')
      .bind(orderId, cur.status, to, actor, opts.note ?? null, now),
  ];
  // The USDT the shop holds changes only when a USDT order completes. `changes() > 0` ties it to the insert above,
  // so a lost race changes nothing. (A buy's USDT was already set aside while the order was open.)
  if (to === 'completed' && cur.usdt_micro && cur.side === 'buy') {
    statements.push(
      db.prepare("UPDATE settings SET value = CAST(MAX(0, CAST(value AS INTEGER) - ?) AS TEXT), updated_at = ? WHERE key = 'stock_usdt_micro' AND value != '' AND changes() > 0").bind(cur.usdt_micro, now),
    );
  } else if (to === 'completed' && cur.usdt_micro && cur.side === 'sell') {
    statements.push(
      db
        .prepare("UPDATE settings SET value = CAST(CAST(value AS INTEGER) + ? AS TEXT), updated_at = ? WHERE key = 'stock_usdt_micro' AND value != '' AND changes() > 0 AND (SELECT value FROM settings WHERE key = 'stock_add_on_sell') = '1'")
        .bind(cur.usdt_micro, now),
    );
  }
  const [upd] = await db.batch(statements);
  return upd.meta.changes === 1 ? { ok: true, from: cur.status } : { ok: false, current: null };
}

/** Add a history row without a status change (for example, extra evidence on an order that is already under review). */
export async function logEvent(db, orderId, status, actor, note, now = nowSec()) {
  await db
    .prepare('INSERT INTO order_events (order_id, from_status, to_status, actor, note, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(orderId, status, status, actor, note ?? null, now)
    .run();
}

/** Update fields without changing the status (for example a second receipt, or a reference added later). */
export async function patchOrder(db, orderId, set, now = nowSec()) {
  const cols = Object.keys(set);
  for (const c of cols) if (!SETTABLE.has(c)) throw new Error(`Column not settable: ${c}`);
  await db
    .prepare(`UPDATE orders SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .bind(...cols.map((c) => set[c]), now, orderId)
    .run();
}

/** Orders still waiting for the customer after their time ran out. */
export async function findExpired(db, now = nowSec(), limit = 6) {
  const { results } = await db
    .prepare("SELECT id, user_id FROM orders WHERE status = 'awaiting_payment' AND expires_at <= ? ORDER BY expires_at LIMIT ?")
    .bind(now, limit)
    .all();
  return results;
}
