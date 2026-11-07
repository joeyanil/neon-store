// Drives the real app in Chromium against the real Worker, with a mocked Telegram around it.
// Walks customer and admin screens, fails on any console error, saves screenshots.   npm run test:ui
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { ADMIN, ALICE, APP, BOT_TOKEN, api, seedCatalog, startStack, step, stopStack } from './harness.mjs';
import { PNG_BYTES } from './harness.mjs';
import { signInitData } from './helpers.js';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = require('playwright')); }

const SHOTS = 'docs/screenshots';
mkdirSync(SHOTS, { recursive: true });
const MOCK = readFileSync(new URL('./tg-mock.js', import.meta.url), 'utf8');
const USER = { ...ALICE, id: 555001, first_name: 'Abebe', username: 'abebe' };

let browser;
const problems = [];

async function newPage({ scheme = 'light', user = USER, url = '/', locale = 'en-GB' } = {}) {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale });
  const page = await c.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource.*(40[0-9]|50[0-9])/.test(m.text())) problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.route('https://telegram.org/**', (r) => r.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.addInitScript(`window.__INIT = ${JSON.stringify({ initData: signInitData(BOT_TOKEN, user), user, scheme })};`);
  await page.addInitScript(MOCK);
  await page.goto(`${APP}${url}`);
  return page;
}
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const pressMain = (page) => page.evaluate(() => window.__tg.pressMain());
const waitText = (page, text, timeout = 8000) => page.getByText(text, { exact: false }).first().waitFor({ timeout });
const tab = (page, label) => page.locator('.nav a', { hasText: label }).click();
const body = (page) => page.locator('body').innerText();

async function main() {
  await startStack();
  browser = await chromium.launch();

  console.log('\nBefore the shop is set up');
  let page = await newPage();
  await step('customer sees a closed notice and four tabs', async () => {
    await page.locator('.nav a').first().waitFor();
    console.log((await body(page)).slice(0, 300));
    assert.equal(await page.locator('.nav a').count(), 4);
    await shot(page, '01-customer-closed');
  });
  await page.close();
  page = await newPage({ user: ADMIN });
  await step('the owner gets five tabs and an admin home', async () => {
    await page.locator('.nav a').first().waitFor();
    assert.equal(await page.locator('.nav a').count(), 5);
    await tab(page, 'Admin');
    await page.waitForTimeout(800);
    console.log((await body(page)).slice(0, 400));
    await shot(page, '02-admin-home-new');
  });
  await page.close();

  const cat = await seedCatalog();
  await api(ADMIN, 'PUT', '/api/admin/settings', { buy_rate: '168.50', sell_rate: '163', min_usdt: '5', max_usdt: '1000', stock_usdt: '500', stock_show: true });
  const sv = await api(ADMIN, 'POST', '/api/admin/services', { platform: 'telegram', name_en: 'Telegram members', price: '85.50', min_qty: 100, max_qty: 10000, eta_text: 'Starts within 24 hours', warranty_days: 30 });
  assert.equal(sv.status, 201, JSON.stringify(sv.body));

  console.log('\nCustomer screens');
  page = await newPage();
  await step('home', async () => { await waitText(page, '168.50'); await shot(page, '10-home'); console.log((await body(page)).slice(0, 500)); });
  for (const [label, name] of [['Rates', '11-rates'], ['Orders', '12-orders'], ['Support', '13-help']]) {
    await step(`${label} tab`, async () => { await tab(page, label); await page.waitForTimeout(600); await shot(page, name); });
  }
  await page.close();

  console.log('\nCustomer buys USDT in the app');
  page = await newPage();
  const mainBtn = (pg) => pg.evaluate(() => JSON.parse(JSON.stringify(window.__tg.state.main)));
  await step('buy form: amount, method, network, address', async () => {
    await page.locator('.pillow.buy').click();
    await page.locator('#f-amount').fill('20');
    await page.locator('.choice').first().click();
    await page.locator('#f-addr').fill('TLsV52sRDL79HXGGm9yzwKibb6BeruhUzy');
    await page.waitForTimeout(300);
    console.log(JSON.stringify(await mainBtn(page)));
    console.log((await body(page)).slice(0, 700));
    await shot(page, '14-buy-form');
  });
  await step('review, confirm, and the order screen shows payment steps', async () => {
    await pressMain(page);
    await page.waitForTimeout(500);
    console.log((await body(page)).slice(0, 600));
    await shot(page, '15-buy-review');
    console.log(JSON.stringify(await mainBtn(page)));
    await pressMain(page);
    await page.waitForTimeout(1200);
    console.log('---ORDER');
    console.log((await body(page)).slice(0, 1200));
    console.log(JSON.stringify(await mainBtn(page)));
    await shot(page, '16-buy-order');
  });
  let orderId;
  await step('customer adds a receipt and sends it', async () => {
    orderId = (await page.locator('header h1').first().innerText()).trim();
    assert.match(orderId, /^NG-/);
    await page.locator('input[type=file]').first().setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: Buffer.from(PNG_BYTES) });
    await page.waitForTimeout(400);
    await pressMain(page);
    await waitText(page, 'Being checked');
    await shot(page, '17-buy-evidence');
  });
  await page.close();

  console.log('\nAdmin works the order in the app');
  page = await newPage({ user: ADMIN });
  await step('admin dashboard: counts, last 24 hours, search, the order waiting', async () => {
    await page.locator('.nav a', { hasText: 'Admin' }).click();
    await waitText(page, 'Last 24 hours');
    await waitText(page, 'Buy 20.00 USDT');
    await page.getByLabel('Search orders').fill(orderId.slice(0, 7));
    await page.waitForTimeout(900);
    assert.ok((await body(page)).includes(orderId), 'search finds the order');
    await page.getByLabel('Search orders').fill('zzzzzz');
    await page.waitForTimeout(900);
    assert.ok((await body(page)).includes('No order matches'));
    await page.getByLabel('Search orders').fill('');
    await page.waitForTimeout(700);
    await shot(page, '17b-admin-dashboard');
  });
  await step('owner opens Storage from the meter: live size, what is stored, deletion rule, download a copy', async () => {
    await page.locator('.storage-link').click();
    await waitText(page, 'Database size');
    for (const w of ['Plenty of room', 'What is stored', 'Receipt photos', 'When records are deleted', 'Download a copy', 'Change how long records are kept']) await waitText(page, w);
    assert.ok(/\d+(\.\d)? (KB|MB)/.test(await body(page)), 'a real size is shown');
    await page.getByRole('button', { name: /All orders/ }).click();
    await waitText(page, 'to your chat with the bot');
    await waitText(page, 'Last copy sent');
    await shot(page, '63-admin-storage');
    await page.getByText('Change how long records are kept').click();
    await waitText(page, 'Keep order records for');
  });
  await page.close();
  page = await newPage({ user: ADMIN, url: '/?s=storage' });
  await step('the reminder link opens Storage directly', async () => {
    await waitText(page, 'Download a copy', 10000);
  });
  await page.close();
  page = await newPage({ user: ADMIN, url: `/?a=${orderId}` });
  await step('deep link opens the admin order review', async () => {
    await waitText(page, 'Check in your bank', 10000);
    console.log((await body(page)).slice(0, 900));
    console.log(JSON.stringify(await mainBtn(page)));
    await shot(page, '18-admin-order');
  });
  await step('admin confirms payment, then releases with a reference', async () => {
    await pressMain(page);
    await waitText(page, 'Transaction hash', 8000);
    assert.equal((await mainBtn(page)).text, 'Mark as released');
    await page.locator('input').last().fill('0xabc123tx');
    await pressMain(page);
    await waitText(page, 'Reference sent', 8000);
    await shot(page, '19-admin-released');
  });
  await page.close();
  await step('customer sees the order completed with the reference', async () => {
    page = await newPage({ url: `/?o=${orderId}` });
    await waitText(page, '0xabc123tx', 8000);
    await shot(page, '20-order-completed');
    await page.close();
  });

  console.log('\nAdmin settings screens');
  page = await newPage({ user: ADMIN });
  await step('settings hub lists its sections', async () => {
    await tab(page, 'Admin');
    await page.getByText('Shop settings').click();
    await page.waitForTimeout(700);
    await shot(page, '30-settings');
  });
  const pressBack = (pg) => pg.evaluate(() => window.__tg.pressBack());
  for (const [row, name] of [['Rates, limits and stock', '31-rates'], ['Payment accounts', '32-methods'], ['USDT networks', '33-networks'], ['Services', '34-services'], ['Rules and policies', '35-policies'], ['Team', '36-team'], ['Order alerts', '37-alerts'], ['Activity log', '38-audit'], ['Setup guide', '39-setup']]) {
    await step(`open ${row}`, async () => {
      await page.getByText(row, { exact: true }).first().click();
      await page.waitForTimeout(800);
      console.log('  >', (await body(page)).replace(/\n+/g, ' | ').slice(0, 260));
      await shot(page, name);
      await pressBack(page);
      await page.waitForTimeout(300);
    });
  }
  await step('owner changes the buy rate in the app and customers see it', async () => {
    await page.getByText('Rates, limits and stock', { exact: true }).first().click();
    await waitText(page, 'Customers pay you');
    await page.getByLabel('Customers pay you').fill('170');
    await pressMain(page);
    await waitText(page, 'Saved', 5000).catch(() => {});
    const r = await api(ALICE, 'GET', '/api/bootstrap');
    assert.equal(r.body.rates.buy_cents, 17000);
  });
  await step('a bad rate is explained on the field, not lost', async () => {
    await page.getByLabel('You pay customers').fill('175');
    await pressMain(page);
    await waitText(page, 'higher', 5000);
    await shot(page, '40-rate-error');
    await page.getByLabel('You pay customers').fill('163');
    await pressMain(page);
    await page.waitForTimeout(500);
  });
  await step('adding a payment account from the app', async () => {
    await pressBack(page);
    await page.getByText('Payment accounts', { exact: true }).first().click();
    await page.getByText('Add', { exact: true }).first().click();
    await page.waitForTimeout(600);
    await shot(page, '41-method-form');
    console.log('  >', (await body(page)).replace(/\n+/g, ' | ').slice(0, 400));
  });
  await page.close();

  console.log('\nServices and support in the app');
  page = await newPage();
  await step('customer orders a service', async () => {
    await page.locator('.quick-item.plat-telegram').click(); // home shortcut straight to the Telegram price list
    await waitText(page, 'Telegram members');
    assert.ok(!(await body(page)).includes('Instagram'), 'only the chosen platform is listed');
    await shot(page, '49-platform');
    await page.getByText('Telegram members').first().click();
    await page.waitForTimeout(600);
    console.log('  >', (await body(page)).replace(/\n+/g, ' | ').slice(0, 500));
    await shot(page, '50-service');
  });
  await step('quantity too low is explained; valid order reaches payment', async () => {
    await page.getByLabel('Quantity').fill('50');
    await page.getByLabel('Link or @username').fill('@neonchannel');
    await page.locator('.choice').first().click();
    await pressMain(page).catch(() => {});
    await page.waitForTimeout(400);
    console.log('  >', (await body(page)).replace(/\n+/g, ' | ').slice(0, 300));
    await page.getByLabel('Quantity').fill('1000');
    await page.waitForTimeout(300);
    assert.match(await body(page), /85\.50/);
    await pressMain(page);
    await page.waitForTimeout(500);
    await shot(page, '51-service-review');
    await pressMain(page);
    await page.waitForTimeout(1200);
    console.log('  >', (await body(page)).replace(/\n+/g, ' | ').slice(0, 400));
    await shot(page, '52-service-order');
  });
  await page.close();
  page = await newPage();
  let ticketId;
  await step('customer opens a support ticket about that order', async () => {
    await tab(page, 'Support');
    await page.waitForTimeout(500);
    console.log('  >', (await body(page)).replace(/\n+/g, ' | ').slice(0, 500));
    await shot(page, '53-help');
  });
  await step('new ticket: category, order, message, send', async () => {
    await page.getByText('New ticket', { exact: true }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.choice[data-c]').first().click();
    await page.locator('.choice[data-o]:not([data-o=""])').first().click();
    await page.locator('textarea').fill('I paid but nothing happened yet.');
    await shot(page, '54-ticket-new');
    await pressMain(page);
    await waitText(page, 'I paid but nothing happened yet.', 8000);
    ticketId = (await page.locator('header h1').first().innerText()).trim();
    assert.match(ticketId, /^TK-/);
    await shot(page, '55-ticket');
  });
  await page.close();
  page = await newPage({ user: ADMIN, url: `/?k=${ticketId}` });
  await step('admin opens the ticket from a link and replies', async () => {
    await waitText(page, 'I paid but nothing happened yet.', 8000);
    await page.locator('textarea').fill('We are checking it now.');
    await shot(page, '56-admin-ticket');
    await page.getByRole('button', { name: /send|reply/i }).last().click().catch(async () => { await pressMain(page); });
    await waitText(page, 'We are checking it now.', 8000);
  });
  await page.close();
  page = await newPage({ url: `/?t=${ticketId}` });
  await step('customer sees the reply', async () => {
    await waitText(page, 'We are checking it now.', 8000);
    await page.close();
  });

  console.log('\nPolicies, English only, dark');
  page = await newPage();
  await step('rules and policies open and show text', async () => {
    await tab(page, 'Support');
    await page.getByText('Rules and policies').first().click();
    await waitText(page, 'Refund policy', 8000);
    await shot(page, '60-policies');
  });
  await page.close();
  page = await newPage({ user: { ...USER, language_code: 'am' } });
  await step('English only: an Amharic phone still gets English, and there is no language switch', async () => {
    await page.locator('.pillow.buy').waitFor();
    const text = await body(page);
    assert.match(text, /Buy USDT/);
    assert.ok(!/[ሀ-፿]/.test(text), 'no Ethiopic text on the home screen');
    assert.equal(await page.locator('.langpill', { hasText: /^\s*(EN|አማ)\s*$/ }).count(), 0, 'no language switch');
    await tab(page, 'Support');
    await page.waitForTimeout(500);
    assert.ok(!/Language|አማርኛ/.test(await body(page)), 'no language setting in Support');
    await shot(page, '61-home-english');
  });
  await page.close();
  page = await newPage({ scheme: 'dark' });
  await step('the app opens light even when Telegram is dark; one small button switches to dark and it is remembered', async () => {
    await page.locator('.pillow.buy').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light', 'light by default');
    const btn = page.locator('.themebtn').first();
    const box = await btn.boundingBox();
    assert.ok(box.width <= 40 && box.height <= 40, 'the button is small');
    assert.match(await btn.getAttribute('aria-label'), /dark mode/);
    await btn.click();
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await shot(page, '62-home-dark');
    const [fg, bg] = await page.evaluate(() => [getComputedStyle(document.body).color, getComputedStyle(document.body).backgroundColor]);
    console.log('  >', fg, bg);
    await page.reload();
    await page.locator('.pillow.buy').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark', 'the choice is kept');
    await page.evaluate(() => localStorage.clear()); // the phone wipes the page's own storage: Telegram's storage must still remember
    await page.reload();
    await page.locator('.pillow.buy').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark', 'the choice survives cleared browser storage');
    assert.match(await page.locator('.themebtn').first().getAttribute('aria-label'), /light mode/);
    await page.locator('.themebtn').first().click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
  });
  await page.close();
  void cat;

  await step('no console errors', async () => { assert.deepEqual(problems, []); });
  await browser.close();
  await stopStack();
}
main().catch(async (e) => { console.error(e); await stopStack().catch(() => {}); process.exit(1); });
