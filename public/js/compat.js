// Makes the app work on older phones (Android WebView 80 and similar) that lack a few newer browser features.
// Imported first by app.js. Everything here is a no-op on current browsers.
if (!Element.prototype.replaceChildren) {
  const replace = function replaceChildren(...nodes) {
    while (this.firstChild) this.removeChild(this.firstChild);
    for (const n of nodes) this.appendChild(typeof n === 'string' ? document.createTextNode(n) : n);
  };
  for (const proto of [Element.prototype, Document.prototype, DocumentFragment.prototype]) {
    Object.defineProperty(proto, 'replaceChildren', { value: replace, configurable: true, writable: true });
  }
}
if (!String.prototype.replaceAll) {
  Object.defineProperty(String.prototype, 'replaceAll', {
    configurable: true, writable: true,
    value(search, to) { return typeof search === 'string' ? this.split(search).join(typeof to === 'function' ? to(search) : to) : this.replace(search, to); },
  });
}
if (!Array.prototype.at) {
  Object.defineProperty(Array.prototype, 'at', { configurable: true, writable: true, value(i) { const n = Math.trunc(i) || 0; return this[n < 0 ? this.length + n : n]; } });
}

// Flex "gap" arrived in Chrome 84. If it is missing, switch on the margin-based spacing in compat.css.
try {
  const probe = document.createElement('div');
  probe.style.cssText = 'display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden';
  probe.append(document.createElement('div'), document.createElement('div'));
  document.documentElement.append(probe);
  const supported = probe.scrollHeight === 1;
  probe.remove();
  if (!supported) document.documentElement.classList.add('no-fg');
} catch { /* leave the layout as it is */ }
