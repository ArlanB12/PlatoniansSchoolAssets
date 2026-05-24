/* ============================================================
   Platonian's IS — v10.6 Enhancements
   Loaded AFTER app.js. Adds:
     1. Drawer "Quick Actions" — mirrors topbar export/backup
        buttons inside the off-canvas sidebar so they remain
        reachable when hidden on mobile.
     2. Bottom-nav "More" button removal (CSS hides it, this
        also strips it from the DOM after render).
     3. Hamburger menu click toggle hardening (open + close).
   ============================================================ */
(function () {
  "use strict";

  /* -- Helpers --------------------------------------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function isMobile() {
    return window.matchMedia("(max-width: 900px)").matches;
  }

  /* -- 1. Drawer "Quick Actions" --------------------------- */
  // Find every [data-management-control="true"] button (or label
  // that wraps a button-like control) sitting inside .topbar-right
  // and mirror them into a section in the sidebar drawer. Clicking
  // a mirror calls .click() on the original so all existing handlers
  // continue to work without changes to app.js.

  function getActionLabel(el) {
    var t = (el.textContent || "").replace(/\s+/g, " ").trim();
    // Strip stray icon prefixes like "⇩ Backup Database"
    t = t.replace(/^[\u2300-\u27FF\u2900-\u29FF\u2B00-\u2BFF\u2190-\u21FF]\s*/, "");
    return t || (el.getAttribute("aria-label") || "Action");
  }

  function iconFor(label) {
    var key = String(label || "").toLowerCase();
    if (key.indexOf("master") >= 0) {
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
    }
    if (key.indexOf("analytics") >= 0 || key.indexOf("summary") >= 0) {
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-5"/></svg>';
    }
    if (key.indexOf("all csv") >= 0 || key.indexOf("export") >= 0) {
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    }
    if (key.indexOf("backup") >= 0) {
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></svg>';
    }
    if (key.indexOf("restore") >= 0) {
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
  }

  function buildDrawerActions() {
    var sidebar = $("#sidebar");
    if (!sidebar) return;

    // Collect candidate originals from the topbar (only inside .topbar-right
    // to avoid grabbing per-table CSV export buttons).
    var topRight = $(".topbar .topbar-right") || $(".topbar-right");
    if (!topRight) return;

    var originals = $$('[data-management-control="true"]', topRight);
    if (!originals.length) {
      var existing = $("#drawer-actions");
      if (existing) existing.remove();
      return;
    }

    // Re-create the section every render (so it stays in sync with the
    // page's actual topbar buttons — e.g. dashboard has 1, reports has 5).
    var prev = $("#drawer-actions");
    if (prev) prev.remove();

    var section = document.createElement("div");
    section.id = "drawer-actions";
    section.className = "drawer-actions";

    var title = document.createElement("div");
    title.className = "drawer-actions-title";
    title.textContent = "Quick Actions";
    section.appendChild(title);

    originals.forEach(function (orig) {
      var label = getActionLabel(orig);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "drawer-action";
      btn.innerHTML = iconFor(label) + " <span>" + label + "</span>";

      btn.addEventListener("click", function (e) {
        e.preventDefault();
        // Close the drawer first so the file picker / confirmation
        // dialog (if any) lands on top of the page, not the drawer.
        closeDrawer();
        // Forward the click to the original control. For <label>
        // wrappers around <input type="file">, .click() opens the
        // native picker; for <button>, it fires the existing handler.
        setTimeout(function () {
          if (orig.tagName === "LABEL") {
            var fileInput = orig.querySelector('input[type="file"]');
            if (fileInput) {
              fileInput.click();
            } else {
              orig.click();
            }
          } else {
            orig.click();
          }
        }, 180);
      });

      section.appendChild(btn);
    });

    // Inject ABOVE the logout button block so the layout stays sensible.
    var logoutBlock = sidebar.querySelector(".sidebar-logout");
    if (logoutBlock) {
      sidebar.insertBefore(section, logoutBlock);
    } else {
      sidebar.appendChild(section);
    }
  }

  /* -- 2. Strip the bottom-nav "More" button --------------- */
  function stripMoreButton() {
    var more = document.getElementById("bottom-nav-more");
    if (more && more.parentNode) {
      more.parentNode.removeChild(more);
    }
  }

  /* -- 3. Drawer helpers ----------------------------------- */
  function closeDrawer() {
    var sidebar = $("#sidebar");
    var overlay = $("#sidebar-overlay");
    if (sidebar) sidebar.classList.remove("open");
    if (overlay) overlay.classList.remove("show");
  }

  // Make sure the overlay always closes the drawer when tapped
  // (some pages didn't wire it). Idempotent: safe to run twice.
  function wireDrawerOverlay() {
    var overlay = $("#sidebar-overlay");
    if (!overlay || overlay.dataset.wired === "1") return;
    overlay.addEventListener("click", closeDrawer);
    overlay.dataset.wired = "1";
  }

  /* -- Init ------------------------------------------------ */
  function init() {
    // Run our mirroring after app.js has had a chance to render the
    // sidebar nav. A small delay covers the case where renderSidebar
    // runs inside a deferred entry.js chain.
    setTimeout(function () {
      buildDrawerActions();
      stripMoreButton();
      wireDrawerOverlay();
    }, 0);

    // Re-run on layout-affecting events (window resize crossing the
    // breakpoint can mean a fresh render of the bottom nav).
    var lastMobile = isMobile();
    window.addEventListener("resize", function () {
      var now = isMobile();
      if (now !== lastMobile) {
        lastMobile = now;
        stripMoreButton();
        buildDrawerActions();
      }
    });

    // Observe the sidebar in case the framework re-renders it later.
    var sidebar = $("#sidebar");
    if (sidebar && "MutationObserver" in window) {
      var obs = new MutationObserver(function () {
        // Only re-build if our section is missing — avoid feedback loop.
        if (!document.getElementById("drawer-actions")) {
          buildDrawerActions();
        }
      });
      obs.observe(sidebar, { childList: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
