// A stand-in for Telegram.WebApp that records what the app asks Telegram to do.
// Injected before the page loads. Tests drive it through window.__tg.
(function () {
  const handlers = {};
  const state = {
    scheme: 'light', header: null, background: null, bottomBar: null, closing: false, closed: false, opened: [], haptics: [], writeAccess: true, confirmAnswer: true,
    back: { visible: false },
    main: { text: '', is_visible: false, is_active: true, progress: false },
    secondary: { text: '', is_visible: false },
  };
  const cbs = { back: new Set(), main: new Set(), secondary: new Set() };
  const params = window.__INIT;
  const btn = (key, store) => ({
    setParams(p) { Object.assign(state[key], p); return this; },
    show() { state[key].is_visible = true; return this; },
    hide() { state[key].is_visible = false; return this; },
    showProgress() { state[key].progress = true; return this; },
    hideProgress() { state[key].progress = false; return this; },
    onClick(cb) { store.add(cb); return this; },
    offClick(cb) { store.delete(cb); return this; },
  });
  const WebApp = {
    initData: params.initData,
    initDataUnsafe: { user: params.user, auth_date: Math.floor(Date.now() / 1000) },
    version: '9.6', platform: 'android', colorScheme: params.scheme || 'light', themeParams: {},
    isVersionAtLeast: () => true,
    // Telegram's own storage survives even when the page's localStorage is wiped; sessionStorage stands in for it here.
    DeviceStorage: { getItem(k, cb) { cb(null, sessionStorage.getItem('tgmock:' + k)); }, setItem(k, v, cb) { sessionStorage.setItem('tgmock:' + k, v); if (cb) cb(null, true); } },
    ready() {}, expand() {}, close() { state.closed = true; },
    setHeaderColor(c) { state.header = c; }, setBackgroundColor(c) { state.background = c; }, setBottomBarColor(c) { state.bottomBar = c; },
    enableClosingConfirmation() { state.closing = true; }, disableClosingConfirmation() { state.closing = false; },
    showConfirm(msg, cb) { state.lastConfirm = msg; cb(state.confirmAnswer); },
    openTelegramLink(u) { state.opened.push(u); },
    requestWriteAccess(cb) { cb(state.writeAccess); },
    HapticFeedback: {
      impactOccurred(s) { state.haptics.push('impact:' + s); }, notificationOccurred(s) { state.haptics.push('notify:' + s); }, selectionChanged() { state.haptics.push('select'); },
    },
    BackButton: {
      show() { state.back.visible = true; return this; }, hide() { state.back.visible = false; return this; },
      onClick(cb) { cbs.back.add(cb); return this; }, offClick(cb) { cbs.back.delete(cb); return this; },
    },
    MainButton: btn('main', cbs.main),
    SecondaryButton: btn('secondary', cbs.secondary),
    onEvent(n, cb) { (handlers[n] ||= new Set()).add(cb); },
    offEvent(n, cb) { handlers[n]?.delete(cb); },
  };
  state.scheme = WebApp.colorScheme;
  window.Telegram = { WebApp };
  window.__tg = {
    state,
    fire(name) { (handlers[name] || []).forEach((cb) => cb.call(WebApp)); },
    setScheme(s) { WebApp.colorScheme = s; state.scheme = s; this.fire('themeChanged'); },
    pressMain() { if (!state.main.is_visible || state.main.is_active === false) throw new Error('Main button is not pressable: ' + JSON.stringify(state.main)); [...cbs.main].forEach((cb) => cb()); },
    pressBack() { if (!state.back.visible) throw new Error('Back button is hidden'); [...cbs.back].forEach((cb) => cb()); },
  };
})();
