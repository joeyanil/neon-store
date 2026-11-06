// Help: the hub (tickets, rules, settings), new ticket, ticket thread, policies.
import { api, fetchImage } from './api.js';
import { S, topBar, themeToggle } from './components.js';
import { flowTop, listRow, textArea } from './form.js';
import { errorText, formatWhen, getLang, t } from './i18n.js';
import { haptic, setActions } from './tg.js';
import { h, icon, shrinkImage, skeletons, toast } from './ui.js';

const STATUS_CLASS = { open: 'warn', answered: 'ok', closed: '' };
const statusPill = (s) => h('span', { class: `pill ${STATUS_CLASS[s] || ''}` }, t(`ticket_status_${s}`));
const CATS = ['failed_order', 'not_received', 'other', 'feedback'];

export function helpScreen(ctx) {
  const { boot } = S;
  const name = boot.support.username;
  const ticketsBox = h('div', { class: 'stack' }, ...skeletons(64));
  const faqs = [1, 2, 3, 4, 5].map((n) => h('details', { class: 'faq' }, h('summary', null, t(`faq${n}_q`), icon('chevron', 20)), h('p', null, t(`faq${n}_a`))));

  const themeSeg = h('div', { class: 'seg', role: 'group', 'aria-label': t('theme') },
    ['auto', 'light', 'dark'].map((p) => h('button', {
      type: 'button', 'aria-pressed': String(S.themePref === p),
      onclick: () => { haptic.select(); ctx.setTheme(p); themeSeg.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(['auto', 'light', 'dark'][i] === p))); },
    }, t(`theme_${p}`))));
  const dmCard = boot.user.can_dm ? h('div', { class: 'notice' }, icon('check', 20), t('allowed_msgs'))
    : h('div', { class: 'stack' }, h('div', { class: 'strong' }, t('allow_msgs')), h('p', { class: 'muted small' }, t('allow_msgs_body')),
      h('button', { class: 'btn', type: 'button', onclick: async (e) => {
        const ok = await ctx.requestMessages();
        if (ok) { toast(t('allowed_msgs'), 'ok'); e.target.closest('.stack').replaceWith(h('div', { class: 'notice' }, icon('check', 20), t('allowed_msgs'))); }
      } }, t('allow')));

  const root = h('div', { class: 'screen' },
    topBar({ title: t('help_title'), sub: t('help_sub'), right: themeToggle() }),
    h('section', { class: 'clay stack' },
      h('button', { class: 'btn primary block', type: 'button', onclick: () => { haptic.press(); ctx.go('/ticket/new'); } }, icon('ticket', 20), t('new_ticket')),
      name ? h('button', { class: 'btn block', type: 'button', onclick: () => ctx.openChat(`https://t.me/${name}`) }, icon('support', 20), t('chat_support')) : null,
      h('p', { class: 'tiny' }, t('support_hint'))),
    h('div', { class: 'stack' }, h('h2', { class: 'section-title' }, t('my_tickets')), ticketsBox),
    listRow({ title: t('policies_open'), lead: h('span', { class: 'side-dot svc', 'aria-hidden': 'true' }, icon('book', 20)), onClick: () => ctx.go('/policies') }),
    h('div', { class: 'stack' }, h('h2', { class: 'section-title' }, t('faq_title')), ...faqs),
    h('section', { class: 'clay stack' }, h('h2', { class: 'section-title' }, t('settings_title')),
      h('div', { class: 'field' }, h('div', { class: 'label' }, t('theme')), themeSeg),
      dmCard));

  let dead = false;
  (async () => {
    try {
      const { tickets } = await api.listTickets();
      if (dead) return;
      ticketsBox.replaceChildren(...(tickets.length
        ? tickets.slice(0, 5).map((tk) => listRow({ title: `${tk.id} · ${t(`cat_${tk.category}`)}`, sub: tk.preview || formatWhen(tk.updated_at), badge: statusPill(tk.status), onClick: () => ctx.go(`/ticket/${tk.id}`) }))
        : [h('p', { class: 'muted small' }, t('no_tickets'))]));
    } catch { if (!dead) ticketsBox.replaceChildren(); }
  })();
  return { el: root, destroy: () => { dead = true; } };
}

/** A photo picker with a preview, shared by the ticket forms. */
function photoPicker(onChange) {
  let file = null;
  let url = null;
  const input = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/*', class: 'sr', tabIndex: -1, 'aria-hidden': 'true' });
  const box = h('button', { class: 'upload', type: 'button', onclick: () => input.click() });
  const paint = () => {
    box.className = `upload ${file ? 'has' : ''}`;
    box.replaceChildren(file ? h('img', { src: url, alt: '' }) : h('span', { class: 'ic' }, icon('camera', 24)),
      h('span', { class: 'grow' }, h('div', { class: 'strong' }, file ? t('change_photo') : t('ticket_attach')), h('div', { class: 'tiny' }, file ? file.name : t('photo_hint'))));
  };
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    file = await shrinkImage(f);
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(file);
    paint(); onChange?.();
  });
  paint();
  return { el: h('div', null, box, input), file: () => file, clear() { file = null; if (url) URL.revokeObjectURL(url); url = null; paint(); } };
}

export function ticketNewScreen(ctx) {
  let category = ctx.params.category || null;
  let orderId = ctx.params.order || '';
  const msg = textArea({ label: t('ticket_message'), placeholder: t('ticket_message_ph'), rows: 5, maxLength: 1500 });
  const photo = photoPicker(() => sync());
  const catBox = h('div', { class: 'choices', role: 'radiogroup', 'aria-label': t('ticket_about') },
    CATS.map((c) => {
      const b = h('button', { class: 'choice', type: 'button', role: 'radio', 'aria-checked': String(category === c), 'data-c': c }, h('span', { class: 'grow strong' }, t(`cat_${c}`)), h('span', { class: 'tick' }, icon('check', 14)));
      b.addEventListener('click', () => { haptic.select(); category = c; catBox.querySelectorAll('.choice').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.c === c))); sync(); });
      return b;
    }));
  const orderBox = h('div', { class: 'choices' });
  const root = h('div', { class: 'screen flow' }, flowTop(ctx, t('new_ticket')),
    h('section', { class: 'clay stack' }, h('div', { class: 'label section-title' }, t('ticket_about')), catBox),
    h('section', { class: 'clay stack' }, h('div', { class: 'label section-title' }, t('ticket_order')), orderBox),
    h('section', { class: 'clay stack' }, msg.el, photo.el));
  msg.input.addEventListener('input', () => sync());

  function paintOrders(list) {
    const opts = [['', t('ticket_no_order')], ...list.map((o) => [o.id, `${o.id} · ${formatWhen(o.created_at)}`])];
    orderBox.replaceChildren(...opts.map(([id, label]) => {
      const b = h('button', { class: 'choice', type: 'button', role: 'radio', 'aria-checked': String(orderId === id), 'data-o': id }, h('span', { class: 'grow' }, label), h('span', { class: 'tick' }, icon('check', 14)));
      b.addEventListener('click', () => { haptic.select(); orderId = id; orderBox.querySelectorAll('.choice').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.o === id))); });
      return b;
    }));
  }
  paintOrders([]);
  api.listOrders('all').then((r) => paintOrders(r.orders.slice(0, 5))).catch(() => {});

  let busy = false;
  const ok = () => category && (msg.get() || photo.file());
  async function send() {
    if (busy || !ok()) return;
    busy = true; sync();
    const f = new FormData();
    f.append('category', category);
    if (orderId) f.append('order_id', orderId);
    f.append('text', msg.get());
    if (photo.file()) f.append('photo', photo.file(), photo.file().name || 'photo.jpg');
    try {
      const d = await api.createTicket(f);
      toast(t('ticket_sent'), 'ok');
      ctx.replace(`/ticket/${d.ticket.id}`, { root: false });
    } catch (err) {
      toast(errorText(err), 'error');
      busy = false; sync();
    }
  }
  function sync() { setActions({ text: t('ticket_send'), disabled: !ok(), loading: busy, onClick: send }); }
  sync();
  return { el: root };
}

export function ticketScreen(ctx) {
  const id = ctx.params.id;
  const thread = h('div', { class: 'thread' });
  const head = h('div', { class: 'row between' });
  const reply = textArea({ placeholder: t('ticket_reply_ph'), rows: 3, maxLength: 1500 });
  const photo = photoPicker(() => sync());
  const composer = h('section', { class: 'clay stack' }, reply.el, photo.el);
  const root = h('div', { class: 'screen flow' }, flowTop(ctx, id), h('section', { class: 'clay stack' }, head, thread), composer);
  let dead = false;
  let busy = false;
  const urls = [];
  reply.input.addEventListener('input', () => sync());

  async function load() {
    try {
      const d = await api.getTicket(id);
      if (dead) return;
      head.replaceChildren(h('span', { class: 'strong' }, t(`cat_${d.ticket.category}`)), statusPill(d.ticket.status));
      thread.replaceChildren(...d.messages.map((m) => {
        const bubble = h('div', { class: `bubble-msg ${m.sender === 'user' ? 'me' : ''}` },
          h('div', { class: 'who' }, `${m.sender === 'user' ? t('ticket_you') : t('ticket_team')} · ${formatWhen(m.at)}`), m.body || null);
        if (m.has_photo) {
          fetchImage(`/api/tickets/${id}/photos/${m.id}`).then((u) => { urls.push(u); bubble.append(h('img', { src: u, alt: '' })); }).catch(() => {});
        }
        return bubble;
      }));
    } catch (err) {
      if (!dead) thread.replaceChildren(h('div', { class: 'notice warn' }, icon('alert', 20), errorText(err)));
    }
  }
  const ok = () => reply.get() || photo.file();
  async function send() {
    if (busy || !ok()) return;
    busy = true; sync();
    const f = new FormData();
    f.append('text', reply.get());
    if (photo.file()) f.append('photo', photo.file(), photo.file().name || 'photo.jpg');
    try {
      await api.replyTicket(id, f);
      reply.set(''); photo.clear();
      toast(t('ticket_reply_sent'), 'ok');
      await load();
    } catch (err) { toast(errorText(err), 'error'); }
    busy = false; sync();
  }
  function sync() { setActions({ text: t('ticket_send'), disabled: !ok(), loading: busy, onClick: send }); }
  sync();
  load();
  const poll = setInterval(() => { if (!document.hidden && !busy) load(); }, 10000);
  return { el: root, refresh: load, destroy() { dead = true; clearInterval(poll); urls.forEach((u) => URL.revokeObjectURL(u)); } };
}

export function policiesScreen(ctx) {
  const box = h('div', { class: 'stack' }, ...skeletons(64, 64, 64));
  const root = h('div', { class: 'screen' }, flowTop(ctx, t('policies_title')), box);
  let dead = false;
  api.policies().then(({ sections }) => {
    if (dead) return;
    const am = getLang() === 'am';
    box.replaceChildren(...(sections.length ? sections.map((p) => h('details', { class: 'faq' },
      h('summary', null, am ? p.title_am : p.title_en, icon('chevron', 20)),
      h('p', { class: 'policy-body' }, am ? p.body_am : p.body_en))) : [h('p', { class: 'muted' }, t('policies_empty'))]));
  }).catch((err) => { if (!dead) box.replaceChildren(h('div', { class: 'notice warn' }, icon('alert', 20), errorText(err))); });
  return { el: root, destroy: () => { dead = true; } };
}
