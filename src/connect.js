// "Connect Telegram" page and the webhook self-repair.
//
// Open  https://<your-worker>/connect  on any device. It shows whether the bot is answering and, if not, why, and one button
// registers the webhook, the "Open App" menu button and the command list. No password is needed: the page can only point
// Telegram at this same Worker, and the secret Telegram uses is derived from the bot token (see secret.js).
// The cron job runs the same repair every 5 minutes, so a redeploy can never leave the bot silent for long.
import { setSetting } from './orders.js';
import { VERSION } from './version.js';
import { webhookSecret } from './secret.js';
import { Telegram, TelegramError, esc } from './telegram.js';

const PAGE = (body) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Telegram</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px 16px;background:#e9efff;color:#0d1424}
button{font:inherit;width:100%;box-sizing:border-box;padding:14px;border-radius:14px;border:0;margin:12px 0;background:#0a62d0;color:#fff;font-weight:600}.ok{color:#0a7d3c}.bad{color:#b3261e}.warn{color:#8a5a00}code{background:#fff;padding:2px 6px;border-radius:6px;word-break:break-all}li{margin:6px 0}</style></head>
<body><h1>Connect Telegram</h1>${body}<p style="opacity:.6;font-size:13px">Version ${VERSION}</p></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });

const COMMANDS = [
  { command: 'start', description: 'Main menu' }, { command: 'buy', description: 'Buy USDT' }, { command: 'sell', description: 'Sell USDT' },
  { command: 'services', description: 'Social-media services' }, { command: 'rates', description: 'Current rates' }, { command: 'orders', description: 'My orders' },
  { command: 'support', description: 'Support' }, { command: 'policies', description: 'Rules and policies' },
];

const hookUrl = (origin) => `${origin}/telegram/webhook`;
const ago = (sec) => (sec < 90 ? 'just now' : sec < 5400 ? `${Math.round(sec / 60)} min ago` : `${Math.round(sec / 3600)} h ago`);

/** Registers everything with Telegram. Returns { me, steps } where steps are { ok, text }. */
async function connect(env, tg, origin) {
  const steps = [];
  const run = async (label, fn) => {
    try { const r = await fn(); steps.push({ ok: true, text: label }); return r; } catch (err) {
      steps.push({ ok: false, text: `${label}: ${err instanceof TelegramError ? err.description || err.message : err.message}` });
      return null;
    }
  };
  const me = await run('Bot token accepted', () => tg.call('getMe', {}));
  if (me) {
    const secret = await webhookSecret(env);
    // Pending messages are kept (not dropped), so a /start sent while the bot was silent is answered.
    await run('Webhook registered', () => tg.call('setWebhook', { url: hookUrl(origin), secret_token: secret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: false }));
    await run('"Open App" button added next to the typing box', () => tg.call('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Open App', web_app: { url: origin } } }));
    await run('Command list set', () => tg.call('setMyCommands', { commands: COMMANDS }));
    await run('Address saved', () => setSetting(env.DB, 'webapp_url', origin));
  }
  return { me, steps };
}

/** What Telegram says about this bot's webhook, in plain words. */
async function health(env, tg, origin) {
  const lines = [];
  if (!env.BOT_TOKEN) return { lines: [{ ok: false, text: 'BOT_TOKEN is not set. Add it in Cloudflare (Settings > Variables and Secrets, type Secret), then redeploy.' }], healthy: false };
  let me;
  try { me = await tg.call('getMe', {}); lines.push({ ok: true, text: `Bot token works: @${me.username}` }); } catch (err) {
    return { lines: [{ ok: false, text: `The bot token is not accepted by Telegram (${err.description || err.message}). Check BOT_TOKEN.` }], healthy: false };
  }
  let healthy = true;
  try {
    const info = await tg.getWebhookInfo();
    const secretOk = !(info.last_error_message && /403|forbidden/i.test(info.last_error_message) && Date.now() / 1000 - (info.last_error_date || 0) < 3600);
    if (info.url !== hookUrl(origin)) { healthy = false; lines.push({ ok: false, text: `Telegram sends messages to ${info.url || 'nowhere'}, not to this app.` }); } else lines.push({ ok: true, text: 'Telegram sends messages to this app.' });
    if (!secretOk) { healthy = false; lines.push({ ok: false, text: 'Telegram was refused by this app (wrong secret). Press the button below to fix it.' }); }
    if (info.last_error_message && secretOk) lines.push({ ok: false, text: `Telegram's last delivery problem: ${info.last_error_message} (${ago(Date.now() / 1000 - (info.last_error_date || 0))})` });
    lines.push({ ok: (info.pending_update_count || 0) < 5, text: `${info.pending_update_count || 0} message(s) waiting to be delivered.` });
  } catch (err) { healthy = false; lines.push({ ok: false, text: `Could not read the webhook: ${err.message}` }); }
  try {
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").first();
    lines.push({ ok: n.n > 5, text: `Database reachable (${n.n} tables).` });
  } catch (err) { healthy = false; lines.push({ ok: false, text: `Database problem: ${err.message}` }); }
  return { lines, healthy, me };
}

const list = (items) => `<ul>${items.map((s) => `<li class="${s.ok ? 'ok' : 'bad'}">${s.ok ? '✓' : '✗'} ${esc(s.text)}</li>`).join('')}</ul>`;

export async function handleConnect(request, env, origin) {
  const tg = new Telegram(env);
  if (request.method === 'POST') {
    const { me, steps } = await connect(env, tg, origin);
    const done = me && steps.every((s) => s.ok);
    return PAGE(`${list(steps)}${done
      ? `<p class="ok"><b>Done.</b> Open <b>@${esc(me.username)}</b> in Telegram and send <code>/start</code>. The owner sees the Admin tab.</p>`
      : '<p class="bad">Something failed. Fix the line marked ✗ and press the button again.</p>'}<form method="post"><button type="submit">Connect again</button></form>`);
  }
  const h = await health(env, tg, origin);
  return PAGE(`${list(h.lines)}${h.healthy
    ? '<p class="ok"><b>Everything looks fine.</b> If the bot still does not answer, press the button once.</p>'
    : '<p class="warn">Press the button to connect the bot to this app.</p>'}<form method="post"><button type="submit">Connect Telegram</button></form>`);
}

/**
 * Runs from the cron job. If Telegram is not pointed at this app, or has been refused (for example after the old secret
 * stopped matching), register the webhook again. Costs one Telegram call when everything is fine.
 */
export async function ensureWebhook(env, tg, now) {
  if (!env.BOT_TOKEN) return false;
  const origin = String(env.WEBAPP_URL || '').replace(/\/$/, '');
  if (!/^https?:\/\/[^/]+$/.test(origin) || /YOUR-SUBDOMAIN/.test(origin)) return false; // not connected yet: /connect has not been opened
  const info = await tg.getWebhookInfo();
  const refused = info.last_error_message && /403|forbidden/i.test(info.last_error_message) && now - (info.last_error_date || 0) < 900;
  if (info.url === hookUrl(origin) && !refused) return false;
  await tg.call('setWebhook', { url: hookUrl(origin), secret_token: await webhookSecret(env), allowed_updates: ['message', 'callback_query'], drop_pending_updates: false });
  console.log('webhook re-registered');
  return true;
}
