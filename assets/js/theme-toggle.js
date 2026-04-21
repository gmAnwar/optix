/**
 * Theme toggle — persists selection in localStorage.
 * Usage:
 *   1) Load this script as early as possible in <head> to avoid flash.
 *   2) Place a button with `data-theme-toggle` anywhere; clicks flip the theme.
 *   3) Theme is applied to <html data-theme="light|dark">. Any .app-redesign
 *      descendant reads the tokens from tokens.css accordingly.
 *
 * Storage key: 'optix-redesign-theme' (scoped, avoids clashing with legacy 'theme').
 */
(function () {
  var STORAGE_KEY = 'optix-redesign-theme';
  var root = document.documentElement;

  function prefersDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function getStored() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (_) { return null; }
  }

  function setStored(val) {
    try { localStorage.setItem(STORAGE_KEY, val); } catch (_) {}
  }

  var SUN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"'
              + ' stroke-linecap="round" stroke-linejoin="round" width="16" height="16" aria-hidden="true">'
              + '<circle cx="12" cy="12" r="4"/>'
              + '<path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>'
              + '</svg>';
  var MOON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"'
               + ' stroke-linecap="round" stroke-linejoin="round" width="16" height="16" aria-hidden="true">'
               + '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'
               + '</svg>';

  function apply(theme) {
    root.setAttribute('data-theme', theme);
    document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
      btn.setAttribute('aria-label', theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro');
      var icon = btn.querySelector('[data-theme-icon]');
      if (icon) icon.innerHTML = theme === 'dark' ? SUN_SVG : MOON_SVG;
      var label = btn.querySelector('[data-theme-label]');
      if (label) label.textContent = theme === 'dark' ? 'Claro' : 'Oscuro';
    });
  }

  var initial = getStored() || (prefersDark() ? 'dark' : 'light');
  apply(initial);

  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-theme-toggle]');
    if (!btn) return;
    var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    setStored(next);
    apply(next);
  });

  window.OptixTheme = {
    get: function () { return root.getAttribute('data-theme'); },
    set: function (t) { setStored(t); apply(t); }
  };
})();
