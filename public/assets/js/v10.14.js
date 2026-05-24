/* ============================================================
   Platonian's IS — v10.14 (scoped JS patch)
   Loaded LAST, after v10.11.js.

   Deliberately SURGICAL. Lessons from the v10.12 regression:
     - NO document-wide MutationObserver.
     - NO rebinding / cloning of existing handlers.
     - NO touching auth or dashboard render timing.

   What this does:
     1. NOTIF SCROLL LOCK (mobile). Watches ONLY the notif
        dropdown's `style.display` via a tightly-scoped observer
        on the single #notif-dropdown node. When it opens on a
        phone width it adds body.notif-open + a tap-to-close
        backdrop so the list scrolls instead of the page behind.

     2. POLLING OPTIMIZATION. Pauses the 30s notification poll
        while the tab is hidden and fires one immediate refresh
        when it becomes visible again. We wrap the public
        window.IMS.fetchNotifications() hook ONLY — not
        window.fetch and not the timer — so a hidden-tab poll
        short-circuits with zero network work. Saves needless
        API hits / battery without changing any data flow.
   ============================================================ */
(function () {
  "use strict";

  function isPhone() {
    return window.matchMedia && window.matchMedia("(max-width: 600px)").matches;
  }

  /* =====================================================
     1. NOTIFICATION SCROLL LOCK + BACKDROP (MOBILE)
     ===================================================== */
  function initNotifScrollLock() {
    var dropdown = document.getElementById("notif-dropdown");
    var bell = document.getElementById("notif-bell-btn");
    if (!dropdown || !bell) return;

    var backdrop = null;

    function ensureBackdrop() {
      if (backdrop) return backdrop;
      backdrop = document.createElement("div");
      backdrop.className = "notif-backdrop";
      // Tapping the backdrop closes the panel by reusing the
      // existing close path: hide the dropdown the same way
      // app.js's outside-click handler would. We set display
      // directly (app.js reads style.display to toggle).
      backdrop.addEventListener("click", function () {
        dropdown.style.display = "none";
      });
      document.body.appendChild(backdrop);
      return backdrop;
    }

    function lock() {
      if (!isPhone()) return;
      document.body.classList.add("notif-open");
      var bd = ensureBackdrop();
      // next frame so the opacity transition runs
      requestAnimationFrame(function () { bd.classList.add("show"); });
    }

    function unlock() {
      document.body.classList.remove("notif-open");
      if (backdrop) backdrop.classList.remove("show");
    }

    // Observe ONLY this one node's style attribute. This is the
    // narrow scope v10.13 promised — no document.body observer.
    var isOpen = dropdown.style.display !== "none";
    var obs = new MutationObserver(function () {
      var openNow = dropdown.style.display !== "none";
      if (openNow === isOpen) return;
      isOpen = openNow;
      if (openNow) { lock(); } else { unlock(); }
    });
    obs.observe(dropdown, { attributes: true, attributeFilter: ["style"] });

    // Safety: if the viewport rotates / resizes while open and
    // leaves phone width, drop the lock so desktop isn't frozen.
    window.addEventListener("resize", function () {
      if (document.body.classList.contains("notif-open") && !isPhone()) {
        unlock();
      } else if (dropdown.style.display !== "none" && isPhone()) {
        lock();
      }
    }, { passive: true });
  }

  /* =====================================================
     2. POLLING OPTIMIZATION — PAUSE WHEN TAB HIDDEN
     app.js polls notifications every 30s via the exposed
     window.IMS.fetchNotifications(). We wrap THAT one function
     (not window.fetch, not the timer) so a poll that fires
     while the tab is hidden short-circuits with zero network
     work, and we fire a single real catch-up the moment the
     tab becomes visible again. Fully reversible: if the hook
     isn't present yet we retry briefly, then give up quietly.
     ===================================================== */
  function patchFetchNotifications() {
    if (!window.IMS || typeof window.IMS.fetchNotifications !== "function") return false;
    if (window.IMS.__v1014_notif_patched) return true;

    var realFetch = window.IMS.fetchNotifications;
    window.IMS.fetchNotifications = function () {
      // Skip the periodic poll while hidden. A poll has no
      // arguments; if anything ever calls it explicitly we still
      // honor that by running the real fetch.
      if (document.hidden && arguments.length === 0) {
        return Promise.resolve();
      }
      return realFetch.apply(this, arguments);
    };
    window.IMS.__v1014_notif_patched = true;
    return true;
  }

  function initPollingOptimization() {
    // The hook is set late in app.js; poll a few times for it.
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      if (patchFetchNotifications() || tries > 40) clearInterval(iv);
    }, 100);

    // Catch-up refresh when the tab returns to the foreground.
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && window.IMS &&
          typeof window.IMS.fetchNotifications === "function") {
        // Pass a flag arg so the wrapper above runs the real
        // fetch even though this fires right as visibility flips.
        window.IMS.fetchNotifications("__catchup");
      }
    });
  }

  /* =====================================================
     INIT
     ===================================================== */
  function init() {
    // v10.15 supersedes the notif scroll lock with a class-driven
    // sheet (it adds .notif-open to the dropdown so the inline
    // display:block from app.js can no longer collapse the flex
    // scroll container). Running both would create two observers
    // and two backdrops, so the lock is disabled here. The polling
    // optimization below is still owned by v10.14.
    // initNotifScrollLock();  // <- handled by v10.15.js now
    initPollingOptimization();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
