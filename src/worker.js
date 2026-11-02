import { handleApi } from './api.js';
import { ensureWebhook, handleConnect } from './connect.js';
import { webhookSecret } from './secret.js';
import { json } from './http.js';
import { VERSION } from './version.js';
import { purgeOldProofs } from './proofs.js';
import { expireStaleOrders, handleUpdate, retryAlerts } from './service.js';
import { Telegram } from './telegram.js';

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const realUrl = (v) => /^https:\/\/[^/]+$/.test(String(v || '').replace(/\/$/, '')) && !/YOUR-SUBDOMAIN/.test(String(v));
/** Uses WEBAPP_URL when it is a real address; otherwise the address the request came in on. */
const withUrl = (env, origin) => (realUrl(env.WEBAPP_URL) ? env : { ...env, WEBAPP_URL: origin });

export default {
  async fetch(request, rawEnv) {
    const url = new URL(request.url);
    const env = withUrl(rawEnv, url.origin);
    const tg = new Telegram(env);

    if (url.pathname === '/connect') return handleConnect(request, env, url.origin);

    if (url.pathname === '/telegram/webhook' && request.method === 'POST') {
      // Telegram sends the secret we registered with setWebhook in this header.
      const secret = await webhookSecret(env);
      if (!secret || !safeEqual(request.headers.get('x-telegram-bot-api-secret-token') || '', secret)) {
        return new Response('forbidden', { status: 403 });
      }
      let update;
      try {
        update = await request.json();
      } catch {
        return new Response('bad request', { status: 400 });
      }
      await handleUpdate(env, tg, update);
      return new Response('ok');
    }

    if (url.pathname.startsWith('/api/')) return handleApi(request, env, tg);
    if (url.pathname === '/health') return json({ ok: true, version: VERSION });

    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('not found', { status: 404 });
  },

  // Runs every 5 minutes (see wrangler.toml): expires orders whose payment window has closed.
  async scheduled(event, rawEnv) {
    let env = rawEnv;
    if (!realUrl(env.WEBAPP_URL)) {
      const saved = await env.DB.prepare("SELECT value FROM settings WHERE key = 'webapp_url'").first().catch(() => null);
      if (saved?.value) env = { ...env, WEBAPP_URL: saved.value };
    }
    const tg = new Telegram(env);
    const now = Math.floor((event.scheduledTime || Date.now()) / 1000);
    // If the webhook was lost or Telegram is being refused, put it back (this is what keeps the bot answering after any redeploy).
    await ensureWebhook(env, tg, now).catch((err) => console.warn('ensureWebhook failed', String(err?.message || err)));
    const n = await expireStaleOrders(env, tg, now);
    if (n) console.log(`expired ${n} order(s)`);
    const a = await retryAlerts(env, tg).catch((err) => { console.warn('retryAlerts failed', String(err?.message || err)); return 0; });
    if (a) console.log(`re-sent ${a} alert(s)`);
    const p = await purgeOldProofs(env, now).catch((err) => { console.warn('purgeOldProofs failed', String(err?.message || err)); return 0; });
    if (p) console.log(`removed ${p} old proof(s)`);
  },
};
