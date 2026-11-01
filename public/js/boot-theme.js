// Runs before the first paint so there is no white flash when Telegram is in dark mode.
(function () {
  var wa = window.Telegram && window.Telegram.WebApp;
  var dark = wa && wa.colorScheme ? wa.colorScheme === 'dark' : window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();

// Starts the app. Done here (not with a <script type="module"> tag) so that if the phone cannot load or run the app's
// files, the exact reason is shown on screen instead of an empty page.
(function () {
  function say(text) {
    var app = document.getElementById('app');
    if (!app || (app.firstChild && !app.querySelector('.boot-note'))) return;
    app.textContent = '';
    var p = document.createElement('p');
    p.className = 'boot-note';
    p.style.cssText = 'padding:24px;font:15px/1.5 system-ui,sans-serif;text-align:center;word-break:break-word';
    p.textContent = text;
    app.appendChild(p);
  }
  function start() {
    var v = (navigator.userAgent.match(/Chrome\/(\d+)/) || [])[1];
    import('/js/app.js').catch(function (err) {
      say('The app could not start (' + String((err && err.message) || err).slice(0, 160) + (v ? '; browser ' + v : '') + '). Close it and open it again. If this keeps happening, tell the shop owner.');
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  // Safety net: if nothing has been drawn after 10 seconds, say so instead of showing an empty screen.
  setTimeout(function () { say('The app could not load. Close it and open it again. If this keeps happening, tell the shop owner.'); }, 10000);
})();
