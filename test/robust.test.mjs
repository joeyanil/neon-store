// Small screens, hostile text and first-load cost, in a real browser against the demo shop.   npm run test:robust
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { ADMIN, ALICE, APP, BOT_TOKEN, api, evidenceForm, png, startStack, step, stopStack } from './harness.mjs';
import { signInitData } from './helpers.js';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = require('playwright')); }
const MOCK = readFileSync(new URL('./tg-mock.js', import.meta.url), 'utf8');
const XSS = '<img src=x onerror=window.__pwned=1>';

async function open(browser, { user, width = 390, scheme = 'light', throttle } = {}) {
  const c = await browser.newContext({ viewport: { width, height: 780 }, isMobile: true, hasTouch: true });
  const page = await c.newPage();
  const reqs = [];
  const errors = [];
  page.on('request', (r) => reqs.push(r));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => { errors.push(`dialog: ${d.message()}`); d.dismiss(); });
  await page.route('https://telegram.org/**', (r) => r.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.addInitScript(`window.__INIT = ${JSON.stringify({ initData: signInitData(BOT_TOKEN, user), user, scheme })};`);
  await page.addInitScript(MOCK);
  if (throttle) {
    const cdp = await c.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', throttle);
  }
  const t0 = Date.now();
  await page.goto(APP);
  return { page, reqs, errors, t0 };
}
const go = async (page, route) => {
  await page.evaluate((r) => { history.pushState({ app: true, path: r, depth: 1 }, ''); dispatchEvent(new PopStateEvent('popstate', { state: history.state })); }, route);
  await page.waitForTimeout(400);
};

async function main() {
  await startStack({ demoData: true });
  const browser = await chromium.launch();
  const evil = { id: 880001, first_name: XSS, username: 'evil_user' };

  await step('hostile names and text are shown as text, never run (customer name, service name, ticket, proof note, policy)', async () => {
    // Put hostile text everywhere an admin or customer can type.
    const svc = await api(ADMIN, 'POST', '/api/admin/services', { platform: 'telegram', name_en: XSS, price: '10', min_qty: 10, max_qty: 100, note: XSS });
    assert.ok(svc.status < 300, JSON.stringify(svc.body));
    await api(ADMIN, 'POST', '/api/admin/policies', { title_en: XSS, body_en: XSS });
    const boot = (await api(evil, 'GET', '/api/bootstrap')).body;
    const o = await api(evil, 'POST', '/api/orders', { side: 'buy', usdt: '10', network: boot.catalog.networks[0].code, method: boot.catalog.methods[0].code, address: 'TLsV52sRDL79HXGGm9yzwKibb6BeruhUzy', idem: 'idem-evil-0001' });
    await api(evil, 'POST', `/api/orders/${o.body.order.id}/evidence`, evidenceForm({ text: XSS, photo: png(5) }));
    const f = new FormData(); f.append('category', 'other'); f.append('text', XSS);
    await api(evil, 'POST', '/api/tickets', f);
    for (const [user, routes] of [[evil, ['/', '/services', '/orders', '/support', '/policies', `/order/${o.body.order.id}`]], [ADMIN, ['/admin', '/admin/services', '/admin/policies', `/admin/order/${o.body.order.id}`, '/admin/tickets', '/admin/audit']]]) {
      const { page, errors } = await open(browser, { user });
      await page.locator('.nav a').first().waitFor();
      for (const r of routes) { await go(page, r); }
      assert.equal(await page.evaluate(() => window.__pwned), undefined, 'hostile script ran');
      assert.equal(await page.locator('img[src="x"]').count(), 0, 'hostile image tag was created');
      assert.deepEqual(errors, []);
      await page.context().close();
    }
  });

  await step('no screen scrolls sideways on a 320 px wide phone (customer and owner, light and dark)', async () => {
    const bad = [];
    for (const [user, scheme, routes] of [
      [ALICE, 'light', ['/', '/rates', '/orders', '/support', '/policies', '/services', '/trade/buy', '/trade/sell', '/ticket/new']],
      [ADMIN, 'dark', ['/admin', '/admin/setup', '/admin/rates', '/admin/methods', '/admin/method/new', '/admin/networks', '/admin/network/new', '/admin/services', '/admin/service/new', '/admin/policies', '/admin/team', '/admin/alerts', '/admin/emoji', '/admin/audit', '/admin/tickets', '/admin/settings']],
    ]) {
      const { page } = await open(browser, { user, width: 320, scheme });
      await page.locator('.nav a').first().waitFor();
      for (const r of routes) {
        await go(page, r);
        const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, wide: [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && !e.closest('.nav')).slice(0, 2).map((e) => `${e.tagName}.${e.className}`.slice(0, 50)) }));
        if (m.sw > m.iw + 1) bad.push(`${scheme} ${r}: ${m.sw}>${m.iw} ${m.wide.join(' ')}`);
      }
      await page.context().close();
    }
    assert.deepEqual(bad, []);
  });

  await step('long names and numbers do not break the layout', async () => {
    await api(ADMIN, 'POST', '/api/admin/methods', { kind: 'bank', label_en: 'Some Very Long Bank Name International Ethiopia Share Company', account_name: 'Aberash Tesfaye Gebremedhin Haile-Selassie', account_number: '1000123456789012345678901234' });
    const { page } = await open(browser, { user: ALICE, width: 320 });
    await page.locator('.nav a').first().waitFor();
    for (const r of ['/trade/buy', '/trade/sell', '/rates']) {
      await go(page, r);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${r} overflows`);
    }
    await page.context().close();
  });

  await step('first load: how many files, how many bytes, how long on a slow phone connection', async () => {
    const fast = await open(browser, { user: ALICE });
    await fast.page.locator('.pillow.buy').waitFor();
    await fast.page.waitForLoadState('networkidle');
    const mine = fast.reqs.filter((r) => r.url().startsWith(APP));
    const sizes = await Promise.all(mine.map(async (r) => { const res = await r.response(); const b = await res?.body().catch(() => null); return b?.length || 0; }));
    const total = sizes.reduce((a, b) => a + b, 0);
    const js = mine.filter((r) => /\.js$/.test(r.url())).length;
    console.log(`    ${mine.length} requests (${js} script files), ${(total / 1024).toFixed(0)} KB before compression`);
    await fast.page.context().close();
    // Typical mid-range phone on a poor mobile connection ("Fast 3G"): 1.6 Mbit/s, 150 ms round trip.
    const slow = await open(browser, { user: ALICE, throttle: { offline: false, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, latency: 150 } });
    await slow.page.locator('.pillow.buy').waitFor({ timeout: 60000 });
    const ms = Date.now() - slow.t0;
    console.log(`    Market screen visible after ${(ms / 1000).toFixed(1)} s on a slow connection (first visit, nothing cached)`);
    await slow.page.reload();
    await slow.page.locator('.pillow.buy').waitFor({ timeout: 60000 });
    console.log('    second visit (cached) done');
    await slow.page.context().close();
    assert.ok(ms < 20000, 'first load is very slow');
  });
  await browser.close();
  console.log('\nRobustness checks passed.');
}
main().then(() => stopStack().then(() => process.exit(0)), async (e) => { console.error(e); await stopStack(); process.exit(1); });
