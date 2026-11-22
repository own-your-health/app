// Applies the theme chosen in Settings before the page first paints, so a
// light choice on a dark phone (or the reverse) never flashes. It reads one
// setting and touches nothing else. src/theme.ts does the same on a change.
(function () {
  var theme;
  try {
    theme = localStorage.getItem('own-your-health-app.theme');
  } catch {
    // Storage refused (a private window with storage off): the device's theme.
    return;
  }
  if (theme !== 'light' && theme !== 'dark') return;
  document.documentElement.setAttribute('data-theme', theme);
  var bar = theme === 'dark' ? '#1d2452' : '#121848';
  var metas = document.querySelectorAll('meta[name="theme-color"]');
  for (var i = 0; i < metas.length; i++) metas[i].setAttribute('content', bar);
})();
