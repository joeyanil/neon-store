// Input validation for the API. The format rules live in public/js/rules.js so the app and server agree.
export { cleanAccount, cleanAddress, cleanBankAccount, cleanLabel, cleanName, cleanPhone, cleanTarget, METHOD_KINDS, NETWORK_KINDS, PLATFORMS } from '../public/js/rules.js';

/** Free text from the customer (transaction id, reference): up to 300 characters, control characters removed. */
export function cleanNote(value, max = 300) {
  // eslint-disable-next-line no-control-regex
  const v = String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  return v.length > max ? v.slice(0, max) : v;
}

export function isValidIdemKey(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(value);
}

export function isOrderId(value) {
  return typeof value === 'string' && /^NG-[2-9A-HJKMNP-Z]{6}$/.test(value);
}
