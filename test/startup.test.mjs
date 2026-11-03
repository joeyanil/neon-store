// The app must open, with real data, even when Telegram behaves badly: device storage that never answers, throwing buttons,
// a failing API. It must never sit on an empty screen.   npm run test:startup
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { ADMIN, ALICE, APP, BOT_TOKEN, startStack, step, stopStack } from './harness.mjs';
import { signInitData } from './helpers.js';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = require('playwright')); }
const MOCK = readFileSync(new URL('./tg-mock.js', import.meta.url), 'utf8');

async function open(browser, tweak, { user = ALICE, block, tgScript = '' } = {}) {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await c.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://telegram.org/**', (r) => r.fulfill({ contentType: 'application/javascript', body: tgScript }));
  if (block) await page.route(block, (r) => r.abort());
  await page.addInitScript(`window.__INIT = ${JSON.stringify({ initData: signInitData(BOT_TOKEN, user), user, scheme: 'light' })};`);
  await page.addInitScript(MOCK);
  if (tweak) await page.addInitScript(tweak);
  await page.goto(APP);
  return { page, errors };
}
const ready = (page, ms = 6000) => page.locator('.nav a').first().waitFor({ timeout: ms });

async function main() {
  await startStack({ demoData: true });
  const browser = await chromium.launch();
  await step('normal start shows the market with the demo shop', async () => {
    const { page } = await open(browser);
    await ready(page);
    assert.match(await page.locator('body').innerText(), /Buy USDT|Sell USDT/i);
  });
  await step('device storage that never answers does not keep the app from opening', async () => {
    const { page } = await open(browser, 'window.Telegram.WebApp.DeviceStorage = { getItem() {}, setItem() {} };');
    await ready(page, 5000);
  });
  await step('device storage that returns errors or odd values still opens', async () => {
    for (const impl of ['(k, cb) => cb("WRONG_KEY")', '(k, cb) => cb(null, undefined)', '(k, cb) => { throw new Error("no") }', '(k, cb) => cb(null, "{broken")']) {
      const { page } = await open(browser, `window.Telegram.WebApp.DeviceStorage = { getItem: ${impl}, setItem() { throw new Error('no') } };`);
      await ready(page, 5000);
    }
  });
  await step('buttons that throw (older or newer Telegram clients) do not blank the app', async () => {
    const { page } = await open(browser, 'const W = window.Telegram.WebApp; W.BackButton.show = () => { throw new Error("x") }; W.BackButton.hide = () => { throw new Error("x") }; W.setHeaderColor = () => { throw new Error("x") };');
    await ready(page, 5000);
  });
  await step('an error thrown inside Telegram\'s own script (like "Cannot read property postMessage of undefined") does not stop the app', async () => {
    const script = "setTimeout(function () { throw new TypeError(\"Cannot read property 'postMessage' of undefined\"); }, 30); setTimeout(function () { Promise.reject(new Error('telegram async')); }, 60);";
    const { page } = await open(browser, null, { tgScript: script });
    await ready(page, 6000);
    await page.waitForTimeout(500);
    assert.match(await page.locator('body').innerText(), /Buy USDT|Sell USDT/i);
    assert.equal(await page.getByText('could not start').count(), 0);
  });
  await step('native buttons that throw on every call fall back to the app\'s own bottom bar', async () => {
    const { page } = await open(browser, 'const W = window.Telegram.WebApp; for (const k of ["MainButton", "SecondaryButton"]) for (const m of ["setParams", "show", "hide", "showProgress", "hideProgress", "onClick", "offClick"]) W[k][m] = () => { throw new Error("no " + m); };');
    await ready(page, 6000);
    await page.evaluate(() => { history.pushState({ app: true, path: '/trade/buy', depth: 1 }, ''); dispatchEvent(new PopStateEvent('popstate', { state: history.state })); });
    await page.waitForTimeout(400);
    assert.ok(await page.locator('.actionbar button').count() >= 1, 'the app\'s own button bar is used');
  });
  await step('an old phone (Android WebView 80: no replaceChildren, replaceAll, at; no flex gap) opens and works', async () => {
    const OLD = 'for (const P of [Element, Document, DocumentFragment]) delete P.prototype.replaceChildren; delete String.prototype.replaceAll; delete Array.prototype.at;';
    const { page, errors } = await open(browser, OLD);
    await ready(page, 6000);
    assert.match(await page.locator('body').innerText(), /Buy USDT/i);
    // Pretend flex gap is missing and check the margin-based spacing keeps screens apart and inside the width.
    await page.evaluate(() => document.documentElement.classList.add('no-fg'));
    for (const route of ['/', '/trade/buy', '/services', '/orders', '/support']) {
      await page.evaluate((r) => { history.pushState({ app: true, path: r, depth: 1 }, ''); dispatchEvent(new PopStateEvent('popstate', { state: history.state })); }, route);
      await page.waitForTimeout(300);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${route} overflows without flex gap`);
    }
    await page.screenshot({ path: '/tmp/old-phone.png' });
    assert.deepEqual(errors, []);
  });
  await step('an Amharic-language phone and a user with no username open the app', async () => {
    const { page } = await open(browser, null, { user: { id: 424999, first_name: 'ሰላም', language_code: 'am' } });
    await ready(page);
  });
  await step('the owner opens every admin screen with the demo data and nothing breaks', async () => {
    const { page, errors } = await open(browser, null, { user: ADMIN });
    await ready(page);
    for (const route of ['/admin', '/admin/setup', '/admin/rates', '/admin/methods', '/admin/networks', '/admin/services', '/admin/policies', '/admin/team', '/admin/alerts', '/admin/emoji', '/admin/audit', '/admin/settings', '/services', '/rates', '/orders', '/support', '/policies', '/trade/buy', '/trade/sell']) {
      await page.evaluate((r) => { history.pushState({ app: true, path: r, depth: 1 }, ''); dispatchEvent(new PopStateEvent('popstate', { state: history.state })); }, route);
      await page.waitForTimeout(350);
      const text = await page.locator('body').innerText();
      assert.ok(text.trim().length > 20, `${route} is empty`);
      assert.ok(!/undefined|\[object|NaN|\bnull\b/.test(text), `${route} shows a raw value: ${text.slice(0, 200)}`);
    }
    assert.deepEqual(errors, []);
  });
  await step('every screen that is not a tab has a visible Back button inside Telegram, and it goes back', async () => {
    const { page } = await open(browser, null, { user: ADMIN });
    await ready(page);
    const routes = ['/services', '/service/demo-tg-subs', '/service/demo-tg-subs/review', '/ticket/new', '/policies', '/trade/buy', '/trade/sell', '/trade/buy/review', '/admin/tickets', '/admin/settings', '/admin/setup', '/admin/rates',
      '/admin/methods', '/admin/method/new', '/admin/networks', '/admin/network/new', '/admin/services', '/admin/service/new', '/admin/policies', '/admin/policy/new', '/admin/team', '/admin/alerts', '/admin/emoji', '/admin/audit'];
    const missing = [];
    for (const r of routes) {
      await page.evaluate(() => { history.replaceState({ app: true, path: '/', depth: 0, root: true }, ''); });
      await page.evaluate((p) => { history.pushState({ app: true, path: p, depth: 1 }, ''); dispatchEvent(new PopStateEvent('popstate', { state: history.state })); }, r);
      await page.waitForTimeout(250);
      const back = page.locator('.backbtn:visible, .backrow:visible').first();
      if (!(await back.count())) { missing.push(r); continue; }
    }
    assert.deepEqual(missing, [], 'screens without a Back button');
    // And it works: open a ticket form from Support, press Back, land on Support.
    await page.evaluate(() => { history.replaceState({ app: true, path: '/support', depth: 0, root: true }, ''); dispatchEvent(new PopStateEvent('popstate', { state: history.state })); });
    await page.getByText('New ticket').first().click();
    await page.locator('.backbtn:visible, .backrow:visible').first().click();
    await page.getByText('Chat with support').first().waitFor({ timeout: 3000 });
  });
  await step('when the server is down the person sees a message and a retry button, not a blank screen', async () => {
    const { page } = await open(browser, null, { block: '**/api/bootstrap' });
    await page.getByRole('button', { name: /retry|try again/i }).waitFor({ timeout: 6000 });
  });
  await step('when a script file cannot be loaded the person is told after a few seconds', async () => {
    const { page } = await open(browser, null, { block: '**/js/screens-home.js' });
    await page.getByText(/could not (load|start)/i).waitFor({ timeout: 14000 });
  });
  await browser.close();
  console.log('\nStartup checks passed.');
}
main().then(() => stopStack().then(() => process.exit(0)), async (e) => { console.error(e); await stopStack(); process.exit(1); });
