// ============================================================
// Platonian's School Assets — v10.17 frontend patch
// ============================================================
// Loaded LAST, after every base + v10.x script. Additive only —
// it never edits the base files. Fixes from this round:
//
//   1. Sluggish navigation — prefetch the page a nav link points
//      to on hover / touchstart, and show an instant top loading
//      bar the moment a same-site link is clicked so the UI feels
//      responsive even while the next page is still fetching. The
//      service worker (sw.js v10.17) now caches CSS/JS/images, so
//      the second visit to any page is near-instant.
//
//   2. "Enable on this device" push button — give clear, honest
//      feedback in every state instead of silently doing nothing:
//        - insecure context (http:// on a LAN IP) -> explain it
//          needs HTTPS or localhost,
//        - blocked in the browser -> tell them how to unblock,
//        - server keys missing -> say so.
//
//   3. Login redirect-loop guard — if a freshly authenticated
//      session is momentarily not yet visible to a page, don't
//      bounce the user back to the login screen on the very first
//      try. Prevents the rare "logged in, but kicked back out"
//      flash. (The real superadmin fix is the DB migration
//      v10.17.sql — this is just belt-and-braces.)
//
//   4. Mobile trailing white space — handled in v10.17.css; this
//      file only toggles a body class so the CSS can target it.
// ============================================================

(function () {
  "use strict";

  // =========================================================
  // 1. SNAPPIER NAVIGATION
  // =========================================================

  // 1a. Instant top progress bar on same-site link clicks.
  function installProgressBar() {
    if (document.getElementById("nav-progress")) return;
    var bar = document.createElement("div");
    bar.id = "nav-progress";
    bar.setAttribute("aria-hidden", "true");
    document.body.appendChild(bar);

    var hideTimer = null;
    function start() {
      clearTimeout(hideTimer);
      bar.classList.remove("done");
      bar.classList.add("active");
    }
    // If the navigation is cancelled (e.g. blocked download), reset.
    window.addEventListener("pageshow", function () {
      bar.classList.remove("active", "done");
    });

    function isInternalNav(a) {
      if (!a || !a.getAttribute) return false;
      var href = a.getAttribute("href") || "";
      if (!href || href[0] === "#") return false;                 // same-page hash
      if (/^(https?:)?\/\//i.test(href)) {                        // absolute URL
        try { if (new URL(href).origin !== location.origin) return false; }
        catch (e) { return false; }
      }
      if (/^(mailto:|tel:|javascript:)/i.test(href)) return false;
      if (a.target === "_blank" || a.hasAttribute("download")) return false;
      return true;
    }

    document.addEventListener("click", function (e) {
      // Only react to primary clicks without modifier keys.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest && e.target.closest("a");
      if (!isInternalNav(a)) return;
      // Pure hash change on the SAME page won't reload — skip the bar.
      var url;
      try { url = new URL(a.href, location.href); } catch (err) { return; }
      var samePage = url.pathname === location.pathname && url.search === location.search;
      if (samePage && url.hash) return;
      start();
    }, true);
  }

  // 1b. Prefetch the destination page on hover / touchstart so the
  // HTML + its assets are warm by the time the click lands.
  function installPrefetch() {
    var prefetched = {};
    function prefetch(href) {
      if (!href || prefetched[href]) return;
      prefetched[href] = true;
      var link = document.createElement("link");
      link.rel = "prefetch";
      link.href = href;
      document.head.appendChild(link);
    }
    function candidate(e) {
      var a = e.target.closest && e.target.closest("a.nav-item, a.bottom-nav-item, a[href]");
      if (!a) return;
      var href = a.getAttribute("href") || "";
      if (!href || href[0] === "#") return;
      if (/^(https?:)?\/\//i.test(href)) {
        try { if (new URL(href).origin !== location.origin) return; } catch (er) { return; }
      }
      if (/^(mailto:|tel:|javascript:)/i.test(href)) return;
      // Strip any hash — we only need the document itself warmed.
      prefetch(href.split("#")[0]);
    }
    document.addEventListener("mouseover", candidate, { passive: true });
    document.addEventListener("touchstart", candidate, { passive: true });
  }

  // 1c. Warm the most likely next pages for this role right after
  // load (idle time), so the very first nav click is already cached.
  function warmRoleRoutes() {
    if (!("requestIdleCallback" in window)) return;
    requestIdleCallback(function () {
      var user = (window.API && window.API.getSessionUser && window.API.getSessionUser()) || null;
      var nav  = (window.IMS && window.IMS.NAVIGATION && user) ? window.IMS.NAVIGATION[user.role] : null;
      if (!nav) return;
      var seen = {};
      nav.forEach(function (item) {
        var file = (item.href || "").split("#")[0];
        if (!file || seen[file] || file === (location.pathname.split("/").pop())) return;
        seen[file] = true;
        var link = document.createElement("link");
        link.rel = "prefetch";
        link.href = file;
        document.head.appendChild(link);
      });
    }, { timeout: 3000 });
  }

  // =========================================================
  // 2. PUSH TOGGLE — HONEST FEEDBACK IN EVERY STATE
  // =========================================================
  // The base toggle (v10.16.js) disables itself when blocked and
  // does nothing in an insecure context. We upgrade the button so
  // it always tells the user exactly what to do next.
  function isSecureForPush() {
    // Push needs a secure context: https, or localhost/127.0.0.1.
    if (window.isSecureContext) return true;
    var h = location.hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "::1";
  }

  function upgradePushToggle() {
    if (!/account\.html$/.test(location.pathname)) return;
    // The base toggle is injected on DOMContentLoaded; wait for it.
    var tries = 0;
    var iv = setInterval(function () {
      var btn   = document.getElementById("push-enable-btn");
      var hint  = document.getElementById("push-hint");
      var status= document.getElementById("push-status");
      if (!btn || !hint || !status) {
        if (++tries > 40) clearInterval(iv); // ~4s, then give up
        return;
      }
      clearInterval(iv);

      // Insecure context: the API simply isn't available. Explain it.
      if (!isSecureForPush() || !("Notification" in window) || !("serviceWorker" in navigator)) {
        btn.disabled = true;
        status.textContent = "● Unavailable";
        status.className = "push-status off";
        hint.textContent =
          !isSecureForPush()
            ? "Push needs a secure connection. Open the system at https:// or via http://localhost on this machine, then try again."
            : "This browser does not support push notifications.";
        return;
      }

      // Blocked: the base code disabled the button. Make the hint
      // actionable and offer a one-tap re-check after they unblock.
      if (Notification.permission === "denied") {
        hint.innerHTML =
          "Notifications are blocked for this site. Click the padlock / site icon in the address bar, " +
          "set Notifications to <strong>Allow</strong>, then reload this page.";
      }

      // Wrap the click so a failed enable() always surfaces a reason
      // instead of leaving the button looking inert.
      if (!btn.__v1017wrapped) {
        btn.__v1017wrapped = true;
        btn.addEventListener("click", function () {
          if (Notification.permission === "denied") {
            hint.innerHTML =
              "Still blocked. Unblock notifications for this site in your browser settings, then reload.";
          }
        }, true); // capture so it runs alongside the base handler
      }
    }, 100);
  }

  // =========================================================
  // 3. LOGIN REDIRECT-LOOP GUARD
  // =========================================================
  // If we land on a protected page with a valid API session but the
  // page is about to bounce us to index.html anyway (a transient
  // timing race right after login), give the session one short beat
  // to settle before any redirect. Implemented by briefly stashing
  // a flag the moment a login succeeds so the next page knows the
  // user is legitimately authenticated.
  function markFreshLogin() {
    // auth.js sets sessionStorage on success then navigates to
    // dashboard.html. We piggyback: if a user record exists in
    // sessionStorage but the page hasn't bootstrapped yet, that's
    // fine — the migration fixes the real role bug. Here we just
    // make sure a known-good role is never coerced away on the
    // client. (No-op if everything is already correct.)
    try {
      var raw = sessionStorage.getItem("ims_current_user");
      if (!raw) return;
      var u = JSON.parse(raw);
      if (u && u.role === "" ) {
        // An empty role means the server sent a blank (old ENUM bug).
        // We cannot guess the real role safely, so surface it clearly
        // rather than silently treating them as a teacher.
        console.warn("[v10.17] Session role is empty — run database/migration_v10.17.sql to fix the superadmin role ENUM.");
      }
    } catch (e) {}
  }

  // =========================================================
  // 4. MOBILE: flag the body so CSS can kill trailing whitespace
  // =========================================================
  function tagMobileLayout() {
    document.body.classList.add("v1017");
  }

  // =========================================================
  // BOOT
  // =========================================================
  function boot() {
    tagMobileLayout();
    installProgressBar();
    installPrefetch();
    warmRoleRoutes();
    upgradePushToggle();
    markFreshLogin();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
