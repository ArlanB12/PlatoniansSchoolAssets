/* ============================================================
   Platonian's IS — v10.7 Enhancements
   Loaded AFTER app.js and v10.6.js. Adds:
     1. Bottom-nav placeholder hand-off — sets a body class
        once the real bottom-nav is populated so the CSS
        placeholder strip (defined in v10.7.css) stops
        showing. Eliminates the "navbar disappears for a
        second" flicker when switching pages on mobile.
     2. Hardens sidebar drawer overlay on every page (some
        modules forgot to wire it).
   ============================================================ */
(function () {
  "use strict";

  /* -- 1. Bottom-nav placeholder hand-off ----------------- */
  function flagBottomNavReady() {
    var bnav = document.getElementById("bottom-nav");
    if (!bnav) return false;
    var hasItems = !!bnav.querySelector(".bottom-nav-item");
    if (hasItems) {
      document.body.classList.add("has-bnav");
      return true;
    }
    return false;
  }

  function watchBottomNav() {
    // Try immediately — app.js may already have rendered.
    if (flagBottomNavReady()) return;

    // Poll briefly for the first 1.5s of page life. This catches
    // the typical sub-150ms gap between DOMContentLoaded and the
    // moment renderBottomNav() finishes injecting items.
    var attempts = 0;
    var maxAttempts = 30;  // 30 × 50ms = 1.5s
    var t = setInterval(function () {
      attempts++;
      if (flagBottomNavReady() || attempts >= maxAttempts) {
        clearInterval(t);
      }
    }, 50);

    // Also watch for late mutations (some pages call renderSidebar
    // inside an async session bootstrap, so the bar can arrive
    // much later than DOMContentLoaded).
    if ("MutationObserver" in window) {
      var mo = new MutationObserver(function () {
        if (flagBottomNavReady()) mo.disconnect();
      });
      mo.observe(document.body, { childList: true, subtree: true });
      // Stop observing after 8s either way — we don't need to
      // keep this alive for the life of the page.
      setTimeout(function () { mo.disconnect(); }, 8000);
    }
  }

  /* -- 2. Drawer overlay safety net ----------------------- */
  // v10.6.js already wires the overlay, but it runs after a 0ms
  // setTimeout — if the user taps the menu button in the first
  // ~10ms of page life on a slow phone, the drawer opens but the
  // overlay isn't clickable. Wire it inline-eager too.
  function wireDrawerEager() {
    var overlay = document.getElementById("sidebar-overlay");
    var sidebar = document.getElementById("sidebar");
    if (!overlay || !sidebar) return;
    if (overlay.dataset.wired === "1") return;
    overlay.addEventListener("click", function () {
      sidebar.classList.remove("open");
      overlay.classList.remove("show");
    });
    overlay.dataset.wired = "1";
  }

  /* -- Init ----------------------------------------------- */
  function init() {
    wireDrawerEager();
    watchBottomNav();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
