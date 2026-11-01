// One-time (and re-runnable) Telegram setup: webhook, menu button, command list.
// Usage:
//   BOT_TOKEN=123:abc WEBAPP_URL=https://your.worker.dev node scripts/telegram-setup.mjs
// (Simpler: open https://your.worker.dev/connect in a browser; it does the same.)
// Add DRY_RUN=1 to print what would be sent without calling Telegram.
import { webhookSecret } from '../src/secret.js';
const { BOT_TOKEN, WEBAPP_URL, DRY_RUN } = process.env;
const WEBHOOK_SECRET = await webhookSecret({ BOT_TOKEN });
const missing = ['BOT_TOKEN', 'WEBAPP_URL'].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing: ${missing.join(', ')}`);
  process.exit(1);
}
if (!/^https:\/\/[^/]+$/.test(WEBAPP_URL)) {
  console.error('WEBAPP_URL must be https and have no trailing slash or path.');
  process.exit(1);
}

const calls = [
  ['setWebhook', { url: `${WEBAPP_URL}/telegram/webhook`, secret_token: WEBHOOK_SECRET, allowed_updates: ['message', 'callback_query'], drop_pending_updates: false }],
  ['setChatMenuButton', { menu_button: { type: 'web_app', text: 'Open App', web_app: { url: WEBAPP_URL } } }],
  ['setMyCommands', { commands: [
    { command: 'start', description: 'Main menu' },
    { command: 'buy', description: 'Buy USDT' },
    { command: 'sell', description: 'Sell USDT' },
    { command: 'services', description: 'Social-media services' },
    { command: 'rates', description: 'Current rates' },
    { command: 'orders', description: 'My orders' },
    { command: 'support', description: 'Support' },
    { command: 'policies', description: 'Rules and policies' },
  ] }],
];

for (const [method, body] of calls) {
  if (DRY_RUN) { console.log(method, JSON.stringify({ ...body, secret_token: body.secret_token ? '***' : undefined })); continue; }
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  console.log(`${data.ok ? 'ok  ' : 'FAIL'} ${method}${data.ok ? '' : ` ${data.description || res.status}`}`);
  if (!data.ok) process.exitCode = 1;
}
