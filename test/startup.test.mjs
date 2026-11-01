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

async function open(browser, tweak, { user = ALICE, block } = {}) {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await c.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://telegram.org/**', (r) => r.fulfill({ contentType: 'application/javascript', body: '' }));
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
  await step('an Amharic-language phone and a user with no username open the app', async () => {
    const { page } = await open(browser, null, { user: { id: 424999, first_name: 'ሰላም', language_code: 'am' } });
    await ready(page);
  });
  await step('the owner opens every admin screen with the demo data and nothing breaks', async () => {
    const { page, errors } = await open(browser, null, { user: ADMIN });
    await ready(page);
    for (const route of ['/admin', '/admin/setup', '/admin/rates', '/admin/methods', '/admin/networks', '/admin/services', '/admin/policies', '/admin/team', '/admin/alerts', '/admin/audit', '/admin/settings', '/services', '/rates', '/orders', '/support', '/policies', '/trade/buy', '/trade/sell']) {
      await page.evaluate((r) => { history.pushState({ app: true, path: r, depth: 1 }, ''); dispatchEvent(new PopStateEvent('popstate', { state: history.state })); }, route);
      await page.waitForTimeout(350);
      const text = await page.locator('body').innerText();
      assert.ok(text.trim().length > 20, `${route} is empty`);
      assert.ok(!/undefined|\[object|NaN|\bnull\b/.test(text), `${route} shows a raw value: ${text.slice(0, 200)}`);
    }
    assert.deepEqual(errors, []);
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
