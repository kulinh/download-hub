(function () {
  function getStoredTheme() {
    try { return localStorage.getItem('theme'); } catch (_) { return null; }
  }

  function getSystemTheme() {
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
  }

  function updateBtn(theme) {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    var isDark = theme === 'dark';
    btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    btn.setAttribute('title', isDark ? 'Switch to light mode' : 'Switch to dark mode');
  }

  var initialTheme = getStoredTheme() || getSystemTheme();
  applyTheme(initialTheme);

  document.addEventListener('DOMContentLoaded', function () {
    var theme = document.documentElement.getAttribute('data-theme') || 'dark';
    updateBtn(theme);

    var btn = document.getElementById('theme-toggle');
    if (!btn) return;

    btn.addEventListener('click', function () {
      var current = document.documentElement.getAttribute('data-theme') || 'dark';
      var next = current === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('theme', next); } catch (_) {}
      applyTheme(next);
      updateBtn(next);
    });
  });
})();
