// Text the bot sends: the admin's order card (English) and customer notifications (English and Amharic).
import { formatEtb, formatUsdt } from './money.js';
import { esc } from './telegram.js';

const STATUS_LABEL = {
  awaiting_payment: 'Waiting for customer',
  evidence_submitted: 'Needs review',
  processing: 'Processing',
  completed: 'Completed',
  rejected: 'Rejected',
  cancelled: 'Cancelled by customer',
  expired: 'Expired',
};

/** Card shown to admins. `order` is a DB row, `user` is {id, first_name, username}. */
export function adminCard(order, user, extra = {}) {
  const pay = JSON.parse(order.pay_snapshot);
  const buy = order.side === 'buy';
  const service = order.side === 'service';
  const who = `<a href="tg://user?id=${user.id}">${esc(user.first_name || 'Customer')}</a>${user.username ? ` @${esc(user.username)}` : ''} · <code>${user.id}</code>`;
  const lines = [
    `<b>${service ? '🛍 SERVICE' : buy ? '🟢 BUY' : '🔴 SELL'} · ${order.id}</b>`,
    `Status: <b>${STATUS_LABEL[order.status] || order.status}</b>${order.late ? ' · <b>⏰ late proof</b>' : ''}`,
    '',
    `<b>Customer</b>: ${who}`,
  ];
  if (service) {
    const sv = pay.service || {};
    lines.push(
      `<b>Service</b>: ${esc(sv.name_en || order.service_code)} (${esc(sv.platform || '')})`,
      `<b>Quantity</b>: ${Number(order.quantity).toLocaleString('en-US')}`,
      `<b>Deliver to</b>: ${esc(order.target)}`,
      `<b>Total</b>: ${formatEtb(order.etb_cents)} ETB`,
      `<b>Customer pays birr via</b>: ${esc(pay.label_en)} → ${esc(pay.account_name)} ${esc(pay.account_number)}`,
    );
  } else {
    lines.push(
      `<b>USDT</b>: ${formatUsdt(order.usdt_micro)}`,
      `<b>Rate</b>: ${formatEtb(order.rate_cents)} ETB`,
      `<b>ETB</b>: ${formatEtb(order.etb_cents)}`,
      `<b>Network</b>: ${esc(order.network_code)}`,
    );
    if (buy) {
      lines.push(`<b>Customer pays birr via</b>: ${esc(pay.label_en)} → ${esc(pay.account_name)} ${esc(pay.account_number)}`);
      lines.push(`<b>Send USDT to</b>: <code>${esc(order.usdt_address)}</code>`);
    } else {
      lines.push(`<b>Customer sends USDT to</b>: <code>${esc(pay.address)}</code>`);
      lines.push(`<b>Pay birr to</b>: ${esc(order.payout_name)} · <code>${esc(order.payout_account)}</code> (${esc(order.method_label_en || order.method_code)})`);
    }
  }
  if (order.evidence_text) lines.push('', `<b>Transaction no.</b>: ${esc(order.evidence_text)}`);
  if (order.evidence_count > 0) lines.push(`<i>${order.evidence_count} proof${order.evidence_count > 1 ? 's' : ''} stored privately. Open the order to see ${order.evidence_count > 1 ? 'them' : 'it'}.</i>`);
  if (extra.duplicates) lines.push('', `⚠️ <b>Warning</b>: this proof matches another order (${extra.duplicates}). Open the order to check.`);
  if (order.reject_reason) lines.push(`<b>Rejected because</b>: ${esc(REASON_EN[order.reject_reason] || order.reject_reason)}`);
  if (order.completion_ref) lines.push('', `<b>Reference sent</b>: ${esc(order.completion_ref)}`);
  if (order.status === 'processing') {
    lines.push('', service
      ? '<i>Deliver the service, then open the order and press “Mark delivered”.</i>'
      : '<i>When you have sent the money, open the order and press “Mark as released” with the reference.</i>');
  }
  const text = lines.join('\n');
  return text.length > 3800 ? `${text.slice(0, 3797)}…` : text;
}

const REASON_EN = { not_received: 'Payment not received', amount_mismatch: 'Amount does not match', unreadable: 'Proof unreadable', other: 'Other reason' };

/**
 * Buttons under the admin card. They change with the order's status; finished orders have none.
 * `open` is a ready-made button that opens the order in the Mini App (null when there is no way to link to it).
 */
export function adminKeyboard(order, open = null) {
  const btn = (text, action, style) => ({ text, callback_data: `o:${order.id}:${action}`, style });
  const rows = [];
  if (open) rows.push([open]);
  if (order.status === 'evidence_submitted') rows.push([btn('✅ Payment received', 'c', 'success'), btn('❌ Reject', 'r', 'danger')]);
  else if (order.status === 'processing') rows.push(open ? [btn('❌ Reject', 'r', 'danger')] : [btn(order.side === 'service' ? '✅ Mark delivered' : '✅ Mark released', 'd', 'success'), btn('❌ Reject', 'r', 'danger')]);
  else if (order.status === 'awaiting_payment' || order.status === 'expired') rows.push([btn('❌ Reject', 'r', 'danger')]);
  return { inline_keyboard: rows };
}

const REASON_AM = { not_received: 'ክፍያው አልደረሰንም', amount_mismatch: 'መጠኑ አይመሳሰልም', unreadable: 'ማስረጃው አይነበብም', other: 'ሌላ ምክንያት' };

const COPY = {
  en: {
    open_order: 'Open order',
    open_market: 'Open market',
    welcome: 'Buy and sell USDT with birr, and order social-media growth services. Every order is checked by a person.',
    evidence: (o) => (o.late
      ? `We received your ${o.side === 'sell' ? 'transfer details' : 'payment receipt'} for ${o.id}, but after the payment window closed. An admin will check it and tell you what happens next.`
      : `We received your ${o.side === 'sell' ? 'transfer details' : 'payment receipt'} for ${o.id}. An admin is checking it now.`),
    processing: (o) => (o.side === 'service' ? `Payment confirmed for ${o.id}. We are starting your service now.` : o.side === 'buy' ? `Payment confirmed for ${o.id}. We are sending your USDT.` : `Your USDT arrived for ${o.id}. We are sending your birr.`),
    completed: (o, ref) => (o.side === 'service' ? `${o.id} is complete. Your service has been delivered.` : o.side === 'buy' ? `${o.id} is complete. Your USDT has been sent.` : `${o.id} is complete. Your birr has been sent.`) + (ref ? `\nReference: ${ref}` : ''),
    rejected: (o) => `${o.id} was not accepted${o.reject_reason ? `: ${REASON_EN[o.reject_reason]}` : ''}. Open Support in the app and mention this order number.`,
    expired: (o) => `${o.id} expired because no payment was submitted in time. If you already paid, contact Support right away.`,
    reference: (o, ref) => `Reference for ${o.id}: ${ref}`,
    rate_prompt: 'How did it go? One tap tells us.',
  },
  am: {
    open_order: 'ትዕዛዙን ክፈት',
    open_market: 'ገበያውን ክፈት',
    welcome: 'USDT በብር ይግዙ ወይም ይሽጡ፣ እንዲሁም የማህበራዊ ሚዲያ አገልግሎቶችን ይዘዙ። እያንዳንዱ ትዕዛዝ በሰው ይረጋገጣል።',
    evidence: (o) => (o.late
      ? `ለ${o.id} ${o.side === 'sell' ? 'የዝውውር ዝርዝርዎ' : 'የክፍያ ደረሰኝዎ'} ደርሶናል፤ ነገር ግን የክፍያ ጊዜው ካለፈ በኋላ ነው። አስተዳዳሪ አይቶ የሚቀጥለውን ያሳውቅዎታል።`
      : `ለ${o.id} ${o.side === 'sell' ? 'የዝውውር ዝርዝርዎ' : 'የክፍያ ደረሰኝዎ'} ደርሶናል። አስተዳዳሪ እያረጋገጠ ነው።`),
    processing: (o) => (o.side === 'service' ? `የ${o.id} ክፍያ ተረጋግጧል። አገልግሎትዎን አሁን እንጀምራለን።` : o.side === 'buy' ? `የ${o.id} ክፍያ ተረጋግጧል። USDT እየላክንልዎ ነው።` : `ለ${o.id} USDT ደርሶናል። ብሩን እየላክንልዎ ነው።`),
    completed: (o, ref) => (o.side === 'service' ? `${o.id} ተጠናቋል። አገልግሎትዎ ተደርሷል።` : o.side === 'buy' ? `${o.id} ተጠናቋል። USDT ተልኮልዎታል።` : `${o.id} ተጠናቋል። ብሩ ተልኮልዎታል።`) + (ref ? `\nማጣቀሻ: ${ref}` : ''),
    rejected: (o) => `${o.id} አልተቀበለም${o.reject_reason ? `: ${REASON_AM[o.reject_reason]}` : ''}። በመተግበሪያው ውስጥ ድጋፍን ከፍተው የትዕዛዙን ቁጥር ይጥቀሱ።`,
    expired: (o) => `${o.id} ክፍያ በጊዜው ስላልገባ ጊዜው አልፏል። ቀድሞ ከከፈሉ ወዲያውኑ ድጋፍን ያነጋግሩ።`,
    reference: (o, ref) => `የ${o.id} ማጣቀሻ: ${ref}`,
    rate_prompt: '',
  },
};

export function copy(lang) {
  void lang; // English only for now; the Amharic copy above is kept for later
  return COPY.en;
}
