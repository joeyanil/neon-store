import { createHmac } from 'node:crypto';

/** Build a correctly signed Telegram initData string, exactly like the Telegram client does. */
export function signInitData(botToken, user, { authDate = Math.floor(Date.now() / 1000), extra = {} } = {}) {
  const fields = { auth_date: String(authDate), query_id: 'AAH-test', user: JSON.stringify(user), ...extra };
  const dataCheck = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dataCheck).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}
