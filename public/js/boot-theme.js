// Runs before the first paint so there is no white flash when Telegram is in dark mode.
(function () {
  var wa = window.Telegram && window.Telegram.WebApp;
  var dark = wa && wa.colorScheme ? wa.colorScheme === 'dark' : window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();

// Safety net: if the app has still not drawn anything after 8 seconds, say so instead of showing an empty screen.
setTimeout(function () {
  var app = document.getElementById('app');
  if (app && !app.firstChild) {
    var p = document.createElement('p');
    p.style.cssText = 'padding:24px;font:16px system-ui,sans-serif;text-align:center';
    p.textContent = 'The app could not load. Close it and open it again. If this keeps happening, tell the shop owner.';
    app.appendChild(p);
  }
}, 8000);
