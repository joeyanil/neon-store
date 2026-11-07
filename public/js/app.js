// Starts the app: Telegram setup, login, routing, bottom navigation.
import './compat.js';
import { admin, api, ApiError } from './api.js';
import { S } from './components.js';
import { errorText, setLang, t } from './i18n.js';
import { homeScreen } from './screens-home.js';
import { adminHomeScreen, adminOrderScreen, adminTicketScreen, adminTicketsScreen } from './screens-admin.js';
import * as AS from './screens-admin-settings.js';
import { storageScreen } from './screens-admin-storage.js';
import { helpScreen, policiesScreen, ticketNewScreen, ticketScreen } from './screens-help.js';
import { ordersScreen, ratesScreen } from './screens-lists.js';
import { serviceScreen, servicesScreen } from './screens-service.js';
import { orderScreen } from './screens-order.js';
import { tradeScreen } from './screens-trade.js';
import * as TG from './tg.js';
import { h, icon } from './ui.js';

const app = document.getElementById('app');
const CUSTOMER_TABS = [
  { path: '/', key: 'nav_market', icon: 'market' },
  { path: '/rates', key: 'nav_rates', icon: 'rates' },
  { path: '/orders', key: 'nav_orders', icon: 'orders' },
  { path: '/support', key: 'nav_support', icon: 'support' },
];
const ADMIN_TAB = { path: '/admin', key: 'nav_admin', icon: 'admin' };
const tabs = () => (S.boot?.role ? [...CUSTOMER_TABS, ADMIN_TAB] : CUSTOMER_TABS);
const CODE = '([a-z0-9-]+|\\d+)';
const ROUTES = [
  { re: /^\/$/, screen: homeScreen, tab: true },
  { re: /^\/rates$/, screen: ratesScreen, tab: true },
  { re: /^\/orders$/, screen: ordersScreen, tab: true },
  { re: /^\/support$/, screen: helpScreen, tab: true },
  { re: /^\/admin$/, screen: adminHomeScreen, tab: true },
  { re: /^\/services$/, screen: servicesScreen },
  { re: /^\/services\/(telegram|instagram|tiktok|youtube|other)$/, screen: servicesScreen, params: (m) => ({ platform: m[1] }) },
  { re: /^\/service\/([a-z0-9-]+)$/, screen: serviceScreen, params: (m) => ({ code: m[1] }) },
  { re: /^\/service\/([a-z0-9-]+)\/review$/, screen: serviceScreen, params: (m) => ({ code: m[1], step: 'review' }) },
  { re: /^\/ticket\/new$/, screen: ticketNewScreen },
  { re: /^\/ticket\/(TK-[2-9A-HJKMNP-Z]{6})$/, screen: ticketScreen, params: (m) => ({ id: m[1] }) },
  { re: /^\/policies$/, screen: policiesScreen },
  { re: /^\/admin\/order\/(NG-[2-9A-HJKMNP-Z]{6})$/, screen: adminOrderScreen, params: (m) => ({ id: m[1] }) },
  { re: /^\/admin\/tickets$/, screen: adminTicketsScreen },
  { re: /^\/admin\/ticket\/(TK-[2-9A-HJKMNP-Z]{6})$/, screen: adminTicketScreen, params: (m) => ({ id: m[1] }) },
  { re: /^\/admin\/settings$/, screen: AS.settingsHubScreen },
  { re: /^\/admin\/storage$/, screen: storageScreen },
  { re: /^\/admin\/setup$/, screen: AS.setupScreen },
  { re: /^\/admin\/rates$/, screen: AS.ratesSettingsScreen },
  { re: /^\/admin\/methods$/, screen: AS.methodsListScreen },
  { re: new RegExp(`^/admin/method/${CODE}$`), screen: AS.methodFormScreen, params: (m) => ({ code: m[1] }) },
  { re: /^\/admin\/networks$/, screen: AS.networksListScreen },
  { re: new RegExp(`^/admin/network/${CODE}$`), screen: AS.networkFormScreen, params: (m) => ({ code: m[1] }) },
  { re: /^\/admin\/services$/, screen: AS.servicesListScreen },
  { re: new RegExp(`^/admin/service/${CODE}$`), screen: AS.serviceFormScreen, params: (m) => ({ code: m[1] }) },
  { re: /^\/admin\/policies$/, screen: AS.policiesListScreen },
  { re: new RegExp(`^/admin/policy/${CODE}$`), screen: AS.policyFormScreen, params: (m) => ({ code: m[1] }) },
  { re: /^\/admin\/team$/, screen: AS.teamScreen },
  { re: /^\/admin\/alerts$/, screen: AS.alertsScreen },
  { re: /^\/admin\/emoji$/, screen: AS.buttonEmojiScreen },
  { re: /^\/admin\/channels$/, screen: AS.channelsScreen },
  { re: /^\/admin\/audit$/, screen: AS.auditScreen },
  { re: /^\/trade\/(buy|sell)$/, screen: tradeScreen, params: (m) => ({ side: m[1] }) },
  { re: /^\/trade\/(buy|sell)\/review$/, screen: tradeScreen, params: (m) => ({ side: m[1], step: 'review' }) },
  { re: /^\/order\/(NG-[2-9A-HJKMNP-Z]{6})$/, screen: orderScreen, params: (m) => ({ id: m[1] }) },
];

let current = null;   // { screen instance, path }
let nav = null;
let fallbackBar = null;

// ---------- router: the address bar never changes, history entries carry the route ----------
const stateOf = () => history.state?.app ? history.state : { app: true, path: '/', depth: 0 };
export function go(path) { history.pushState({ app: true, path, depth: stateOf().depth + 1 }, ''); show(path); }
export function replace(path, extra = {}) { history.replaceState({ app: true, path, depth: extra.root ? 0 : stateOf().depth, root: Boolean(extra.root) }, ''); show(path); }
function back() {
  const s = stateOf();
  if (s.depth > 0 && !s.root) history.back();
  else replace('/');
}
addEventListener('popstate', () => show(stateOf().path));

const ctx = {
  go, replace, back,
  updateNav: () => paintNav(),
  setLang: async (lang) => { await applyLang(lang); api.setLanguage(lang).catch(() => {}); },
  toggleLang: () => ctx.setLang(S.lang === 'en' ? 'am' : 'en'),
  setTheme: (pref) => { S.themePref = pref; TG.prefs.set('neon.theme', pref); TG.applyTheme(pref); },
  openChat: (url) => TG.openTelegramLink(url),
  requestMessages: async () => { const ok = await TG.requestWriteAccess(); if (ok) { S.boot.user.can_dm = true; api.markCanDm().catch(() => {}); } return ok; },
  openIds: new Set(),
  params: {},
};

function show(path) {
  current?.screen.destroy?.();
  TG.setActions(null);
  for (const r of ROUTES) {
    const m = r.re.exec(path);
    if (!m) continue;
    ctx.params = r.params ? r.params(m) : {};
    const screen = r.screen(ctx);
    current = { screen, path, tab: Boolean(r.tab) };
    // Every screen except the five tabs gets a visible Back button, even where the screen forgot to add its own.
    // (Telegram's own back arrow is missing or hidden on some phones.)
    if (!r.tab && !screen.el.querySelector('.backbtn')) {
      screen.el.prepend(h('button', { class: 'backrow', type: 'button', onclick: back, 'aria-label': t('back') }, icon('back', 20), t('back')));
    }
    app.replaceChildren(screen.el);
    window.scrollTo(0, 0);
    nav.classList.toggle('hide', !r.tab);
    paintNav();
    TG.setBack(r.tab ? null : back);
    document.title = `${t('app_name')}`;
    return;
  }
  replace('/');
}

// ---------- bottom nav ----------
function buildNav() {
  nav = h('nav', { class: 'nav', 'aria-label': 'Main' });
  document.body.append(nav);
}
function paintNav() {
  const path = current?.path || '/';
  const list = tabs();
  nav.classList.toggle('five', list.length === 5);
  nav.replaceChildren(...list.map((tab) => {
    const a = h('a', { href: '#', class: `tab-${tab.icon}`, 'aria-current': tab.path === path ? 'page' : null, onclick: (e) => {
      e.preventDefault();
      if (tab.path === path) { current?.screen.refresh?.(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      TG.haptic.select();
      replace(tab.path, { root: true });
    } }, icon(tab.icon), t(tab.key));
    if (tab.path === '/orders' && S.activeCount > 0) a.append(h('span', { class: 'dot', 'aria-label': String(S.activeCount) }, String(S.activeCount)));
    if (tab.path === '/admin' && S.adminBadge > 0) a.append(h('span', { class: 'dot', 'aria-label': String(S.adminBadge) }, String(S.adminBadge)));
    return a;
  }));
}

// ---------- language and theme ----------
async function applyLang(lang) {
  S.lang = lang;
  setLang(lang);
  TG.prefs.set('neon.lang', lang);
  if (current) show(current.path);
}

// ---------- start up ----------
function splash() {
  app.replaceChildren(h('div', { class: 'splash' }, h('div', { class: 'orb' }, icon('ghost', 40))));
}

function fatal(err) {
  TG.setActions(null);
  nav?.classList.add('hide');
  const session = err.code === 'session_expired' || err.code === 'unauthorized';
  app.replaceChildren(h('div', { class: 'screen' }, h('div', { class: 'clay stack', role: 'alert' },
    h('div', { class: 'notice warn' }, icon('alert', 20), errorText(err)),
    h('button', { class: 'btn primary', type: 'button', onclick: () => (session ? TG.closeApp() : start()) }, session ? t('close') : t('retry')))));
}

async function start() {
  splash();
  try {
    const boot = await api.bootstrap();
    S.boot = boot;
        S.lang = 'en'; // English only for now; saved language preferences are ignored
    setLang(S.lang);
    const deep = deepLink();
    if (deep) replace(deep, { root: true });
    else replace('/', { root: true });
    api.listOrders('active').then((r) => { S.activeCount = r.orders.length; paintNav(); }).catch(() => {});
    if (boot.role) admin.summary().then((s) => { S.adminBadge = s.counts.review + s.counts.release + s.counts.tickets; paintNav(); }).catch(() => {});
  } catch (err) {
    fatal(err instanceof ApiError ? err : new ApiError('server_error', 'Unexpected error'));
  }
}

/** Links from bot messages: ?o= order, ?a= admin order, ?t= ticket, ?k= admin ticket (or the same as a start parameter). */
function deepLink() {
  const q = new URLSearchParams(location.search);
  const sp = TG.startParam();
  const pick = (key, letter, re) => {
    const v = q.get(key) || new RegExp(`^${letter}_(.+)$`).exec(sp)?.[1];
    return v && re.test(v) ? v : null;
  };
  const ORDER = /^NG-[2-9A-HJKMNP-Z]{6}$/;
  const TICKET = /^TK-[2-9A-HJKMNP-Z]{6}$/;
  const o = pick('o', 'o', ORDER);
  if (o) return `/order/${o}`;
  const t = pick('t', 't', TICKET);
  if (t) return `/ticket/${t}`;
  if (S.boot.role) {
    const ao = pick('a', 'a', ORDER);
    if (ao) return `/admin/order/${ao}`;
    const k = pick('k', 'k', TICKET);
    if (k) return `/admin/ticket/${k}`;
  }
  if (S.boot.role === 'owner' && (q.get('s') === 'storage' || sp === 's_storage')) return '/admin/storage';
  return null;
}

// After an admin saves anything, reload the shop data so the Market, Rates and Services screens show it at once.
let reloading = false;
addEventListener('neon:shop-changed', async () => {
  if (reloading || !S.boot) return;
  reloading = true;
  try {
    S.boot = { ...(await api.bootstrap()), user: { ...S.boot.user } };
    if (S.boot.role) admin.summary().then((s) => { S.adminBadge = s.counts.review + s.counts.release + s.counts.tickets; paintNav(); }).catch(() => {});
  } catch { /* the next screen load will try again */ } finally { reloading = false; }
});

async function main() {
  TG.init();
  S.themePref = (await TG.prefs.get('neon.theme')) || 'light'; // light until the person chooses otherwise
  document.addEventListener('neon-theme-toggle', () => ctx.setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  TG.applyTheme(S.themePref);
  TG.onThemeChanged(() => { if (S.themePref === 'auto') TG.applyTheme('auto'); });
  TG.watchKeyboard();
  fallbackBar = h('div', { class: 'actionbar', hidden: true });
  document.body.append(fallbackBar);
  TG.mountFallbackBar(fallbackBar);
  buildNav();
  nav.classList.add('hide');
  TG.onActivated(async () => {
    if (!S.boot) return;
    try { S.boot = { ...(await api.bootstrap()), user: { ...S.boot.user } }; } catch { /* keep the last known rates */ }
    current?.screen.refresh?.();
  });
  await start();
}
// Whatever goes wrong, the person sees a message and a retry button, never an empty screen.
function showCrash(err) {
  console.error(err);
  try {
    app.replaceChildren(h('div', { class: 'screen' }, h('div', { class: 'clay stack', role: 'alert' },
      h('div', { class: 'notice warn' }, icon('alert', 20), 'The app could not start.'),
      h('p', { class: 'muted' }, String(err?.message || err || 'Unknown problem').slice(0, 200), err?.stack ? ` [${String(err.stack).split('\n').slice(1, 3).map((l) => l.trim().replace(location.origin, '').replace(/^at /, '')).join(' < ').slice(0, 160)}]` : ''),
      h('button', { class: 'btn primary', type: 'button', onclick: () => location.reload() }, 'Try again'))));
  } catch { /* nothing more to do */ }
}
// Only the app's own errors count. Telegram's script (another website, so its errors arrive as an anonymous "Script error."
// with no file name) must never stop the app: it has its own handling and the app works without its answers.
const starting = () => !app.firstChild || app.querySelector('.splash');
addEventListener('error', (e) => {
  if (!e.filename || !String(e.filename).startsWith(location.origin) || !starting()) return;
  showCrash(`${e.message} (${String(e.filename).replace(location.origin, '')}:${e.lineno})`);
});
addEventListener('unhandledrejection', (e) => {
  if (starting() && (e.reason instanceof ApiError || String(e.reason?.stack || '').includes(location.origin))) showCrash(e.reason);
});
main().catch(showCrash);
