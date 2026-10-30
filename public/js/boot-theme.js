// Runs before the first paint so there is no white flash when Telegram is in dark mode.
(function () {
  var wa = window.Telegram && window.Telegram.WebApp;
  var dark = wa && wa.colorScheme ? wa.colorScheme === 'dark' : window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
