// Shared test harness: the real Worker running locally (wrangler dev, local D1) next to a fake Telegram server.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { signInitData } from './helpers.js';

export const APP = 'http://127.0.0.1:8787';
export const TG_PORT = 8788;
export const BOT_TOKEN = '123456:TEST-TOKEN';
export const WEBHOOK_SECRET = 'whsec_test_secret';
export const ADMIN = { id: 900001, first_name: 'Admin' };
export const STAFF = { id: 900002, first_name: 'Selam', username: 'selam_staff' };
export const ALICE = { id: 111001, first_name: 'Alice', username: 'alice', language_code: 'en' };
export const BOB = { id: 111002, first_name: 'Bob', username: 'bob', language_code: 'am' };
export const ADMIN_CHAT = -1009999;
export const ADDR_TRC20 = 'TLsV52sRDL79HXGGm9yzwKibb6BeruhUzy';
export const ADDR_BEP20 = '0x1234567890abcdef1234567890abcdef12345678';

const persist = mkdtempSync(join(tmpdir(), 'neon-test-'));
const env = { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' };
// The local Worker talks to a fake Telegram on 127.0.0.1. A corporate or sandbox proxy would intercept that call.
for (const k of Object.keys(env)) if (/^(https?|all)_proxy$/i.test(k)) delete env[k];
env.NO_PROXY = env.no_proxy = '127.0.0.1,localhost';
let wrangler;
let wlog = '';
export let passed = 0;

// ---------- fake Telegram ----------
export const tgCalls = [];
let msgId = 1000;
const fakeTelegram = createServer(async (req, res) => {
  if (req.url.startsWith('/file/')) {
    res.writeHead(200, { 'content-type': 'image/png' });
    return res.end(Buffer.from(PNG_B64, 'base64'));
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  const method = req.url.split('/').pop();
  let payload;
  const ct = req.headers['content-type'] || '';
  if (ct.includes('multipart/form-data')) {
    const form = await new Response(raw, { headers: { 'content-type': ct } }).formData();
    payload = Object.fromEntries([...form.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : `[file ${v.name} ${v.size}b ${v.type}]`]));
    if (payload.reply_markup) payload.reply_markup = JSON.parse(payload.reply_markup);
  } else {
    payload = JSON.parse(raw.toString() || '{}');
  }
  const call = { method, payload };
  tgCalls.push(call);
  let result = true;
  if (method === 'sendMessage') result = { message_id: ++msgId };
  if (method === 'getFile') result = { file_id: payload.file_id, file_path: `photos/${payload.file_id}.png`, file_size: 70 };
  if (method === 'getMe') result = { id: 1, is_bot: true, username: 'neon_test_bot' };
  if (method === 'sendDocument') { const id = ++msgId; result = { message_id: id, document: { file_id: `doc_${id}` } }; }
  if (method === 'sendPhoto') result = { message_id: ++msgId, photo: [{ file_id: 'small' }, { file_id: 'big' }] };
  call.result = result;
  if (payload.chat_id === 424242) {
    res.writeHead(403, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, description: 'Forbidden: bot was blocked by the user' }));
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, result }));
});

/** The screen a person is looking at: their latest sent or edited message. */
export const screenOf = (user) => {
  const c = [...tgCalls].reverse().find((x) => (x.method === 'sendMessage' || x.method === 'editMessageText') && x.payload.chat_id === user.id);
  if (!c) return null;
  return { text: c.payload.text, rows: c.payload.reply_markup?.inline_keyboard || [], id: c.payload.message_id ?? c.result.message_id };
};
export const takeCalls = (method, filter = () => true) => tgCalls.filter((c) => c.method === method && filter(c.payload));
export const lastCall = (method, filter) => takeCalls(method, filter).at(-1);
export const lastPayload = (method, filter) => lastCall(method, filter)?.payload;

// ---------- helpers ----------
export async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n${err.stack}`);
    throw err;
  }
}

export function api(user, method, path, body, { raw } = {}) {
  const headers = {};
  if (user) headers.authorization = `tma ${signInitData(BOT_TOKEN, user)}`;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  return fetch(`${APP}${path}`, { method, headers, body: payload }).then(async (res) => (raw ? res : { status: res.status, body: await res.json().catch(() => null) }));
}

export async function webhook(update, secret = WEBHOOK_SECRET) {
  return fetch(`${APP}/telegram/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret },
    body: JSON.stringify(update),
  });
}
let updateId = 1;
export const nextUpdateId = () => updateId++;
export const adminSays = (text, extra = {}) => webhook({ update_id: updateId++, message: { message_id: 5000 + updateId, from: ADMIN, chat: { id: ADMIN_CHAT, type: 'supergroup' }, text, ...extra } });
export const press = (from, data, message) => webhook({ update_id: updateId++, callback_query: { id: `cb${updateId}`, from, data, message } });

/** Creates the shop's accounts and networks through the real admin API, as the owner would in the app. */
export async function seedCatalog() {
  const post = async (path, body) => {
    const r = await api(ADMIN, 'POST', path, body);
    if (r.status !== 201) throw new Error(`seed ${path} failed: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  const telebirr = (await post('/api/admin/methods', { kind: 'mobile', label_en: 'Telebirr', label_am: 'ቴሌብር', account_name: 'Neon Store', account_number: '0911223344' })).method.code;
  const cbe = (await post('/api/admin/methods', { kind: 'bank', label_en: 'Commercial Bank of Ethiopia', label_am: 'የኢትዮጵያ ንግድ ባንክ', account_name: 'Neon Store', account_number: '1000123456789' })).method.code;
  const trc20 = (await post('/api/admin/networks', { kind: 'tron', label: 'USDT · TRON (TRC20)', deposit_address: ADDR_TRC20 })).network.code;
  const bep20 = (await post('/api/admin/networks', { kind: 'evm', label: 'USDT · BNB Chain (BEP20)', deposit_address: ADDR_BEP20 })).network.code;
  const bybit = (await post('/api/admin/networks', { kind: 'bybit_uid', label: 'Bybit UID (internal transfer)', deposit_address: '12345678' })).network.code;
  return { telebirr, cbe, trc20, bep20, bybit };
}

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
export const PNG_BYTES = Uint8Array.from(atob(PNG_B64), (c) => c.charCodeAt(0));
/** A valid PNG. Pass a number to get a different file (so its hash differs) that is still a valid PNG. */
export const png = (variant = 0) => new Blob([PNG_BYTES, new Uint8Array(variant)], { type: 'image/png' });
export const evidenceForm = ({ text, photo } = {}) => {
  const f = new FormData();
  if (text !== undefined) f.append('text', text);
  if (photo) f.append('photo', photo, 'receipt.png');
  return f;
};

export async function waitFor(url, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

export function wr(args) {
  const r = spawnSync('npx', ['wrangler', ...args], { env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`wrangler ${args.join(' ')} failed:\n${r.stdout}\n${r.stderr}`);
}


export function startFakeTelegram() {
  return new Promise((r) => fakeTelegram.listen(TG_PORT, '127.0.0.1', r));
}

/** Migrates a fresh local database, starts the Worker and waits until it answers. */
export async function startStack({ extraVars = [] } = {}) {
  const busy = await fetch(`${APP}/health`).then(() => true, () => false);
  if (busy) throw new Error('Port 8787 is already in use. Stop the other wrangler dev first.');
  await startFakeTelegram();
  console.log('Preparing local database…');
  wr(['d1', 'migrations', 'apply', 'neon-p2p', '--local', '--persist-to', persist]);
  console.log('Starting Worker…');
  const vars = { BOT_TOKEN, WEBHOOK_SECRET, ADMIN_IDS: String(ADMIN.id), ADMIN_CHAT_ID: String(ADMIN_CHAT), WEBAPP_URL: APP, TELEGRAM_API_BASE: `http://127.0.0.1:${TG_PORT}`, SUPPORT_USERNAME: 'Neon_ghost147' };
  const args = ['wrangler', 'dev', '--local', '--port', '8787', '--persist-to', persist, '--test-scheduled'];
  for (const [k, v] of Object.entries(vars)) args.push('--var', `${k}:${v}`);
  for (const v of extraVars) args.push('--var', v);
  wrangler = spawn('npx', args, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  wrangler.stdout.on('data', (d) => (wlog += d));
  wrangler.stderr.on('data', (d) => (wlog += d));
  try {
    await waitFor(`${APP}/health`);
  } catch (e) {
    console.error(wlog);
    throw e;
  }
}

export const workerLog = () => wlog;

export async function stopStack() {
  if (wrangler?.pid) {
    const kids = spawnSync('pgrep', ['-g', String(wrangler.pid)], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
    for (const pid of kids) { try { process.kill(Number(pid), 'SIGKILL'); } catch { /* already gone */ } }
    try { process.kill(-wrangler.pid, 'SIGKILL'); } catch { /* already gone */ }
  }
  fakeTelegram.close();
  await new Promise((r) => setTimeout(r, 800));
  rmSync(persist, { recursive: true, force: true });
}
