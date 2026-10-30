// JSON API used by the Mini App. Every request carries "Authorization: tma <initData>" (no cookies).
import { AuthError, validateInitData } from './auth.js';
import { ApiError, errorResponse, json, readJson } from './http.js';
import { handleAdmin } from './admin-api.js';
import { getRole } from './admin.js';
import { createOrder } from './create.js';
import { customerStats, getCatalog, getOrderRow, getSettings, listOrders, nowSec, sideAvailability, stockInfo } from './orders.js';
import { proofResponse } from './proofs.js';
import { cancelOrder, customerOrderView, submitEvidence } from './service.js';
import { listPolicies } from './shop-admin.js';
import { createTicket, customerReply, getTicket, isTicketId, listTickets, threadOf, ticketDetail, ticketPhoto } from './tickets.js';
import { isOrderId } from './validate.js';

const MAX_UPLOAD_BYTES = 7 * 1024 * 1024;

/** Reads a multipart upload (text plus an optional photo) with a size check. */
async function readForm(request) {
  if (!(request.headers.get('content-type') || '').includes('multipart/form-data')) throw new ApiError(400, 'bad_request', 'Send this as a form upload.');
  if (Number(request.headers.get('content-length') || 0) > MAX_UPLOAD_BYTES) throw new ApiError(413, 'photo_too_large', 'That image is too large. Use one under 6 MB.');
  try {
    return await request.formData();
  } catch {
    throw new ApiError(400, 'bad_request', 'Could not read the upload.');
  }
}
const filePart = (form) => {
  const photo = form.get('photo');
  return photo && typeof photo === 'object' ? photo : null;
};

async function authenticate(request, env, { touch }) {
  const header = request.headers.get('authorization') || '';
  if (!header.startsWith('tma ')) throw new ApiError(401, 'unauthorized', 'Open this app from Telegram.');
  let login;
  try {
    login = await validateInitData(header.slice(4), env.BOT_TOKEN, { maxAgeSec: Number(env.AUTH_MAX_AGE_SEC) || 86400 });
  } catch (err) {
    if (err instanceof AuthError) {
      if (err.code === 'server_misconfigured') throw new ApiError(500, 'server_error', 'Server is not configured.');
      throw new ApiError(401, err.code === 'expired' ? 'session_expired' : 'unauthorized', err.message);
    }
    throw err;
  }

  const tgUser = login.user;
  const now = nowSec();
  const firstLanguage = String(tgUser.language_code || '').startsWith('am') ? 'am' : 'en';
  if (touch) {
    await env.DB
      .prepare(
        `INSERT INTO users (id, first_name, username, language, can_dm, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET first_name = excluded.first_name, username = excluded.username,
                                       can_dm = MAX(users.can_dm, excluded.can_dm), last_seen_at = excluded.last_seen_at`,
      )
      .bind(tgUser.id, String(tgUser.first_name || '').slice(0, 64), tgUser.username ? String(tgUser.username).slice(0, 64) : null, firstLanguage, tgUser.allows_write_to_pm ? 1 : 0, now, now)
      .run();
  } else {
    await env.DB
      .prepare('INSERT OR IGNORE INTO users (id, first_name, username, language, can_dm, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(tgUser.id, String(tgUser.first_name || '').slice(0, 64), tgUser.username ? String(tgUser.username).slice(0, 64) : null, firstLanguage, tgUser.allows_write_to_pm ? 1 : 0, now, now)
      .run();
  }
  const user = await env.DB.prepare('SELECT id, first_name, username, language, can_dm, blocked FROM users WHERE id = ?').bind(tgUser.id).first();
  return { user, startParam: login.startParam };
}

export async function handleApi(request, env, tg) {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');
    const method = request.method;
    const { user } = await authenticate(request, env, { touch: path === '/api/bootstrap' });
    const db = env.DB;

    if (path.startsWith('/api/admin')) {
      const role = await getRole(env, user.id);
      const res = await handleAdmin(request, env, tg, { user, role, path });
      if (res) return res;
    }

    if (path === '/api/bootstrap' && method === 'GET') {
      const [s, catalog, role, stats] = await Promise.all([getSettings(db), getCatalog(db), getRole(env, user.id), customerStats(db, user.id)]);
      const stock = await stockInfo(db, s);
      return json({
        user: { id: user.id, first_name: user.first_name, username: user.username, language: user.language, can_dm: Boolean(user.can_dm), blocked: Boolean(user.blocked) },
        role,
        availability: sideAvailability(s, catalog),
        rates: { ready: s.buy_rate_cents > 0 && s.sell_rate_cents > 0, buy_cents: s.buy_rate_cents, sell_cents: s.sell_rate_cents, updated_at: s.rate_updated_at, paused: s.paused },
        limits: { min_usdt_micro: s.min_usdt_micro, max_usdt_micro: s.max_usdt_micro },
        // The amount is sent only when the owner chose to show it; otherwise the app learns nothing about the stock.
        stock: stock.tracking && stock.show ? { available_usdt_micro: stock.available } : null,
        stats,
        order_ttl_min: s.order_ttl_min,
        catalog,
        support: { username: env.SUPPORT_USERNAME || null },
        server_time: nowSec(),
      });
    }

    if (path === '/api/language' && method === 'POST') {
      const body = await readJson(request);
      if (body.language !== 'en' && body.language !== 'am') throw new ApiError(400, 'bad_language', 'Choose English or Amharic.');
      await db.prepare('UPDATE users SET language = ? WHERE id = ?').bind(body.language, user.id).run();
      return json({ language: body.language });
    }

    if (path === '/api/can-dm' && method === 'POST') {
      // The app calls this after the user grants "allow messages" in Telegram's own dialog.
      await db.prepare('UPDATE users SET can_dm = 1 WHERE id = ?').bind(user.id).run();
      return json({ can_dm: true });
    }

    if (path === '/api/orders' && method === 'POST') {
      const body = await readJson(request);
      const row = await createOrder(db, user.id, body);
      return json({ order: await customerOrderView(db, row), server_time: nowSec() }, 201);
    }

    if (path === '/api/orders' && method === 'GET') {
      const filter = ['active', 'done', 'all'].includes(url.searchParams.get('filter')) ? url.searchParams.get('filter') : 'all';
      const before = url.searchParams.get('before');
      const page = await listOrders(db, user.id, filter, before && /^\d+$/.test(before) ? before : null);
      return json({ ...page, server_time: nowSec() });
    }

    if (path === '/api/policies' && method === 'GET') {
      return json({ sections: (await listPolicies(db)).map((p) => ({ id: p.id, title_en: p.title_en, title_am: p.title_am || p.title_en, body_en: p.body_en, body_am: p.body_am || p.body_en })) });
    }

    // ----- support tickets -----
    if (path === '/api/tickets' && method === 'GET') return json({ tickets: await listTickets(db, user.id) });
    if (path === '/api/tickets' && method === 'POST') {
      const f = await readForm(request);
      return json(await createTicket(env, tg, user.id, { category: String(f.get('category') || ''), orderId: String(f.get('order_id') || '') || null, text: f.get('text'), photo: filePart(f) }), 201);
    }
    const tm = /^\/api\/tickets\/([^/]+)(?:\/(messages|photos\/(\d+)))?$/.exec(path);
    if (tm) {
      const [, id, action, photoId] = tm;
      if (!isTicketId(id)) throw new ApiError(404, 'not_found', 'Ticket not found.');
      const t = await getTicket(db, id);
      const mine = t && t.user_id === user.id;
      if (!t || !(mine || (photoId && (await getRole(env, user.id))))) throw new ApiError(404, 'not_found', 'Ticket not found.');
      if (!action && method === 'GET') return json(await ticketDetail(db, t));
      if (photoId && method === 'GET') return await ticketPhoto(env, id, Number(photoId));
      if (action === 'messages' && method === 'POST') {
        const f = await readForm(request);
        return json(await customerReply(env, tg, user.id, id, { text: f.get('text'), photo: filePart(f) }));
      }
    }

    const pm = /^\/api\/orders\/([^/]+)\/proofs\/(\d+)$/.exec(path);
    if (pm && method === 'GET') {
      // A proof is shown to the customer who sent it and to the team, nobody else.
      if (!isOrderId(pm[1])) throw new ApiError(404, 'not_found', 'Order not found.');
      const row = await getOrderRow(db, pm[1]);
      if (!row) throw new ApiError(404, 'not_found', 'Order not found.');
      if (row.user_id !== user.id && !(await getRole(env, user.id))) throw new ApiError(404, 'not_found', 'Order not found.');
      return await proofResponse(env, db, pm[1], Number(pm[2]));
    }

    const m = /^\/api\/orders\/([^/]+)(?:\/(cancel|evidence))?$/.exec(path);
    if (m) {
      const [, id, action] = m;
      if (!isOrderId(id)) throw new ApiError(404, 'not_found', 'Order not found.');

      if (!action && method === 'GET') {
        const row = await getOrderRow(db, id);
        if (!row || row.user_id !== user.id) throw new ApiError(404, 'not_found', 'Order not found.');
        return json({ order: await customerOrderView(db, row), server_time: nowSec() });
      }
      if (action === 'cancel' && method === 'POST') {
        return json({ order: await cancelOrder(env, user.id, id), server_time: nowSec() });
      }
      if (action === 'evidence' && method === 'POST') {
        const form = await readForm(request);
        const order = await submitEvidence(env, tg, user.id, id, { text: form.get('text'), photo: filePart(form) });
        return json({ order, server_time: nowSec() });
      }
    }

    throw new ApiError(404, 'not_found', 'Unknown endpoint.');
  } catch (err) {
    if (!(err instanceof ApiError)) console.error('api error', String(err?.stack || err));
    return errorResponse(err);
  }
}
