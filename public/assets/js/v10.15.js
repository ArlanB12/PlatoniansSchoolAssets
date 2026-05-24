/* ============================================================
   Platonian's IS — v10.15 (scoped JS patch)
   Loaded LAST, after v10.14.js.

   Surgical, same discipline as v10.14:
     - NO document-wide MutationObserver.
     - NO rebinding of existing handlers.
     - Observes ONLY the single #notif-dropdown node.

   What this does:
     1. NOTIF MOBILE SCROLL — class-driven sheet. app.js opens
        the dropdown with an inline `display:block`, which beat
        the v10.13/v10.14 `display:flex` sheet layout (inline
        wins over non-!important CSS). With display:block the
        flex scroll region (.notif-list { flex:1 1 auto;
        min-height:0 }) never formed, so the list overflowed off
        the bottom of the screen and could not be scrolled.

        Fix: when the dropdown opens we add a `.notif-open` class
        to the dropdown itself. v10.15.css drives the entire
        mobile sheet layout from `.notif-dropdown.notif-open`
        with !important, so the inline display can no longer
        collapse the scroll container. We also add the page lock
        + tap-to-close backdrop on phones (replacing v10.14's
        body-only lock, which used touch-action:none on the body
        and inadvertently blocked the list's own pan-y scroll on
        some Chromium/Brave builds).
   ============================================================ */
(function () {
  "use strict";

  function isPhone() {
    return window.matchMedia && window.matchMedia("(max-width: 600px)").matches;
  }
  function isMobileWidth() {
    return window.matchMedia && window.matchMedia("(max-width: 900px)").matches;
  }

  function initNotifSheet() {
    var dropdown = document.getElementById("notif-dropdown");
    var bell = document.getElementById("notif-bell-btn");
    if (!dropdown || !bell) return;

    var backdrop = null;

    function ensureBackdrop() {
      if (backdrop) return backdrop;
      backdrop = document.createElement("div");
      backdrop.className = "notif-backdrop";
      // Tap the backdrop -> close via the same path app.js uses
      // (it reads style.display to toggle).
      backdrop.addEventListener("click", function () {
        dropdown.style.display = "none";
      });
      document.body.appendChild(backdrop);
      return backdrop;
    }

    function applyOpenState() {
      // The class drives the mobile sheet layout regardless of the
      // inline display app.js set. Harmless on desktop (the CSS
      // only reacts to it under <=900px).
      dropdown.classList.add("notif-open");
      if (isPhone()) {
        document.body.classList.add("notif-open");
        var bd = ensureBackdrop();
        requestAnimationFrame(function () { bd.classList.add("show"); });
      }
    }

    function clearOpenState() {
      dropdown.classList.remove("notif-open");
      document.body.classList.remove("notif-open");
      if (backdrop) backdrop.classList.remove("show");
    }

    // Watch ONLY this node's inline style (app.js toggles
    // display:none / block). Tightly scoped — no body observer.
    var wasOpen = dropdown.style.display !== "none";
    if (wasOpen) applyOpenState();

    var obs = new MutationObserver(function () {
      var openNow = dropdown.style.display !== "none";
      if (openNow === wasOpen) return;
      wasOpen = openNow;
      if (openNow) { applyOpenState(); } else { clearOpenState(); }
    });
    obs.observe(dropdown, { attributes: true, attributeFilter: ["style"] });

    // If the viewport changes while the panel is open, keep the
    // lock/backdrop consistent with the current width.
    window.addEventListener("resize", function () {
      var openNow = dropdown.style.display !== "none";
      if (!openNow) return;
      if (isPhone()) {
        document.body.classList.add("notif-open");
        var bd = ensureBackdrop();
        bd.classList.add("show");
      } else {
        document.body.classList.remove("notif-open");
        if (backdrop) backdrop.classList.remove("show");
      }
    }, { passive: true });
  }

  function init() {
    initNotifSheet();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
