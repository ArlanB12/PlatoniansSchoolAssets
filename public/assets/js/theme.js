// ============================================================
// Platonian's IS — Theme Module (v10.2)
// ------------------------------------------------------------
// Adds a class `dark` to the <html> element when the user has
// opted in to dark mode. The choice is persisted in localStorage
// so it survives reloads and survives across pages without any
// flash of the wrong theme — the inline <script> in <head> on
// each page reads localStorage before the first paint.
//
// Public API:
//   window.Theme.get()      -> 'light' | 'dark'
//   window.Theme.set(name)  -> persists + applies
//   window.Theme.toggle()   -> flips and persists
//   window.Theme.wire(btn)  -> wires a button to toggle on click
//                              and keeps its visual state in sync
// ============================================================
(() => {
  "use strict";

  const STORAGE_KEY = 'platonian_theme';

  function get() {
    try { return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light'; }
    catch { return 'light'; }
  }

  function apply(name) {
    const root = document.documentElement;
    if (name === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    // Mirror to body for legacy selectors that target body.dark
    if (document.body) {
      if (name === 'dark') document.body.classList.add('dark');
      else document.body.classList.remove('dark');
    }
  }

  function set(name) {
    const n = name === 'dark' ? 'dark' : 'light';
    apply(n);
    try { localStorage.setItem(STORAGE_KEY, n); } catch {}
    // Update every wired toggle's pressed state
    document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
      btn.setAttribute('aria-pressed', String(n === 'dark'));
    });
  }

  function toggle() {
    set(get() === 'dark' ? 'light' : 'dark');
  }

  function wire(btn) {
    if (!btn || btn._themeWired) return;
    btn._themeWired = true;
    btn.setAttribute('data-theme-toggle', '');
    btn.setAttribute('aria-pressed', String(get() === 'dark'));
    btn.addEventListener('click', (e) => { e.preventDefault(); toggle(); });
  }

  // Auto-wire any element with the .theme-toggle class on every page load
  document.addEventListener('DOMContentLoaded', () => {
    apply(get()); // re-apply (no-op if already applied by head inline script)
    document.querySelectorAll('.theme-toggle').forEach(wire);
  });

  window.Theme = { get, set, toggle, wire, apply };
})();
