// Money helpers. Everything is integer math so rounding never drifts.
//   USDT is held as micro-units (6 decimals), ETB as cents (2 decimals).
// Rounding policy protects the house: a customer buying USDT pays ETB rounded UP,
// a customer selling USDT receives ETB rounded DOWN.

export const USDT_SCALE = 1_000_000;

/** "12.5" -> 12_500_000. Returns null for anything that is not a plain positive decimal with <= 6 places. */
export function parseUsdt(input) {
  const s = String(input ?? '').trim();
  if (!/^\d{1,9}(\.\d{1,6})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const micro = Number(whole) * USDT_SCALE + Number(frac.padEnd(6, '0'));
  return micro > 0 ? micro : null;
}

/** "165.5" -> 16550 (ETB cents per USDT). Max 2 decimals. */
export function parseRate(input) {
  const s = String(input ?? '').trim();
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return cents > 0 ? cents : null;
}

/** ETB cents owed for a USDT amount at a rate. mode: 'up' (customer pays) or 'down' (customer receives). */
export function etbForUsdt(usdtMicro, rateCents, mode) {
  const num = BigInt(usdtMicro) * BigInt(rateCents);
  const den = BigInt(USDT_SCALE);
  let q = num / den;
  if (mode === 'up' && num % den !== 0n) q += 1n;
  return Number(q);
}

export function formatUsdt(micro) {
  const whole = Math.floor(micro / USDT_SCALE);
  const frac = String(micro % USDT_SCALE).padStart(6, '0').replace(/0+$/, '').padEnd(2, '0');
  return `${whole.toLocaleString('en-US')}.${frac}`;
}

export function formatEtb(cents) {
  const whole = Math.floor(cents / 100);
  const frac = String(cents % 100).padStart(2, '0');
  return `${whole.toLocaleString('en-US')}.${frac}`;
}
