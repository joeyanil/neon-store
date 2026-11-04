import { api, serverNow } from './api.js';
import { emptyState, langPill, orderCard, S } from './components.js';
import { formatAgo, t } from './i18n.js';
import { PLATFORMS } from './platforms.js';
import { haptic, openTelegramLink, user } from './tg.js';
import { etb, h, icon, isOpen, skeletons, usdt } from './ui.js';

/** Four coloured shortcuts: one tap from the home screen to a platform's price list. */
function servicesBlock(ctx) {
  const open = (path) => { haptic.press(); ctx.go(path); };
  return h('section', { class: 'stack' },
    h('div', { class: 'row between' }, h('h2', { class: 'section-title' }, t('services_tile')),
      h('button', { class: 'langpill', type: 'button', onclick: () => open('/services') }, t('see_all'))),
    h('div', { class: 'quick' }, PLATFORMS.map((p) => h('button', { class: `quick-item plat-${p.code}`, type: 'button', onclick: () => open(`/services/${p.code}`) },
      h('span', { class: 'plat-dot big', 'aria-hidden': 'true' }, icon(p.icon, 24)), h('span', { class: 'quick-label' }, p.name)))));
}

const LINKS = [['channel', 'megaphone', 'link_channel'], ['reviews', 'star', 'link_reviews'], ['logs', 'receipt', 'link_logs']];
function linksBlock(links) {
  const shown = LINKS.filter(([k]) => links && links[k]);
  if (!shown.length) return null;
  return h('div', { class: 'link-row' }, shown.map(([k, ic, label]) => h('button', { class: `link-chip link-${k}`, type: 'button', onclick: () => { haptic.select(); openTelegramLink(links[k]); } }, icon(ic, 18), t(label))));
}

export function homeScreen(ctx) {
  const { boot } = S;
  const name = boot.user.first_name || user()?.first_name || '';
  const paused = boot.rates.paused;

  const pillow = (side) => {
    const rate = side === 'buy' ? boot.rates.buy_cents : boot.rates.sell_cents;
    return h('button', {
      class: `pillow ${side}`, type: 'button', disabled: paused || !boot.availability[side],
      onclick: () => { haptic.press(); ctx.go(`/trade/${side}`); },
    },
      h('div', null,
        h('div', { class: 'verb' }, t(`${side}_verb`)),
        h('div', { class: 'hint' }, t(`${side}_hint`))),
      h('div', null,
        h('div', { class: 'rate num' }, boot.rates.ready && boot.availability[side] ? etb(rate) : 'Soon'),
        h('div', { class: 'unit' }, boot.rates.ready && boot.availability[side] ? t('per_usdt') : t('rate_soon'))));
  };

  const ordersBox = h('div', { class: 'stack' }, ...skeletons(96));
  const root = h('div', { class: 'screen' },
    h('header', { class: 'top' },
      h('div', { class: 'grow' },
        h('h1', { class: 'hello' }, t('hello', { name })),
        h('p', { class: 'sub muted' }, t('hello_sub'))),
      langPill(ctx.toggleLang)),
    boot.rates.paused ? h('div', { class: 'notice warn', role: 'status' }, icon('alert', 20), t('paused_banner'))
      : !boot.rates.ready ? h('div', { class: 'notice', role: 'status' }, icon('info', 20), t('rates_not_ready'))
      : !boot.availability.buy && !boot.availability.sell && !boot.availability.service ? h('div', { class: 'notice', role: 'status' }, icon('info', 20), t('shop_not_open')) : null,
    h('div', { class: 'pillows' }, pillow('buy'), pillow('sell')),
    boot.stock ? h('p', { class: 'stock-line' }, icon('shield', 16), t('stock_left', { n: usdt(boot.stock.available_usdt_micro) })) : null,
    boot.availability.service ? servicesBlock(ctx) : null,
    linksBlock(boot.links),
    boot.rates.ready ? h('p', { class: 'tiny' }, t('rates_updated', { when: formatAgo(boot.rates.updated_at, serverNow()) })) : null,
    ordersBox);

  let dead = false;
  (async () => {
    try {
      const { orders } = await api.listOrders('all');
      if (dead) return;
      S.activeCount = orders.filter((o) => isOpen(o.status)).length;
      ctx.updateNav();
      const open = orders.filter((o) => isOpen(o.status));
      const recent = orders.filter((o) => !isOpen(o.status)).slice(0, 3);
      ordersBox.replaceChildren();
      if (!orders.length) {
        ordersBox.append(h('div', { class: 'clay' }, emptyState({ iconName: 'orders', title: t('no_orders_title'), body: t('no_orders_body') })));
        return;
      }
      const section = (title, list, showAll) => list.length && ordersBox.append(
        h('div', { class: 'row between' }, h('h2', { class: 'section-title' }, title),
          showAll ? h('button', { class: 'langpill', type: 'button', onclick: () => ctx.replace('/orders') }, t('see_all')) : null),
        ...list.map((o) => orderCard(o, () => ctx.go(`/order/${o.id}`))));
      section(t('open_orders'), open, false);
      section(t('recent_orders'), recent, true);
    } catch {
      if (!dead) ordersBox.replaceChildren();
    }
  })();

  return { el: root, destroy: () => { dead = true; } };
}
