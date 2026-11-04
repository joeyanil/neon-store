// The test-shop data (scripts/demo-data.sql): fills only what is empty, keeps what the owner entered, and never
// re-adds what was deleted.   npm run test:demo
import assert from 'node:assert/strict';
import { ADMIN, ALICE, api, nextUpdateId, runDemoSql, screenOf, startStack, step, stopStack, webhook } from './harness.mjs';

const OWNER_WORK = `
UPDATE settings SET value = '17000', updated_at = 1 WHERE key = 'buy_rate_cents';
INSERT INTO birr_methods (code, kind, label_en, account_name, account_number, accept_buy, pay_sell, active, sort, created_at, updated_at)
VALUES ('mine-tele', 'mobile', 'My Telebirr', 'Owner', '0911223344', 1, 1, 1, 1, 1, 1);
`;

async function main() {
  await startStack({ beforeDemo: OWNER_WORK, demoData: true });

  await step('the shop opens by itself, and what the owner already entered is kept', async () => {
    const b = (await api(ALICE, 'GET', '/api/bootstrap')).body;
    assert.equal(b.rates.ready, true);
    assert.equal(b.rates.buy_cents, 17000, 'the owner\'s own buy rate survives');
    assert.equal(b.rates.sell_cents, 16300, 'an unset sell rate gets the test value');
    assert.equal(b.limits.max_usdt_micro, 1_000_000_000);
    assert.deepEqual(b.catalog.methods.map((m) => m.code), ['mine-tele'], 'no demo account is added next to the owner\'s own');
    assert.deepEqual(b.catalog.networks.map((n) => n.code).sort(), ['demo-bep20', 'demo-bybit', 'demo-trc20']);
    assert.equal(b.catalog.services.length, 15);
    for (const p of ['telegram', 'instagram', 'tiktok', 'youtube']) assert.ok(b.catalog.services.some((s) => s.platform === p), p);
  });
  await step('the three sides are open: buy, sell and services', async () => {
    const setup = (await api(ADMIN, 'GET', '/api/admin/setup')).body;
    assert.deepEqual(setup.sides, { buy: true, sell: true, service: true });
  });
  await step('running it again, or after the owner deleted rows, adds nothing back', async () => {
    assert.equal((await api(ADMIN, 'DELETE', '/api/admin/services/demo-tg-comments')).status, 200);
    assert.equal((await api(ADMIN, 'DELETE', '/api/admin/networks/demo-bybit')).status, 200);
    runDemoSql();
    const b = (await api(ALICE, 'GET', '/api/bootstrap')).body;
    assert.equal(b.catalog.services.length, 14);
    assert.deepEqual(b.catalog.networks.map((n) => n.code).sort(), ['demo-bep20', 'demo-trc20']);
  });
  await step('a customer can order a service straight away', async () => {
    const svc = (await api(ALICE, 'GET', '/api/bootstrap')).body.catalog.services.find((s) => s.code === 'demo-tg-subs');
    const r = await api(ALICE, 'POST', '/api/orders', { side: 'service', service: svc.code, quantity: 1000, target: '@neonchannel', method: 'mine-tele', idem: 'idem-demo-service-1' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.order.etb_cents, 9000);
  });
  await step('the alert check passes on its own when the owner starts the bot (alerts by private message)', async () => {
    await api(ADMIN, 'POST', '/api/admin/alerts/dm');
    const alerts = async () => (await api(ADMIN, 'GET', '/api/admin/setup')).body.steps.find((x) => x.key === 'alerts').done;
    assert.equal(await alerts(), false);
    await webhook({ update_id: nextUpdateId(), message: { message_id: 1, from: ADMIN, chat: { id: ADMIN.id, type: 'private' }, text: '/start' } });
    assert.equal(await alerts(), true);
  });
  const say = (u, text) => webhook({ update_id: nextUpdateId(), message: { message_id: 7000 + nextUpdateId(), from: u, chat: { id: u.id, type: 'private' }, text } });
  const tap = (u, data) => webhook({ update_id: nextUpdateId(), callback_query: { id: `cb${nextUpdateId()}`, from: u, data, message: { message_id: screenOf(u)?.id, chat: { id: u.id, type: 'private' } } } });
  const texts = (u) => screenOf(u).rows.flat().map((b) => b.text).join(' | ');
  await step('what an admin saves in the app shows up in the chat bot straight away: rates, services, prices, accounts', async () => {
    await say(ALICE, '/start');
    await tap(ALICE, 'c:rates');
    assert.match(screenOf(ALICE).text, /170\.00 ETB/, 'the owner\'s buy rate');
    await api(ADMIN, 'PUT', '/api/admin/settings', { buy_rate: '171.25', sell_rate: '160' });
    await tap(ALICE, 'c:rates');
    assert.match(screenOf(ALICE).text, /171\.25 ETB/);
    assert.match(screenOf(ALICE).text, /160\.00 ETB/);
    await tap(ALICE, 'c:svc');
    await tap(ALICE, 'c:sp:telegram');
    assert.match(texts(ALICE), /Telegram subscribers: 90\.00 ETB \/ 1,000/);
    await api(ADMIN, 'PUT', '/api/admin/services/demo-tg-subs', { price: '95.5' });
    await api(ADMIN, 'POST', '/api/admin/services', { platform: 'telegram', name_en: 'Telegram boosts', price: '300', min_qty: 10, max_qty: 500 });
    await tap(ALICE, 'c:svc');
    await tap(ALICE, 'c:sp:telegram');
    assert.match(texts(ALICE), /Telegram subscribers: 95\.50 ETB \/ 1,000/);
    assert.match(texts(ALICE), /Telegram boosts: 300\.00 ETB \/ 1,000/);
    await api(ADMIN, 'PUT', '/api/admin/services/demo-tg-views', { active: false });
    await tap(ALICE, 'c:svc');
    await tap(ALICE, 'c:sp:telegram');
    assert.ok(!/post views/.test(texts(ALICE)), 'a service the owner switched off disappears');
    await api(ADMIN, 'POST', '/api/admin/methods', { kind: 'mobile', label_en: 'M-Pesa', account_name: 'Neon Store', account_number: '0711223344' });
    await tap(ALICE, 'c:buy');
    assert.match(texts(ALICE), /M-Pesa/);
    await api(ADMIN, 'PUT', '/api/admin/settings', { paused: true });
    await tap(ALICE, 'c:buy');
    assert.match(screenOf(ALICE).text, /paused/);
  });
  console.log('\nDemo data checks passed.');
}

let failed = false;
try { await main(); } catch (e) { failed = true; console.error(e); } finally { await stopStack(); process.exit(failed ? 1 : 0); }
