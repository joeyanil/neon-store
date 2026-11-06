import { getLang, t } from './i18n.js';
import { S } from './state.js';
import { etb, formatWhen, h, icon, statusBadge, usdt } from './ui.js';

export function orderTitle(o) {
  if (o.side === 'service') {
    const name = o.pay ? (getLang() === 'am' ? o.pay.service?.name_am : o.pay.service?.name_en) : t('services_title');
    return t('order_service', { name: name || t('services_title'), qty: Number(o.quantity).toLocaleString('en-US') });
  }
  return t(o.side === 'buy' ? 'order_buy' : 'order_sell', { amount: usdt(o.usdt_micro) });
}

/** A tappable summary of one order. */
export function orderCard(o, onOpen) {
  return h('button', { class: 'clay tight order-card', type: 'button', onclick: () => onOpen(o) },
    h('div', { class: 'row' },
      h('span', { class: `side-dot ${o.side === 'service' ? 'svc' : o.side}`, 'aria-hidden': 'true' }, icon(o.side === 'service' ? 'bag' : o.side === 'buy' ? 'arrowdown' : 'arrowup', 20)),
      h('div', { class: 'grow' },
        h('div', { class: 'num strong' }, orderTitle(o)),
        h('div', { class: 'tiny ellipsis' }, `${o.id} · ${formatWhen(o.created_at)}`)),
      icon('chevron', 20)),
    h('div', { class: 'row between' }, statusBadge(o.status),
      h('div', { class: 'num small strong' }, `${etb(o.etb_cents)} ETB`)));
}

export function emptyState({ iconName, title, body, action }) {
  return h('div', { class: 'empty' },
    h('div', { class: 'orb' }, icon(iconName, 32)),
    h('h2', null, title),
    h('p', { class: 'muted small' }, body),
    action);
}

/** The shop is English only for now, so there is nothing to switch. */
/** A small sun/moon button for switching between light and dark. The app listens for the event and does the switching. */
export function themeToggle() {
  const dark = () => document.documentElement.dataset.theme === 'dark';
  const btn = h('button', { type: 'button', class: 'themebtn' });
  const paint = () => {
    btn.replaceChildren(icon(dark() ? 'sun' : 'moon', 18));
    btn.setAttribute('aria-label', dark() ? 'Switch to light mode' : 'Switch to dark mode');
  };
  btn.addEventListener('click', () => { document.dispatchEvent(new CustomEvent('neon-theme-toggle')); paint(); });
  paint();
  return btn;
}

export function topBar({ title, sub, right }) {
  return h('header', { class: 'top' },
    h('div', { class: 'grow' }, h('h1', null, title), sub ? h('p', { class: 'sub' }, sub) : null),
    right);
}

export { S };
