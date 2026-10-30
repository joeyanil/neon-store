// Creating orders: USDT buy / sell and social-media service orders. DB only, no Telegram calls.
import { ApiError } from './http.js';
import { etbForUsdt, parseUsdt } from './money.js';
import { cleanAccount, cleanAddress, cleanName, cleanTarget, isValidIdemKey } from './validate.js';
import { customerStats, getOrderRow, getSettings, newOrderId, nowSec, ORDER_SELECT, OPEN_STATUSES, stockInfo, unlockProgress, unlockRule } from './orders.js';

const OPEN_IN = `(${OPEN_STATUSES.map(() => '?').join(',')})`;

async function replayOf(db, userId, idem) {
  return db.prepare(`${ORDER_SELECT} WHERE o.user_id = ? AND o.idem_key = ?`).bind(userId, idem).first();
}

/** Checks shared by every kind of order. Returns the settings, or an existing order when this is a replay. */
async function preflight(db, userId, body) {
  const s = await getSettings(db);
  if (s.paused) throw new ApiError(503, 'paused', 'The shop is paused for now. Check back soon.');
  if (!isValidIdemKey(body.idem)) throw new ApiError(400, 'bad_request', 'Request is missing its unique key.');
  // A double tap or a retry after a bad connection returns the order that already exists.
  const replay = await replayOf(db, userId, body.idem);
  if (replay) return { replay };
  const person = await db.prepare('SELECT blocked FROM users WHERE id = ?').bind(userId).first();
  if (person?.blocked) throw new ApiError(403, 'blocked', 'Your account cannot place new orders. Open Support to ask why.');
  return { s };
}

/** The customer pays us with this birr method (buy and service orders). */
async function payableMethod(db, userId, code) {
  const method = await db.prepare('SELECT * FROM birr_methods WHERE code = ? AND active = 1').bind(String(code)).first();
  if (!method || method.accept_buy !== 1 || !method.account_name || !method.account_number) throw new ApiError(400, 'bad_method', 'Choose a payment method.');
  const lock = unlockProgress(unlockRule(method), await customerStats(db, userId));
  if (lock) throw new ApiError(403, 'method_locked', 'This payment method is not open to you yet. Pick another one.', { method: method.code, ...lock });
  return method;
}

const accountSnapshot = (m) => ({ kind: 'birr', label_en: m.label_en, label_am: m.label_am || m.label_en, account_name: m.account_name, account_number: m.account_number, note: m.note || '' });

/**
 * One guarded INSERT. The guards run inside the same statement as the insert, so two customers racing for the last
 * USDT (or one customer opening orders in parallel) cannot both get through.
 */
async function insertOrder(db, userId, o, now) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = newOrderId();
    const stockGuard = o.stockUsdt
      ? `AND ((SELECT value FROM settings WHERE key = 'stock_usdt_micro') IS NULL OR (SELECT value FROM settings WHERE key = 'stock_usdt_micro') = ''
              OR CAST((SELECT value FROM settings WHERE key = 'stock_usdt_micro') AS INTEGER)
                 - COALESCE((SELECT SUM(usdt_micro) FROM orders WHERE side = 'buy' AND status IN ${OPEN_IN}), 0) >= ?)`
      : '';
    const args = [
      id, userId, o.side, o.usdt ?? null, o.rate ?? null, o.etb, o.method.code, o.network?.code ?? null, o.service?.code ?? null, o.quantity ?? null, o.target ?? null,
      JSON.stringify(o.snapshot), o.usdtAddress ?? null, o.payoutName ?? null, o.payoutAccount ?? null, o.idem, now, now, o.expires,
      userId, ...OPEN_STATUSES, o.maxOpen,
      ...(o.stockUsdt ? [...OPEN_STATUSES, o.stockUsdt] : []),
    ];
    try {
      const [ins] = await db.batch([
        db
          .prepare(
            `INSERT INTO orders (id, user_id, side, status, usdt_micro, rate_cents, etb_cents, method_code, network_code, service_code, quantity, target,
                                 pay_snapshot, usdt_address, payout_name, payout_account, idem_key, created_at, updated_at, expires_at)
             SELECT ?, ?, ?, 'awaiting_payment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
             WHERE (SELECT COUNT(*) FROM orders WHERE user_id = ? AND status IN ${OPEN_IN}) < ? ${stockGuard}`,
          )
          .bind(...args),
        db
          .prepare("INSERT INTO order_events (order_id, from_status, to_status, actor, note, created_at) SELECT ?, NULL, 'awaiting_payment', ?, NULL, ? WHERE changes() > 0")
          .bind(id, `user:${userId}`, now),
      ]);
      if (ins.meta.changes > 0) return await getOrderRow(db, id);
      // Nothing was inserted: a guard said no. Find out which one, so the customer gets the right message.
      const raced = await replayOf(db, userId, o.idem);
      if (raced) return raced;
      const open = await db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND status IN ${OPEN_IN}`).bind(userId, ...OPEN_STATUSES).first();
      if (open.n >= o.maxOpen) throw new ApiError(429, 'too_many_open', `You can have ${o.maxOpen} open orders at a time. Finish or cancel one first.`);
      throw await stockError(db, o.settings);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (!/UNIQUE/i.test(String(err?.message || err))) throw err;
      const raced = await replayOf(db, userId, o.idem);
      if (raced) return raced;
      // Otherwise the random id collided; try another.
    }
  }
  throw new ApiError(500, 'id_collision', 'Could not create the order. Try again.');
}

/** The amount is only mentioned when the owner chose to show the stock. */
async function stockError(db, s) {
  const st = await stockInfo(db, s);
  if (st.show && st.tracking) {
    return new ApiError(409, 'insufficient_stock', 'We do not have that much USDT right now. Try a smaller amount.', { available_usdt_micro: st.available });
  }
  return new ApiError(409, 'insufficient_stock', 'We do not have enough USDT for that amount right now. Try a smaller amount or come back later.');
}

export async function createOrder(db, userId, body, now = nowSec()) {
  const side = body.side;
  if (side === 'service') return createServiceOrder(db, userId, body, now);
  if (side !== 'buy' && side !== 'sell') throw new ApiError(400, 'bad_side', 'Choose buy or sell.');
  const pre = await preflight(db, userId, body);
  if (pre.replay) return pre.replay;
  const s = pre.s;

  const usdt = parseUsdt(body.usdt);
  if (!usdt) throw new ApiError(400, 'bad_amount', 'Enter an amount in USDT, up to 6 decimals.');
  if (!(s.max_usdt_micro > 0)) throw new ApiError(503, 'not_open', 'The shop is not open yet. Check back soon.');
  if (usdt < s.min_usdt_micro || usdt > s.max_usdt_micro) {
    throw new ApiError(400, 'amount_out_of_range', 'Amount is outside the allowed range.', { min_usdt_micro: s.min_usdt_micro, max_usdt_micro: s.max_usdt_micro });
  }
  const rate = side === 'buy' ? s.buy_rate_cents : s.sell_rate_cents;
  if (!(rate > 0)) throw new ApiError(503, 'rate_not_set', 'Rates are being updated. Try again in a few minutes.');

  // Only accounts switched on for this side can be chosen; the client's word is never trusted for details.
  let method;
  if (side === 'buy') method = await payableMethod(db, userId, body.method);
  else {
    method = await db.prepare('SELECT * FROM birr_methods WHERE code = ? AND active = 1').bind(String(body.method)).first();
    if (!method || method.pay_sell !== 1) throw new ApiError(400, 'bad_method', 'Choose a payment method.');
  }
  const network = await db.prepare('SELECT * FROM usdt_networks WHERE code = ? AND active = 1').bind(String(body.network)).first();
  const networkOk = network && (side === 'buy' ? network.send_buy === 1 : network.accept_sell === 1 && network.deposit_address);
  if (!networkOk) throw new ApiError(400, 'bad_network', 'Choose a network.');

  const o = { side, usdt, rate, method, network, idem: body.idem, maxOpen: s.max_open_orders, settings: s, expires: now + s.order_ttl_min * 60 };
  if (side === 'buy') {
    o.usdtAddress = cleanAddress(network.kind, body.address);
    if (!o.usdtAddress) throw new ApiError(400, 'bad_address', `That is not a valid address for ${network.label}.`);
    o.snapshot = accountSnapshot(method);
    o.stockUsdt = usdt;
    // A friendly early answer; the guarded insert below is what actually protects the stock.
    const st = await stockInfo(db, s);
    if (st.tracking && usdt > st.available) throw await stockError(db, s);
  } else {
    o.payoutName = cleanName(body.payout_name);
    if (!o.payoutName) throw new ApiError(400, 'bad_name', 'Enter the account holder name.');
    o.payoutAccount = cleanAccount(method.kind, body.payout_account);
    if (!o.payoutAccount) throw new ApiError(400, 'bad_account', method.kind === 'mobile' ? 'Enter a valid phone number, like 0911 223344.' : 'Enter a valid account number.');
    o.snapshot = { kind: 'usdt', network: network.code, net_kind: network.kind, label: network.label, address: network.deposit_address };
  }
  o.etb = etbForUsdt(usdt, rate, side === 'buy' ? 'up' : 'down');
  return insertOrder(db, userId, o, now);
}

/** Total in ETB cents for `qty` units at `priceCentsPer1000`, rounded up so the shop never undercharges. */
export const serviceTotal = (qty, priceCentsPer1000) => Math.ceil((qty * priceCentsPer1000) / 1000);

export async function createServiceOrder(db, userId, body, now = nowSec()) {
  const pre = await preflight(db, userId, body);
  if (pre.replay) return pre.replay;
  const s = pre.s;

  const service = await db.prepare('SELECT * FROM service_items WHERE code = ? AND active = 1').bind(String(body.service)).first();
  if (!service) throw new ApiError(400, 'bad_service', 'Choose a service.');
  const qty = Number(body.quantity);
  if (!Number.isInteger(qty) || qty < service.min_qty || qty > service.max_qty) {
    throw new ApiError(400, 'bad_quantity', 'That quantity is outside the allowed range.', { min_qty: service.min_qty, max_qty: service.max_qty });
  }
  const target = cleanTarget(service.platform, body.target);
  if (!target) throw new ApiError(400, 'bad_target', 'That link does not look right for this service. Paste the link or @username.');
  const method = await payableMethod(db, userId, body.method);
  const etb = serviceTotal(qty, service.price_cents_per_1000);
  if (!(etb > 0)) throw new ApiError(400, 'bad_quantity', 'That quantity is outside the allowed range.');

  const snapshot = {
    ...accountSnapshot(method),
    service: { code: service.code, platform: service.platform, name_en: service.name_en, name_am: service.name_am || service.name_en, eta_text: service.eta_text, warranty_days: service.warranty_days },
  };
  return insertOrder(db, userId, { side: 'service', etb, method, service, quantity: qty, target, snapshot, idem: body.idem, maxOpen: s.max_open_orders, settings: s, expires: now + s.order_ttl_min * 60 }, now);
}
