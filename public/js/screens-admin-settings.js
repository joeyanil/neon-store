// Admin settings: hub, rates / limits / stock, payment accounts, USDT networks, services, rules, team, alerts, activity, setup guide.
import { admin, api } from './api.js';
import { S } from './components.js';
import { flowTop, listRow, segField, textArea, textField, toggleRow, countBubble } from './form.js';
import { errorText, formatWhen, t } from './i18n.js';
import { confirmDialog, haptic, setActions } from './tg.js';
import { h, icon, skeletons, toast } from './ui.js';

const toBirr = (c) => (c ? (c / 100).toFixed(2) : '');
const toUsdt = (m) => (m ? (m / 1e6).toFixed(6).replace(/0+$/, '').replace(/\.$/, '') : '');
const card = (...kids) => h('section', { class: 'clay stack' }, ...kids);
const title = (text) => h('h2', { class: 'section-title' }, text);
const lead = (name) => h('span', { class: 'side-dot svc', 'aria-hidden': 'true' }, icon(name, 20));

/** Sends a form to the server, shows the server's field message under the right input, and returns the result or null. */
async function submit(fields, call) {
  try {
    return await call();
  } catch (err) {
    const f = err.extra?.field;
    if (f && fields[f]) { fields[f].error(err.message); haptic.error(); }
    toast(errorText(err), 'error');
    return null;
  }
}

function loading(root, load) {
  const box = h('div', { class: 'stack' }, ...skeletons(120, 120));
  root.append(box);
  load().then((el) => box.replaceWith(el)).catch((err) => box.replaceChildren(h('div', { class: 'notice warn' }, icon('alert', 20), errorText(err))));
}

// ---------- hub ----------
export function settingsHubScreen(ctx) {
  const root = h('div', { class: 'screen' }, flowTop(ctx, 'Shop settings'));
  loading(root, async () => {
    const [setup, methods, networks, services, policies] = await Promise.all([admin.setup(), admin.list('methods'), admin.list('networks'), admin.list('services'), admin.list('policies')]);
    const row = (name, ttl, sub, path, badge) => listRow({ title: ttl, sub, lead: lead(name), badge, onClick: () => ctx.go(path) });
    const rows = [
      setup.complete ? null : listRow({ title: 'Setup guide', sub: 'A few steps are still missing', lead: lead('alert'), badge: h('span', { class: 'pill warn' }, 'Finish'), onClick: () => ctx.go('/admin/setup') }),
      row('rates', 'Rates, limits and stock', 'Prices, order sizes, USDT you hold, pause', '/admin/rates'),
      row('orders', 'Payment accounts', `${methods.methods.length} added · where customers pay you, and how you pay them`, '/admin/methods'),
      row('globe', 'USDT networks', `${networks.networks.length} added · deposit addresses and sending options`, '/admin/networks'),
      row('bag', 'Services', `${services.services.length} on the price list`, '/admin/services'),
      row('send', 'Channels', 'Channel, reviews and logs links on the bot', '/admin/channels'),
      row('book', 'Rules and policies', `${policies.sections.length} sections customers can read`, '/admin/policies'),
      row('shield', 'Team', 'Owners and staff', '/admin/team'),
      row('support', 'Alerts', setup.alerts.tested ? (setup.alerts.mode === 'dm' ? 'Private messages to each admin' : 'Sent to a group chat') : 'Not tested yet', '/admin/alerts'),
      S.boot.role === 'owner' ? row('globe', 'Button emoji', 'Premium emoji on the chat bot buttons', '/admin/emoji') : null,
      row('clock', 'Activity log', 'Who changed what', '/admin/audit'),
    ];
    return h('div', { class: 'stack' }, ...rows);
  });
  return { el: root };
}

// ---------- rates, limits, stock ----------
export function ratesSettingsScreen(ctx) {
  const root = h('div', { class: 'screen flow' }, flowTop(ctx, 'Rates, limits and stock'));
  let save;
  loading(root, async () => {
    const { settings: s } = await admin.settings();
    const f = {
      buy_rate: textField({ label: 'Customers pay you, per 1 USDT', value: toBirr(s.buy_rate_cents), inputMode: 'decimal', suffix: 'ETB', placeholder: '168.50' }),
      sell_rate: textField({ label: 'You pay customers, per 1 USDT', value: toBirr(s.sell_rate_cents), inputMode: 'decimal', suffix: 'ETB', placeholder: '163.00', hint: 'Must not be higher than the price above.' }),
      min_usdt: textField({ label: 'Smallest order', value: toUsdt(s.min_usdt_micro), inputMode: 'decimal', suffix: 'USDT', placeholder: '5' }),
      max_usdt: textField({ label: 'Largest order', value: toUsdt(s.max_usdt_micro), inputMode: 'decimal', suffix: 'USDT', placeholder: 'You decide', hint: 'The shop stays closed for USDT orders until you set this.' }),
      stock_usdt: textField({ label: 'USDT you hold right now', value: toUsdt(s.stock_usdt_micro), inputMode: 'decimal', suffix: 'USDT', placeholder: 'Leave empty to not track', hint: 'Goes down by itself when a buy is completed. You can type a new number any time.' }),
      order_ttl_min: textField({ label: 'Time to pay', value: String(s.order_ttl_min), inputMode: 'numeric', suffix: 'min' }),
      max_open_orders: textField({ label: 'Open orders per customer', value: String(s.max_open_orders), inputMode: 'numeric' }),
      proof_retention_days: textField({ label: 'Keep proof images for', value: String(s.proof_retention_days), inputMode: 'numeric', suffix: 'days', hint: '0 keeps them forever. Orders stay; only the images are deleted.' }),
    };
    const stockShow = toggleRow({ label: 'Show stock to customers', hint: 'When off, customers never see the amount, not even in an error message.', value: s.stock_show });
    const addOnSell = toggleRow({ label: 'Add to stock when you buy USDT', hint: 'A completed sell order adds its USDT to the number above.', value: s.stock_add_on_sell });
    const paused = toggleRow({ label: 'Pause the shop', hint: 'Customers can still see their orders but cannot start new ones.', value: s.paused });
    save = async () => {
      const body = {
        order_ttl_min: f.order_ttl_min.get(), max_open_orders: f.max_open_orders.get(), proof_retention_days: f.proof_retention_days.get(),
        stock_usdt: f.stock_usdt.get(), stock_show: stockShow.get(), stock_add_on_sell: addOnSell.get(), paused: paused.get(),
      };
      if (f.buy_rate.get() || f.sell_rate.get()) { body.buy_rate = f.buy_rate.get(); body.sell_rate = f.sell_rate.get(); }
      if (f.min_usdt.get() || f.max_usdt.get()) { body.min_usdt = f.min_usdt.get(); body.max_usdt = f.max_usdt.get(); }
      const res = await submit(f, () => admin.saveSettings(body));
      if (res) { toast('Saved', 'ok'); S.boot = { ...(await api.bootstrap().catch(() => S.boot)), user: S.boot.user }; }
    };
    return h('div', { class: 'stack' },
      card(title('Rates'), f.buy_rate.el, f.sell_rate.el, h('p', { class: 'tiny' }, 'No fees are added. Whatever your exchange takes comes out of your own margin.')),
      card(title('Order size'), f.min_usdt.el, f.max_usdt.el),
      card(title('Stock'), f.stock_usdt.el, stockShow.el, addOnSell.el),
      card(title('Timing and limits'), f.order_ttl_min.el, f.max_open_orders.el, f.proof_retention_days.el),
      card(paused.el));
  });
  setActions({ text: 'Save', onClick: () => save?.() });
  return { el: root, destroy: () => setActions(null) };
}

// ---------- generic list of editable things ----------
function listScreen(ctx, { heading, kind, key, empty, addPath, rowOf, pick }) {
  const root = h('div', { class: 'screen flow' }, flowTop(ctx, heading));
  loading(root, async () => {
    const data = await admin.list(kind);
    const items = data[pick];
    return h('div', { class: 'stack' },
      ...(items.length ? items.map((x) => rowOf(x, ctx)) : [card(h('p', { class: 'muted' }, empty))]),
      h('button', { class: 'btn primary block', type: 'button', onclick: () => ctx.go(addPath) }, icon('plus', 20), 'Add'));
  });
  return { el: root };
}

// ---------- payment accounts ----------
const METHOD_PRESETS = [
  ['Telebirr', 'mobile', 'ቴሌብር'], ['Commercial Bank of Ethiopia', 'bank', 'የኢትዮጵያ ንግድ ባንክ'], ['Awash Bank', 'bank', ''], ['Bank of Abyssinia', 'bank', ''], ['Dashen Bank', 'bank', ''], ['M-Pesa', 'mobile', ''],
];

export const methodsListScreen = (ctx) => listScreen(ctx, {
  heading: 'Payment accounts', kind: 'methods', pick: 'methods', addPath: '/admin/method/new', empty: 'No accounts yet. Add the Telebirr or bank account customers pay into.',
  rowOf: (m, c) => listRow({
    title: m.label_en, sub: `${m.account_number || 'payout only'} · ${[m.accept_buy ? 'receives payments' : null, m.pay_sell ? 'pays out' : null].filter(Boolean).join(' + ')}`,
    badge: m.active ? (m.open_orders ? countBubble(m.open_orders) : null) : h('span', { class: 'pill' }, 'Off'), lead: lead('orders'), onClick: () => c.go(`/admin/method/${m.code}`),
  }),
});

export function methodFormScreen(ctx) {
  const code = ctx.params.code;
  const isNew = code === 'new';
  const root = h('div', { class: 'screen flow' }, flowTop(ctx, isNew ? 'Add payment account' : 'Edit payment account'));
  let save;
  loading(root, async () => {
    const m = isNew ? { kind: 'mobile', label_en: '', label_am: '', account_name: '', account_number: '', note: '', accept_buy: 1, pay_sell: 1, active: 1, unlock_orders: 0, unlock_volume_micro: 0, unlock_need_ratio: 0, open_orders: 0, total_orders: 0 }
      : (await admin.list('methods')).methods.find((x) => x.code === code);
    if (!m) throw new Error('Account not found');
    const f = {
      kind: segField({ label: 'Type', value: m.kind, options: [['mobile', 'Mobile money'], ['bank', 'Bank']] }),
      label_en: textField({ label: 'Name customers see', value: m.label_en, placeholder: 'Telebirr', maxLength: 40 }),
      label_am: textField({ label: 'Name in Amharic (optional)', value: m.label_am, placeholder: 'ቴሌብር', maxLength: 40 }),
      account_name: textField({ label: 'Account holder name', value: m.account_name, placeholder: 'Exactly as the bank or Telebirr shows it', hint: 'Customers see this to be sure they pay the right person.' }),
      account_number: textField({ label: 'Account or phone number', value: m.account_number, inputMode: 'text', placeholder: '0911 22 33 44 or 1000123456789' }),
      note: textField({ label: 'Note to the customer (optional)', value: m.note, maxLength: 160, placeholder: 'Write the order number in the reason field' }),
      unlock_orders: textField({ label: 'Completed orders needed', value: String(m.unlock_orders || 0), inputMode: 'numeric', hint: '0 = open to everyone from the first order.' }),
      unlock_volume: textField({ label: 'USDT traded needed', value: toUsdt(m.unlock_volume_micro) || '0', inputMode: 'decimal', suffix: 'USDT' }),
    };
    const acceptBuy = toggleRow({ label: 'Customers can pay me here', hint: 'Used when a customer buys USDT or a service.', value: m.accept_buy });
    const paySell = toggleRow({ label: 'I can pay customers here', hint: 'Used when a customer sells USDT and you send them birr.', value: m.pay_sell });
    const ratio = toggleRow({ label: 'Need more completed than cancelled', value: m.unlock_need_ratio });
    const active = toggleRow({ label: 'Active', hint: 'Turn off to hide it without deleting.', value: m.active });
    const presets = isNew ? card(title('Quick start'), h('div', { class: 'preset-row' }, METHOD_PRESETS.map(([name, kind, am]) => h('button', { class: 'chip', type: 'button', onclick: () => { f.label_en.set(name); f.label_am.set(am); f.kind.set(kind); } }, name)))) : null;
    save = async () => {
      const body = {
        kind: f.kind.get(), label_en: f.label_en.get(), label_am: f.label_am.get(), account_name: f.account_name.get(), account_number: f.account_number.get(), note: f.note.get(),
        accept_buy: acceptBuy.get(), pay_sell: paySell.get(), active: active.get(), unlock_orders: f.unlock_orders.get(), unlock_volume: f.unlock_volume.get(), unlock_need_ratio: ratio.get(),
      };
      const res = await submit(f, () => (isNew ? admin.create('methods', body) : admin.update('methods', code, body)));
      if (res) { toast('Saved', 'ok'); ctx.back(); }
    };
    const warn = !isNew && m.open_orders ? h('div', { class: 'notice warn' }, icon('alert', 20), `${m.open_orders} open order(s) still show the old details. Changing the number does not change them. To retire an account safely, turn it off, wait for those orders to finish, then add the new one.`) : null;
    const del = !isNew ? h('button', { class: 'btn danger block', type: 'button', onclick: async () => {
      if (!(await confirmDialog('Delete this account?'))) return;
      try { await admin.remove('methods', code); toast('Deleted', 'ok'); ctx.back(); } catch (err) { toast(errorText(err), 'error'); }
    } }, m.total_orders ? 'Delete (not possible: orders used it)' : 'Delete account') : null;
    return h('div', { class: 'stack' }, warn, presets,
      card(f.kind.el, f.label_en.el), card(f.account_name.el, f.account_number.el, f.note.el),
      card(title('How it is used'), acceptBuy.el, paySell.el, active.el),
      card(title('Unlock rule (optional)'), h('p', { class: 'tiny' }, 'Keep a riskier method for trusted customers. Customers who do not meet the rule see it locked, with what is missing.'), f.unlock_orders.el, f.unlock_volume.el, ratio.el),
      del);
  });
  setActions({ text: 'Save', onClick: () => save?.() });
  return { el: root, destroy: () => setActions(null) };
}

// ---------- USDT networks ----------
const NETWORK_PRESETS = [['USDT · TRON (TRC20)', 'tron'], ['USDT · BNB Chain (BEP20)', 'evm'], ['Bybit UID (internal transfer)', 'bybit_uid'], ['USDT · Other network', 'other']];
const KIND_LABEL = { tron: 'TRON', evm: 'BNB Chain / EVM', bybit_uid: 'Bybit UID', other: 'Other' };

export const networksListScreen = (ctx) => listScreen(ctx, {
  heading: 'USDT networks', kind: 'networks', pick: 'networks', addPath: '/admin/network/new', empty: 'No networks yet. Add the network or Bybit UID customers send USDT to.',
  rowOf: (n, c) => listRow({
    title: n.label, sub: `${KIND_LABEL[n.kind]} · ${[n.accept_sell ? 'receives USDT' : null, n.send_buy ? 'sends USDT' : null].filter(Boolean).join(' + ')}`,
    badge: n.active ? (n.open_orders ? countBubble(n.open_orders) : null) : h('span', { class: 'pill' }, 'Off'), lead: lead('globe'), onClick: () => c.go(`/admin/network/${n.code}`),
  }),
});

export function networkFormScreen(ctx) {
  const code = ctx.params.code;
  const isNew = code === 'new';
  const root = h('div', { class: 'screen flow' }, flowTop(ctx, isNew ? 'Add USDT network' : 'Edit USDT network'));
  let save;
  loading(root, async () => {
    const n = isNew ? { kind: 'tron', label: '', deposit_address: '', accept_sell: 1, send_buy: 1, active: 1, open_orders: 0, total_orders: 0 } : (await admin.list('networks')).networks.find((x) => x.code === code);
    if (!n) throw new Error('Network not found');
    const f = {
      kind: segField({ label: 'Type (decides how addresses are checked)', value: n.kind, options: Object.entries(KIND_LABEL) }),
      label: textField({ label: 'Name customers see', value: n.label, maxLength: 50, placeholder: 'USDT · TRON (TRC20)' }),
      deposit_address: textField({ label: 'Your deposit address or UID', value: n.deposit_address, placeholder: 'Where customers send USDT', hint: 'Check this twice. Customers send real money to it.' }),
    };
    const acceptSell = toggleRow({ label: 'Customers can send USDT here', hint: 'Used when a customer sells USDT to you. Needs the address above.', value: n.accept_sell });
    const sendBuy = toggleRow({ label: 'I can send USDT on this network', hint: 'Used when a customer buys and gives you their address.', value: n.send_buy });
    const active = toggleRow({ label: 'Active', value: n.active });
    const presets = isNew ? card(title('Quick start'), h('div', { class: 'preset-row' }, NETWORK_PRESETS.map(([label, kind]) => h('button', { class: 'chip', type: 'button', onclick: () => { f.label.set(label); f.kind.set(kind); } }, label)))) : null;
    save = async () => {
      const body = { kind: f.kind.get(), label: f.label.get(), deposit_address: f.deposit_address.get(), accept_sell: acceptSell.get(), send_buy: sendBuy.get(), active: active.get() };
      const res = await submit(f, () => (isNew ? admin.create('networks', body) : admin.update('networks', code, body)));
      if (res) { toast('Saved', 'ok'); ctx.back(); }
    };
    const del = !isNew ? h('button', { class: 'btn danger block', type: 'button', onclick: async () => {
      if (!(await confirmDialog('Delete this network?'))) return;
      try { await admin.remove('networks', code); toast('Deleted', 'ok'); ctx.back(); } catch (err) { toast(errorText(err), 'error'); }
    } }, n.total_orders ? 'Delete (not possible: orders used it)' : 'Delete network') : null;
    return h('div', { class: 'stack' }, presets, card(f.kind.el, f.label.el, f.deposit_address.el), card(title('How it is used'), acceptSell.el, sendBuy.el, active.el), del);
  });
  setActions({ text: 'Save', onClick: () => save?.() });
  return { el: root, destroy: () => setActions(null) };
}

// ---------- services ----------
const SERVICE_PRESETS = {
  telegram: ['Telegram members', 'Telegram post views', 'Telegram post reactions'],
  instagram: ['Instagram followers', 'Instagram likes', 'Instagram comments'],
  tiktok: ['TikTok followers', 'TikTok views', 'TikTok likes', 'TikTok shares', 'TikTok favorites'],
  youtube: ['YouTube subscribers', 'YouTube views'],
};
const PLATFORM_LABEL = { telegram: 'Telegram', instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', other: 'Other' };

export const servicesListScreen = (ctx) => listScreen(ctx, {
  heading: 'Services', kind: 'services', pick: 'services', addPath: '/admin/service/new', empty: 'No services yet. Add what you sell, with a price per 1,000.',
  rowOf: (s, c) => listRow({
    title: s.name_en, sub: `${PLATFORM_LABEL[s.platform]} · ${toBirr(s.price_cents_per_1000)} ETB per 1,000 · ${s.min_qty.toLocaleString('en-US')} to ${s.max_qty.toLocaleString('en-US')}`,
    badge: s.active ? null : h('span', { class: 'pill' }, 'Off'), lead: lead('bag'), onClick: () => c.go(`/admin/service/${s.code}`),
  }),
});

export function serviceFormScreen(ctx) {
  const code = ctx.params.code;
  const isNew = code === 'new';
  const root = h('div', { class: 'screen flow' }, flowTop(ctx, isNew ? 'Add service' : 'Edit service'));
  let save;
  loading(root, async () => {
    const s = isNew ? { platform: 'telegram', name_en: '', name_am: '', price_cents_per_1000: 0, min_qty: 100, max_qty: 10000, eta_text: '', warranty_days: 0, note: '', active: 1, total_orders: 0, open_orders: 0 }
      : (await admin.list('services')).services.find((x) => x.code === code);
    if (!s) throw new Error('Service not found');
    const f = {
      platform: segField({ label: 'Platform', value: s.platform, options: Object.entries(PLATFORM_LABEL) }),
      name_en: textField({ label: 'Name customers see', value: s.name_en, maxLength: 60, placeholder: 'Telegram members' }),
      name_am: textField({ label: 'Name in Amharic (optional)', value: s.name_am, maxLength: 60 }),
      price: textField({ label: 'Price for 1,000', value: toBirr(s.price_cents_per_1000), inputMode: 'decimal', suffix: 'ETB', placeholder: '85' }),
      min_qty: textField({ label: 'Smallest order', value: String(s.min_qty), inputMode: 'numeric' }),
      max_qty: textField({ label: 'Largest order', value: String(s.max_qty), inputMode: 'numeric' }),
      eta_text: textField({ label: 'Delivery time (optional)', value: s.eta_text, maxLength: 80, placeholder: 'Starts within 24 hours' }),
      warranty_days: textField({ label: 'Warranty', value: String(s.warranty_days), inputMode: 'numeric', suffix: 'days', hint: '0 = no warranty.' }),
      note: textField({ label: 'Note before ordering (optional)', value: s.note, maxLength: 240, placeholder: 'Your channel must be public' }),
    };
    const active = toggleRow({ label: 'Active', hint: 'Turn off to hide it without deleting.', value: s.active });
    const presets = isNew ? card(title('Quick start'), h('div', { class: 'preset-row' }, Object.entries(SERVICE_PRESETS).flatMap(([p, names]) => names.map((n) => h('button', { class: 'chip', type: 'button', onclick: () => { f.platform.set(p); f.name_en.set(n); } }, n))))) : null;
    save = async () => {
      const body = { platform: f.platform.get(), name_en: f.name_en.get(), name_am: f.name_am.get(), price: f.price.get(), min_qty: f.min_qty.get(), max_qty: f.max_qty.get(), eta_text: f.eta_text.get(), warranty_days: f.warranty_days.get(), note: f.note.get(), active: active.get() };
      const res = await submit(f, () => (isNew ? admin.create('services', body) : admin.update('services', code, body)));
      if (res) { toast('Saved', 'ok'); ctx.back(); }
    };
    const del = !isNew ? h('button', { class: 'btn danger block', type: 'button', onclick: async () => {
      if (!(await confirmDialog('Delete this service?'))) return;
      try { await admin.remove('services', code); toast('Deleted', 'ok'); ctx.back(); } catch (err) { toast(errorText(err), 'error'); }
    } }, s.total_orders ? 'Delete (not possible: orders used it)' : 'Delete service') : null;
    return h('div', { class: 'stack' }, presets, card(f.platform.el, f.name_en.el), card(f.price.el, f.min_qty.el, f.max_qty.el), card(f.eta_text.el, f.warranty_days.el, f.note.el), card(active.el), del);
  });
  setActions({ text: 'Save', onClick: () => save?.() });
  return { el: root, destroy: () => setActions(null) };
}

// ---------- policies ----------
export const policiesListScreen = (ctx) => listScreen(ctx, {
  heading: 'Rules and policies', kind: 'policies', pick: 'sections', addPath: '/admin/policy/new', empty: 'No sections yet.',
  rowOf: (p, c) => listRow({ title: p.title_en, sub: p.body_en.slice(0, 70), badge: p.active ? null : h('span', { class: 'pill' }, 'Hidden'), lead: lead('book'), onClick: () => c.go(`/admin/policy/${p.id}`) }),
});

export function policyFormScreen(ctx) {
  const id = ctx.params.code;
  const isNew = id === 'new';
  const root = h('div', { class: 'screen flow' }, flowTop(ctx, isNew ? 'Add section' : 'Edit section'));
  let save;
  loading(root, async () => {
    const p = isNew ? { title_en: '', title_am: '', body_en: '', body_am: '', active: 1, sort: 0 } : (await admin.list('policies')).sections.find((x) => String(x.id) === String(id));
    if (!p) throw new Error('Section not found');
    const f = {
      title_en: textField({ label: 'Title', value: p.title_en, maxLength: 80 }),
      body_en: textArea({ label: 'Text', value: p.body_en, rows: 9, maxLength: 4000, hint: 'Plain text. A blank line starts a new paragraph.' }),
      title_am: textField({ label: 'Title in Amharic (optional)', value: p.title_am, maxLength: 80 }),
      body_am: textArea({ label: 'Text in Amharic (optional)', value: p.body_am, rows: 9, maxLength: 4000 }),
      sort: textField({ label: 'Position', value: String(p.sort), inputMode: 'numeric', hint: 'Smaller numbers come first.' }),
    };
    const active = toggleRow({ label: 'Visible to customers', value: p.active });
    save = async () => {
      const body = { title_en: f.title_en.get(), body_en: f.body_en.get(), title_am: f.title_am.get(), body_am: f.body_am.get(), active: active.get() };
      if (!isNew) body.sort = f.sort.get();
      const res = await submit(f, () => (isNew ? admin.create('policies', body) : admin.update('policies', id, body)));
      if (res) { toast('Saved', 'ok'); ctx.back(); }
    };
    const del = !isNew ? h('button', { class: 'btn danger block', type: 'button', onclick: async () => {
      if (!(await confirmDialog('Delete this section?'))) return;
      try { await admin.remove('policies', id); toast('Deleted', 'ok'); ctx.back(); } catch (err) { toast(errorText(err), 'error'); }
    } }, 'Delete section') : null;
    return h('div', { class: 'stack' }, card(f.title_en.el, f.body_en.el), card(active.el, isNew ? null : f.sort.el), del);
  });
  setActions({ text: 'Save', onClick: () => save?.() });
  return { el: root, destroy: () => setActions(null) };
}

// ---------- team ----------
export function teamScreen(ctx) {
  const root = h('div', { class: 'screen flow' }, flowTop(ctx, 'Team'));
  const idField = textField({ label: 'Telegram number id', inputMode: 'numeric', placeholder: '123456789', hint: 'They can get it from @userinfobot. They must also have started this bot once.' });
  const nameField = textField({ label: 'Name (optional)', maxLength: 40 });
  const listBox = h('div', { class: 'stack' }, ...skeletons(70));
  const person = (p, owner) => h('div', { class: 'clay tight row' }, h('div', { class: 'grow' }, h('div', { class: 'strong' }, p.first_name || p.name || p.id), h('div', { class: 'tiny' }, `${p.username ? `@${p.username} · ` : ''}ID ${p.id}`)),
    owner ? h('span', { class: 'pill ok' }, 'Owner') : h('button', { class: 'btn small danger', type: 'button', onclick: async () => {
      if (!(await confirmDialog('Remove this person from the team?'))) return;
      try { paint(await admin.removeStaff(p.id)); toast('Removed', 'ok'); } catch (err) { toast(errorText(err), 'error'); }
    } }, 'Remove'));
  const paint = (d) => listBox.replaceChildren(...d.owners.map((o) => person(o, true)), ...d.staff.map((s) => person(s, false)));
  admin.team().then(paint).catch((err) => listBox.replaceChildren(h('div', { class: 'notice warn' }, errorText(err))));
  root.append(listBox, card(title('Add staff'), h('p', { class: 'tiny' }, 'Staff can review orders, release money and answer tickets. They cannot change accounts, rates or the team.'), idField.el, nameField.el,
    h('button', { class: 'btn primary block', type: 'button', onclick: async () => {
      const res = await submit({ id: idField, name: nameField }, () => admin.addStaff({ id: idField.get(), name: nameField.get() }));
      if (res) { paint(res); idField.set(''); nameField.set(''); toast('Added', 'ok'); }
    } }, 'Add')));
  return { el: root };
}

// ---------- alerts ----------
export function alertsScreen(ctx) {
  const root = h('div', { class: 'screen flow' }, flowTop(ctx, 'Alerts'));
  const box = h('div', { class: 'stack' }, ...skeletons(120));
  root.append(box);
  const paint = (info) => box.replaceChildren(
    card(title('Where alerts go'), h('p', { class: 'muted small' }, info.mode === 'dm' ? 'Each admin gets a private message from the bot.' : info.mode === 'chat' ? 'A group chat chosen with /alerts.' : 'The group set in ADMIN_CHAT_ID.'),
      h('div', { class: `notice ${info.tested ? '' : 'warn'}` }, icon(info.tested ? 'check' : 'alert', 20), info.tested ? 'A test alert reached its destination.' : 'No test alert has been sent yet.'),
      h('button', { class: 'btn primary block', type: 'button', onclick: async () => {
        try { const r = await admin.testAlerts(); toast(r.reached ? `Reached ${r.reached} of ${r.total}` : 'Nobody was reached. Each admin must press Start in the bot.', r.reached ? 'ok' : 'error'); paint(r.info); } catch (err) { toast(errorText(err), 'error'); }
      } }, 'Send a test alert'),
      info.mode === 'dm' ? null : h('button', { class: 'btn block', type: 'button', onclick: async () => { try { paint(await admin.alertsToDm()); toast('Alerts now go to private messages', 'ok'); } catch (err) { toast(errorText(err), 'error'); } } }, 'Use private messages instead')),
    card(title('Use a group chat'), h('p', { class: 'muted small' }, 'Add the bot to a group of people you trust, then send /alerts in that group. Anyone in the group sees order details.')));
  admin.alerts().then(paint).catch((err) => box.replaceChildren(h('div', { class: 'notice warn' }, errorText(err))));
  return { el: root };
}

// ---------- channel, reviews and logs ----------
export function channelsScreen(ctx) {
  const root = h('div', { class: 'screen flow' }, flowTop(ctx, 'Channels'));
  let save;
  loading(root, async () => {
    const { settings: s } = await admin.settings();
    const f = {
      channel: textField({ label: 'Main channel', value: s.channel_ref, placeholder: '@mychannel', hint: 'Shows as a Channel button. A public name or an invite link both work.' }),
      reviews: textField({ label: 'Reviews channel', value: s.reviews_ref, placeholder: '@myreviews', hint: 'Customers who rate an order are posted here. Add the bot as an admin of this channel.' }),
      logs: textField({ label: 'Bot logs channel', value: s.logs_ref, placeholder: '@mylogs', hint: 'New and finished orders are posted here with the customer ID hidden. Add the bot as an admin of this channel.' }),
    };
    save = async () => {
      const res = await submit(f, () => admin.saveSettings({ channel: f.channel.get(), reviews: f.reviews.get(), logs: f.logs.get() }));
      if (res) toast('Saved', 'ok');
    };
    return h('div', { class: 'stack' }, card(...Object.values(f).map((x) => x.el)),
      h('div', { class: 'notice' }, icon('info', 20), 'Leave a box empty to hide that button. A private channel needs its numeric ID (it starts with -100), and then has no button.'));
  });
  setActions({ text: 'Save', onClick: () => save?.() });
  return { el: root, destroy: () => setActions(null) };
}

// ---------- premium emoji on the chat bot's buttons ----------
export function buttonEmojiScreen(ctx) {
  const root = h('div', { class: 'screen flow' }, flowTop(ctx, 'Button emoji'));
  let save;
  loading(root, async () => {
    const { items, map } = await admin.buttonEmoji();
    const norm = (e) => e.replace(/\uFE0F/g, '');
    const f = Object.fromEntries(items.map((it) => [it.emoji, textField({ label: `${it.emoji}  ${it.example}`, value: map[norm(it.emoji)] || '', inputMode: 'numeric', placeholder: 'Premium emoji ID (optional)' })]));
    save = async () => {
      const body = Object.fromEntries(Object.entries(f).map(([e, field]) => [e, field.get()]));
      const res = await submit(f, () => admin.saveButtonEmoji(body));
      if (res) toast('Saved. Open the bot menu again to see it.', 'ok');
    };
    return h('div', { class: 'stack' },
      card(title('Premium emoji'), h('p', { class: 'muted small' }, 'Works when the bot\'s owner has Telegram Premium. To get an ID: send a premium emoji to the bot in a private chat and it replies with the ID. Paste it next to the ordinary emoji it should replace. Leave a box empty to keep the ordinary emoji. If Telegram refuses an ID, the bot quietly uses the ordinary emoji.')),
      card(...Object.values(f).map((x) => x.el)));
  });
  setActions({ text: 'Save', onClick: () => save?.() });
  return { el: root, destroy: () => setActions(null) };
}

// ---------- activity ----------
export function auditScreen(ctx) {
  const root = h('div', { class: 'screen' }, flowTop(ctx, 'Activity log'));
  loading(root, async () => {
    const { entries } = await admin.audit();
    return h('div', { class: 'stack' }, ...(entries.length ? entries.map((e) => h('div', { class: 'clay tight stack' }, h('div', { class: 'row between' }, h('span', { class: 'strong' }, e.action), h('span', { class: 'tiny' }, formatWhen(e.at))), h('div', { class: 'tiny break' }, `${e.actor_name || e.actor}${e.detail ? ` · ${e.detail}` : ''}`))) : [card(h('p', { class: 'muted' }, 'Nothing yet.'))]));
  });
  return { el: root };
}

// ---------- setup guide ----------
const STEP_INFO = {
  rates: ['Set your rates', 'What customers pay and receive per USDT.', '/admin/rates'],
  limits: ['Set the order size', 'Smallest and largest order. The shop stays closed until you enter a largest order.', '/admin/rates'],
  stock: ['Enter your USDT stock (optional)', 'So the shop never sells more than you hold.', '/admin/rates'],
  methods: ['Add a payment account', 'The Telebirr or bank account customers pay into, and the ones you pay out from.', '/admin/method/new'],
  networks: ['Add a USDT network', 'The address or Bybit UID customers send USDT to.', '/admin/network/new'],
  alerts: ['Test your alerts', 'Make sure order alerts reach you.', '/admin/alerts'],
  services: ['Add your services (optional)', 'Followers, views and likes with your prices.', '/admin/service/new'],
};
export function setupScreen(ctx) {
  const root = h('div', { class: 'screen' }, flowTop(ctx, 'Setup guide'));
  loading(root, async () => {
    const s = await admin.setup();
    const done = s.steps.filter((x) => x.required && x.done).length;
    const total = s.steps.filter((x) => x.required).length;
    return h('div', { class: 'stack' },
      card(h('div', { class: 'wizard-hero' }, h('div', { class: 'orb', style: 'width:64px;height:64px;border-radius:50%;display:grid;place-items:center;box-shadow:var(--raise);color:var(--accent-text)' }, icon('shield', 32)),
        h('h2', { class: 'section-title' }, s.complete ? 'Your shop is ready' : 'Let us get your shop ready'),
        h('p', { class: 'muted small' }, s.complete ? `You can take ${[s.sides.buy && 'buy', s.sides.sell && 'sell', s.sides.service && 'service'].filter(Boolean).join(', ') || 'no'} orders now.` : `${done} of ${total} required steps done. You can leave and come back; this list always matches what is saved.`),
        h('div', { class: 'steps' }, s.steps.filter((x) => x.required).map((x) => h('i', { class: x.done ? 'on' : '' }))))),
      ...s.steps.map((st) => {
        const [name, hint, path] = STEP_INFO[st.key];
        return h('button', { class: `clay tight list-row check-item ${st.done ? 'done' : ''}`, type: 'button', onclick: () => ctx.go(path) },
          h('span', { class: 'tick' }, icon('check', 16)), h('div', { class: 'grow' }, h('div', { class: 'strong' }, name), h('div', { class: 'tiny' }, hint)), icon('chevron', 20));
      }));
  });
  return { el: root, refresh: () => ctx.replace('/admin/setup') };
}
