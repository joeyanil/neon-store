import { api, serverNow } from './api.js';
import { emptyState, themeToggle, orderCard, S, topBar } from './components.js';
import { errorText, formatAgo, formatWhen, t } from './i18n.js';
import { etbForUsdt, parseUsdt } from './money.js';
import { haptic } from './tg.js';
import { etb, h, icon, isOpen, skeletons, toast, usdt } from './ui.js';

// ---------- Orders ----------
export function ordersScreen(ctx) {
  let filter = ctx.params.filter === 'done' ? 'done' : 'active';
  let dead = false;
  let items = [];
  let next = null;
  const listBox = h('div', { class: 'stack' });
  const seg = h('div', { class: 'seg', role: 'group' },
    ['active', 'done'].map((f) => h('button', {
      type: 'button', 'data-f': f, 'aria-pressed': String(filter === f),
      onclick: () => { if (filter === f) return; haptic.select(); filter = f; syncSeg(); load(true); },
    }, t(`filter_${f}`))));
  const syncSeg = () => seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.f === filter)));

  function paint() {
    listBox.replaceChildren();
    if (!items.length) {
      listBox.append(h('div', { class: 'clay' }, emptyState({
        iconName: 'orders',
        title: t(`empty_${filter}_title`), body: t(`empty_${filter}_body`),
        action: filter === 'active' ? h('button', { class: 'btn primary', type: 'button', onclick: () => ctx.replace('/') }, t('start_trading')) : null,
      })));
      return;
    }
    listBox.append(...items.map((o) => orderCard(o, () => ctx.go(`/order/${o.id}`))));
    if (next) listBox.append(h('button', { class: 'btn', type: 'button', onclick: () => load(false) }, t('load_more')));
  }

  async function load(reset) {
    if (reset) { items = []; next = null; listBox.replaceChildren(...skeletons(96, 96)); }
    try {
      const res = await api.listOrders(filter, reset ? null : next);
      if (dead) return;
      items = reset ? res.orders : items.concat(res.orders);
      next = res.next;
      if (filter === 'active') { S.activeCount = items.length; ctx.updateNav(); }
      paint();
    } catch (err) {
      if (dead) return;
      listBox.replaceChildren(h('div', { class: 'clay stack' }, h('div', { class: 'notice warn' }, icon('alert', 20), errorText(err)),
        h('button', { class: 'btn', type: 'button', onclick: () => load(true) }, t('retry'))));
    }
  }

  const root = h('div', { class: 'screen' }, topBar({ title: t('orders_title'), right: themeToggle() }), seg, listBox);
  load(true);
  return { el: root, refresh: () => load(true), destroy: () => { dead = true; } };
}

// ---------- Rates ----------
export function ratesScreen(ctx) {
  const { boot } = S;
  const r = boot.rates;
  let amount = '';
  const calcBuy = h('div', { class: 'num big-amount' }, '0.00 ETB');
  const calcSell = h('div', { class: 'num big-amount' }, '0.00 ETB');
  const input = h('input', { type: 'text', inputMode: 'decimal', placeholder: '100', 'aria-label': t('calc_amount'), autocomplete: 'off', id: 'calc' });
  input.addEventListener('input', () => {
    input.value = input.value.replace(',', '.').replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
    amount = input.value;
    const m = parseUsdt(amount);
    calcBuy.textContent = m && r.ready ? `${etb(etbForUsdt(m, r.buy_cents, 'up'))} ETB` : '0.00 ETB';
    calcSell.textContent = m && r.ready ? `${etb(etbForUsdt(m, r.sell_cents, 'down'))} ETB` : '0.00 ETB';
  });

  const rateCard = (side, cls) => h('div', { class: 'clay tight stack' },
    h('div', { class: 'row' }, h('span', { class: `side-dot ${cls}`, 'aria-hidden': 'true' }, icon(cls === 'buy' ? 'arrowdown' : 'arrowup', 20)),
      h('div', { class: 'tiny grow' }, t(`rate_you_${side}`))),
    h('div', { class: 'num big-amount' }, r.ready ? etb(side === 'buy' ? r.buy_cents : r.sell_cents) : 'Not set'),
    h('div', { class: 'tiny' }, t('per_usdt')));

  const root = h('div', { class: 'screen' },
    topBar({ title: t('rates_title'), sub: t('rates_sub'), right: themeToggle() }),
    r.ready ? null : h('div', { class: 'notice' }, icon('info', 20), t('rates_not_ready')),
    h('div', { class: 'pillows' }, rateCard('buy', 'buy'), rateCard('sell', 'sell')),
    h('section', { class: 'clay stack' },
      h('dl', { class: 'kv' },
        h('dt', null, t('rate_when_updated')), h('dd', null, r.ready ? `${formatWhen(r.updated_at)} (${formatAgo(r.updated_at, serverNow())})` : 'Not set'),
        h('dt', null, t('order_size')), h('dd', { class: 'num' }, `${usdt(boot.limits.min_usdt_micro)} to ${usdt(boot.limits.max_usdt_micro)} USDT`),
        h('dt', null, t('order_window')), h('dd', null, t('minutes', { n: boot.order_ttl_min })),
        boot.stock ? [h('dt', null, t('stock_label')), h('dd', { class: 'num' }, `${usdt(boot.stock.available_usdt_micro)} USDT`)] : null)),
    h('section', { class: 'clay stack' },
      h('h2', { class: 'section-title' }, t('calc_title')),
      h('div', { class: 'well input-wrap big-input' }, input, h('span', { class: 'suffix' }, 'USDT')),
      h('div', null, h('div', { class: 'tiny' }, t('calc_buy')), calcBuy),
      h('div', null, h('div', { class: 'tiny' }, t('calc_sell')), calcSell)));
  return { el: root };
}

