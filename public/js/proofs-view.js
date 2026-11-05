// Receipts and transaction numbers of one order, shown the same way to the customer and to the team.
import { fetchImage } from './api.js';
import { copyButton, h } from './ui.js';

/** Full-screen view of one image, with a Close button. */
export function lightbox(src) {
  const box = h('div', { class: 'lightbox', role: 'dialog', onclick: () => box.remove() },
    h('img', { src, alt: 'Receipt' }),
    h('button', { class: 'btn primary lightbox-close', type: 'button', onclick: () => box.remove() }, 'Close'));
  document.body.append(box);
}

/**
 * proofs: the list from the API. urls: an array the screen revokes when it closes.
 * Returns null when the order has no receipts at all.
 */
export function proofsSection(orderId, proofs, { retentionDays = 90, urls = [], title = 'Receipts and transaction numbers' } = {}) {
  const items = proofs || [];
  if (!items.length) return null;
  const grid = h('div', { class: 'proofs' });
  const texts = [];
  let removed = 0;
  for (const p of items) {
    if (p.text) texts.push({ text: p.text, at: p.at });
    if (p.has_image) {
      const cell = h('button', { type: 'button', 'aria-label': 'Open receipt' }, '…');
      grid.append(cell);
      fetchImage(`/api/orders/${orderId}/proofs/${p.id}`).then((u) => {
        urls.push(u);
        cell.replaceChildren(h('img', { src: u, alt: 'Receipt' }));
        cell.onclick = () => lightbox(u);
      }).catch(() => { cell.textContent = 'Not available'; });
    } else if (p.removed) {
      removed += 1;
      grid.append(h('button', { type: 'button', disabled: true }, 'Image removed'));
    }
  }
  return h('section', { class: 'clay stack' },
    h('h2', { class: 'section-title' }, title),
    grid.children.length ? grid : null,
    ...texts.map((x) => h('div', { class: 'well copy-row' },
      h('div', { class: 'grow' }, h('div', { class: 'k' }, 'Transaction number'), h('div', { class: 'v' }, x.text)),
      copyButton(x.text, 'Transaction number'))),
    removed ? h('p', { class: 'tiny' }, `Images are removed ${retentionDays} days after an order ends to save space. The order, its history and the transaction numbers stay.`)
      : h('p', { class: 'tiny' }, `Images are kept for ${retentionDays} days after the order ends. The transaction numbers and history stay.`));
}
