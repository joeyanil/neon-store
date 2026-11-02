import test from 'node:test';
import assert from 'node:assert/strict';
import { etbForUsdt, formatEtb, formatUsdt, parseRate, parseUsdt } from '../src/money.js';
import { cleanAccount, cleanAddress, cleanName, cleanNote, cleanTarget, isOrderId, isValidIdemKey } from '../src/validate.js';
import { AuthError, validateInitData } from '../src/auth.js';
import { TRANSITIONS, canTransition, newOrderId } from '../src/orders.js';
import { adminCard, adminKeyboard } from '../src/messages.js';
import { serviceTotal } from '../src/create.js';
import { signInitData } from './helpers.js';

const TOKEN = '123456:TEST-TOKEN';
const USER = { id: 777001, first_name: 'Abebe', username: 'abebe', language_code: 'en' };

test('parseUsdt accepts plain decimals up to 6 places and rejects the rest', () => {
  assert.equal(parseUsdt('12.5'), 12_500_000);
  assert.equal(parseUsdt('100'), 100_000_000);
  assert.equal(parseUsdt('0.000001'), 1);
  for (const bad of ['', 'abc', '-5', '0', '0.0', '1.1234567', '1e3', '1,000', ' ', null, undefined, '12.']) {
    assert.equal(parseUsdt(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

test('parseRate accepts up to 2 decimals', () => {
  assert.equal(parseRate('168.5'), 16850);
  assert.equal(parseRate('163'), 16300);
  assert.equal(parseRate('163.999'), null);
  assert.equal(parseRate('0'), null);
});

test('etbForUsdt rounds up for buy and down for sell, with no float drift', () => {
  // 10.333333 USDT at 168.57 = 1741.8...  (not a whole number of cents)
  const usdt = parseUsdt('10.333333');
  const up = etbForUsdt(usdt, 16857, 'up');
  const down = etbForUsdt(usdt, 16857, 'down');
  assert.equal(up, down + 1);
  assert.equal(etbForUsdt(100_000_000, 16850, 'up'), 1_685_000); // exact: 100 * 168.50 = 16,850.00
  assert.equal(etbForUsdt(100_000_000, 16850, 'down'), 1_685_000);
  // large amounts stay exact
  assert.equal(etbForUsdt(5_000_000_000, 99_999, 'up'), 499_995_000);
});

test('formatting', () => {
  assert.equal(formatUsdt(12_500_000), '12.50');
  assert.equal(formatUsdt(1_234_567_000), '1,234.567');
  assert.equal(formatEtb(1_685_005), '16,850.05');
});

test('address validation per network kind', () => {
  assert.equal(cleanAddress('tron', 'TLsV52sRDL79HXGGm9yzwKibb6BeruhUzy'), 'TLsV52sRDL79HXGGm9yzwKibb6BeruhUzy');
  assert.equal(cleanAddress('tron', '0x' + 'a'.repeat(40)), null);
  assert.equal(cleanAddress('evm', '0x' + 'aB1'.repeat(13) + 'c'), '0x' + 'aB1'.repeat(13) + 'c');
  assert.equal(cleanAddress('evm', 'TLsV52sRDL79HXGGm9yzwKibb6BeruhUzy'), null);
  assert.equal(cleanAddress('bybit_uid', '123456789'), '123456789');
  assert.equal(cleanAddress('bybit_uid', '12ab'), null);
  assert.equal(cleanAddress('doge', 'x'), null);
});

test('name, account, phone, link and note cleaning', () => {
  assert.equal(cleanName('አበበ በቀለ'), 'አበበ በቀለ');
  assert.equal(cleanName("Abebe O'Neil-Smith"), "Abebe O'Neil-Smith");
  assert.equal(cleanName('A'), null);
  assert.equal(cleanName('<script>'), null);
  assert.ok(cleanAccount('bank', '1000 1234 5678'));
  assert.equal(cleanAccount('bank', '12'), null);
  assert.equal(cleanAccount('mobile', '+251 911 22 33 44'), '0911223344');
  assert.equal(cleanAccount('mobile', '0811223344'), null);
  assert.equal(cleanTarget('telegram', '@neonghost'), 'https://t.me/neonghost');
  assert.equal(cleanTarget('telegram', 'https://evil.example/x'), null);
  assert.equal(cleanNote('  hi\u0000there  '), 'hithere');
  assert.equal(cleanNote('x'.repeat(500)).length, 300);
  assert.equal(isValidIdemKey('abcd1234'), true);
  assert.equal(isValidIdemKey('short'), false);
});

test('order ids are well formed and effectively unique', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const id = newOrderId();
    assert.ok(isOrderId(id), id);
    seen.add(id);
  }
  assert.ok(seen.size > 1990);
});

test('initData: valid login passes', async () => {
  const init = signInitData(TOKEN, USER);
  const res = await validateInitData(init, TOKEN);
  assert.equal(res.user.id, USER.id);
});

test('initData: tampering, wrong token, expiry and junk are rejected', async () => {
  const init = signInitData(TOKEN, USER);
  const tampered = init.replace('777001', '777002');
  await assert.rejects(validateInitData(tampered, TOKEN), (e) => e instanceof AuthError && e.code === 'bad_signature');
  await assert.rejects(validateInitData(init, 'other:TOKEN'), (e) => e.code === 'bad_signature');
  const old = signInitData(TOKEN, USER, { authDate: Math.floor(Date.now() / 1000) - 90_000 });
  await assert.rejects(validateInitData(old, TOKEN), (e) => e.code === 'expired');
  const future = signInitData(TOKEN, USER, { authDate: Math.floor(Date.now() / 1000) + 3600 });
  await assert.rejects(validateInitData(future, TOKEN), (e) => e.code === 'bad_init_data');
  for (const junk of ['', 'hash=abc', 'a=b', 'x'.repeat(5000)]) {
    await assert.rejects(validateInitData(junk, TOKEN), (e) => e instanceof AuthError);
  }
  const bot = signInitData(TOKEN, { ...USER, is_bot: true });
  await assert.rejects(validateInitData(bot, TOKEN), (e) => e.code === 'bad_init_data');
});

test('initData: extra fields such as signature and start_param are covered by the check', async () => {
  const init = signInitData(TOKEN, USER, { extra: { signature: 'abc_DEF-123', start_param: 'ref1' } });
  const res = await validateInitData(init, TOKEN);
  assert.equal(res.startParam, 'ref1');
  await assert.rejects(validateInitData(init.replace('ref1', 'ref2'), TOKEN), (e) => e.code === 'bad_signature');
});

test('state machine: who can do what', () => {
  assert.ok(canTransition('awaiting_payment', 'evidence_submitted', 'user'));
  assert.ok(canTransition('awaiting_payment', 'cancelled', 'user'));
  assert.ok(canTransition('awaiting_payment', 'expired', 'system'));
  assert.ok(canTransition('evidence_submitted', 'processing', 'admin'));
  assert.ok(canTransition('processing', 'completed', 'admin'));
  // customers can never confirm, complete or reject their own order
  assert.equal(canTransition('evidence_submitted', 'processing', 'user'), false);
  assert.equal(canTransition('processing', 'completed', 'user'), false);
  assert.equal(canTransition('processing', 'rejected', 'user'), false);
  // once evidence is in, the customer cannot cancel
  assert.equal(canTransition('evidence_submitted', 'cancelled', 'user'), false);
  // finished orders never move again
  for (const done of ['completed', 'rejected', 'cancelled']) assert.equal(TRANSITIONS[done], undefined);
  // an expired order only reopens by a late proof from the customer, or is rejected by an admin
  assert.ok(canTransition('expired', 'evidence_submitted', 'user'));
  assert.ok(canTransition('expired', 'rejected', 'admin'));
  assert.equal(canTransition('expired', 'processing', 'admin'), false);
  // cannot skip review
  assert.equal(canTransition('awaiting_payment', 'processing', 'admin'), false);
  assert.equal(canTransition('evidence_submitted', 'completed', 'admin'), false);
});

test('admin card escapes customer text and buttons follow the status', () => {
  const order = {
    id: 'NG-ABC234', side: 'buy', status: 'evidence_submitted', usdt_micro: 100_000_000, rate_cents: 16850, etb_cents: 1_685_000,
    network_code: 'TRC20', usdt_address: 'TLsV52sRDL79HXGGm9yzwKibb6BeruhUzy', evidence_text: '<b>hack</b> & co', evidence_count: 1,
    pay_snapshot: JSON.stringify({ kind: 'birr', label_en: 'Telebirr', account_name: 'Neon', account_number: '0911000000' }),
  };
  const card = adminCard(order, { id: 5, first_name: '<i>X</i>', username: 'x_y' });
  assert.ok(!card.includes('<i>X</i>'));
  assert.ok(card.includes('&lt;b&gt;hack&lt;/b&gt; &amp; co'));
  assert.ok(card.length <= 1024);
  assert.deepEqual(adminKeyboard(order).inline_keyboard[0].map((b) => b.callback_data), ['o:NG-ABC234:c', 'o:NG-ABC234:r']);
  assert.deepEqual(adminKeyboard({ ...order, status: 'processing' }).inline_keyboard[0].map((b) => b.callback_data), ['o:NG-ABC234:d', 'o:NG-ABC234:r']);
  assert.deepEqual(adminKeyboard({ ...order, status: 'completed' }).inline_keyboard, []);
  for (const b of adminKeyboard(order).inline_keyboard[0]) assert.ok(b.callback_data.length <= 64);
});

test('service totals round up so the shop never undercharges', () => {
  assert.equal(serviceTotal(1000, 8550), 8550);
  assert.equal(serviceTotal(1500, 8550), 12825);
  assert.equal(serviceTotal(1, 8550), 9); // 8.55 cents -> 9
});

// The Mini App must run on old phones (Android WebView 80, from 2020). These features arrived later and would stop the
// whole app from starting, so they must not be used directly. public/js/compat.js fills in the few that are needed.
import { readdirSync, readFileSync } from 'node:fs';
test('Mini App code uses nothing newer than Chrome 80 (or has a fill-in in compat.js)', () => {
  const banned = [
    [/\?\?=|\|\|=|&&=/, 'logical assignment (Chrome 85)'], [/\.replaceAll\(/, 'replaceAll (85)'], [/\.at\(-?\d/, 'Array/String.at (92)'], [/structuredClone/, 'structuredClone (98)'],
    [/Object\.hasOwn\(/, 'Object.hasOwn (93)'], [/\.findLast(Index)?\(/, 'findLast (97)'], [/Promise\.any/, 'Promise.any (85)'], [/\.toSorted\(|\.toReversed\(/, 'toSorted (110)'],
    [/randomUUID/, 'crypto.randomUUID (92)'], [/AbortSignal\.(timeout|any)/, 'AbortSignal.timeout (124)'], [/\bstatic\s*\{|#[a-z_]\w*\s*\(/i, 'private methods / static blocks (84+)'], [/await\s+import\(/, 'top-level await style import'],
  ];
  const problems = [];
  for (const f of readdirSync('public/js')) {
    if (f === 'compat.js' || !f.endsWith('.js')) continue;
    const text = readFileSync(`public/js/${f}`, 'utf8').replace(/\/\/.*$/gm, '');
    for (const [re, why] of banned) if (re.test(text)) problems.push(`${f}: ${why}`);
    if (/^await\s/m.test(text)) problems.push(`${f}: top-level await (89)`);
  }
  const css = readFileSync('public/css/app.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  if (/[{;\s]inset\s*:\s*[^i]/.test(css.replace(/box-shadow[^;]*;/g, '').replace(/--[\w-]+:[^;]*;/g, ''))) problems.push('app.css: "inset:" shorthand (87)');
  if (/[{;\s]aspect-ratio/.test(css) && !/@supports not \(aspect-ratio/.test(css)) problems.push('app.css: aspect-ratio without a fallback (88)');
  assert.deepEqual(problems, []);
});
test('compat.css covers every flex container that relies on gap', () => {
  const css = readFileSync('public/css/app.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const compat = readFileSync('public/css/compat.css', 'utf8');
  const missing = [];
  for (const m of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const gap = /(?:^|[;\s])gap:\s*([^;]+)/.exec(m[2])?.[1].trim().split(/\s+/)[0];
    if (!gap || /^0(px)?$/.test(gap) || !/display:\s*(inline-flex|flex)\b/.test(m[2])) continue;
    for (const sel of m[1].split(',')) if (!compat.includes(`html.no-fg ${sel.trim()} >`)) missing.push(sel.trim());
  }
  assert.deepEqual(missing, [], 'run: node scripts/gen-compat-css.mjs');
});
