// Routes under /api/admin/*. Staff can work the order queue; everything that changes the shop itself is owner-only.
import {
  addStaff, adminListOrders, adminOrderDetail, adminSummary, audit, createMethod, createNetwork, deleteMethod, deleteNetwork, listMethodsAdmin, listNetworksAdmin,
  listAudit, listTeam, removeStaff, setBlocked, settingsView, setupStatus, updateMethod, updateNetwork, updateSettings,
} from './admin.js';
import { knownEmojis, loadMap, saveMap } from './emoji.js';
import { ApiError, json, readJson } from './http.js';
import { getSettings, nowSec, setSetting } from './orders.js';
import { alertTargets } from './notify.js';
import { adminAct } from './service.js';
import { createPolicy, createService, deletePolicy, deleteService, listPolicies, listServicesAdmin, updatePolicy, updateService } from './shop-admin.js';
import { adminClose, adminListTickets, adminReply, adminTicketDetail, isTicketId, ticketPhoto } from './tickets.js';
import { isOrderId } from './validate.js';

const needOwner = (role) => {
  if (role !== 'owner') throw new ApiError(403, 'forbidden', 'Only an owner can change this.');
};

async function alertInfo(env) {
  const s = await getSettings(env.DB);
  const envChat = Number.isSafeInteger(Number(env.ADMIN_CHAT_ID)) && Number(env.ADMIN_CHAT_ID) !== 0;
  const mode = s.admin_chat_explicit ? (s.admin_chat_id ? 'chat' : 'dm') : envChat ? 'env_chat' : 'dm';
  return { mode, tested: s.alerts_tested };
}

/** @returns {Promise<Response | null>} null when the path is not an admin route */
export async function handleAdmin(request, env, tg, { user, role, path }) {
  if (!path.startsWith('/api/admin/') && path !== '/api/admin') return null;
  if (!role) throw new ApiError(403, 'forbidden', 'This area is for the team only.');
  const url = new URL(request.url);
  const method = request.method;
  const db = env.DB;
  const body = async () => (method === 'POST' || method === 'PUT' ? readJson(request) : {});
  const rest = path.slice('/api/admin/'.length);

  // ----- order queue (owners and staff) -----
  if (rest === 'summary' && method === 'GET') return json({ ...(await adminSummary(db)), role, server_time: nowSec() });

  if (rest === 'orders' && method === 'GET') {
    const filter = ['review', 'release', 'open', 'done', 'all'].includes(url.searchParams.get('filter')) ? url.searchParams.get('filter') : 'review';
    const before = url.searchParams.get('before');
    return json({ ...(await adminListOrders(db, filter, before && /^\d+$/.test(before) ? before : null, 30, url.searchParams.get('q') || '')), server_time: nowSec() });
  }

  let m = /^orders\/([^/]+)(?:\/(confirm|release|reject))?$/.exec(rest);
  if (m) {
    const [, id, action] = m;
    if (!isOrderId(id)) throw new ApiError(404, 'not_found', 'Order not found.');
    if (!action && method === 'GET') {
      const detail = await adminOrderDetail(db, id);
      if (!detail) throw new ApiError(404, 'not_found', 'Order not found.');
      return json({ ...detail, server_time: nowSec() });
    }
    if (action && method === 'POST') {
      const b = await body();
      if (action === 'release') {
        const ref = String(b.reference ?? '').trim();
        const kind = (await db.prepare('SELECT side FROM orders WHERE id = ?').bind(id).first())?.side;
        if (kind !== 'service' && ref.length < 3) throw new ApiError(400, 'invalid_field', 'Enter the transaction hash or bank reference so the customer can check it (at least 3 characters).', { field: 'reference' });
      }
      const res = await adminAct(env, tg, user.id, id, action, { reference: b.reference, reason: b.reason });
      const detail = await adminOrderDetail(db, id);
      return json({ applied: res.ok, message: res.message, ...detail, server_time: nowSec() }, res.ok ? 200 : 409);
    }
  }

  // ----- support inbox (owners and staff) -----
  if (rest === 'tickets' && method === 'GET') {
    const st = ['open', 'answered', 'closed', 'all'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : 'open';
    return json(await adminListTickets(db, st));
  }
  m = /^tickets\/([^/]+)(?:\/(reply|close|photos\/(\d+)))?$/.exec(rest);
  if (m) {
    const [, id, action, photoId] = m;
    if (!isTicketId(id)) throw new ApiError(404, 'not_found', 'Ticket not found.');
    if (!action && method === 'GET') {
      const d = await adminTicketDetail(db, id);
      if (!d) throw new ApiError(404, 'not_found', 'Ticket not found.');
      return json(d);
    }
    if (photoId && method === 'GET') return await ticketPhoto(env, id, Number(photoId));
    if (action === 'reply' && method === 'POST') {
      await adminReply(env, tg, user.id, id, (await body()).text);
      return json(await adminTicketDetail(db, id));
    }
    if (action === 'close' && method === 'POST') {
      await adminClose(env, tg, user.id, id);
      return json(await adminTicketDetail(db, id));
    }
  }

  m = /^customers\/(\d+)\/block$/.exec(rest);
  if (m && method === 'POST') {
    needOwner(role); // blocking a customer is the owner's decision
    const b = await body();
    await setBlocked(db, user.id, Number(m[1]), b.blocked === true);
    return json({ blocked: b.blocked === true });
  }

  // ----- everything below changes the shop: owners only -----
  needOwner(role);

  if (rest === 'setup' && method === 'GET') return json({ ...(await setupStatus(env)), alerts: await alertInfo(env), settings: settingsView(await getSettings(db)), server_time: nowSec() });

  if (rest === 'settings' && method === 'GET') return json({ settings: settingsView(await getSettings(db)) });
  if (rest === 'settings' && method === 'PUT') return json({ settings: await updateSettings(db, user.id, await body()) });

  if (rest === 'methods' && method === 'GET') return json({ methods: await listMethodsAdmin(db) });
  if (rest === 'methods' && method === 'POST') return json({ method: await createMethod(db, user.id, await body()) }, 201);
  m = /^methods\/([a-z0-9-]+)$/.exec(rest);
  if (m && method === 'PUT') return json({ method: await updateMethod(db, user.id, m[1], await body()) });
  if (m && method === 'DELETE') { await deleteMethod(db, user.id, m[1]); return json({ deleted: true }); }

  if (rest === 'networks' && method === 'GET') return json({ networks: await listNetworksAdmin(db) });
  if (rest === 'networks' && method === 'POST') return json({ network: await createNetwork(db, user.id, await body()) }, 201);
  m = /^networks\/([a-z0-9-]+)$/.exec(rest);
  if (m && method === 'PUT') return json({ network: await updateNetwork(db, user.id, m[1], await body()) });
  if (m && method === 'DELETE') { await deleteNetwork(db, user.id, m[1]); return json({ deleted: true }); }

  if (rest === 'services' && method === 'GET') return json({ services: await listServicesAdmin(db) });
  if (rest === 'services' && method === 'POST') return json({ service: await createService(db, user.id, await body()) }, 201);
  m = /^services\/([a-z0-9-]+)$/.exec(rest);
  if (m && method === 'PUT') return json({ service: await updateService(db, user.id, m[1], await body()) });
  if (m && method === 'DELETE') { await deleteService(db, user.id, m[1]); return json({ deleted: true }); }

  if (rest === 'policies' && method === 'GET') return json({ sections: await listPolicies(db, { all: true }) });
  if (rest === 'policies' && method === 'POST') return json({ section: await createPolicy(db, user.id, await body()) }, 201);
  m = /^policies\/(\d+)$/.exec(rest);
  if (m && method === 'PUT') return json({ section: await updatePolicy(db, user.id, Number(m[1]), await body()) });
  if (m && method === 'DELETE') { await deletePolicy(db, user.id, Number(m[1])); return json({ deleted: true }); }

  if (rest === 'team' && method === 'GET') return json(await listTeam(env));
  if (rest === 'team' && method === 'POST') return json(await addStaff(env, user.id, await body()), 201);
  m = /^team\/(\d+)$/.exec(rest);
  if (m && method === 'DELETE') return json(await removeStaff(env, user.id, Number(m[1])));

  if (rest === 'button-emoji' && method === 'GET') { needOwner(role); return json({ items: knownEmojis(), map: await loadMap(db) }); }
  if (rest === 'button-emoji' && method === 'PUT') { needOwner(role); const b = await body(); return json({ map: await saveMap(db, user.id, b.map) }); }

  if (rest === 'audit' && method === 'GET') return json({ entries: await listAudit(db) });

  if (rest === 'alerts' && method === 'GET') return json(await alertInfo(env));
  if (rest === 'alerts/test' && method === 'POST') {
    const s = await getSettings(db);
    const targets = await alertTargets(env, s);
    let reached = 0;
    const failed = [];
    for (const chat of targets) {
      try {
        await tg.sendMessage(chat, '✅ <b>Test alert</b>\nOrder alerts will arrive here. Each one has a button to review the proof and release the money.');
        reached++;
      } catch (err) {
        failed.push(chat);
      }
    }
    if (reached) await setSetting(db, 'alerts_tested', 1);
    await audit(db, user.id, 'alerts.test', `${reached}/${targets.length} reached`);
    return json({ reached, total: targets.length, failed: failed.length, info: await alertInfo(env) });
  }
  if (rest === 'alerts/dm' && method === 'POST') {
    await setSetting(db, 'admin_chat_id', 0);
    await audit(db, user.id, 'alerts.destination', 'private messages');
    return json(await alertInfo(env));
  }

  throw new ApiError(404, 'not_found', 'Unknown endpoint.');
}
