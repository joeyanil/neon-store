// One-time "Connect Telegram" page. After the first deploy, open  https://<your-worker>/connect  on any device,
// type the WEBHOOK_SECRET you saved in Cloudflare, and press the button. The Worker registers the webhook, the
// "Open App" menu button and the command list with Telegram itself, so nothing has to run on a computer.
import { setSetting } from './orders.js';
import { Telegram, TelegramError, esc } from './telegram.js';

const PAGE = (body) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Telegram</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px 16px;background:#e9efff;color:#0d1424}
input,button{font:inherit;width:100%;box-sizing:border-box;padding:14px;border-radius:14px;border:1px solid #9aa8c8;margin:8px 0}
button{background:#0a62d0;color:#fff;border:0;font-weight:600}.ok{color:#0a7d3c}.bad{color:#b3261e}code{background:#fff;padding:2px 6px;border-radius:6px}li{margin:6px 0}</style></head>
<body><h1>Connect Telegram</h1>${body}</body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const COMMANDS = [
  { command: 'start', description: 'Main menu' }, { command: 'buy', description: 'Buy USDT' }, { command: 'sell', description: 'Sell USDT' },
  { command: 'services', description: 'Social-media services' }, { command: 'rates', description: 'Current rates' }, { command: 'orders', description: 'My orders' },
  { command: 'support', description: 'Support' }, { command: 'policies', description: 'Rules and policies' }
];

export async function handleConnect(request, env, origin) {
  if (!env.BOT_TOKEN || !env.WEBHOOK_SECRET) {
    return PAGE('<p class="bad">BOT_TOKEN and WEBHOOK_SECRET are not set in Cloudflare yet. Add both as secrets, redeploy, then come back to this page.</p>');
  }
  if (request.method !== 'POST') {
    return PAGE(`<p>This links your bot to the shop. It is safe to run again any time.</p>
<form method="post"><label for="k">Your WEBHOOK_SECRET</label><input id="k" name="key" type="password" autocomplete="off" required><button type="submit">Connect Telegram</button></form>`);
  }
  const form = await request.formData().catch(() => null);
  if (!form || !safeEqual(String(form.get('key') || ''), env.WEBHOOK_SECRET)) {
    return PAGE('<p class="bad">That is not the right secret.</p><p><a href="/connect">Try again</a></p>');
  }
  const tg = new Telegram(env);
  const steps = [];
  const run = async (label, fn) => {
    try { const r = await fn(); steps.push(`<li class="ok">✓ ${esc(label)}</li>`); return r; } catch (err) {
      steps.push(`<li class="bad">✗ ${esc(label)}: ${esc(err instanceof TelegramError ? err.description || err.message : err.message)}</li>`);
      return null;
    }
  };
  const me = await run('Bot token accepted', () => tg.call('getMe', {}));
  if (me) {
    await run('Webhook registered', () => tg.call('setWebhook', { url: `${origin}/telegram/webhook`, secret_token: env.WEBHOOK_SECRET, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true }));
    await run('"Open App" button added next to the typing box', () => tg.call('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Open App', web_app: { url: origin } } }));
    await run('Command list set', () => tg.call('setMyCommands', { commands: COMMANDS }));
    await run('Address saved', async () => { await setSetting(env.DB, 'webapp_url', origin); });
  }
  const done = me && !steps.some((s) => s.includes('class="bad"'));
  return PAGE(`<ul>${steps.join('')}</ul>${done
    ? `<p class="ok"><b>Done.</b> Open <b>@${esc(me.username)}</b> in Telegram and send <code>/start</code>. The owner sees the Admin tab.</p>`
    : '<p class="bad">Something failed. Fix the line marked ✗ and press the button again.</p><p><a href="/connect">Back</a></p>'}`);
}
