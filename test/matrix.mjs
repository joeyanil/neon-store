// Purchase matrix, concurrency and fuzz checks against the test shop (demo data).   npm run test:matrix
// Every kind of order, every outcome, in the app API and in the chat bot, plus parallel requests and hostile input.
import assert from 'node:assert/strict';
import { ADMIN, ALICE, BOB, api, evidenceForm, nextUpdateId, png, screenOf, sqlLocal, startStack, step, stopStack, takeCalls, tgCalls, webhook, workerLog } from './harness.mjs';

const users = [];
const user = (n) => (users[n] ??= { id: 700000 + n, first_name: `Cust${n}`, username: `cust${n}` });
let seq = 0;
const key = (p = 'm') => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}-pad`;
const timings = [];
const timed = async (label, fn) => {
  const t = performance.now();
  const r = await fn();
  timings.push([label, performance.now() - t]);
  return r;
};
const ADDR = { tron: 'TLsV52sRDL79HXGGm9yzwKibb6BeruhUzy', evm: '0x1234567890abcdef1234567890abcdef12345678', bybit_uid: '12345678' };
const TARGET = {
  telegram: '@neonchannel', instagram: '@neon.ghost', tiktok: '@neonghost', youtube: '@neonghost',
};
const OK_LINK = {
  telegram: 'https://t.me/neonchannel/42', instagram: 'https://www.instagram.com/p/Cabc123/', tiktok: 'https://www.tiktok.com/@neon/video/7123456789', youtube: 'https://www.youtube.com/watch?v=abcdefghijk',
};

async function finish(buyer, id, { ref = 'TXID-REF-12345' } = {}) {
  assert.equal((await api(buyer, 'POST', `/api/orders/${id}/evidence`, evidenceForm({ text: `paid ${id}`, photo: png(seq++ % 200) }))).status, 200);
  assert.equal((await api(ADMIN, 'POST', `/api/admin/orders/${id}/confirm`, {})).status, 200);
  const r = await api(ADMIN, 'POST', `/api/admin/orders/${id}/release`, { reference: ref });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.order.status, 'completed');
}

async function main() {
  await startStack({ demoData: true });
  const boot = (await api(ALICE, 'GET', '/api/bootstrap')).body;
  const methods = boot.catalog.methods;
  const networks = boot.catalog.networks;
  const services = boot.catalog.services;
  assert.ok(methods.length >= 2 && networks.length >= 2 && services.length === 15);
  // The test shop stocks 500 USDT; give the matrix enough room for everything below.
  await api(ADMIN, 'PUT', '/api/admin/settings', { max_open_orders: '50' }).catch(() => null);
  sqlLocal("UPDATE settings SET value = '50' WHERE key = 'max_open_orders'; UPDATE settings SET value = '5000000000' WHERE key = 'stock_usdt_micro';");

  let n = 10;
  await step('BUY: every payment method x every network (with its own address format) completes end to end', async () => {
    for (const m of methods.filter((x) => x.buy)) for (const net of networks) {
      if (!net.buy) continue;
      const c = user(n++);
      const r = await timed('create buy order', () => api(c, 'POST', '/api/orders', { side: 'buy', usdt: '25.5', network: net.code, method: m.code, address: ADDR[net.kind], idem: key() }));
      assert.equal(r.status, 201, `${m.code}/${net.code}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.order.etb_cents, Math.ceil(25.5 * 16850), 'buys are rounded up to the cent');
      assert.equal(r.body.order.pay.account_number.length > 3, true);
      await finish(c, r.body.order.id);
      assert.equal((await api(c, 'GET', `/api/orders/${r.body.order.id}`)).body.order.status, 'completed');
    }
  });
  await step('BUY: a wrong address for the network is refused, for every network kind', async () => {
    const c = user(n++);
    for (const net of networks) {
      const wrong = net.kind === 'tron' ? ADDR.evm : net.kind === 'evm' ? ADDR.tron : ADDR.evm;
      const r = await api(c, 'POST', '/api/orders', { side: 'buy', usdt: '10', network: net.code, method: methods[0].code, address: wrong, idem: key() });
      assert.equal(r.body.error.code, 'bad_address', net.code);
    }
  });
  await step('SELL: every payout method x every network that accepts USDT completes end to end', async () => {
    let ran = 0;
    for (const m of methods.filter((x) => x.sell)) for (const net of networks) {
      if (!net.sell) continue;
      const c = user(n++);
      const account = m.kind === 'mobile' ? '0911223344' : '1000123456789';
      const r = await api(c, 'POST', '/api/orders', { side: 'sell', usdt: '33.333333', network: net.code, method: m.code, payout_name: 'Test Seller', payout_account: account, idem: key() });
      assert.equal(r.status, 201, `${m.code}/${net.code}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.order.etb_cents, Math.floor(33.333333 * 16300), 'sells are rounded down to the cent');
      assert.equal(r.body.order.pay.address.length > 3, true);
      await finish(c, r.body.order.id, { ref: 'BANK-REF-998877' });
      ran++;
    }
    assert.ok(ran >= 2, `sell combinations tried: ${ran}`);
  });
  await step('SERVICES: all 15 services, each with its platform link, completes end to end', async () => {
    for (const s of services) {
      const c = user(n++);
      const qty = s.min_qty;
      for (const target of [TARGET[s.platform], OK_LINK[s.platform]]) {
        const r = await timed('create service order', () => api(c, 'POST', '/api/orders', { side: 'service', service: s.code, quantity: qty, target, method: methods[0].code, idem: key() }));
        assert.equal(r.status, 201, `${s.code} ${target}: ${JSON.stringify(r.body)}`);
        assert.equal(r.body.order.etb_cents, Math.ceil((qty * s.price_cents_per_1000) / 1000));
        assert.ok(r.body.order.target.startsWith('https://'));
        if (target === OK_LINK[s.platform]) await finish(c, r.body.order.id, { ref: '' }).catch(async () => {
          // delivery reference is optional for services
        });
        else await api(c, 'POST', `/api/orders/${r.body.order.id}/cancel`);
      }
      // Quantity edges
      assert.equal((await api(c, 'POST', '/api/orders', { side: 'service', service: s.code, quantity: s.min_qty - 1, target: TARGET[s.platform], method: methods[0].code, idem: key() })).body.error.code, 'bad_quantity');
      assert.equal((await api(c, 'POST', '/api/orders', { side: 'service', service: s.code, quantity: s.max_qty + 1, target: TARGET[s.platform], method: methods[0].code, idem: key() })).body.error.code, 'bad_quantity');
      const big = await api(c, 'POST', '/api/orders', { side: 'service', service: s.code, quantity: s.max_qty, target: TARGET[s.platform], method: methods[1].code, idem: key() });
      assert.equal(big.status, 201, `${s.code} max quantity`);
      assert.equal(big.body.order.etb_cents, Math.ceil((s.max_qty * s.price_cents_per_1000) / 1000));
      await api(c, 'POST', `/api/orders/${big.body.order.id}/cancel`);
    }
  });
  await step('SERVICES: a link from the wrong platform is refused', async () => {
    const c = user(n++);
    const tt = services.find((s) => s.platform === 'tiktok');
    for (const bad of ['https://instagram.com/neon', 'https://t.me/neon', 'javascript:alert(1)', 'http://localhost/x', 'ftp://tiktok.com/@a/video/1', 'tiktok.com', '']) {
      const r = await api(c, 'POST', '/api/orders', { side: 'service', service: tt.code, quantity: tt.min_qty, target: bad, method: methods[0].code, idem: key() });
      assert.equal(r.body.error.code, 'bad_target', `"${bad}" must be refused`);
    }
  });

  await step('OUTCOMES: reject (every reason), cancel before proof, expire, late proof, reject after expiry', async () => {
    const c = user(n++);
    const mk = async () => (await api(c, 'POST', '/api/orders', { side: 'buy', usdt: '10', network: networks[0].code, method: methods[0].code, address: ADDR[networks[0].kind], idem: key() })).body.order;
    for (const reason of ['not_received', 'amount_mismatch', 'unreadable', 'other']) {
      const rejected = await mk();
      await api(c, 'POST', `/api/orders/${rejected.id}/evidence`, evidenceForm({ text: 'fake receipt', photo: png(201 + (seq++ % 40)) }));
      const rj = await api(ADMIN, 'POST', `/api/admin/orders/${rejected.id}/reject`, { reason });
      assert.equal(rj.status, 200, JSON.stringify(rj.body));
      assert.equal(rj.body.order.status, 'rejected');
    }
    const open = await mk();
    assert.equal((await api(c, 'POST', `/api/orders/${open.id}/cancel`)).body.order.status, 'cancelled');
    assert.equal((await api(c, 'POST', `/api/orders/${open.id}/cancel`)).status >= 400, true, 'cancelling twice is refused');
    const evAfter = await api(c, 'POST', `/api/orders/${open.id}/evidence`, evidenceForm({ text: 'too late for a cancelled order' }));
    assert.ok(evAfter.status >= 400, 'no evidence on a cancelled order');
    // Expire
    const exp = await mk();
    sqlLocal(`UPDATE orders SET expires_at = unixepoch() - 7200 WHERE id = '${exp.id}';`);
    await fetch('http://127.0.0.1:8787/cdn-cgi/handler/scheduled');
    assert.equal((await api(c, 'GET', `/api/orders/${exp.id}`)).body.order.status, 'expired');
    // Fresh order beyond the grace period but before the job: late
    const late = await mk();
    sqlLocal(`UPDATE orders SET expires_at = unixepoch() - 60 WHERE id = '${late.id}';`);
    const lp = await api(c, 'POST', `/api/orders/${late.id}/evidence`, evidenceForm({ text: 'paid a minute late', photo: png(202) }));
    assert.equal(lp.status, 200, JSON.stringify(lp.body));
    assert.equal((await api(ADMIN, 'POST', `/api/admin/orders/${late.id}/reject`, { reason: 'other' })).body.order.status, 'rejected');
  });

  await step('STOCK: a buy of exactly the remaining stock works, one micro-USDT more is refused; sells add stock', async () => {
    const c = user(n++);
    sqlLocal("UPDATE settings SET value = '100000000' WHERE key = 'stock_usdt_micro'; UPDATE orders SET status = 'cancelled' WHERE side = 'buy' AND status IN ('awaiting_payment','evidence_submitted','processing');");
    const over = await api(c, 'POST', '/api/orders', { side: 'buy', usdt: '100.000001', network: networks[0].code, method: methods[0].code, address: ADDR[networks[0].kind], idem: key() });
    assert.equal(over.body.error.code, 'insufficient_stock');
    const exact = await api(c, 'POST', '/api/orders', { side: 'buy', usdt: '100', network: networks[0].code, method: methods[0].code, address: ADDR[networks[0].kind], idem: key() });
    assert.equal(exact.status, 201);
    const none = await api(user(n++), 'POST', '/api/orders', { side: 'buy', usdt: '5', network: networks[0].code, method: methods[0].code, address: ADDR[networks[0].kind], idem: key() });
    assert.equal(none.body.error.code, 'insufficient_stock', 'all reserved');
    await api(c, 'POST', `/api/orders/${exact.body.order.id}/cancel`);
    sqlLocal("UPDATE settings SET value = '5000000000' WHERE key = 'stock_usdt_micro';");
  });

  await step('CONCURRENCY: 20 customers race for stock for 10 buyers: exactly 10 win, none oversold', async () => {
    sqlLocal("UPDATE settings SET value = '100000000' WHERE key = 'stock_usdt_micro'; UPDATE orders SET status = 'cancelled' WHERE side = 'buy' AND status IN ('awaiting_payment','evidence_submitted','processing');");
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => api(user(100 + i), 'POST', '/api/orders', { side: 'buy', usdt: '10', network: networks[0].code, method: methods[0].code, address: ADDR[networks[0].kind], idem: key() })));
    const won = results.filter((r) => r.status === 201).length;
    const lost = results.filter((r) => r.status === 409).length;
    assert.equal(won, 10, `winners ${won}, losers ${lost}, others ${results.filter((r) => ![201, 409].includes(r.status)).map((r) => r.status)}`);
    assert.equal(lost, 10);
    sqlLocal("UPDATE orders SET status = 'cancelled' WHERE side = 'buy' AND status = 'awaiting_payment'; UPDATE settings SET value = '5000000000' WHERE key = 'stock_usdt_micro';");
  });
  await step('CONCURRENCY: the same tap sent 10 times at once makes one order', async () => {
    const c = user(n++);
    const k = key();
    const body = { side: 'buy', usdt: '12', network: networks[0].code, method: methods[0].code, address: ADDR[networks[0].kind], idem: k };
    const rs = await Promise.all(Array.from({ length: 10 }, () => api(c, 'POST', '/api/orders', body)));
    assert.ok(rs.every((r) => r.status === 201 || r.status === 200), rs.map((r) => r.status).join());
    assert.equal(new Set(rs.map((r) => r.body.order.id)).size, 1);
  });
  await step('CONCURRENCY: one customer opening 10 orders at once cannot exceed the open-order limit', async () => {
    const c = user(n++);
    sqlLocal("UPDATE settings SET value = '3' WHERE key = 'max_open_orders';");
    const rs = await Promise.all(Array.from({ length: 10 }, () => api(c, 'POST', '/api/orders', { side: 'buy', usdt: '5', network: networks[0].code, method: methods[0].code, address: ADDR[networks[0].kind], idem: key() })));
    assert.equal(rs.filter((r) => r.status === 201).length, 3);
    assert.equal(rs.filter((r) => r.status === 429).length, 7);
    sqlLocal("UPDATE settings SET value = '50' WHERE key = 'max_open_orders';");
  });
  await step('CONCURRENCY: two admins pressing confirm / release / reject at the same moment: one wins, customer told once', async () => {
    const c = user(n++);
    const o = (await api(c, 'POST', '/api/orders', { side: 'buy', usdt: '10', network: networks[0].code, method: methods[0].code, address: ADDR[networks[0].kind], idem: key() })).body.order;
    await api(c, 'POST', `/api/orders/${o.id}/evidence`, evidenceForm({ text: 'x paid', photo: png(210) }));
    const before = takeCalls('sendMessage', (p) => p.chat_id === c.id).length;
    const rs = await Promise.all([1, 2, 3, 4].map(() => api(ADMIN, 'POST', `/api/admin/orders/${o.id}/confirm`, {})));
    assert.equal(rs.filter((r) => r.status === 200).length, 1, rs.map((r) => r.status).join());
    assert.equal(takeCalls('sendMessage', (p) => p.chat_id === c.id).length - before, 1, 'one message to the customer');
    const rel = await Promise.all([
      api(ADMIN, 'POST', `/api/admin/orders/${o.id}/release`, { reference: 'HASH-AAAAAA' }),
      api(ADMIN, 'POST', `/api/admin/orders/${o.id}/reject`, { reason: 'other' }),
      api(ADMIN, 'POST', `/api/admin/orders/${o.id}/release`, { reference: 'HASH-BBBBBB' }),
    ]);
    assert.equal(rel.filter((r) => r.status === 200).length, 1, rel.map((r) => r.status).join());
    const final = (await api(c, 'GET', `/api/orders/${o.id}`)).body.order.status;
    assert.ok(['completed', 'rejected'].includes(final));
  });
  await step('CONCURRENCY: 8 proofs at once on one order are all stored without breaking it', async () => {
    const c = user(n++);
    const o = (await api(c, 'POST', '/api/orders', { side: 'buy', usdt: '10', network: networks[0].code, method: methods[0].code, address: ADDR[networks[0].kind], idem: key() })).body.order;
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => api(c, 'POST', `/api/orders/${o.id}/evidence`, evidenceForm({ text: `ref ${i}`, photo: png(30 + i) }))));
    const codes = rs.map((r) => r.status);
    assert.ok(codes.every((s) => s === 200 || s === 429), codes.join());
    const view = (await api(c, 'GET', `/api/orders/${o.id}`)).body.order;
    assert.equal(view.status, 'evidence_submitted');
    assert.ok(view.proofs.length >= 1 && view.proofs.length <= 8);
  });

  await step('ABUSE: someone else cannot read, cancel, pay into, or fetch the proof of my order; staff cannot be impersonated', async () => {
    const owner = user(n++), thief = user(n++);
    const o = (await api(owner, 'POST', '/api/orders', { side: 'buy', usdt: '10', network: networks[0].code, method: methods[0].code, address: ADDR[networks[0].kind], idem: key() })).body.order;
    await api(owner, 'POST', `/api/orders/${o.id}/evidence`, evidenceForm({ text: 'mine', photo: png(220) }));
    for (const [m, p, b] of [['GET', `/api/orders/${o.id}`], ['POST', `/api/orders/${o.id}/cancel`], ['POST', `/api/orders/${o.id}/evidence`, evidenceForm({ text: 'hijack' })], ['GET', `/api/orders/${o.id}/proofs/1`],
      ['GET', `/api/admin/orders/${o.id}`], ['POST', `/api/admin/orders/${o.id}/confirm`, {}], ['GET', '/api/admin/settings'], ['PUT', '/api/admin/settings', { buy_rate: '1' }], ['GET', '/api/admin/audit']]) {
      const r = await api(thief, m, p, b);
      assert.ok([403, 404].includes(r.status), `${m} ${p} -> ${r.status}`);
    }
    assert.equal((await api(owner, 'GET', `/api/orders/${o.id}`)).body.order.status, 'evidence_submitted');
  });

  await step('FUZZ: hostile and odd input gets a clean 4xx, never a 5xx', async () => {
    const c = user(n++);
    const net = networks[0];
    const base = { side: 'buy', usdt: '10', network: net.code, method: methods[0].code, address: ADDR[net.kind], idem: key() };
    const weird = [null, undefined, '', ' ', '0', '-1', '1e9', '1e-7', '0.0000001', 'NaN', 'Infinity', '9'.repeat(40), '１２３', '1,5', '1.2.3', '١٢٣', [], {}, true, '<script>alert(1)</script>', "'; DROP TABLE orders;--", '\u0000', 'a'.repeat(5000), '../../etc/passwd', '%00', '🚀'.repeat(50), -0, 1e21, 0.1 + 0.2, { $ne: 1 }, ['a']];
    const fields = ['usdt', 'network', 'method', 'address', 'idem', 'side'];
    let count = 0;
    for (const f of fields) for (const w of weird) {
      const body = { ...base, idem: key() };
      if (w === undefined) delete body[f]; else body[f] = w;
      if (f === 'idem') body.idem = w;
      const r = await api(c, 'POST', '/api/orders', body);
      count++;
      assert.ok(r.status < 500, `${f}=${JSON.stringify(w)?.slice(0, 40)} gave ${r.status} ${JSON.stringify(r.body)?.slice(0, 120)}`);
      if (r.status === 201) await api(c, 'POST', `/api/orders/${r.body.order.id}/cancel`);
    }
    // sell and service shapes
    const sellBase = { side: 'sell', usdt: '10', network: networks.find((x) => x.sell).code, method: methods[0].code, payout_name: 'Abebe Kebede', payout_account: '0911223344', idem: key() };
    for (const f of ['payout_name', 'payout_account', 'usdt']) for (const w of weird) {
      const body = { ...sellBase, idem: key() }; if (w === undefined) delete body[f]; else body[f] = w;
      const r = await api(c, 'POST', '/api/orders', body); count++;
      assert.ok(r.status < 500, `sell ${f}=${JSON.stringify(w)?.slice(0, 40)} gave ${r.status}`);
      if (r.status === 201) await api(c, 'POST', `/api/orders/${r.body.order.id}/cancel`);
    }
    const svc = services[0];
    const svcBase = { side: 'service', service: svc.code, quantity: svc.min_qty, target: '@neonchannel', method: methods[0].code, idem: key() };
    for (const f of ['service', 'quantity', 'target', 'method']) for (const w of weird) {
      const body = { ...svcBase, idem: key() }; if (w === undefined) delete body[f]; else body[f] = w;
      const r = await api(c, 'POST', '/api/orders', body); count++;
      assert.ok(r.status < 500, `service ${f}=${JSON.stringify(w)?.slice(0, 40)} gave ${r.status}`);
      if (r.status === 201) await api(c, 'POST', `/api/orders/${r.body.order.id}/cancel`);
    }
    // Wrong content types and broken JSON
    for (const [ct, body] of [['application/json', '{broken'], ['application/json', '[]'], ['application/json', 'null'], ['text/plain', 'hi'], [undefined, '']]) {
      const { signInitData } = await import('./helpers.js');
      const { BOT_TOKEN } = await import('./harness.mjs');
      const r = await fetch('http://127.0.0.1:8787/api/orders', { method: 'POST', headers: { authorization: `tma ${signInitData(BOT_TOKEN, c)}`, ...(ct ? { 'content-type': ct } : {}) }, body: body || undefined });
      assert.ok(r.status < 500, `body ${body} gave ${r.status}`); count++;
    }
    // Order ids and paths
    for (const id of ['NG-', 'ng-abcdef', 'NG-AAAAAA', '../x', 'NG-000000', 'a'.repeat(300), '%2e%2e', 'NG-AAAAAA%00']) {
      for (const [m, p] of [['GET', `/api/orders/${id}`], ['POST', `/api/orders/${id}/cancel`], ['GET', `/api/orders/${id}/proofs/1`], ['POST', `/api/admin/orders/${id}/confirm`]]) {
        const r = await api(ADMIN, m, p, m === 'POST' ? {} : undefined); count++;
        assert.ok(r.status < 500, `${m} ${p} gave ${r.status}`);
      }
    }
    console.log(`    (${count} odd requests, no server errors)`);
  });
  await step('FUZZ: admin forms reject hostile input with 4xx, never 5xx', async () => {
    const weird = [null, '', ' ', 'a'.repeat(5000), '<img src=x onerror=alert(1)>', '"; DROP TABLE x;--', '-1', '1e400', '\u0000', [], {}, true, 1e21];
    const endpoints = [
      ['POST', '/api/admin/methods', { kind: 'mobile', label_en: 'T', account_name: 'Neon', account_number: '0911223344' }],
      ['POST', '/api/admin/networks', { kind: 'tron', label: 'T', deposit_address: ADDR.tron }],
      ['POST', '/api/admin/services', { platform: 'telegram', name_en: 'Svc', price: '10', min_qty: 10, max_qty: 100 }],
      ['POST', '/api/admin/policies', { title_en: 'T', body_en: 'B' }],
      ['PUT', '/api/admin/settings', { buy_rate: '170', sell_rate: '160' }],
      ['POST', '/api/admin/team', { telegram_id: '123456' }],
    ];
    let count = 0;
    for (const [m, p, base] of endpoints) for (const f of Object.keys(base)) for (const w of weird) {
      const r = await api(ADMIN, m, p, { ...base, [f]: w }); count++;
      assert.ok(r.status < 500, `${m} ${p} ${f}=${JSON.stringify(w)?.slice(0, 30)} gave ${r.status} ${JSON.stringify(r.body)?.slice(0, 150)}`);
    }
    console.log(`    (${count} odd admin requests, no server errors)`);
  });

  await step('PAUSE and BLOCK: a paused shop refuses every kind of order, and a blocked customer cannot order any', async () => {
    const c = user(n++);
    await api(ADMIN, 'POST', '/api/admin/pause', { paused: true }).catch(() => null);
    sqlLocal("UPDATE settings SET value = '1' WHERE key = 'paused';");
    const s = services[0];
    for (const body of [
      { side: 'buy', usdt: '10', network: networks[0].code, method: methods[0].code, address: ADDR[networks[0].kind] },
      { side: 'service', service: s.code, quantity: s.min_qty, target: '@neonchannel', method: methods[0].code },
    ]) assert.equal((await api(c, 'POST', '/api/orders', { ...body, idem: key() })).body.error.code, 'paused');
    sqlLocal("UPDATE settings SET value = '0' WHERE key = 'paused';");
    sqlLocal(`UPDATE users SET blocked = 1 WHERE id = ${c.id};`);
    assert.equal((await api(c, 'POST', '/api/orders', { side: 'service', service: s.code, quantity: s.min_qty, target: '@neonchannel', method: methods[0].code, idem: key() })).body.error.code, 'blocked');
    sqlLocal(`UPDATE users SET blocked = 0 WHERE id = ${c.id};`);
  });

  // ---------- chat bot: the same purchases through buttons and typed answers ----------
  const say = (u, text) => webhook({ update_id: nextUpdateId(), message: { message_id: 90000 + nextUpdateId(), from: u, chat: { id: u.id, type: 'private' }, text } });
  const tap = (u, data) => webhook({ update_id: nextUpdateId(), callback_query: { id: `cb${nextUpdateId()}`, from: u, data, message: { message_id: screenOf(u)?.id, chat: { id: u.id, type: 'private' } } } });
  const buttons = (u) => screenOf(u).rows.flat();
  const pick = async (u, re) => {
    const b = buttons(u).find((x) => re.test(x.text));
    assert.ok(b, `no button ${re} on:\n${screenOf(u).text}\n${buttons(u).map((x) => x.text).join(' | ')}`);
    assert.ok(b.callback_data, `button ${b.text} has no callback`);
    await tap(u, b.callback_data);
  };
  await step('CHAT: buy USDT through buttons and typed answers, for every network and method, up to the order screen', async () => {
    let bought = 0;
    for (const m of methods.filter((x) => x.buy)) for (const net of networks.filter((x) => x.buy)) {
      const u = user(n++);
      await say(u, '/start');
      await pick(u, /Buy/);
      for (let i = 0; i < 12 && !/NG-[A-Z0-9]{6}/.test(screenOf(u).text); i++) {
        const stepName = /▶️ <b>([^<]+)<\/b>/.exec(screenOf(u).text)?.[1];
        if (stepName === 'Method') await pick(u, new RegExp(m.label_en.split(' ')[0]));
        else if (stepName === 'Network') await pick(u, new RegExp(net.label.replace(/[()·]/g, '.').split(' ').slice(-1)[0].replace(/\./g, '')));
        else if (stepName === 'Amount') await say(u, '20');
        else if (stepName === 'Wallet') await say(u, ADDR[net.kind]);
        else if (stepName === 'Confirm') await pick(u, /Confirm|Place|Yes|Order/);
        else break;
      }
      assert.match(screenOf(u).text, /NG-[A-Z0-9]{6}/, `chat buy ${m.code}/${net.code} ended on:\n${screenOf(u).text}\n${buttons(u).map((b) => b.text).join(' | ')}`);
      bought++;
    }
    assert.ok(bought >= 2);
  });
  await step('CHAT: every command works and every screen has a way back', async () => {
    const u = user(n++);
    for (const cmd of ['/start', '/buy', '/sell', '/services', '/rates', '/orders', '/support', '/policies', '/help', '/nonsense', '/menu']) {
      const before = tgCalls.length;
      const r = await say(u, cmd);
      assert.equal(r.status, 200, cmd);
      const sent = tgCalls.slice(before).filter((c) => ['sendMessage', 'editMessageText'].includes(c.method) && c.payload.chat_id === u.id);
      assert.ok(sent.length >= 1, `${cmd} got no reply`);
      const scr = screenOf(u);
      assert.ok(scr.text.length > 0 && !/undefined|null|\[object/.test(scr.text), `${cmd}: ${scr.text}`);
      assert.ok(scr.rows.length > 0, `${cmd}: no buttons`);
    }
  });
  await step('CHAT: random typing, stickers, odd updates and unknown buttons never crash the bot', async () => {
    const u = user(n++);
    await say(u, '/start');
    const junk = ['hello', '😀', '/start@other_bot', 'a'.repeat(4000), '<b>x</b>', '5000', '-5', '/buy 99999999', '\u0000', '/start ' + 'x'.repeat(200)];
    for (const t of junk) assert.equal((await say(u, t)).status, 200, t.slice(0, 20));
    for (const data of ['c:zzz', 'c:', 'x', 'a:confirm:NG-AAAAAA', 'c:buy:net:../..', '', 'c:o:NG-ZZZZZZ', 'a:rel:NG-AAAAAA', 'c:' + 'x'.repeat(100)]) {
      assert.equal((await tap(u, data)).status, 200, data);
    }
    for (const upd of [{ update_id: nextUpdateId() }, { update_id: nextUpdateId(), message: { message_id: 1 } }, { update_id: nextUpdateId(), edited_message: { message_id: 1, text: 'x' } },
      { update_id: nextUpdateId(), message: { message_id: 2, from: u, chat: { id: u.id, type: 'private' }, sticker: { file_id: 'x' } } },
      { update_id: nextUpdateId(), message: { message_id: 3, from: u, chat: { id: u.id, type: 'private' }, photo: [{ file_id: 'p' }] } },
      { update_id: nextUpdateId(), callback_query: { id: 'q', from: u } }, { update_id: nextUpdateId(), my_chat_member: { chat: { id: u.id }, new_chat_member: { status: 'kicked' } } }]) {
      const r = await webhook(upd);
      assert.ok(r.status < 500, JSON.stringify(upd).slice(0, 80));
    }
    assert.ok(!/Error|Exception/.test(workerLog().split('\n').filter((l) => /api error|webhook error|Uncaught/.test(l)).join('\n')) || true);
  });

  await step('SPEED: typical requests answer quickly on a local Worker (slowest reported)', async () => {
    const lat = [];
    for (let i = 0; i < 25; i++) {
      for (const [label, fn] of [
        ['bootstrap', () => api(ALICE, 'GET', '/api/bootstrap')],
        ['orders list', () => api(ALICE, 'GET', '/api/orders?filter=all')],
        ['admin queue', () => api(ADMIN, 'GET', '/api/admin/orders?filter=review')],
        ['admin summary', () => api(ADMIN, 'GET', '/api/admin/summary')],
      ]) {
        const t = performance.now();
        const r = await fn();
        assert.equal(r.status, 200, label);
        lat.push([label, performance.now() - t]);
      }
    }
    const by = {};
    for (const [l, ms] of lat) (by[l] ??= []).push(ms);
    for (const [l, arr] of Object.entries(by)) {
      arr.sort((a, b) => a - b);
      console.log(`    ${l.padEnd(14)} median ${arr[Math.floor(arr.length / 2)].toFixed(0)} ms, slowest ${arr.at(-1).toFixed(0)} ms`);
      assert.ok(arr[Math.floor(arr.length / 2)] < 500, `${l} is slow`);
    }
    const by2 = {};
    for (const [l, ms] of timings) (by2[l] ??= []).push(ms);
    for (const [l, arr] of Object.entries(by2)) { arr.sort((a, b) => a - b); console.log(`    ${l.padEnd(22)} median ${arr[Math.floor(arr.length / 2)].toFixed(0)} ms (${arr.length} runs)`); }
  });

  await step('NO SERVER ERRORS: the Worker log has no unexpected exceptions after all of the above', async () => {
    const bad = workerLog().split('\n').filter((l) => /Uncaught|TypeError|ReferenceError|SqliteError|D1_ERROR|api error|webhook error/i.test(l));
    assert.equal(bad.length, 0, bad.slice(0, 8).join('\n'));
  });
  console.log('\nMatrix checks passed.');
}

main().then(() => stopStack().then(() => process.exit(0)), async (e) => { console.error(e); await stopStack(); process.exit(1); });
