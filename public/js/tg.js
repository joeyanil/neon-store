// Everything that touches Telegram's own UI lives here, with a safe fallback when the app is opened in a plain browser.
// Telegram.WebApp reference: https://core.telegram.org/bots/webapps

const WA = window.Telegram?.WebApp;
export const tg = WA && WA.initData ? WA : null;
export const inTelegram = Boolean(tg);

const atLeast = (v) => Boolean(tg?.isVersionAtLeast?.(v));
const safe = (fn) => { try { return fn(); } catch { return undefined; } };

export const THEME_COLORS = {
  light: { bg: '#dde5f0', accent: '#0a62d0', onAccent: '#ffffff' },
  dark: { bg: '#0d1424', accent: '#3dd5ff', onAccent: '#04202b' },
};

export const initData = () => (tg ? tg.initData : '');
export const user = () => tg?.initDataUnsafe?.user ?? null;
export const startParam = () => tg?.initDataUnsafe?.start_param ?? new URLSearchParams(location.search).get('startapp') ?? '';

// ---------- start up ----------
export function init() {
  if (!tg) return;
  document.body.classList.add('in-tg');
  safe(() => tg.ready());
  safe(() => tg.expand());
  if (/Telegram-Android.*\(LOW\)/.test(navigator.userAgent)) document.documentElement.classList.add('lowperf');
}

// ---------- theme ----------
export function systemScheme() {
  return tg?.colorScheme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

/** pref: 'auto' follows Telegram, or 'light' / 'dark' forces one. */
export function applyTheme(pref) {
  const scheme = pref === 'light' || pref === 'dark' ? pref : systemScheme();
  document.documentElement.dataset.theme = scheme;
  const c = THEME_COLORS[scheme];
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', c.bg);
  if (tg) {
    safe(() => tg.setHeaderColor(c.bg));
    safe(() => tg.setBackgroundColor(c.bg));
    if (atLeast('7.10')) safe(() => tg.setBottomBarColor(c.bg));
  }
  return scheme;
}

export function onThemeChanged(cb) {
  safe(() => tg?.onEvent('themeChanged', cb));
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', cb);
}
export function onActivated(cb) {
  safe(() => tg?.onEvent('activated', cb));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) cb(); });
}

// ---------- haptics ----------
export const haptic = {
  tap: () => safe(() => tg?.HapticFeedback.impactOccurred('light')),
  press: () => safe(() => tg?.HapticFeedback.impactOccurred('medium')),
  select: () => safe(() => tg?.HapticFeedback.selectionChanged()),
  success: () => safe(() => tg?.HapticFeedback.notificationOccurred('success')),
  warn: () => safe(() => tg?.HapticFeedback.notificationOccurred('warning')),
  error: () => safe(() => tg?.HapticFeedback.notificationOccurred('error')),
};

// ---------- back button ----------
let backHandler = null;
export function setBack(handler) {
  if (!tg) return;
  safe(() => { if (backHandler) tg.BackButton.offClick(backHandler); });
  backHandler = handler;
  safe(() => {
    if (handler) { tg.BackButton.onClick(handler); tg.BackButton.show(); } else tg.BackButton.hide();
  });
}

// ---------- the big bottom button ----------
// Inside Telegram this drives the native Main/Secondary buttons. In a browser it falls back to our own bar.
let fallbackBar = null;
let mainCb = null;
let secondaryCb = null;

export function mountFallbackBar(el) {
  fallbackBar = el;
}
export const usesNativeButtons = () => Boolean(tg?.MainButton);

function colors() {
  return THEME_COLORS[document.documentElement.dataset.theme] || THEME_COLORS.light;
}

/**
 * @param {{text: string, onClick: Function, disabled?: boolean, loading?: boolean} | null} main
 * @param {{text: string, onClick: Function} | null} [secondary]
 */
export function setActions(main, secondary = null) {
  // If this Telegram version fails on its native buttons, fall through to the app's own bottom bar.
  if (usesNativeButtons() && safe(() => { setNativeActions(main, secondary); return true; })) return;
  setBarActions(main, secondary);
}

function setNativeActions(main, secondary) {
  {
    const mb = tg.MainButton;
    if (mainCb) { mb.offClick(mainCb); mainCb = null; }
    if (!main) {
      mb.hideProgress();
      mb.hide();
    } else {
      const c = colors();
      mb.setParams({ text: main.text, color: c.accent, text_color: c.onAccent, is_active: !main.disabled && !main.loading, is_visible: true, has_shine_effect: false });
      if (main.loading) mb.showProgress(false); else mb.hideProgress();
      mainCb = main.onClick;
      mb.onClick(mainCb);
    }
    if (atLeast('7.10') && tg.SecondaryButton) {
      const sb = tg.SecondaryButton;
      if (secondaryCb) { sb.offClick(secondaryCb); secondaryCb = null; }
      if (!secondary) sb.hide();
      else {
        sb.setParams({ text: secondary.text, is_visible: true, position: 'top' });
        secondaryCb = secondary.onClick;
        sb.onClick(secondaryCb);
      }
    }
  }
}

function setBarActions(main, secondary) {
  if (!fallbackBar) return;
  fallbackBar.replaceChildren();
  fallbackBar.hidden = !main && !secondary;
  const mk = (cfg, cls) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn block ${cls}`;
    b.disabled = Boolean(cfg.disabled || cfg.loading);
    if (cfg.loading) {
      const s = document.createElement('span');
      s.className = 'spin';
      b.append(s);
    }
    b.append(document.createTextNode(cfg.text));
    b.addEventListener('click', () => { haptic.tap(); cfg.onClick(); });
    return b;
  };
  if (secondary) fallbackBar.append(mk(secondary, ''));
  if (main) fallbackBar.append(mk(main, 'primary'));
}

// ---------- dialogs and links ----------
export function confirmDialog(message) {
  return new Promise((resolve) => {
    try {
      if (tg && atLeast('6.2')) tg.showConfirm(message, (ok) => resolve(Boolean(ok)));
      else resolve(window.confirm(message));
    } catch { resolve(window.confirm(message)); }
  });
}
export function openTelegramLink(url) {
  try { if (tg) tg.openTelegramLink(url); else window.open(url, '_blank', 'noopener'); } catch { window.open(url, '_blank', 'noopener'); }
}
export function setClosingConfirmation(on) {
  if (!tg) return;
  safe(() => (on ? tg.enableClosingConfirmation() : tg.disableClosingConfirmation()));
}
export function requestWriteAccess() {
  return new Promise((resolve) => {
    try {
      if (tg && atLeast('6.9')) tg.requestWriteAccess((ok) => resolve(Boolean(ok)));
      else resolve(false);
    } catch { resolve(false); }
  });
}
export const closeApp = () => safe(() => (tg ? tg.close() : window.close()));

// ---------- keyboard: hide the floating nav while typing so it never covers a field ----------
// Android does not blur a field when the keyboard is dismissed, so the nav also comes back when the visible
// height recovers, when the person taps outside a field, or presses Enter.
export function watchKeyboard() {
  const isField = (el) => el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && el.type !== 'file';
  const show = () => document.body.classList.remove('kb');
  const fullHeight = () => Math.max(window.innerHeight, screen.height * 0.5);
  document.addEventListener('focusin', (e) => {
    if (!isField(e.target)) return;
    document.body.classList.add('kb');
    setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250);
  });
  document.addEventListener('focusout', () => setTimeout(() => { if (!isField(document.activeElement)) show(); }, 80));
  document.addEventListener('pointerdown', (e) => {
    if (isField(document.activeElement) && !e.target.closest?.('input, textarea, select, label')) {
      document.activeElement.blur();
      show();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.target.blur(); show(); }
  });
  window.visualViewport?.addEventListener('resize', () => {
    if (window.visualViewport.height >= fullHeight() * 0.9) show();
  });
}

// ---------- small persistent preferences (device storage when Telegram offers it) ----------
const mem = new Map();
// Device storage only accepts letters, digits, underscore and dash in a key, and some Telegram versions never answer at all,
// so every read has a short deadline: a missing answer must never keep the app from opening.
const safeKey = (k) => String(k).replace(/[^A-Za-z0-9_-]/g, '_');
export const prefs = {
  /** Looks in this phone's browser storage first (instant), then Telegram's device storage, then Telegram's cloud storage (which also survives a reinstall). */
  async get(key) {
    const sk = safeKey(key);
    const ask = (store, minVersion) => new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 1200);
      try {
        if (tg && atLeast(minVersion) && tg[store]) return tg[store].getItem(sk, (err, v) => { clearTimeout(timer); resolve(err || !v ? null : v); });
      } catch { /* fall through */ }
      clearTimeout(timer);
      resolve(null);
    });
    try { const v = localStorage.getItem(key); if (v) return v; } catch { /* no browser storage */ }
    return (await ask('DeviceStorage', '9.0')) || (await ask('CloudStorage', '6.9')) || mem.get(key) || null;
  },
  /** Saves in every place that works, so one that is cleared or unsupported does not lose the choice. */
  set(key, value) {
    mem.set(key, value);
    const sk = safeKey(key);
    try { localStorage.setItem(key, value); } catch { /* no browser storage */ }
    try { if (tg && atLeast('9.0') && tg.DeviceStorage) tg.DeviceStorage.setItem(sk, value); } catch { /* unsupported */ }
    try { if (tg && atLeast('6.9') && tg.CloudStorage) tg.CloudStorage.setItem(sk, value); } catch { /* unsupported */ }
  },
};
