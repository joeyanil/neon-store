// One-time (and re-runnable) Telegram setup: webhook, menu button, command list.
// Usage:
//   BOT_TOKEN=123:abc WEBHOOK_SECRET=long-random-string WEBAPP_URL=https://your.worker.dev node scripts/telegram-setup.mjs
// Add DRY_RUN=1 to print what would be sent without calling Telegram.
const { BOT_TOKEN, WEBHOOK_SECRET, WEBAPP_URL, DRY_RUN } = process.env;
const missing = ['BOT_TOKEN', 'WEBHOOK_SECRET', 'WEBAPP_URL'].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing: ${missing.join(', ')}`);
  process.exit(1);
}
if (!/^https:\/\/[^/]+$/.test(WEBAPP_URL)) {
  console.error('WEBAPP_URL must be https and have no trailing slash or path.');
  process.exit(1);
}
if (!/^[A-Za-z0-9_-]{16,256}$/.test(WEBHOOK_SECRET)) {
  console.error('WEBHOOK_SECRET must be 16-256 characters of A-Z a-z 0-9 _ - (Telegram allows nothing else).');
  process.exit(1);
}

const calls = [
  ['setWebhook', { url: `${WEBAPP_URL}/telegram/webhook`, secret_token: WEBHOOK_SECRET, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true }],
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
