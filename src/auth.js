// Telegram Mini App login: verify the signed initData string on the server.
// Algorithm (core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
//   secret = HMAC_SHA256(key = "WebAppData", message = bot_token)
//   check  = HMAC_SHA256(key = secret, message = data_check_string)
// data_check_string = every received field except `hash`, as key=value, sorted by key, joined with "\n".

export class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const enc = new TextEncoder();

async function hmac(keyBytes, message) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * @param {string} initData  raw Telegram.WebApp.initData
 * @param {string} botToken
 * @param {{maxAgeSec?: number, now?: number}} [opts]
 * @returns {Promise<{user: object, authDate: number, startParam?: string}>}
 */
export async function validateInitData(initData, botToken, opts = {}) {
  const maxAgeSec = opts.maxAgeSec ?? 86400;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (!initData || typeof initData !== 'string' || initData.length > 4096) throw new AuthError('bad_init_data', 'Missing or malformed login data');
  if (!botToken) throw new AuthError('server_misconfigured', 'Bot token is not configured');

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new AuthError('bad_init_data', 'Login data has no signature');
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secret = await hmac(enc.encode('WebAppData'), botToken);
  const expected = toHex(await hmac(secret, dataCheckString));
  if (!safeEqual(expected, hash.toLowerCase())) throw new AuthError('bad_signature', 'Login data signature is invalid');

  const authDate = Number(params.get('auth_date'));
  if (!Number.isInteger(authDate) || authDate <= 0) throw new AuthError('bad_init_data', 'Login data has no date');
  if (now - authDate > maxAgeSec) throw new AuthError('expired', 'Login data is too old. Reopen the app.');
  if (authDate - now > 300) throw new AuthError('bad_init_data', 'Login data date is in the future');

  let user;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch {
    user = null;
  }
  if (!user || !Number.isSafeInteger(user.id) || user.is_bot) throw new AuthError('bad_init_data', 'Login data has no user');

  return { user, authDate, startParam: params.get('start_param') || undefined };
}
