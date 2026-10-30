// Input rules shared by the app (instant feedback) and the Worker (the authority).

export const NETWORK_KINDS = ['tron', 'evm', 'bybit_uid', 'other'];
export const METHOD_KINDS = ['bank', 'mobile'];

export const ADDRESS_RULES = {
  tron: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  evm: /^0x[0-9a-fA-F]{40}$/,
  bybit_uid: /^\d{5,12}$/,
  other: /^[A-Za-z0-9][A-Za-z0-9:_.\-]{5,119}$/,
};

/** Returns the cleaned address or null when it does not match the network kind's format. */
export function cleanAddress(kind, value) {
  const rule = ADDRESS_RULES[kind];
  const v = String(value ?? '').trim();
  return rule && rule.test(v) ? v : null;
}

/** Person or account name: 2-60 characters, letters (any script), spaces, dots, hyphens, apostrophes. */
export function cleanName(value) {
  const v = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (v.length < 2 || v.length > 60) return null;
  return /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u.test(v) ? v : null;
}

/** Ethiopian mobile number in any common form -> 09XXXXXXXX (or 07XXXXXXXX). */
export function cleanPhone(value) {
  const digits = String(value ?? '').replace(/[\s()-]/g, '');
  const m = /^(?:\+?251|0)?([79]\d{8})$/.exec(digits);
  return m ? `0${m[1]}` : null;
}

/** Bank account number: 5-30 characters, digits, letters, spaces and hyphens. */
export function cleanBankAccount(value) {
  const v = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (v.length < 5 || v.length > 30) return null;
  return /^[0-9A-Za-z][0-9A-Za-z -]*$/.test(v) ? v : null;
}

/** The number to pay, checked the way its method type needs: a phone for mobile money, an account for a bank. */
export function cleanAccount(kind, value) {
  return kind === 'mobile' ? cleanPhone(value) : cleanBankAccount(value);
}

/** Display name for something the admin names (bank, network, team member): 2-40 printable characters. */
export function cleanLabel(value, max = 40) {
  // eslint-disable-next-line no-control-regex
  const v = String(value ?? '').replace(/[\u0000-\u001F\u007F<>]/g, '').replace(/\s+/g, ' ').trim();
  return v.length >= 2 && v.length <= max ? v : null;
}

export const PLATFORMS = ['telegram', 'instagram', 'tiktok', 'youtube', 'other'];

const HOSTS = {
  telegram: ['t.me', 'telegram.me', 'telegram.dog'],
  instagram: ['instagram.com', 'www.instagram.com', 'instagr.am'],
  tiktok: ['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'],
  youtube: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'],
};

/**
 * The link a service is delivered to. Accepts a full link, a link without https://, or an @name for the big platforms,
 * and returns one clean https link, or null if it does not belong to the service's platform.
 */
export function cleanTarget(platform, value) {
  let v = String(value ?? '').trim();
  if (v.length < 3 || v.length > 300) return null;
  const handle = /^@([A-Za-z0-9._]{2,32})$/.exec(v);
  if (handle) {
    const h = handle[1];
    if (platform === 'telegram') return `https://t.me/${h}`;
    if (platform === 'instagram') return `https://instagram.com/${h}`;
    if (platform === 'tiktok') return `https://tiktok.com/@${h}`;
    if (platform === 'youtube') return `https://youtube.com/@${h}`;
    return null;
  }
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  let u;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (!host.includes('.') || u.pathname === '/' || u.pathname === '') return null;
  const allowed = HOSTS[platform];
  if (allowed && !allowed.includes(host)) return null;
  return `https://${host}${u.pathname}${u.search}`.slice(0, 300);
}
