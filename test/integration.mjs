// End-to-end test: the real Worker (local D1) against a fake Telegram.
// Covers the admin setup, proof storage, both order lifecycles, admin actions from the app and from chat buttons,
// late proofs, blocking, alert retry and proof retention.   npm run test:integration
import assert from 'node:assert/strict';
import {
  ADDR_BEP20, ADDR_TRC20, ADMIN, ADMIN_CHAT, ALICE, APP, BOB, BOT_TOKEN, PNG_BYTES, WEBHOOK_SECRET, STAFF, adminSays, api, evidenceForm, lastCall, lastPayload, nextUpdateId, fakeWebhook, fakeRules, passed, png, press, screenOf,
  seedCatalog, startStack, step, stopStack, takeCalls, webhook, workerLog,
} from './harness.mjs';
import { signInitData } from './helpers.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const scheduledAt = (ms) => fetch(`${APP}/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*&time=${ms}`);
const dmTo = (id) => lastPayload('sendMessage', (p) => p.chat_id === id);

async function main() {
  await startStack();
  let ids;

  console.log('\nSecurity');
  await step('API rejects requests with no login', async () => {
    assert.equal((await api(null, 'GET', '/api/bootstrap')).status, 401);
  });
  await step('API rejects a forged signature', async () => {
    const forged = signInitData('999:WRONG', ALICE);
    const res = await fetch(`${APP}/api/bootstrap`, { headers: { authorization: `tma ${forged}` } });
    assert.equal(res.status, 401);
  });
  await step('API rejects expired login data', async () => {
    const old = signInitData(BOT_TOKEN, ALICE, { authDate: Math.floor(Date.now() / 1000) - 200_000 });
    const res = await fetch(`${APP}/api/bootstrap`, { headers: { authorization: `tma ${old}` } });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error.code, 'session_expired');
  });
  await step('webhook rejects a wrong or missing secret', async () => {
    assert.equal((await webhook({ update_id: 1 }, 'nope')).status, 403);
    assert.equal((await fetch(`${APP}/telegram/webhook`, { method: 'POST', body: '{}' })).status, 403);
  });
  await step('customers are locked out of every admin endpoint', async () => {
    for (const [m, path] of [['GET', '/api/admin/summary'], ['GET', '/api/admin/orders'], ['GET', '/api/admin/methods'], ['PUT', '/api/admin/settings'], ['GET', '/api/admin/team']]) {
      const r = await api(ALICE, m, path, m === 'PUT' ? {} : undefined);
      assert.equal(r.status, 403, `${m} ${path}`);
      assert.equal(r.body.error.code, 'forbidden');
    }
    assert.equal((await api(null, 'GET', '/api/admin/summary')).status, 401);
  });

  console.log('\nBefore the shop is set up');
  await step('a fresh shop shows nothing to buy or sell and no secrets', async () => {
    const r = await api(ALICE, 'GET', '/api/bootstrap');
    assert.equal(r.status, 200);
    assert.equal(r.body.user.id, ALICE.id);
    assert.equal(r.body.user.language, 'en');
    assert.equal(r.body.role, null);
    assert.equal(r.body.rates.ready, false);
    assert.deepEqual(r.body.availability, { buy: false, sell: false, service: false });
    assert.deepEqual(r.body.catalog, { methods: [], networks: [], services: [] });
    assert.equal(r.body.stock, null);
    assert.equal(r.body.support.username, 'Neon_ghost147');
    assert.equal((await api(BOB, 'GET', '/api/bootstrap')).body.user.language, 'en', 'English only: the Telegram language code is ignored');
  });
  await step('the owner is recognised and sees an unfinished setup checklist', async () => {
    assert.equal((await api(ADMIN, 'GET', '/api/bootstrap')).body.role, 'owner');
    const r = await api(ADMIN, 'GET', '/api/admin/setup');
    assert.equal(r.status, 200);
    assert.equal(r.body.ready, false);
    assert.equal(r.body.complete, false);
    assert.deepEqual(r.body.steps.filter((s) => s.required && !s.done).map((s) => s.key), ['rates', 'limits', 'methods', 'networks', 'alerts']);
  });
  await step('creating an order before the shop is ready fails clearly', async () => {
    const r = await api(ALICE, 'POST', '/api/orders', { side: 'buy', usdt: '50', method: 'x', network: 'y', address: ADDR_TRC20, idem: 'idem-early-0001' });
    assert.equal(r.status, 503);
    assert.equal(r.body.error.code, 'not_open');
  });

  console.log('\nAdmin setup: rates, accounts, networks, team');
  await step('non-admins cannot use /setrate in chat', async () => {
    await webhook({ update_id: nextUpdateId(), message: { message_id: 1, from: ALICE, chat: { id: ALICE.id, type: 'private' }, text: '/setrate 170 160' } });
    assert.equal((await api(ALICE, 'GET', '/api/bootstrap')).body.rates.ready, false);
  });
  await step('the owner adds a staff member; mistakes are explained', async () => {
    assert.equal((await api(STAFF, 'GET', '/api/admin/summary')).status, 403);
    const bad = await api(ADMIN, 'POST', '/api/admin/team', { id: 'abc' });
    assert.equal(bad.body.error.field, 'id');
    const owner = await api(ADMIN, 'POST', '/api/admin/team', { id: ADMIN.id });
    assert.match(owner.body.error.message, /already an owner/);
    const ok = await api(ADMIN, 'POST', '/api/admin/team', { id: STAFF.id, name: 'Selam' });
    assert.equal(ok.status, 201);
    assert.deepEqual(ok.body.staff.map((s) => s.id), [STAFF.id]);
    const again = await api(ADMIN, 'POST', '/api/admin/team', { id: STAFF.id });
    assert.match(again.body.error.message, /already on the team/);
    assert.equal((await api(STAFF, 'GET', '/api/bootstrap')).body.role, 'staff');
  });
  await step('staff can work the queue but cannot change the shop', async () => {
    assert.equal((await api(STAFF, 'GET', '/api/admin/summary')).status, 200);
    for (const [m, path, body] of [['PUT', '/api/admin/settings', {}], ['POST', '/api/admin/methods', {}], ['GET', '/api/admin/methods'], ['POST', '/api/admin/team', { id: 5 }], ['POST', '/api/admin/alerts/test', {}], ['GET', '/api/admin/setup']]) {
      assert.equal((await api(STAFF, m, path, body)).status, 403, `${m} ${path}`);
    }
  });
  await step('rates: sell above buy is refused, then accepted the right way round; limits are checked', async () => {
    const bad = await api(ADMIN, 'PUT', '/api/admin/settings', { buy_rate: '150', sell_rate: '170' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.field, 'sell_rate');
    assert.equal((await api(ADMIN, 'PUT', '/api/admin/settings', { buy_rate: 'abc', sell_rate: '1' })).body.error.field, 'buy_rate');
    assert.equal((await api(ADMIN, 'PUT', '/api/admin/settings', { min_usdt: '50', max_usdt: '20' })).body.error.field, 'max_usdt');
    assert.equal((await api(ADMIN, 'PUT', '/api/admin/settings', { order_ttl_min: 0 })).body.error.field, 'order_ttl_min');
    const ok = await api(ADMIN, 'PUT', '/api/admin/settings', { buy_rate: '168.50', sell_rate: '163', min_usdt: '10', max_usdt: '1000', order_ttl_min: 1 });
    assert.equal(ok.status, 200);
    assert.deepEqual([ok.body.settings.buy_rate_cents, ok.body.settings.sell_rate_cents, ok.body.settings.max_usdt_micro, ok.body.settings.order_ttl_min], [16850, 16300, 1_000_000_000, 1]);
    const r = await api(ALICE, 'GET', '/api/bootstrap');
    assert.deepEqual([r.body.rates.ready, r.body.rates.buy_cents, r.body.limits.max_usdt_micro, r.body.order_ttl_min], [true, 16850, 1_000_000_000, 1]);
  });
  await step('payment account form validates by type: phone for mobile money, account number for a bank', async () => {
    const base = { kind: 'mobile', label_en: 'Telebirr', account_name: 'Neon Store', account_number: '0911223344' };
    const cases = [
      [{ ...base, account_number: '12345' }, 'account_number'],
      [{ ...base, account_number: '0811223344' }, 'account_number'],
      [{ ...base, account_name: '' }, 'account_name'],
      [{ ...base, account_name: '12345' }, 'account_name'],
      [{ ...base, label_en: 'x' }, 'label_en'],
      [{ ...base, kind: 'cash' }, 'kind'],
      [{ ...base, accept_buy: false, pay_sell: false }, 'accept_buy'],
      [{ ...base, kind: 'bank', account_number: '1' }, 'account_number'],
    ];
    for (const [body, field] of cases) {
      const r = await api(ADMIN, 'POST', '/api/admin/methods', body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.body.error.field, field, JSON.stringify(body));
    }
    const normalised = await api(ADMIN, 'POST', '/api/admin/methods', { ...base, label_en: 'Temp', account_number: '+251 911 22 33 44' });
    assert.equal(normalised.status, 201);
    assert.equal(normalised.body.method.account_number, '0911223344'); // any common phone format is stored one way
    assert.equal((await api(ADMIN, 'DELETE', `/api/admin/methods/${normalised.body.method.code}`)).status, 200);
    assert.equal((await api(ADMIN, 'DELETE', `/api/admin/methods/${normalised.body.method.code}`)).status, 404);
  });
  await step('network form validates the address for its kind', async () => {
    const cases = [
      [{ kind: 'tron', label: 'TRON', deposit_address: '0x1234' }, 'deposit_address'],
      [{ kind: 'evm', label: 'BNB', deposit_address: ADDR_TRC20 }, 'deposit_address'],
      [{ kind: 'bybit_uid', label: 'Bybit', deposit_address: 'abc' }, 'deposit_address'],
      [{ kind: 'tron', label: 'TRON', deposit_address: '' }, 'deposit_address'], // customers send here, so an address is required
      [{ kind: 'tron', label: 'T', deposit_address: ADDR_TRC20 }, 'label'],
      [{ kind: 'solana', label: 'Solana', deposit_address: ADDR_TRC20 }, 'kind'],
    ];
    for (const [body, field] of cases) {
      const r = await api(ADMIN, 'POST', '/api/admin/networks', body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.body.error.field, field);
    }
    // send-only network (we can pay out on it, customers cannot send to it): no address needed
    const sendOnly = await api(ADMIN, 'POST', '/api/admin/networks', { kind: 'other', label: 'Polygon', accept_sell: false, send_buy: true });
    assert.equal(sendOnly.status, 201);
    assert.equal((await api(ADMIN, 'DELETE', `/api/admin/networks/${sendOnly.body.network.code}`)).status, 200);
  });
  await step('the owner creates the real accounts and networks; customers see names only, never account details', async () => {
    ids = await seedCatalog();
    const r = await api(ALICE, 'GET', '/api/bootstrap');
    assert.deepEqual(r.body.availability, { buy: true, sell: true, service: false });
    assert.deepEqual(r.body.catalog.methods.map((m) => [m.label_en, m.kind, m.buy, m.sell]), [['Telebirr', 'mobile', true, true], ['Commercial Bank of Ethiopia', 'bank', true, true]]);
    assert.equal(r.body.catalog.networks.length, 3);
    const raw = JSON.stringify(r.body);
    for (const secret of ['0911223344', '1000123456789', ADDR_TRC20, ADDR_BEP20, '12345678']) assert.ok(!raw.includes(secret), `catalog leaked ${secret}`);
  });
  await step('editing: a note appears in the order, turning an account off removes it, turning it on restores it', async () => {
    const put = await api(ADMIN, 'PUT', `/api/admin/methods/${ids.cbe}`, { active: false });
    assert.equal(put.status, 200);
    assert.deepEqual((await api(ALICE, 'GET', '/api/bootstrap')).body.catalog.methods.map((m) => m.label_en), ['Telebirr']);
    await api(ADMIN, 'PUT', `/api/admin/methods/${ids.cbe}`, { active: true, note: 'Write the order number in the reason field' });
    assert.equal((await api(ALICE, 'GET', '/api/bootstrap')).body.catalog.methods.length, 2);
  });
  await step('a pay-out-only account is offered for sells but cannot be used to buy', async () => {
    const awash = await api(ADMIN, 'POST', '/api/admin/methods', { kind: 'bank', label_en: 'Awash Bank', accept_buy: false, pay_sell: true });
    assert.equal(awash.status, 201, JSON.stringify(awash.body));
    ids.awash = awash.body.method.code;
    const m = (await api(ALICE, 'GET', '/api/bootstrap')).body.catalog.methods.find((x) => x.code === ids.awash);
    assert.deepEqual([m.buy, m.sell], [false, true]);
    const r = await api(ALICE, 'POST', '/api/orders', { side: 'buy', usdt: '20', method: ids.awash, network: ids.trc20, address: ADDR_TRC20, idem: 'idem-payout-only-1' });
    assert.equal(r.body.error.code, 'bad_method');
  });
  await step('alerts: the test message reaches the admin chat and finishes the checklist', async () => {
    const t = await api(ADMIN, 'POST', '/api/admin/alerts/test', {});
    assert.equal(t.status, 200);
    assert.equal(t.body.reached, 1);
    assert.equal(lastPayload('sendMessage', (p) => p.chat_id === ADMIN_CHAT).text.includes('Test alert'), true);
    const s = await api(ADMIN, 'GET', '/api/admin/setup');
    assert.equal(s.body.complete, true);
    assert.deepEqual(s.body.sides, { buy: true, sell: true, service: false });
  });

  console.log('\nBuy order lifecycle (proof kept in Telegram, admin acts in the app)');
  let buy;
  const buyBody = () => ({ side: 'buy', usdt: '100', method: ids.telebirr, network: ids.trc20, address: ADDR_TRC20, idem: 'idem-buy-alice-01' });
  await step('input validation: amount, range, address by network kind, method, network', async () => {
    const cases = [
      [{ ...buyBody(), usdt: 'abc', idem: 'idem-v-0000001' }, 400, 'bad_amount'],
      [{ ...buyBody(), usdt: '5', idem: 'idem-v-0000002' }, 400, 'amount_out_of_range'],
      [{ ...buyBody(), usdt: '5000', idem: 'idem-v-0000003' }, 400, 'amount_out_of_range'],
      [{ ...buyBody(), address: '0x123', idem: 'idem-v-0000004' }, 400, 'bad_address'],
      [{ ...buyBody(), address: ADDR_BEP20, idem: 'idem-v-0000008' }, 400, 'bad_address'], // a BEP20 address is not valid on TRON
      [{ ...buyBody(), method: 'PAYPAL', idem: 'idem-v-0000005' }, 400, 'bad_method'],
      [{ ...buyBody(), network: 'SOL', idem: 'idem-v-0000006' }, 400, 'bad_network'],
      [{ ...buyBody(), side: 'swap', idem: 'idem-v-0000007' }, 400, 'bad_side'],
      [{ ...buyBody(), idem: 'x' }, 400, 'bad_request'],
    ];
    for (const [body, status, code] of cases) {
      const r = await api(ALICE, 'POST', '/api/orders', body);
      assert.equal(r.status, status, JSON.stringify(body));
      assert.equal(r.body.error.code, code);
    }
  });
  await step('buy order is created with the locked rate, exact birr total and the admin-configured payee', async () => {
    const r = await api(ALICE, 'POST', '/api/orders', buyBody());
    assert.equal(r.status, 201);
    buy = r.body.order;
    assert.match(buy.id, /^NG-[2-9A-HJKMNP-Z]{6}$/);
    assert.equal(buy.status, 'awaiting_payment');
    assert.equal(buy.etb_cents, 1_685_000); // 100 USDT x 168.50 = 16,850.00 ETB
    assert.equal(buy.pay.account_number, '0911223344'); // payee details come from the admin's account list, not the client
    assert.equal(buy.usdt_address, ADDR_TRC20);
    assert.deepEqual(buy.proofs, []);
    assert.ok(buy.expires_at - r.body.server_time <= 60 && buy.expires_at > r.body.server_time);
  });
  await step('a double tap with the same key returns the same order', async () => {
    const r = await api(ALICE, 'POST', '/api/orders', buyBody());
    assert.equal(r.body.order.id, buy.id);
    const list = await api(ALICE, 'GET', '/api/orders?filter=active');
    assert.equal(list.body.orders.filter((o) => o.id === buy.id).length, 1);
  });
  await step("another customer cannot see, cancel or pay into someone else's order", async () => {
    assert.equal((await api(BOB, 'GET', `/api/orders/${buy.id}`)).status, 404);
    assert.equal((await api(BOB, 'POST', `/api/orders/${buy.id}/cancel`)).status, 404);
    assert.equal((await api(BOB, 'POST', `/api/orders/${buy.id}/evidence`, evidenceForm({ text: 'x' }))).status, 404);
    assert.equal((await api(ALICE, 'GET', '/api/orders/NOT-AN-ID')).status, 404);
  });
  await step('proof needs something to show, and only real images are accepted (the file is checked, not its label)', async () => {
    const none = await api(ALICE, 'POST', `/api/orders/${buy.id}/evidence`, evidenceForm({}));
    assert.equal(none.body.error.code, 'no_evidence');
    const text = new Blob(['not an image'], { type: 'text/plain' });
    assert.equal((await api(ALICE, 'POST', `/api/orders/${buy.id}/evidence`, evidenceForm({ photo: text }))).body.error.code, 'bad_photo');
    const lying = new Blob(['<script>alert(1)</script>'], { type: 'image/png' });
    assert.equal((await api(ALICE, 'POST', `/api/orders/${buy.id}/evidence`, evidenceForm({ photo: lying }))).body.error.code, 'bad_photo');
    const huge = new Blob([PNG_BYTES, new Uint8Array(6.5 * 1024 * 1024)], { type: 'image/png' });
    const big = await api(ALICE, 'POST', `/api/orders/${buy.id}/evidence`, evidenceForm({ photo: huge }));
    assert.equal(big.body.error.code, 'photo_too_large');
    assert.equal((await api(ALICE, 'GET', `/api/orders/${buy.id}`)).body.order.status, 'awaiting_payment', 'rejected uploads change nothing');
  });
  let proofId;
  await step('a receipt is stored privately in Telegram, the order enters the queue and the admin gets a text-only alert with a review button', async () => {
    const ok = await api(ALICE, 'POST', `/api/orders/${buy.id}/evidence`, evidenceForm({ text: 'Telebirr ref TX123 <b>', photo: png() }));
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.order.status, 'evidence_submitted');
    assert.equal(ok.body.order.evidence_count, 1);
    assert.equal(ok.body.order.proofs.length, 1);
    assert.equal(ok.body.order.proofs[0].has_image, true);
    proofId = ok.body.order.proofs[0].id;
    assert.equal(takeCalls('sendPhoto').length, 0, 'receipts are never forwarded into chat');
    const vault = lastPayload('sendDocument');
    assert.equal(vault.chat_id, String(ADMIN.id), 'receipts go to the private vault chat (the first owner)');
    assert.equal(vault.disable_notification, 'true');
    assert.equal(vault.caption, `Proof ${buy.id}`);
    const alert = lastPayload('sendMessage', (p) => p.chat_id === ADMIN_CHAT && String(p.text).includes(buy.id));
    assert.ok(alert.text.includes('Telebirr ref TX123 &lt;b&gt;'), 'customer text is escaped');
    assert.ok(!alert.text.includes('late proof'));
    const rows = alert.reply_markup.inline_keyboard;
    assert.equal(rows[0][0].url, `https://t.me/neon_test_bot?startapp=a_${buy.id}`); // group chats open the app through a t.me link
    assert.deepEqual(rows[1].map((b) => b.callback_data), [`o:${buy.id}:c`, `o:${buy.id}:r`]);
  });
  await step('the proof image comes back byte for byte, only to its owner and the team', async () => {
    const mine = await api(ALICE, 'GET', `/api/orders/${buy.id}/proofs/${proofId}`, undefined, { raw: true });
    assert.equal(mine.status, 200);
    assert.equal(mine.headers.get('content-type'), 'image/png');
    assert.match(mine.headers.get('cache-control'), /no-store/);
    assert.equal(mine.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(new Uint8Array(await mine.arrayBuffer()).slice(0, PNG_BYTES.length), PNG_BYTES);
    assert.equal((await api(ADMIN, 'GET', `/api/orders/${buy.id}/proofs/${proofId}`, undefined, { raw: true })).status, 200);
    assert.equal((await api(STAFF, 'GET', `/api/orders/${buy.id}/proofs/${proofId}`, undefined, { raw: true })).status, 200);
    assert.equal((await api(BOB, 'GET', `/api/orders/${buy.id}/proofs/${proofId}`, undefined, { raw: true })).status, 404);
    assert.equal((await api(null, 'GET', `/api/orders/${buy.id}/proofs/${proofId}`, undefined, { raw: true })).status, 401);
    assert.equal((await api(ALICE, 'GET', `/api/orders/${buy.id}/proofs/99999`, undefined, { raw: true })).status, 404);
  });
  await step('after proof the customer can no longer cancel', async () => {
    const r = await api(ALICE, 'POST', `/api/orders/${buy.id}/cancel`);
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'not_cancellable');
  });
  await step('the queue and the order page give the admin everything needed to decide', async () => {
    const sum = await api(ADMIN, 'GET', '/api/admin/summary');
    assert.equal(sum.body.counts.review, 1);
    const q = await api(STAFF, 'GET', '/api/admin/orders?filter=review');
    assert.deepEqual(q.body.orders.map((o) => o.id), [buy.id]);
    assert.equal(q.body.orders[0].customer.first_name, 'Alice');
    const d = await api(STAFF, 'GET', `/api/admin/orders/${buy.id}`);
    assert.equal(d.status, 200);
    assert.equal(d.body.order.pay.account_number, '0911223344');
    assert.equal(d.body.order.usdt_address, ADDR_TRC20);
    assert.equal(d.body.order.proofs[0].text, 'Telebirr ref TX123 <b>');
    assert.deepEqual(d.body.customer, { id: ALICE.id, first_name: 'Alice', username: 'alice', blocked: false, member_since: d.body.customer.member_since, total_orders: 1, completed_orders: 0 });
    assert.deepEqual(d.body.warnings, []);
    assert.equal((await api(ALICE, 'GET', `/api/admin/orders/${buy.id}`)).status, 403);
  });
  await step('the same screenshot and transaction number on a second order raise a warning', async () => {
    const o = await api(BOB, 'POST', '/api/orders', { ...buyBody(), usdt: '15', address: ADDR_TRC20, idem: 'idem-bob-dup-0001' });
    const dup = o.body.order.id;
    const sent = await api(BOB, 'POST', `/api/orders/${dup}/evidence`, evidenceForm({ text: 'TELEBIRR REF tx123 <b>', photo: png() }));
    assert.equal(sent.status, 200);
    const d = await api(ADMIN, 'GET', `/api/admin/orders/${dup}`);
    assert.deepEqual(d.body.warnings.map((w) => `${w.kind}:${w.order_id}`).sort(), [`image:${buy.id}`, `text:${buy.id}`]);
    assert.match(lastPayload('sendMessage', (p) => String(p.text).includes(dup)).text, /matches another order/);
    // a different file of the same kind is not flagged
    const p2 = await api(BOB, 'POST', `/api/orders/${dup}/evidence`, evidenceForm({ photo: png(7) }));
    assert.equal(p2.body.order.proofs.length, 2);
    const reject = await api(ADMIN, 'POST', `/api/admin/orders/${dup}/reject`, { reason: 'other' });
    assert.equal(reject.body.order.status, 'rejected');
    assert.equal(reject.body.order.reject_reason, 'other');
  });
  const card = () => ({ chat: { id: ADMIN_CHAT }, message_id: 2000, text: 'card' });
  await step('non-admins cannot press admin buttons', async () => {
    await press(ALICE, `o:${buy.id}:c`, card());
    assert.match(lastCall('answerCallbackQuery').payload.text, /Admins only/);
    assert.equal((await api(ALICE, 'GET', `/api/orders/${buy.id}`)).body.order.status, 'evidence_submitted');
  });
  await step('admin confirms payment in the app: status moves, every alert is refreshed, the customer is told', async () => {
    const edits = takeCalls('editMessageText').length;
    const r = await api(STAFF, 'POST', `/api/admin/orders/${buy.id}/confirm`, {});
    assert.equal(r.status, 200);
    assert.equal(r.body.order.status, 'processing');
    assert.ok(takeCalls('editMessageText').length > edits, 'the alert in chat was edited');
    assert.ok(lastPayload('editMessageText').text.includes('Processing'));
    const dm = dmTo(ALICE.id);
    assert.match(dm.text, new RegExp(`Payment confirmed for ${buy.id}`));
    assert.ok(dm.reply_markup.inline_keyboard[0][0].web_app.url.endsWith(`/?o=${buy.id}`));
  });
  await step('pressing confirm again does nothing the second time', async () => {
    const before = takeCalls('sendMessage', (p) => p.chat_id === ALICE.id).length;
    const r = await api(ADMIN, 'POST', `/api/admin/orders/${buy.id}/confirm`, {});
    assert.equal(r.status, 409);
    assert.equal(r.body.applied, false);
    assert.equal(takeCalls('sendMessage', (p) => p.chat_id === ALICE.id).length, before);
  });
  await step('releasing needs a reference, then completes the order and sends it to the customer', async () => {
    const none = await api(ADMIN, 'POST', `/api/admin/orders/${buy.id}/release`, {});
    assert.equal(none.status, 400);
    assert.equal(none.body.error.field, 'reference');
    assert.equal((await api(ADMIN, 'POST', `/api/admin/orders/${buy.id}/release`, { reference: 'ab' })).status, 400);
    const r = await api(ADMIN, 'POST', `/api/admin/orders/${buy.id}/release`, { reference: 'TXID-ABC-999' });
    assert.equal(r.status, 200);
    assert.equal(r.body.order.status, 'completed');
    assert.equal(r.body.order.completion_ref, 'TXID-ABC-999');
    const dm = dmTo(ALICE.id);
    assert.match(dm.text, /is complete/);
    assert.match(dm.text, /Reference: TXID-ABC-999/);
  });
  await step('the customer history is complete and hides admin ids; the admin history names who acted', async () => {
    const mine = await api(ALICE, 'GET', `/api/orders/${buy.id}`);
    assert.equal(mine.body.order.status, 'completed');
    const trail = mine.body.order.events.filter((e) => e.from !== e.to).map((e) => `${e.from ?? 'new'}>${e.to}:${e.by}`);
    assert.deepEqual(trail, ['new>awaiting_payment:user', 'awaiting_payment>evidence_submitted:user', 'evidence_submitted>processing:admin', 'processing>completed:admin']);
    assert.ok(!JSON.stringify(mine.body.order).includes(String(ADMIN.id)));
    assert.ok(!JSON.stringify(mine.body.order).includes(String(STAFF.id)));
    const theirs = await api(ADMIN, 'GET', `/api/admin/orders/${buy.id}`);
    const acted = theirs.body.order.events.filter((e) => e.by === 'admin');
    assert.deepEqual(acted.map((e) => [e.by_id, e.by_name]), [[STAFF.id, 'Selam'], [ADMIN.id, 'Admin']]);
  });
  await step('a completed order cannot be reopened or rejected', async () => {
    const r = await api(ADMIN, 'POST', `/api/admin/orders/${buy.id}/reject`, { reason: 'other' });
    assert.equal(r.status, 409);
    await press(ADMIN, `o:${buy.id}:r`, card());
    assert.match(lastCall('answerCallbackQuery').payload.text, /Not applied/);
    assert.equal((await api(ALICE, 'GET', `/api/orders/${buy.id}`)).body.order.status, 'completed');
  });
  await step('chat buttons still work for quick actions, and a reply sends a reference', async () => {
    const o = await api(ALICE, 'POST', '/api/orders', { ...buyBody(), usdt: '12', idem: 'idem-chat-buttons-1' });
    const id = o.body.order.id;
    await api(ALICE, 'POST', `/api/orders/${id}/evidence`, evidenceForm({ text: 'paid' }));
    await press(STAFF, `o:${id}:c`, card());
    assert.equal((await api(ALICE, 'GET', `/api/orders/${id}`)).body.order.status, 'processing');
    await adminSays('TXID-REPLY-1', { reply_to_message: { message_id: 2000, text: `🟢 BUY · ${id}\nStatus: Processing` } });
    assert.match(dmTo(ALICE.id).text, /TXID-REPLY-1/);
    await press(ADMIN, `o:${id}:d`, card());
    const done = await api(ALICE, 'GET', `/api/orders/${id}`);
    assert.equal(done.body.order.status, 'completed');
    assert.equal(done.body.order.completion_ref, 'TXID-REPLY-1');
  });

  console.log('\nSell order lifecycle');
  let sell;
  await step('sell order validates the payout account by method type and rounds birr down', async () => {
    const base = { side: 'sell', usdt: '10.333333', network: ids.trc20 };
    const noName = await api(BOB, 'POST', '/api/orders', { ...base, method: ids.cbe, payout_name: '', payout_account: '1000111122223', idem: 'idem-sell-bob-00' });
    assert.equal(noName.body.error.code, 'bad_name');
    const noAcct = await api(BOB, 'POST', '/api/orders', { ...base, method: ids.cbe, payout_name: 'Bob Tesfaye', payout_account: '1', idem: 'idem-sell-bob-01' });
    assert.equal(noAcct.body.error.code, 'bad_account');
    const notPhone = await api(BOB, 'POST', '/api/orders', { ...base, method: ids.telebirr, payout_name: 'Bob Tesfaye', payout_account: '1000111122223', idem: 'idem-sell-bob-03' });
    assert.equal(notPhone.body.error.code, 'bad_account', 'a bank number is not a Telebirr phone number');
    const phone = await api(BOB, 'POST', '/api/orders', { ...base, usdt: '10', method: ids.telebirr, payout_name: 'Bob Tesfaye', payout_account: '+251 91 122 3355', idem: 'idem-sell-bob-04' });
    assert.equal(phone.status, 201);
    assert.equal(phone.body.order.payout_account, '0911223355'); // normalised
    await api(BOB, 'POST', `/api/orders/${phone.body.order.id}/cancel`);
    const r = await api(BOB, 'POST', '/api/orders', { ...base, method: ids.cbe, payout_name: 'Bob Tesfaye', payout_account: '1000111122223', idem: 'idem-sell-bob-02' });
    assert.equal(r.status, 201);
    sell = r.body.order;
    assert.equal(sell.etb_cents, 168_433); // 10.333333 x 163.00 = 1684.33279 -> 1684.33 (down)
    assert.equal(sell.pay.address, ADDR_TRC20); // customer sends USDT to our configured address
    assert.equal(sell.pay.net_kind, 'tron');
    assert.equal(sell.payout_name, 'Bob Tesfaye');
  });
  await step('a sell proof can be a transaction hash alone; the alert tells the admin whom to pay', async () => {
    const r = await api(BOB, 'POST', `/api/orders/${sell.id}/evidence`, evidenceForm({ text: 'tx hash 0xabc123' }));
    assert.equal(r.body.order.status, 'evidence_submitted');
    assert.equal(r.body.order.proofs[0].has_image, false);
    const msg = lastPayload('sendMessage', (p) => String(p.text || '').includes(sell.id) && p.chat_id === ADMIN_CHAT);
    assert.ok(msg.text.includes('tx hash 0xabc123'));
    assert.ok(msg.text.includes('Pay birr to'));
  });
  await step('a second proof is accepted and logged', async () => {
    const r = await api(BOB, 'POST', `/api/orders/${sell.id}/evidence`, evidenceForm({ photo: png(3) }));
    assert.equal(r.body.order.evidence_count, 2);
    assert.equal(r.body.order.status, 'evidence_submitted');
    assert.ok(r.body.order.events.some((e) => e.note === 'additional evidence'));
  });
  await step('admin rejects with a reason: the customer is told in English, the reason is recorded', async () => {
    assert.equal((await api(ADMIN, 'POST', `/api/admin/orders/${sell.id}/reject`, { reason: 'because' })).body.error.field, 'reason');
    const r = await api(ADMIN, 'POST', `/api/admin/orders/${sell.id}/reject`, { reason: 'amount_mismatch' });
    assert.equal(r.body.order.status, 'rejected');
    const mine = await api(BOB, 'GET', `/api/orders/${sell.id}`);
    assert.equal(mine.body.order.reject_reason, 'amount_mismatch');
    assert.match(dmTo(BOB.id).text, /was not accepted: Amount does not match/);
  });

  console.log('\nCancel, limits, expiry, late proof, pause, block');
  await step('customer can cancel before sending proof', async () => {
    const o = await api(ALICE, 'POST', '/api/orders', { ...buyBody(), usdt: '20', idem: 'idem-cancel-0001' });
    const c = await api(ALICE, 'POST', `/api/orders/${o.body.order.id}/cancel`);
    assert.equal(c.body.order.status, 'cancelled');
    assert.equal((await api(ALICE, 'POST', `/api/orders/${o.body.order.id}/cancel`)).status, 409);
  });
  let willExpire;
  await step('open-order limit is enforced (3 at a time)', async () => {
    const out = [];
    for (let i = 0; i < 3; i++) {
      const r = await api(ALICE, 'POST', '/api/orders', { ...buyBody(), usdt: String(30 + i), idem: `idem-limit-000${i}` });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      out.push(r.body.order.id);
    }
    willExpire = out;
    const fourth = await api(ALICE, 'POST', '/api/orders', { ...buyBody(), usdt: '40', idem: 'idem-limit-0009' });
    assert.equal(fourth.status, 429);
    assert.equal(fourth.body.error.code, 'too_many_open');
  });
  await step('the 5-minute job expires unpaid orders and notifies the customer', async () => {
    const res = await scheduledAt(Date.now() + 3 * 3600 * 1000);
    assert.equal(res.status, 200);
    for (const id of willExpire) {
      const r = await api(ALICE, 'GET', `/api/orders/${id}`);
      assert.equal(r.body.order.status, 'expired');
      assert.deepEqual(r.body.order.events.map((e) => e.by), ['user', 'system']);
    }
    assert.match(dmTo(ALICE.id).text, /expired/);
    assert.equal((await api(ALICE, 'GET', `/api/orders/${buy.id}`)).body.order.status, 'completed');
  });
  await step('paying a little late still counts: the receipt is accepted, flagged "late" and shown to the admin', async () => {
    const id = willExpire[0];
    const r = await api(ALICE, 'POST', `/api/orders/${id}/evidence`, evidenceForm({ text: 'paid at minute 31', photo: png(11) }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.order.status, 'evidence_submitted');
    assert.equal(r.body.order.late, true);
    assert.deepEqual(r.body.order.events.filter((e) => e.from !== e.to).map((e) => `${e.from}>${e.to}:${e.by}`), ['null>awaiting_payment:user', 'awaiting_payment>expired:system', 'expired>evidence_submitted:user']);
    assert.match(lastPayload('sendMessage', (p) => p.chat_id === ADMIN_CHAT && String(p.text).includes(id)).text, /late proof/);
    const q = await api(ADMIN, 'GET', '/api/admin/orders?filter=review');
    assert.ok(q.body.orders.some((o) => o.id === id && o.late));
    const rej = await api(ADMIN, 'POST', `/api/admin/orders/${id}/reject`, { reason: 'not_received' });
    assert.equal(rej.body.order.status, 'rejected');
  });
  await step('an expired order with no proof can still be rejected by the admin (and then it is done)', async () => {
    const id = willExpire[1];
    const r = await api(ADMIN, 'POST', `/api/admin/orders/${id}/reject`, {});
    assert.equal(r.body.order.status, 'rejected');
    assert.equal((await api(ALICE, 'POST', `/api/orders/${id}/evidence`, evidenceForm({ text: 'x' }))).status, 409);
  });
  await step('proof that arrives after the window but before the job runs is accepted as late too', async () => {
    const o = await api(ALICE, 'POST', '/api/orders', { ...buyBody(), usdt: '25', idem: 'idem-stale-00001' });
    const created = o.body.order;
    await sleep(Math.max(0, (created.expires_at - Math.floor(Date.now() / 1000)) * 1000 + 1500));
    const r = await api(ALICE, 'POST', `/api/orders/${created.id}/evidence`, evidenceForm({ text: 'late but real' }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.order.late, true);
    assert.deepEqual(r.body.order.events.filter((e) => e.from !== e.to).map((e) => e.to), ['awaiting_payment', 'expired', 'evidence_submitted']);
    await api(ADMIN, 'POST', `/api/admin/orders/${created.id}/reject`, { reason: 'other' });
  });
  await step('order lists filter active and done and paginate', async () => {
    assert.equal((await api(ALICE, 'GET', '/api/orders?filter=active')).body.orders.length, 0);
    const done = await api(ALICE, 'GET', '/api/orders?filter=done');
    assert.ok(done.body.orders.length >= 6);
    assert.ok(done.body.orders.every((o) => ['completed', 'rejected', 'cancelled', 'expired'].includes(o.status)));
    assert.equal((await api(BOB, 'GET', '/api/orders?filter=done')).body.orders.some((o) => o.id === sell.id), true);
    const adminDone = await api(ADMIN, 'GET', '/api/admin/orders?filter=done');
    assert.ok(adminDone.body.orders.length >= 6);
    assert.ok(adminDone.body.orders.every((o) => o.customer && o.method));
  });
  await step('pause blocks new orders and resume restores them (from the app)', async () => {
    await api(ADMIN, 'PUT', '/api/admin/settings', { paused: true });
    const blocked = await api(BOB, 'POST', '/api/orders', { ...buyBody(), usdt: '20', idem: 'idem-paused-0001' });
    assert.equal(blocked.status, 503);
    assert.equal(blocked.body.error.code, 'paused');
    await api(ADMIN, 'PUT', '/api/admin/settings', { paused: false });
    assert.equal((await api(BOB, 'POST', '/api/orders', { ...buyBody(), usdt: '20', idem: 'idem-paused-0002' })).status, 201);
  });
  await step('a blocked customer can look around but not order; unblocking restores it', async () => {
    assert.equal((await api(STAFF, 'POST', `/api/admin/customers/${BOB.id}/block`, { blocked: true })).status, 403, 'support staff cannot block customers');
    const r = await api(ADMIN, 'POST', `/api/admin/customers/${BOB.id}/block`, { blocked: true });
    assert.equal(r.status, 200);
    assert.equal((await api(BOB, 'GET', '/api/bootstrap')).body.user.blocked, true);
    const o = await api(BOB, 'POST', '/api/orders', { ...buyBody(), usdt: '21', idem: 'idem-blocked-bob-1' });
    assert.equal(o.status, 403);
    assert.equal(o.body.error.code, 'blocked');
    assert.equal((await api(BOB, 'GET', '/api/orders')).status, 200);
    await api(ADMIN, 'POST', `/api/admin/customers/${BOB.id}/block`, { blocked: false });
    assert.equal((await api(BOB, 'POST', '/api/orders', { ...buyBody(), usdt: '21', idem: 'idem-blocked-bob-1' })).status, 201);
    assert.equal((await api(ALICE, 'POST', `/api/admin/customers/${BOB.id}/block`, { blocked: true })).status, 403);
  });
  await step('a customer who blocked the bot does not break the flow', async () => {
    const blocked = { id: 424242, first_name: 'Blocked', language_code: 'en' };
    const o = await api(blocked, 'POST', '/api/orders', { ...buyBody(), usdt: '20', idem: 'idem-blocked-0001' });
    assert.equal(o.status, 201);
    await api(blocked, 'POST', `/api/orders/${o.body.order.id}/evidence`, evidenceForm({ text: 'paid' }));
    const r = await api(ADMIN, 'POST', `/api/admin/orders/${o.body.order.id}/confirm`, {});
    assert.equal(r.body.order.status, 'processing');
  });

  console.log('\nAccount edits, in-use protection, audit');
  await step('an account that orders used cannot be deleted, only turned off; edits are counted against open orders', async () => {
    const del = await api(ADMIN, 'DELETE', `/api/admin/methods/${ids.telebirr}`);
    assert.equal(del.status, 409);
    assert.equal(del.body.error.code, 'in_use');
    const list = await api(ADMIN, 'GET', '/api/admin/methods');
    const tele = list.body.methods.find((m) => m.code === ids.telebirr);
    assert.ok(tele.open_orders >= 1, 'the open-order count warns the admin before changing account details');
    assert.equal((await api(ADMIN, 'DELETE', `/api/admin/networks/${ids.trc20}`)).status, 409);
  });
  await step('open orders keep the account details they were created with', async () => {
    const o = await api(ALICE, 'POST', '/api/orders', { ...buyBody(), usdt: '22', idem: 'idem-snapshot-0001' });
    await api(ADMIN, 'PUT', `/api/admin/methods/${ids.telebirr}`, { account_number: '0922334455' });
    const again = await api(ALICE, 'GET', `/api/orders/${o.body.order.id}`);
    assert.equal(again.body.order.pay.account_number, '0911223344');
    const fresh = await api(ALICE, 'POST', '/api/orders', { ...buyBody(), usdt: '23', idem: 'idem-snapshot-0002' });
    assert.equal(fresh.body.order.pay.account_number, '0922334455');
    await api(ADMIN, 'PUT', `/api/admin/methods/${ids.telebirr}`, { account_number: '0911223344' });
    await api(ALICE, 'POST', `/api/orders/${o.body.order.id}/cancel`);
    await api(ALICE, 'POST', `/api/orders/${fresh.body.order.id}/cancel`);
  });

  console.log('\nAlerts that fail are retried');
  await step('when the alert cannot be delivered the customer is not blocked, and the cron job sends it later', async () => {
    // Fake Telegram answers 403 for chat 424242: send alerts there, as if the group had been deleted.
    await webhook({ update_id: nextUpdateId(), message: { message_id: 9, from: ADMIN, chat: { id: 424242, type: 'supergroup' }, text: '/alerts' } });
    const o = await api(ALICE, 'POST', '/api/orders', { ...buyBody(), usdt: '24', idem: 'idem-retry-alert-1' });
    const id = o.body.order.id;
    const sent = await api(ALICE, 'POST', `/api/orders/${id}/evidence`, evidenceForm({ text: 'paid', photo: png(21) }));
    assert.equal(sent.status, 200, 'the proof is saved even though no admin could be told');
    assert.equal(sent.body.order.status, 'evidence_submitted');
    assert.equal((await api(ADMIN, 'GET', '/api/admin/summary')).body.counts.review >= 1, true, 'it is in the queue anyway');
    // The owner moves alerts to private messages; the next job run delivers the missed alert to each admin.
    await webhook({ update_id: nextUpdateId(), message: { message_id: 10, from: ADMIN, chat: { id: ADMIN.id, type: 'private' }, text: '/alerts' } });
    assert.equal((await api(ADMIN, 'GET', '/api/admin/alerts')).body.mode, 'dm');
    await scheduledAt(Date.now() + 60_000);
    for (const admin of [ADMIN, STAFF]) {
      const a = lastPayload('sendMessage', (p) => p.chat_id === admin.id && String(p.text).includes(id));
      assert.ok(a, `alert reached ${admin.first_name}`);
      assert.ok(a.reply_markup.inline_keyboard[0][0].web_app.url.endsWith(`/?a=${id}`), 'private chats open the app directly');
    }
    await api(ADMIN, 'POST', `/api/admin/orders/${id}/reject`, { reason: 'other' });
  });
  await step('the owner can read the audit trail of what was changed, and staff cannot', async () => {
    const r = await api(ADMIN, 'GET', '/api/admin/audit');
    assert.equal(r.status, 200);
    const actions = new Set(r.body.entries.map((e) => e.action));
    for (const a of ['method.create', 'method.update', 'network.create', 'settings.update', 'team.add', 'user.block', 'alerts.test', 'alerts.destination']) assert.ok(actions.has(a), `audit has ${a}`);
    const edit = r.body.entries.find((e) => e.action === 'method.update' && e.detail.includes('account_number'));
    assert.ok(edit, 'a change to an account number is recorded by field name, not by value');
    assert.ok(!JSON.stringify(r.body.entries).includes('0922334455'), 'account numbers are never copied into the log');
    assert.equal((await api(STAFF, 'GET', '/api/admin/audit')).status, 403);
  });

  console.log('\nTeam and retention');
  await step('removing a staff member takes the access away at once', async () => {
    const r = await api(ADMIN, 'DELETE', `/api/admin/team/${STAFF.id}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.staff, []);
    assert.equal((await api(STAFF, 'GET', '/api/admin/summary')).status, 403);
    assert.equal((await api(ADMIN, 'DELETE', `/api/admin/team/${STAFF.id}`)).status, 404);
  });
  await step('old proofs of finished orders are deleted after the retention period; the order itself stays', async () => {
    const before = await api(ALICE, 'GET', `/api/orders/${buy.id}/proofs/${proofId}`, undefined, { raw: true });
    assert.equal(before.status, 200);
    assert.equal((await api(ADMIN, 'PUT', '/api/admin/settings', { proof_retention_days: 1 })).body.settings.proof_retention_days, 1);
    await scheduledAt(Date.now() + 3 * 86400 * 1000);
    const gone = await api(ALICE, 'GET', `/api/orders/${buy.id}/proofs/${proofId}`, undefined, { raw: true });
    assert.equal(gone.status, 404);
    const order = await api(ALICE, 'GET', `/api/orders/${buy.id}`);
    assert.equal(order.body.order.status, 'completed');
    assert.equal(order.body.order.proofs[0].removed, true);
    assert.equal(order.body.order.proofs[0].has_image, false);
  });
  console.log('\nStock, unlock rules, services, support tickets, policies');
  const sBuy = (n, usdt, extra = {}) => ({ side: 'buy', usdt, method: ids.telebirr, network: ids.trc20, address: ADDR_TRC20, idem: `idem-stock-${n}-000`, ...extra });
  await step('stock off: nothing is tracked and bootstrap reveals nothing', async () => {
    // clear leftovers of earlier tests so reserved amounts start at zero
    const open = await api(ADMIN, 'GET', '/api/admin/orders?filter=open');
    for (const o of open.body.orders) await api(ADMIN, 'POST', `/api/admin/orders/${o.id}/reject`, { reason: 'other' });
    assert.equal((await api(ADMIN, 'GET', '/api/admin/orders?filter=open')).body.orders.length, 0);
    const r = await api(ALICE, 'GET', '/api/bootstrap');
    assert.equal(r.body.stock, null);
    assert.equal((await api(ADMIN, 'PUT', '/api/admin/settings', { stock_usdt: 'abc' })).body.error.field, 'stock_usdt');
  });
  await step('stock on and shown: the amount is visible; open buys reserve it; too much is refused with the number', async () => {
    assert.equal((await api(ADMIN, 'PUT', '/api/admin/settings', { stock_usdt: '100', stock_show: true })).status, 200);
    assert.equal((await api(ALICE, 'GET', '/api/bootstrap')).body.stock.available_usdt_micro, 100_000_000);
    const a = await api(ALICE, 'POST', '/api/orders', sBuy(1, '60'));
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.equal((await api(BOB, 'GET', '/api/bootstrap')).body.stock.available_usdt_micro, 40_000_000);
    const tooMuch = await api(BOB, 'POST', '/api/orders', sBuy(2, '50'));
    assert.equal(tooMuch.status, 409);
    assert.equal(tooMuch.body.error.code, 'insufficient_stock');
    assert.equal(tooMuch.body.error.available_usdt_micro, 40_000_000);
    ids.stockOrder = a.body.order.id;
  });
  await step('stock hidden: nothing about the amount leaks, in bootstrap or in the error', async () => {
    await api(ADMIN, 'PUT', '/api/admin/settings', { stock_show: false });
    const boot = await api(BOB, 'GET', '/api/bootstrap');
    assert.equal(boot.body.stock, null);
    const tooMuch = await api(BOB, 'POST', '/api/orders', sBuy(3, '50'));
    assert.equal(tooMuch.status, 409);
    assert.equal(tooMuch.body.error.code, 'insufficient_stock');
    assert.ok(!JSON.stringify(tooMuch.body).match(/40|available|100/), JSON.stringify(tooMuch.body));
  });
  await step('cancelling frees the reserved USDT; completing a buy lowers the stock; a sell adds to it', async () => {
    await api(ALICE, 'POST', `/api/orders/${ids.stockOrder}/cancel`);
    assert.equal((await api(ADMIN, 'GET', '/api/admin/settings')).body.settings.stock_usdt_micro, 100_000_000);
    const o = await api(ALICE, 'POST', '/api/orders', sBuy(4, '30'));
    const id = o.body.order.id;
    await api(ALICE, 'POST', `/api/orders/${id}/evidence`, evidenceForm({ text: 'TXN-STOCK-1' }));
    assert.equal((await api(ADMIN, 'POST', `/api/admin/orders/${id}/confirm`, {})).status, 200);
    assert.equal((await api(ADMIN, 'POST', `/api/admin/orders/${id}/release`, { reference: 'hash-abc' })).status, 200);
    assert.equal((await api(ADMIN, 'GET', '/api/admin/settings')).body.settings.stock_usdt_micro, 70_000_000);
    const sell = await api(BOB, 'POST', '/api/orders', { side: 'sell', usdt: '20', method: ids.telebirr, network: ids.trc20, payout_name: 'Bob Tesfaye', payout_account: '0912345678', idem: 'idem-stock-sell-01' });
    assert.equal(sell.status, 201, JSON.stringify(sell.body));
    await api(BOB, 'POST', `/api/orders/${sell.body.order.id}/evidence`, evidenceForm({ text: 'TXN-SELL-STOCK' }));
    await api(ADMIN, 'POST', `/api/admin/orders/${sell.body.order.id}/confirm`, {});
    await api(ADMIN, 'POST', `/api/admin/orders/${sell.body.order.id}/release`, { reference: 'bank-ref-1' });
    assert.equal((await api(ADMIN, 'GET', '/api/admin/settings')).body.settings.stock_usdt_micro, 90_000_000);
  });
  await step('two buyers racing for the last USDT cannot both win', async () => {
    await api(ADMIN, 'PUT', '/api/admin/settings', { stock_usdt: '50', stock_show: true });
    const [x, y] = await Promise.all([
      api(ALICE, 'POST', '/api/orders', sBuy(5, '40', { idem: 'idem-race-aaaa-1' })),
      api(BOB, 'POST', '/api/orders', sBuy(6, '40', { idem: 'idem-race-bbbb-2' })),
    ]);
    assert.deepEqual([x.status, y.status].sort(), [201, 409]);
    for (const [u, r] of [[ALICE, x], [BOB, y]]) if (r.status === 201) await api(u, 'POST', `/api/orders/${r.body.order.id}/cancel`);
    await api(ADMIN, 'PUT', '/api/admin/settings', { stock_usdt: '' });
    assert.equal((await api(ALICE, 'GET', '/api/bootstrap')).body.stock, null);
  });

  await step('unlock rule: a method with an unlock rule is refused until the customer has the history', async () => {
    const m = await api(ADMIN, 'POST', '/api/admin/methods', { kind: 'bank', label_en: 'Locked Bank', account_name: 'Neon Store', account_number: '2000123456', unlock_orders: 2, unlock_need_ratio: true });
    assert.equal(m.status, 201, JSON.stringify(m.body));
    ids.locked = m.body.method.code;
    const boot = await api(BOB, 'GET', '/api/bootstrap');
    assert.equal(boot.body.catalog.methods.find((x) => x.code === ids.locked).unlock.orders, 2);
    const r = await api(BOB, 'POST', '/api/orders', sBuy(7, '10', { method: ids.locked, idem: 'idem-lock-0001' }));
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'method_locked');
    assert.equal(r.body.error.have.orders, boot.body.stats.completed);
    assert.equal((await api(ADMIN, 'PUT', `/api/admin/methods/${ids.locked}`, { unlock_orders: 'x' })).body.error.field, 'unlock_orders');
    await api(ADMIN, 'PUT', `/api/admin/methods/${ids.locked}`, { unlock_orders: 0, unlock_need_ratio: false });
    const ok = await api(BOB, 'POST', '/api/orders', sBuy(8, '10', { method: ids.locked, idem: 'idem-lock-0002' }));
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    await api(BOB, 'POST', `/api/orders/${ok.body.order.id}/cancel`);
  });

  let svc;
  await step('services: the owner builds the price list with validation; customers see prices but nothing secret', async () => {
    const bad = [
      [{ platform: 'myspace', name_en: 'X members', price: '85', min_qty: 100, max_qty: 1000 }, 'platform'],
      [{ platform: 'telegram', name_en: 'x', price: '85', min_qty: 100, max_qty: 1000 }, 'name_en'],
      [{ platform: 'telegram', name_en: 'Telegram members', price: 'free', min_qty: 100, max_qty: 1000 }, 'price'],
      [{ platform: 'telegram', name_en: 'Telegram members', price: '85', min_qty: 500, max_qty: 100 }, 'max_qty'],
    ];
    for (const [b, field] of bad) {
      const r = await api(ADMIN, 'POST', '/api/admin/services', b);
      assert.equal(r.status, 400);
      assert.equal(r.body.error.field, field);
    }
    assert.equal((await api(STAFF, 'POST', '/api/admin/services', {})).status, 403);
    const ok = await api(ADMIN, 'POST', '/api/admin/services', { platform: 'telegram', name_en: 'Telegram members', price: '85.50', min_qty: 100, max_qty: 10000, eta_text: 'Starts within 24 hours', warranty_days: 30 });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    svc = ok.body.service.code;
    const boot = await api(ALICE, 'GET', '/api/bootstrap');
    assert.equal(boot.body.availability.service, true);
    assert.equal(boot.body.catalog.services[0].price_cents_per_1000, 8550);
  });
  await step('a service order: quantity range, link check, total rounded up, payment details only inside the order', async () => {
    const base = { side: 'service', service: svc, quantity: 1500, target: '@neonghost', method: ids.telebirr, idem: 'idem-svc-00001' };
    assert.equal((await api(ALICE, 'POST', '/api/orders', { ...base, quantity: 50 })).body.error.code, 'bad_quantity');
    assert.equal((await api(ALICE, 'POST', '/api/orders', { ...base, target: 'https://evil.example/x' })).body.error.code, 'bad_target');
    assert.equal((await api(ALICE, 'POST', '/api/orders', { ...base, method: 'nope' })).body.error.code, 'bad_method');
    const r = await api(ALICE, 'POST', '/api/orders', base);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const o = r.body.order;
    assert.equal(o.side, 'service');
    assert.equal(o.etb_cents, Math.ceil((1500 * 8550) / 1000)); // 12825
    assert.equal(o.target, 'https://t.me/neonghost');
    assert.equal(o.pay.account_number, '0911223344');
    assert.equal(o.pay.service.name_en, 'Telegram members');
    assert.equal(o.usdt_micro, null);
    const again = await api(ALICE, 'POST', '/api/orders', base); // same key: same order
    assert.equal(again.body.order.id, o.id);
    ids.svcOrder = o.id;
  });
  await step('a service order is reviewed and delivered; the delivery reference is optional', async () => {
    const id = ids.svcOrder;
    await api(ALICE, 'POST', `/api/orders/${id}/evidence`, evidenceForm({ text: 'TXN-SVC-1', photo: png(7) }));
    const card = lastPayload('sendMessage', (p) => /SERVICE/.test(p.text || '') && p.text.includes(id));
    assert.ok(card, 'service alert sent');
    assert.match(card.text, /Telegram members/);
    assert.match(card.text, /1,500/);
    assert.equal((await api(ADMIN, 'POST', `/api/admin/orders/${id}/confirm`, {})).status, 200);
    const done = await api(ADMIN, 'POST', `/api/admin/orders/${id}/release`, {});
    assert.equal(done.status, 200, JSON.stringify(done.body));
    const note = lastPayload('sendMessage', (p) => p.chat_id === ALICE.id && p.text.includes(id) && /delivered/.test(p.text));
    assert.ok(note, 'customer told the service was delivered');
    assert.equal((await api(ALICE, 'GET', `/api/orders/${id}`)).body.order.status, 'completed');
    const usdtOrder = await api(ALICE, 'POST', '/api/orders', sBuy(9, '10', { idem: 'idem-ref-req-001' }));
    await api(ALICE, 'POST', `/api/orders/${usdtOrder.body.order.id}/evidence`, evidenceForm({ text: 'TXN-REFREQ' }));
    await api(ADMIN, 'POST', `/api/admin/orders/${usdtOrder.body.order.id}/confirm`, {});
    assert.equal((await api(ADMIN, 'POST', `/api/admin/orders/${usdtOrder.body.order.id}/release`, {})).body.error.field, 'reference'); // USDT still needs a hash
    await api(ADMIN, 'POST', `/api/admin/orders/${usdtOrder.body.order.id}/reject`, { reason: 'other' });
  });
  await step('services can be switched off and are protected once used', async () => {
    assert.equal((await api(ADMIN, 'DELETE', `/api/admin/services/${svc}`)).status, 409);
    await api(ADMIN, 'PUT', `/api/admin/services/${svc}`, { active: false });
    assert.equal((await api(ALICE, 'GET', '/api/bootstrap')).body.availability.service, false);
    await api(ADMIN, 'PUT', `/api/admin/services/${svc}`, { active: true });
  });

  await step('support tickets: customer opens one with a photo, admin is alerted, replies, customer is told, closing works', async () => {
    await api(ADMIN, 'POST', '/api/admin/team', { id: STAFF.id, name: 'Selam' }); // an earlier step removed the staff member
    const f = new FormData();
    f.append('category', 'not_received');
    f.append('order_id', ids.svcOrder);
    f.append('text', 'I paid but nothing arrived yet');
    f.append('photo', png(3), 'p.png');
    const mk = await api(ALICE, 'POST', '/api/tickets', f);
    assert.equal(mk.status, 201, JSON.stringify(mk.body));
    const tid = mk.body.ticket.id;
    assert.match(tid, /^TK-/);
    assert.equal(mk.body.messages[0].has_photo, true);
    assert.ok(lastPayload('sendMessage', (p) => (p.text || '').includes(tid) && /New ticket/.test(p.text)), 'admin alerted');
    // someone else's order, bad category and strangers are refused
    const f2 = new FormData(); f2.append('category', 'other'); f2.append('order_id', ids.svcOrder); f2.append('text', 'hi');
    assert.equal((await api(BOB, 'POST', '/api/tickets', f2)).body.error.code, 'bad_order');
    const f3 = new FormData(); f3.append('category', 'nonsense'); f3.append('text', 'hi');
    assert.equal((await api(ALICE, 'POST', '/api/tickets', f3)).body.error.code, 'bad_category');
    assert.equal((await api(BOB, 'GET', `/api/tickets/${tid}`)).status, 404);
    assert.equal((await api(BOB, 'GET', `/api/tickets/${tid}/photos/${mk.body.messages[0].id}`, undefined, { raw: true })).status, 404);
    assert.equal((await api(ALICE, 'GET', `/api/tickets/${tid}/photos/${mk.body.messages[0].id}`, undefined, { raw: true })).status, 200);
    assert.equal((await api(STAFF, 'GET', `/api/admin/tickets/${tid}/photos/${mk.body.messages[0].id}`, undefined, { raw: true })).status, 200);
    // admin inbox, reply
    assert.equal((await api(ALICE, 'GET', '/api/admin/tickets')).status, 403);
    const inbox = await api(STAFF, 'GET', '/api/admin/tickets');
    assert.equal(inbox.body.tickets[0].id, tid);
    assert.equal((await api(STAFF, 'GET', '/api/admin/summary')).body.counts.tickets, 1);
    const rep = await api(STAFF, 'POST', `/api/admin/tickets/${tid}/reply`, { text: 'Checking now, please wait.' });
    assert.equal(rep.status, 200);
    assert.equal(rep.body.ticket.status, 'answered');
    assert.ok(lastPayload('sendMessage', (p) => p.chat_id === ALICE.id && (p.text || '').includes('Checking now')), 'customer told');
    // customer replies, admin replies from chat by replying to the alert
    const f4 = new FormData(); f4.append('text', 'Thank you');
    assert.equal((await api(ALICE, 'POST', `/api/tickets/${tid}/messages`, f4)).body.ticket.status, 'open');
    const alert = lastPayload('sendMessage', (p) => (p.text || '').includes(tid) && /Customer replied/.test(p.text));
    assert.ok(alert);
    await adminSays('It is on its way', { reply_to_message: { message_id: 1, text: alert.text } });
    assert.ok(lastPayload('sendMessage', (p) => p.chat_id === ALICE.id && (p.text || '').includes('on its way')));
    // close with the button
    await press(ADMIN, `t:${tid}:x`, { message_id: 1, chat: { id: ADMIN_CHAT } });
    assert.equal((await api(ALICE, 'GET', `/api/tickets/${tid}`)).body.ticket.status, 'closed');
    assert.equal((await api(ALICE, 'GET', '/api/tickets')).body.tickets.length, 1);
  });

  await step('policies: customers read the active sections; the owner edits them; staff cannot', async () => {
    const r = await api(ALICE, 'GET', '/api/policies');
    assert.ok(r.body.sections.length >= 5);
    assert.equal(r.body.sections.every((p) => p.title_en && p.body_en), true);
    assert.equal((await api(STAFF, 'POST', '/api/admin/policies', { title_en: 'x', body_en: 'yy' })).status, 403);
    assert.equal((await api(ADMIN, 'POST', '/api/admin/policies', { title_en: 'x', body_en: 'yy' })).body.error.field, 'title_en');
    const mk = await api(ADMIN, 'POST', '/api/admin/policies', { title_en: 'Extra rule', body_en: 'Be kind to each other.' });
    assert.equal(mk.status, 201);
    assert.ok((await api(ALICE, 'GET', '/api/policies')).body.sections.some((p) => p.title_en === 'Extra rule'));
    await api(ADMIN, 'PUT', `/api/admin/policies/${mk.body.section.id}`, { active: false });
    assert.ok(!(await api(ALICE, 'GET', '/api/policies')).body.sections.some((p) => p.title_en === 'Extra rule'));
    assert.equal((await api(ADMIN, 'DELETE', `/api/admin/policies/${mk.body.section.id}`)).status, 200);
  });

  console.log('\nChat mode (the same shop, inside the bot)');
  const say = (u, text, extra = {}) => webhook({ update_id: nextUpdateId(), message: { message_id: 7000 + nextUpdateId(), from: u, chat: { id: u.id, type: 'private' }, text, ...extra } });
  const tap = (u, data) => webhook({ update_id: nextUpdateId(), callback_query: { id: `cb${nextUpdateId()}`, from: u, data, message: { message_id: screenOf(u)?.id, chat: { id: u.id, type: 'private' } } } });
  const buttons = (u) => screenOf(u).rows.flat();
  const hasButton = (u, data) => buttons(u).some((b) => b.callback_data === data);
  let chatBuy;
  await step('/start shows the menu with coloured buttons and the app button', async () => {
    await say(ALICE, '/start');
    const sc = screenOf(ALICE);
    assert.match(sc.text, /Neon Store/);
    const buy = buttons(ALICE).find((b) => b.callback_data === 'c:buy');
    const sell = buttons(ALICE).find((b) => b.callback_data === 'c:sell');
    assert.equal(buy.style, 'success');
    assert.equal(sell.style, 'danger');
    assert.ok(buttons(ALICE).some((b) => b.web_app?.url), 'open app button');
    assert.ok(!buttons(ALICE).some((b) => b.callback_data === 'a:home'), 'no admin button for customers');
  });
  await step('buying in chat: one message is edited through every step, typed answers are checked and removed', async () => {
    await tap(ALICE, 'c:buy');
    const first = screenOf(ALICE);
    assert.match(first.text, /▶️ <b>Method<\/b>/);
    await tap(ALICE, `c:pm:${ids.telebirr}`);
    await tap(ALICE, `c:pn:${ids.trc20}`);
    assert.match(screenOf(ALICE).text, /How much USDT/);
    await say(ALICE, '2');
    assert.match(screenOf(ALICE).text, /must be between/);
    await say(ALICE, '25');
    assert.match(screenOf(ALICE).text, /address/i);
    await say(ALICE, 'not-an-address');
    assert.match(screenOf(ALICE).text, /not a valid/);
    await say(ALICE, ADDR_TRC20);
    const confirm = screenOf(ALICE);
    assert.match(confirm.text, /Check your order/);
    assert.match(confirm.text, /25\.00 USDT/);
    assert.equal(confirm.id, first.id, 'the same message was edited all along');
    assert.ok(takeCalls('deleteMessage', (p) => p.chat_id === ALICE.id).length >= 3, 'typed answers removed');
    await tap(ALICE, 'c:ok');
    const pay = screenOf(ALICE);
    chatBuy = /NG-[2-9A-HJKMNP-Z]{6}/.exec(pay.text)[0];
    assert.match(pay.text, /0911223344/);
    assert.ok(hasButton(ALICE, `c:op:${chatBuy}`));
    const o = await api(ALICE, 'GET', `/api/orders/${chatBuy}`);
    assert.deepEqual([o.body.order.status, o.body.order.usdt_micro, o.body.order.usdt_address], ['awaiting_payment', 25_000_000, ADDR_TRC20]);
  });
  await step('sending proof in chat: a photo with a caption reaches the admins and the vault', async () => {
    await tap(ALICE, `c:op:${chatBuy}`);
    assert.match(screenOf(ALICE).text, /receipt/i);
    await say(ALICE, undefined, { photo: [{ file_id: 'small' }, { file_id: 'large' }], caption: 'TXN-CHAT-1' });
    assert.match(screenOf(ALICE).text, /Received for/);
    const o = (await api(ALICE, 'GET', `/api/orders/${chatBuy}`)).body.order;
    assert.equal(o.status, 'evidence_submitted');
    assert.equal(o.proofs[0].has_image, true);
    assert.equal(o.proofs[0].text, 'TXN-CHAT-1');
    assert.ok(lastPayload('sendMessage', (p) => [ADMIN_CHAT, ADMIN.id].includes(p.chat_id) && (p.text || '').includes(chatBuy)), 'admin alerted');
  });
  await step('my orders: open list, order screen, finished tab', async () => {
    await tap(ALICE, 'c:ol:active:0');
    assert.ok(hasButton(ALICE, `c:ov:${chatBuy}`));
    await tap(ALICE, `c:ov:${chatBuy}`);
    assert.match(screenOf(ALICE).text, /checking your proof/);
    await tap(ALICE, 'c:ol:done:0');
    assert.match(screenOf(ALICE).text, /finished orders/);
  });
  await step('selling in chat: collects payout name and account, then shows where to send the USDT', async () => {
    await api(BOB, 'POST', '/api/language', { language: 'en' });
    await say(BOB, '/start');
    await tap(BOB, 'c:sell');
    await tap(BOB, `c:pn:${ids.trc20}`);
    await tap(BOB, `c:pm:${ids.telebirr}`);
    await say(BOB, '40');
    await say(BOB, 'Bob Tesfaye');
    await say(BOB, '12');
    assert.match(screenOf(BOB).text, /not a valid phone/);
    await say(BOB, '0912 345 678');
    assert.match(screenOf(BOB).text, /Check your order/);
    await tap(BOB, 'c:ok');
    const pay = screenOf(BOB);
    assert.ok(pay.text.includes(ADDR_TRC20));
    const id = /NG-[2-9A-HJKMNP-Z]{6}/.exec(pay.text)[0];
    const o = (await api(BOB, 'GET', `/api/orders/${id}`)).body.order;
    assert.deepEqual([o.side, o.payout_account], ['sell', '0912345678']);
    await tap(BOB, `c:oc:${id}`);
    assert.match(screenOf(BOB).text, /Cancel order/);
    await tap(BOB, `c:ocy:${id}`);
    assert.equal((await api(BOB, 'GET', `/api/orders/${id}`)).body.order.status, 'cancelled');
  });
  await step('services in chat: platform, service, quantity, link, payment', async () => {
    await tap(ALICE, 'c:svc');
    await tap(ALICE, 'c:sp:telegram');
    await tap(ALICE, `c:ss:${svc}`);
    assert.match(screenOf(ALICE).text, /Type a number from/);
    await say(ALICE, '5');
    assert.match(screenOf(ALICE).text, /whole number/);
    await say(ALICE, '2,000');
    await say(ALICE, 'https://evil.example/x');
    assert.match(screenOf(ALICE).text, /does not look right/);
    await say(ALICE, '@neonchat');
    await tap(ALICE, `c:pm:${ids.telebirr}`);
    assert.match(screenOf(ALICE).text, /171\.00 ETB/);
    await tap(ALICE, 'c:ok');
    const id = /NG-[2-9A-HJKMNP-Z]{6}/.exec(screenOf(ALICE).text)[0];
    const o = (await api(ALICE, 'GET', `/api/orders/${id}`)).body.order;
    assert.deepEqual([o.side, o.quantity, o.target], ['service', 2000, 'https://t.me/neonchat']);
  });
  await step('support in chat: a ticket with the order picker, then read it back', async () => {
    await tap(ALICE, 'c:sup');
    await tap(ALICE, 'c:tc:not_received');
    assert.ok(hasButton(ALICE, `c:to:${chatBuy}`), 'order picker lists recent orders');
    await tap(ALICE, `c:to:${chatBuy}`);
    await say(ALICE, 'My money left my account but the order is still waiting');
    assert.match(screenOf(ALICE).text, /Ticket TK-/);
    const list = await api(ALICE, 'GET', '/api/tickets');
    const t = list.body.tickets.find((x) => x.order_id === chatBuy);
    assert.ok(t, 'ticket saved with its order');
    await tap(ALICE, 'c:tl');
    assert.ok(hasButton(ALICE, `c:tv:${t.id}`));
    await tap(ALICE, `c:tv:${t.id}`);
    assert.match(screenOf(ALICE).text, /My money left/);
    await api(ADMIN, 'POST', `/api/admin/tickets/${t.id}/close`, {});
  });
  await step('policies and language', async () => {
    await tap(ALICE, 'c:pol');
    const pol = buttons(ALICE).find((b) => /^c:ps:\d+$/.test(b.callback_data));
    await tap(ALICE, pol.callback_data);
    assert.ok(screenOf(ALICE).text.length > 60);
    await tap(ALICE, 'c:home');
    assert.match(screenOf(ALICE).text, /Swap USDT and birr/);
    assert.ok(!buttons(ALICE).some((b) => /Language|ቋንቋ/.test(b.text)), 'there is no language button');
  });
  await step('rates screen shows both prices and hides the stock when it is not tracked', async () => {
    await tap(ALICE, 'c:rates');
    const sc = screenOf(ALICE).text;
    assert.match(sc, /168\.50 ETB/);
    assert.match(sc, /163\.00 ETB/);
    assert.ok(!/In stock/.test(sc));
    await api(ADMIN, 'PUT', '/api/admin/settings', { stock_usdt: '500', stock_show: false });
    await tap(ALICE, 'c:rates');
    assert.ok(!/In stock|500/.test(screenOf(ALICE).text), 'hidden stock never shown');
    await api(ADMIN, 'PUT', '/api/admin/settings', { stock_show: true });
    await tap(ALICE, 'c:rates');
    assert.match(screenOf(ALICE).text, /In stock: 475\.00/);
    await api(ADMIN, 'PUT', '/api/admin/settings', { stock_usdt: '' });
  });
  await step('admin in chat: customers cannot open it; the owner sees the queue, opens a card, sets rates and stock, pauses', async () => {
    await tap(ALICE, 'a:home');
    assert.equal(lastPayload('answerCallbackQuery')?.text, 'Admins only.');
    await say(ADMIN, '/start');
    assert.ok(buttons(ADMIN).some((b) => b.callback_data === 'a:home'));
    await tap(ADMIN, 'a:home');
    assert.match(screenOf(ADMIN).text, /To review: <b>\d+<\/b>/);
    await tap(ADMIN, 'a:q:review');
    assert.ok(hasButton(ADMIN, `a:v:${chatBuy}`));
    await tap(ADMIN, `a:v:${chatBuy}`);
    const card = lastPayload('sendMessage', (p) => p.chat_id === ADMIN.id && (p.text || '').includes(chatBuy));
    assert.ok(card.reply_markup.inline_keyboard.flat().some((b) => b.callback_data === `o:${chatBuy}:c`));
    await press(ADMIN, `o:${chatBuy}:c`, { message_id: 1, chat: { id: ADMIN.id } });
    assert.equal((await api(ALICE, 'GET', `/api/orders/${chatBuy}`)).body.order.status, 'processing');
    await tap(ADMIN, 'a:home');
    await tap(ADMIN, 'a:rt');
    await say(ADMIN, '171 166');
    assert.deepEqual([(await api(ADMIN, 'GET', '/api/admin/settings')).body.settings.buy_rate_cents, (await api(ADMIN, 'GET', '/api/admin/settings')).body.settings.sell_rate_cents], [17100, 16600]);
    await tap(ADMIN, 'a:st');
    await say(ADMIN, '900');
    assert.equal((await api(ADMIN, 'GET', '/api/admin/settings')).body.settings.stock_usdt_micro, 900_000_000);
    await tap(ADMIN, 'a:st');
    await say(ADMIN, 'off');
    assert.equal((await api(ADMIN, 'GET', '/api/admin/settings')).body.settings.stock_usdt_micro, null);
    await tap(ADMIN, 'a:p');
    assert.equal((await api(ALICE, 'GET', '/api/bootstrap')).body.rates.paused, true);
    await tap(ALICE, 'c:buy');
    assert.match(screenOf(ALICE).text, /paused/);
    await tap(ADMIN, 'a:p');
    assert.equal((await api(ALICE, 'GET', '/api/bootstrap')).body.rates.paused, false);
  });

  await step('premium emoji: the owner gets an ID by sending an emoji, sets it in the app, buttons use it, and a refusal falls back to the ordinary emoji', async () => {
    // Customers cannot touch it; the owner can.
    assert.equal((await api(ALICE, 'PUT', '/api/admin/button-emoji', { map: { '🛒': '5368324170671202286' } })).status, 403);
    assert.equal((await api(STAFF, 'GET', '/api/admin/button-emoji')).status, 403, 'staff cannot change the look of the bot');
    const list = (await api(ADMIN, 'GET', '/api/admin/button-emoji')).body;
    assert.ok(list.items.some((i) => i.emoji === '🛒'));
    assert.equal((await api(ADMIN, 'PUT', '/api/admin/button-emoji', { map: { '🛒': 'abc' } })).body.error.code, 'invalid_field');
    assert.equal((await api(ADMIN, 'PUT', '/api/admin/button-emoji', { map: { '🦄': '5368324170671202286' } })).body.error.code, 'invalid_field');
    // The owner sends a premium emoji to the bot and is told its ID. Customers get nothing special.
    await say(ADMIN, '🛒', { entities: [{ type: 'custom_emoji', offset: 0, length: 2, custom_emoji_id: '5368324170671202286' }] });
    assert.match(screenOf(ADMIN).text, /5368324170671202286/);
    await say(ALICE, '🛒', { entities: [{ type: 'custom_emoji', offset: 0, length: 2, custom_emoji_id: '5368324170671202286' }] });
    assert.ok(!/5368324170671202286/.test(screenOf(ALICE).text), 'customers are not given IDs');
    // Set it: the menu button loses its ordinary emoji and carries the premium one.
    assert.equal((await api(ADMIN, 'PUT', '/api/admin/button-emoji', { map: { '🛒': '5368324170671202286' } })).status, 200);
    await say(ALICE, '/start');
    const buy = buttons(ALICE).find((b) => b.callback_data === 'c:buy');
    assert.equal(buy.icon_custom_emoji_id, '5368324170671202286');
    assert.equal(buy.text, 'Buy USDT');
    // Telegram refuses it (owner without Premium): the menu still appears, with the ordinary emoji.
    fakeRules.refuseCustomEmoji = true;
    await say(ALICE, '/start');
    const plain = buttons(ALICE).find((b) => b.callback_data === 'c:buy');
    assert.equal(plain.icon_custom_emoji_id, undefined);
    assert.equal(plain.text, '🛒 Buy USDT');
    fakeRules.refuseCustomEmoji = false;
    // Clearing it restores the ordinary emoji.
    await api(ADMIN, 'PUT', '/api/admin/button-emoji', { map: { '🛒': '' } });
    await say(ALICE, '/start');
    assert.equal(buttons(ALICE).find((b) => b.callback_data === 'c:buy').text, '🛒 Buy USDT');
  });
  await step('English is the only language: others are refused', async () => {
    assert.equal((await api(ALICE, 'POST', '/api/language', { language: 'en' })).status, 200);
    assert.equal((await api(ALICE, 'POST', '/api/language', { language: 'am' })).status, 400);
    assert.equal((await api(ALICE, 'GET', '/api/bootstrap')).body.user.language, 'en');
  });
  await step('chat buttons follow the colour scheme: blue by default, green for the main action, red for cancel, grey for quiet ones', async () => {
    await tap(ALICE, 'c:home');
    const style = (data) => buttons(ALICE).find((b) => b.callback_data === data)?.style;
    assert.equal(style('c:buy'), 'success');
    assert.equal(style('c:sell'), 'danger', 'sell is red');
    assert.equal(style('c:svc'), 'primary');
    assert.equal(style('c:rates'), 'primary');
    assert.equal(style('c:sup'), undefined, 'support is grey');
    assert.equal(style('c:ol:active:0'), 'primary', 'my orders is blue');
    await tap(ALICE, 'c:buy');
    assert.equal(style('c:x'), 'danger', 'cancel is red');
    assert.equal(style('c:back'), 'primary', 'back is blue');
    assert.equal(style('c:home'), undefined);
    await tap(ALICE, 'c:x');
  });

  console.log('\nConnect page');
  await step('/connect needs no password, says what is wrong, and one press connects everything', async () => {
    fakeWebhook.url = '';
    const before = takeCalls('setWebhook').length;
    const page = await (await fetch(`${APP}/connect`)).text();
    assert.match(page, /Bot token works: @neon_test_bot/);
    assert.match(page, /not to this app/);
    assert.equal(takeCalls('setWebhook').length, before, 'opening the page changes nothing');
    const ok = await (await fetch(`${APP}/connect`, { method: 'POST' })).text();
    assert.match(ok, /Done/);
    assert.match(ok, /neon_test_bot/);
    const hook = lastPayload('setWebhook');
    assert.equal(hook.url, `${APP}/telegram/webhook`);
    assert.equal(hook.secret_token, WEBHOOK_SECRET, 'the secret comes from the bot token, not from a setting that a redeploy can wipe');
    assert.equal(hook.drop_pending_updates, false, 'messages sent while the bot was silent are still answered');
    assert.equal(lastPayload('setChatMenuButton').menu_button.text, 'Open App');
    assert.ok(lastPayload('setMyCommands').commands.some((c) => c.command === 'buy'));
    assert.match(await (await fetch(`${APP}/connect`)).text(), /Everything looks fine/);
  });
  await step('the bot repairs its own webhook from the 5-minute job when it was lost', async () => {
    fakeWebhook.url = 'https://old.example/telegram/webhook';
    const before = takeCalls('setWebhook').length;
    await scheduledAt(Date.now());
    await sleep(400);
    assert.equal(takeCalls('setWebhook').length, before + 1);
    assert.equal(fakeWebhook.url, `${APP}/telegram/webhook`);
    await scheduledAt(Date.now());
    await sleep(400);
    assert.equal(takeCalls('setWebhook').length, before + 1, 'nothing to repair the second time');
  });
  await step('channel, reviews and logs: buttons, anonymised logs, one-time feedback', async () => {
    assert.equal((await api(ADMIN, 'PUT', '/api/admin/settings', { logs: 'https://t.me/+abcdefghij' })).status, 400, 'an invite link cannot be posted to');
    const put = await api(ADMIN, 'PUT', '/api/admin/settings', { channel: 'https://t.me/neonchannel', reviews: '@neonreviews', logs: '-1001234567890' });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    assert.equal(put.body.settings.reviews_ref, '@neonreviews');
    const boot = await api(ALICE, 'GET', '/api/bootstrap');
    assert.equal(boot.body.links.channel, 'https://t.me/neonchannel');
    assert.equal(boot.body.links.reviews, 'https://t.me/neonreviews');
    assert.equal(boot.body.links.logs, '');
    await tap(ALICE, 'c:home');
    assert.ok(buttons(ALICE).some((b) => b.url === 'https://t.me/neonchannel'), 'channel button');
    assert.ok(buttons(ALICE).some((b) => b.url === 'https://t.me/neonreviews'), 'reviews button');
    const o = await api(ALICE, 'POST', '/api/orders', sBuy(9, '12'));
    assert.equal(o.status, 201, JSON.stringify(o.body));
    const id = o.body.order.id;
    const pending = lastPayload('sendMessage', (p) => String(p.chat_id) === '-1001234567890');
    assert.match(pending.text, /New order, waiting for payment/);
    assert.match(pending.text, /111\*\*\*01/);
    assert.ok(!pending.text.includes('111001'), 'the customer id is masked');
    await api(ALICE, 'POST', `/api/orders/${id}/evidence`, evidenceForm({ text: 'TXN-FB-1' }));
    await api(ADMIN, 'POST', `/api/admin/orders/${id}/confirm`, {});
    await api(ADMIN, 'POST', `/api/admin/orders/${id}/release`, { reference: 'hash-fb' });
    assert.match(lastPayload('sendMessage', (p) => String(p.chat_id) === '-1001234567890').text, /Order completed/);
    const dm = dmTo(ALICE.id);
    const starRow = dm.reply_markup.inline_keyboard[0];
    assert.equal(starRow.length, 5, 'five star buttons on the completion message');
    assert.equal(starRow[3].callback_data, `c:rv:${id}:4`);
    assert.equal((await api(BOB, 'POST', `/api/orders/${id}/review`, { rating: 5 })).status, 404, 'only the customer who placed the order can review it');
    assert.equal((await api(ADMIN, 'POST', `/api/orders/${id}/review`, { rating: 5 })).status, 403, 'the team cannot review');
    assert.equal((await api(ALICE, 'POST', `/api/orders/${id}/review`, { rating: 6 })).status, 400);
    assert.equal((await api(ALICE, 'POST', `/api/orders/${id}/review`, { rating: 0 })).status, 400);
    await tap(ALICE, `c:rv:${id}:4`);
    const review = lastPayload('sendMessage', (p) => p.chat_id === '@neonstore_Review' || p.chat_id === '@neonreviews');
    assert.match(review.text, /4 out of 5 · Good/);
    assert.match(review.text, /New customer review/);
    assert.ok(!review.text.includes('111001'), 'customer id is masked');
    assert.match(screenOf(ALICE).text, /add a short comment/i);
    const posts = takeCalls('sendMessage', (p) => p.chat_id === '@neonreviews').length;
    await say(ALICE, 'Fast and friendly <b>service</b>');
    const edit = lastPayload('editMessageText', (p) => p.chat_id === '@neonreviews');
    assert.match(edit.text, /Fast and friendly &lt;b&gt;service&lt;\/b&gt;/, 'the comment is added to the same post, escaped');
    assert.equal(takeCalls('sendMessage', (p) => p.chat_id === '@neonreviews').length, posts, 'no second post');
    const again = await api(ALICE, 'POST', `/api/orders/${id}/review`, { rating: 1 });
    assert.equal(again.status, 409, 'one review per order');
    const mine = (await api(ALICE, 'GET', `/api/orders/${id}`)).body.order;
    assert.equal(mine.rating, 4);
    assert.match(mine.review_text, /Fast and friendly/);
    assert.equal(lastPayload('sendMessage', (p) => String(p.chat_id) === '-1001234567890').text.includes('Order completed'), true);
  });
  await step('admin history: everything view, search by order, name and transaction number; reviews in the summary; staff limits', async () => {
    const all = await api(STAFF, 'GET', '/api/admin/orders?filter=all');
    assert.equal(all.status, 200);
    assert.ok(all.body.orders.length > 5, 'the everything view lists finished and open orders');
    const first = all.body.orders[0];
    const byId = await api(STAFF, 'GET', `/api/admin/orders?filter=review&q=${first.id.slice(0, 7)}`);
    assert.ok(byId.body.orders.some((o) => o.id === first.id), 'a search ignores the tab and finds the order');
    const byTx = await api(STAFF, 'GET', '/api/admin/orders?filter=all&q=TXN-FB-1');
    assert.equal(byTx.body.orders.length, 1, 'found by transaction number');
    const byName = await api(STAFF, 'GET', '/api/admin/orders?filter=all&q=@alice');
    assert.ok(byName.body.orders.length >= 1 && byName.body.orders.every((o) => o.customer.username === 'alice'));
    assert.equal((await api(STAFF, 'GET', '/api/admin/orders?filter=all&q=%25')).body.orders.length, 0, 'wildcards are not special');
    const sm = await api(STAFF, 'GET', '/api/admin/summary');
    assert.equal(sm.body.reviews.count, 1);
    assert.equal(sm.body.reviews.average, 4);
    const detail = await api(STAFF, 'GET', `/api/admin/orders/${byTx.body.orders[0].id}`);
    assert.equal(detail.body.order.rating, 4);
    assert.ok(detail.body.order.proofs.some((p) => p.text === 'TXN-FB-1'), 'the transaction number is in the order detail');
    assert.equal((await api(STAFF, 'GET', '/api/admin/settings')).status, 403, 'staff cannot open shop settings');
    assert.equal((await api(STAFF, 'PUT', '/api/admin/settings', { paused: true })).status, 403);
    assert.equal((await api(STAFF, 'GET', '/api/admin/audit')).status, 403);
  });
  await step('Telegram messages with a wrong or missing secret are refused', async () => {
    const upd = { update_id: nextUpdateId(), message: { message_id: 9, from: ALICE, chat: { id: ALICE.id, type: 'private' }, text: '/start' } };
    assert.equal((await webhook(upd, 'wrong')).status, 403);
    assert.equal((await webhook(upd, '')).status, 403);
    assert.equal((await webhook(upd)).status, 200);
  });

  console.log(`\nAll ${passed} integration checks passed.`);
}

let failed = false;
try {
  await main();
} catch (err) {
  failed = true;
  console.error('\nIntegration run failed.');
  if (process.env.SHOW_WORKER_LOG) {
    await sleep(1500);
    console.error(workerLog().split('\n').slice(-40).join('\n'));
  }
} finally {
  await stopStack();
  process.exit(failed ? 1 : 0);
}
