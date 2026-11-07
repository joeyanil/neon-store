import { initData } from './tg.js';

export class ApiError extends Error {
  constructor(code, message, status = 0, extra = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

let offset = 0; // server clock minus device clock, in seconds, so countdowns are right even when the phone clock is off
export const serverNow = () => Math.floor(Date.now() / 1000 + offset);
function noteServerTime(t) {
  if (Number.isFinite(t)) offset = t - Date.now() / 1000;
}

async function request(method, path, { json, form, timeout = 20_000 } = {}) {
  const headers = { authorization: `tma ${initData()}` };
  let body;
  if (form) body = form;
  else if (json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(json);
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  let res;
  try {
    res = await fetch(path, { method, headers, body, signal: ctl.signal });
  } catch {
    throw new ApiError('network_error', 'No connection');
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try {
    data = await res.json();
  } catch { /* empty or non-JSON body */ }
  if (!res.ok) {
    if (data && data.applied === false) throw new ApiError('not_applied', data.message || 'Not applied', res.status, {});
    const e = data?.error || {};
    throw new ApiError(e.code || 'server_error', e.message || 'Request failed', res.status, e);
  }
  noteServerTime(data?.server_time);
  // Anything an admin saves can change what customers see (rates, accounts, services), so tell the app to reload its shop data.
  if (method !== 'GET' && path.startsWith('/api/admin/')) dispatchEvent(new Event('neon:shop-changed'));
  return data;
}

export const api = {
  bootstrap: () => request('GET', '/api/bootstrap'),
  setLanguage: (language) => request('POST', '/api/language', { json: { language } }),
  markCanDm: () => request('POST', '/api/can-dm', { json: {} }),
  createOrder: (body) => request('POST', '/api/orders', { json: body }),
  listOrders: (filter = 'all', before = null) =>
    request('GET', `/api/orders?filter=${filter}${before ? `&before=${before}` : ''}`),
  getOrder: (id) => request('GET', `/api/orders/${id}`),
  sendReview: (id, rating, comment) => request('POST', `/api/orders/${id}/review`, { json: { rating, comment } }),
  cancelOrder: (id) => request('POST', `/api/orders/${id}/cancel`, { json: {} }),
  sendEvidence: (id, form) => request('POST', `/api/orders/${id}/evidence`, { form, timeout: 60_000 }),
  policies: () => request('GET', '/api/policies'),
  listTickets: () => request('GET', '/api/tickets'),
  getTicket: (id) => request('GET', `/api/tickets/${id}`),
  createTicket: (form) => request('POST', '/api/tickets', { form, timeout: 60_000 }),
  replyTicket: (id, form) => request('POST', `/api/tickets/${id}/messages`, { form, timeout: 60_000 }),
};

/** Fetches a private image (a proof or a ticket photo) with the login header and returns an object URL for <img>. */
export async function fetchImage(path) {
  const res = await fetch(path, { headers: { authorization: `tma ${initData()}` } });
  if (!res.ok) throw new ApiError('not_found', 'Image unavailable', res.status);
  return URL.createObjectURL(await res.blob());
}

/** Everything under /api/admin. Owners can use all of it; staff only the queue, tickets and customers. */
export const admin = {
  summary: () => request('GET', '/api/admin/summary'),
  storage: () => request('GET', '/api/admin/storage'),
  exportOrders: (scope) => request('POST', '/api/admin/export', { json: { scope } }),
  orders: (filter, before = null, q = '') => request('GET', `/api/admin/orders?filter=${filter}${before ? `&before=${before}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  order: (id) => request('GET', `/api/admin/orders/${id}`),
  act: (id, action, json = {}) => request('POST', `/api/admin/orders/${id}/${action}`, { json }),
  block: (userId, blocked) => request('POST', `/api/admin/customers/${userId}/block`, { json: { blocked } }),
  tickets: (status = 'open') => request('GET', `/api/admin/tickets?status=${status}`),
  ticket: (id) => request('GET', `/api/admin/tickets/${id}`),
  ticketReply: (id, text) => request('POST', `/api/admin/tickets/${id}/reply`, { json: { text } }),
  ticketClose: (id) => request('POST', `/api/admin/tickets/${id}/close`, { json: {} }),
  setup: () => request('GET', '/api/admin/setup'),
  settings: () => request('GET', '/api/admin/settings'),
  saveSettings: (json) => request('PUT', '/api/admin/settings', { json }),
  list: (kind) => request('GET', `/api/admin/${kind}`),
  create: (kind, json) => request('POST', `/api/admin/${kind}`, { json }),
  update: (kind, key, json) => request('PUT', `/api/admin/${kind}/${key}`, { json }),
  remove: (kind, key) => request('DELETE', `/api/admin/${kind}/${key}`),
  team: () => request('GET', '/api/admin/team'),
  addStaff: (json) => request('POST', '/api/admin/team', { json }),
  removeStaff: (id) => request('DELETE', `/api/admin/team/${id}`),
  audit: () => request('GET', '/api/admin/audit'),
  buttonEmoji: () => request('GET', '/api/admin/button-emoji'),
  saveButtonEmoji: (map) => request('PUT', '/api/admin/button-emoji', { json: { map } }),
  alerts: () => request('GET', '/api/admin/alerts'),
  testAlerts: () => request('POST', '/api/admin/alerts/test', { json: {} }),
  alertsToDm: () => request('POST', '/api/admin/alerts/dm', { json: {} }),
};

/** A random key that makes "create order" safe to retry or double tap. */
export function newIdemKey() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
