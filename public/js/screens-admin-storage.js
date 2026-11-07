// The owner's read-only Storage screen: how full the free database is, what is in it, when old records are deleted,
// and a button that sends a CSV copy of the orders to the owner's chat before they are removed.
import { admin } from './api.js';
import { flowTop, listRow } from './form.js';
import { errorText, formatWhen } from './i18n.js';
import { haptic } from './tg.js';
import { h, icon, skeletons, toast } from './ui.js';

const card = (...kids) => h('section', { class: 'clay stack' }, ...kids);
const title = (text) => h('h2', { class: 'section-title' }, text);
const n = (x) => Number(x).toLocaleString('en-US');
const size = (bytes) => (bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0)} MB`);

function meter(pct, level) {
  const fill = h('i');
  fill.style.width = `${Math.max(2, Math.min(100, pct))}%`; // through the element: the page's content policy blocks inline style attributes
  return h('div', { class: `meter ${level}`, role: 'img', 'aria-label': `${Math.round(pct)} percent of storage used` }, fill);
}

export function storageScreen(ctx) {
  const root = h('div', { class: 'screen flow' }, flowTop(ctx, 'Storage'));
  const box = h('div', { class: 'stack' }, ...skeletons(150, 200));
  root.append(box);
  let dead = false;

  const draw = (r) => {
    const pct = (r.bytes / r.limit) * 100;
    const level = pct >= 90 ? 'bad' : pct >= 70 ? 'warn' : 'ok';
    const verdict = level === 'ok' ? 'Plenty of room' : level === 'warn' ? 'Getting full' : 'Almost full';
    const row = (label, value, hint) => h('div', { class: 'stat-line' }, h('span', null, label, hint ? h('span', { class: 'tiny block-hint' }, hint) : null), h('span', { class: 'num' }, value));

    const sendBtn = (scope, label, primary) => {
      const b = h('button', { class: `btn block ${primary ? 'primary' : ''}`, type: 'button' }, icon('download', 20), label);
      b.addEventListener('click', async () => {
        if (b.disabled) return;
        b.disabled = true;
        try {
          const res = await admin.exportOrders(scope);
          haptic.success?.();
          toast(`Sent ${n(res.sent)} order${res.sent === 1 ? '' : 's'} to your chat with the bot`, 'ok');
          const fresh = await admin.storage();
          if (!dead) draw(fresh);
        } catch (err) {
          haptic.error?.();
          toast(errorText(err), 'error');
        } finally {
          b.disabled = false;
        }
      });
      return b;
    };

    const soon = r.expiring.count;
    const backup = card(
      title('Download a copy'),
      h('p', { class: 'muted small' }, 'A spreadsheet (CSV) with every detail of each order: customer, amounts, transaction numbers, payout details and reviews. It arrives as a file in your private chat with the bot.'),
      soon ? h('div', { class: 'notice warn' }, icon('alert', 20),
        `${n(soon)} finished order${soon === 1 ? '' : 's'} will be deleted within ${r.warn_days} days${r.expiring.oldest ? `, the oldest from ${formatWhen(r.expiring.oldest)}` : ''}. Download a copy first so you keep a record.`) : null,
      soon ? sendBtn('expiring', `Orders about to be deleted (${n(soon)})`, true) : null,
      r.counts.orders ? sendBtn('all', `All orders (${n(r.counts.orders)})`, !soon) : h('p', { class: 'tiny' }, 'No orders yet, so there is nothing to download.'),
      h('p', { class: 'tiny' }, r.last_export_at ? `Last copy sent ${formatWhen(r.last_export_at)}.` : 'No copy sent yet.'),
      h('p', { class: 'tiny' }, 'The file contains customer details. Keep it private.'));

    box.replaceChildren(
      card(
        h('div', { class: 'stat-line' }, h('span', { class: 'muted' }, 'Database size'), h(`span`, { class: `pill ${level}` }, verdict)),
        h('div', { class: 'big-figure num' }, size(r.bytes)),
        meter(pct, level),
        h('p', { class: 'tiny' }, `${pct < 0.1 ? 'Under 0.1' : pct.toFixed(pct < 10 ? 1 : 0)}% of the ${size(r.limit)} the free plan allows. Checked just now.`)),
      backup,
      card(
        title('What is stored'),
        row('Orders', n(r.counts.orders), `${n(r.counts.finished)} finished`),
        row('Customers', n(r.counts.customers)),
        row('Receipt photos', n(r.counts.receipts), 'Kept in Telegram, not here'),
        row('Support tickets', n(r.counts.tickets)),
        row('Activity log entries', n(r.counts.activity)),
        row('XO games', n(r.counts.games), 'Removed after 2 days'),
        r.orders_per_day ? row('Orders per day', `about ${r.orders_per_day}`, 'Average over the last 30 days') : null),
      card(
        title('When records are deleted'),
        h('p', { class: 'muted small' }, `Finished, rejected, cancelled and expired orders are deleted ${r.keep_days} days after they end, with their transaction numbers and history. Orders that are still open are never deleted. You are reminded ${r.warn_days} days before, so you can download a copy.`),
        listRow({ title: 'Change how long records are kept', sub: `Now ${r.keep_days} days`, lead: h('span', { class: 'side-dot tone-amber', 'aria-hidden': 'true' }, icon('clock', 20)), onClick: () => ctx.go('/admin/rates') })));
  };

  admin.storage().then((r) => { if (!dead) draw(r); }).catch((err) => box.replaceChildren(h('div', { class: 'notice warn' }, icon('alert', 20), errorText(err))));
  return { el: root, destroy: () => { dead = true; } };
}
