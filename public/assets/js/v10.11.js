/* ============================================================
   Platonian's IS — v10.11 Enhancements
   Loaded LAST, after v10.10.js. Adds:

     1. Filter-select chevron wrapper — wraps every
        <select class="filter-select"> in a div.filter-select-wrap
        so the chevron lives on the wrapper (not the select),
        eliminating duplicate-chevron rendering glitches.

     2. IMS.toast(opts) and IMS.toast.success(msg) — non-modal
        notifications that slide in from the top-right, auto-
        dismiss after a delay, and never block the UI.

     3. Success celebration modal — when a teacher's borrow
        request submits successfully, show a proper confirmation
        with the request ID and next-step guidance instead of
        just the small inline message.

     4. Additional confirmations:
        - Add Category (Inventory page)
        - Add Location (Inventory page)
        - Edit Max Borrow Limit (Inventory page)
        - Mark all notifications read
        - Forgot Password submission

     5. Success toasts wired to all setMsg/setMessage calls
        that include "success" — automatic celebratory feedback
        for every completed action.
   ============================================================ */
(function () {
  "use strict";

  function escapeHTML(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }


  /* =====================================================
     1. FILTER-SELECT CHEVRON WRAPPER
     Wraps each <select.filter-select> in
        <div class="filter-select-wrap"> ... </div>
     so the chevron is a sibling ::after on the wrapper,
     never a property of the select itself. This makes
     duplicate-chevron rendering glitches impossible.
     ===================================================== */
  function wrapFilterSelects(root) {
    var scope = root || document;
    var selects = scope.querySelectorAll("select.filter-select");
    selects.forEach(function (sel) {
      if (sel.parentNode && sel.parentNode.classList &&
          sel.parentNode.classList.contains("filter-select-wrap")) {
        return; // already wrapped
      }
      var wrap = document.createElement("div");
      wrap.className = "filter-select-wrap";
      // Preserve any layout-affecting inline styles from the
      // select (margin) by leaving them on the select itself.
      sel.parentNode.insertBefore(wrap, sel);
      wrap.appendChild(sel);
    });
  }


  /* =====================================================
     2. TOAST NOTIFICATIONS — IMS.toast()
     ===================================================== */

  function ensureToastHost() {
    var host = document.getElementById("ims-toast-host");
    if (host) return host;
    host = document.createElement("div");
    host.id = "ims-toast-host";
    host.className = "ims-toast-host";
    host.setAttribute("aria-live", "polite");
    host.setAttribute("aria-atomic", "false");
    document.body.appendChild(host);
    return host;
  }

  // Icons keyed by tone
  var TOAST_ICONS = {
    success: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    error:   '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    warn:    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info:    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  };

  function toast(opts) {
    var o = opts || {};
    var tone     = o.tone     || "success";
    var title    = o.title    || "";
    var message  = o.message  || "";
    var duration = (o.duration == null) ? 4200 : o.duration;
    var host = ensureToastHost();

    var el = document.createElement("div");
    el.className = "ims-toast " + tone;
    el.setAttribute("role", tone === "error" ? "alert" : "status");

    var icon = TOAST_ICONS[tone] || TOAST_ICONS.info;
    el.innerHTML =
      '<div class="ims-toast-icon">' + icon + '</div>' +
      '<div class="ims-toast-body">' +
        (title ? '<div class="ims-toast-title">' + escapeHTML(title) + '</div>' : '') +
        '<div>' + (o.allowHTML ? message : escapeHTML(message)) + '</div>' +
      '</div>' +
      '<button class="ims-toast-close" type="button" aria-label="Dismiss">&times;</button>';

    host.appendChild(el);
    // Force a layout flush, then add .open for the slide-in transition
    requestAnimationFrame(function () { el.classList.add("open"); });

    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      el.classList.remove("open");
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 280);
    }
    el.querySelector(".ims-toast-close").addEventListener("click", close);
    if (duration > 0) setTimeout(close, duration);

    return { close: close, el: el };
  }
  toast.success = function (message, title) {
    return toast({ tone: "success", title: title || "Success", message: message });
  };
  toast.error = function (message, title) {
    return toast({ tone: "error", title: title || "Something went wrong", message: message });
  };
  toast.info = function (message, title) {
    return toast({ tone: "info", title: title || "", message: message });
  };
  toast.warn = function (message, title) {
    return toast({ tone: "warn", title: title || "Heads up", message: message });
  };

  window.IMS = window.IMS || {};
  window.IMS.toast = toast;


  /* =====================================================
     3. SUCCESS CELEBRATION MODAL FOR BORROW SUBMIT
     Watch the #borrow-message element. When it shows a
     success message, also show a celebration modal with
     a checkmark icon and the request ID.
     ===================================================== */

  function celebrate(opts) {
    if (!window.IMS || !window.IMS.confirm) return;
    // Use the existing confirm dialog with a "success" icon
    // and only a single OK button (cancelText empty would
    // still show one — instead we use a simple approach:
    // confirm with both buttons but hide Cancel via CSS class).
    var checkIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';

    // Build a manual modal (similar shape to ims-confirm but
    // single-button) to avoid double-buttoning the success.
    var prev = document.getElementById("ims-confirm-backdrop");
    if (prev) prev.remove();

    var backdrop = document.createElement("div");
    backdrop.className = "ims-confirm-backdrop";
    backdrop.id = "ims-confirm-backdrop";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.innerHTML =
      '<div class="ims-confirm-box" tabindex="-1">' +
        '<div class="ims-confirm-head">' +
          '<div class="ims-confirm-icon success">' + checkIcon + '</div>' +
          '<div class="ims-confirm-title">' + escapeHTML(opts.title || "Success") + '</div>' +
        '</div>' +
        (opts.message ? '<div class="ims-confirm-message">' + (opts.allowHTML ? opts.message : escapeHTML(opts.message)) + '</div>' : '') +
        '<div class="ims-confirm-actions">' +
          '<button type="button" class="btn btn-primary" data-ims-confirm-ok>' + escapeHTML(opts.okText || "Got it") + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(backdrop);
    requestAnimationFrame(function () { backdrop.classList.add("open"); });

    var okBtn = backdrop.querySelector("[data-ims-confirm-ok]");
    // Focus the dialog box (not the button) so the OK button doesn't
    // render an oversized focus ring. Enter/Escape still close it via
    // the keydown handler below.
    var box = backdrop.querySelector(".ims-confirm-box");
    setTimeout(function () { (box || okBtn) && (box || okBtn).focus(); }, 60);

    function close() {
      backdrop.classList.remove("open");
      document.removeEventListener("keydown", onKey);
      setTimeout(function () {
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      }, 220);
    }
    function onKey(e) {
      if (e.key === "Escape" || e.key === "Enter") close();
    }
    document.addEventListener("keydown", onKey);
    okBtn.addEventListener("click", close);
    backdrop.addEventListener("click", function (e) { if (e.target === backdrop) close(); });
  }


  /* =====================================================
     4. WATCH SUCCESS MESSAGES → SHOW TOASTS / MODAL
     The existing pages set inline success messages via
     setMsg / setMessage. We observe a curated list of
     message containers; when their textContent transitions
     to a non-empty success state, we surface a toast (and
     for borrow submission, a celebration modal).
     ===================================================== */

  function isSuccessNode(el) {
    if (!el) return false;
    var c = (el.className || "").toString();
    return /success/i.test(c);
  }

  function watchMessageElement(id, options) {
    var el = document.getElementById(id);
    if (!el || el.__v111_watched) return;
    el.__v111_watched = true;
    var opts = options || {};

    var lastText = "";
    function check() {
      var text = (el.textContent || "").trim();
      if (!text || text === lastText) {
        if (!text) lastText = "";
        return;
      }
      lastText = text;
      if (!isSuccessNode(el)) return;

      // Special case: borrow request submission → celebration
      if (opts.celebrate) {
        // Extract request ID (PRR-#### or REQ-####) from the text
        var match = text.match(/(?:Request\s+)?([A-Z]+-?\d+)/);
        var reqId = match ? match[1] : null;
        var html =
          "Your borrow request " +
          (reqId ? "<strong>" + escapeHTML(reqId) + "</strong> " : "") +
          "has been submitted successfully. " +
          "An administrator or custodian will review it shortly. " +
          "You'll see the status update on this page once it's processed.";
        celebrate({
          title: "Request Submitted!",
          message: html,
          allowHTML: true,
          okText: "Got it",
        });
        return;
      }

      // Default: toast
      window.IMS.toast.success(text, opts.title || "Success");
    }
    var obs = new MutationObserver(function () {
      // Defer one microtask so the className update from
      // setMsg has landed before we read it.
      setTimeout(check, 0);
    });
    obs.observe(el, { childList: true, characterData: true, subtree: true });
  }

  function wireSuccessWatchers() {
    var page = document.body && document.body.dataset.page;

    if (page === "borrow") {
      watchMessageElement("borrow-message", { celebrate: true });
    }

    // Generic toast watchers for the other pages
    var watchList = {
      "transactions": [
        { id: "transactions-message" },
        { id: "pending-requests-message" },
        { id: "return-message" },
      ],
      "inventory":    [{ id: "inventory-message" }],
      "users":        [{ id: "users-message" }],
      "account":      [{ id: "account-message" }],
      "policy":       [{ id: "policy-message" }],
      "return":       [{ id: "return-message" }, { id: "teacher-return-message" }],
      "reports":      [{ id: "reports-message" }],
      "dashboard":    [{ id: "dashboard-message" }],
    };
    var pageWatchers = watchList[page] || [];
    pageWatchers.forEach(function (w) { watchMessageElement(w.id); });
  }


  /* =====================================================
     5. EXTRA CONFIRMATIONS — DELEGATED
     ===================================================== */

  function wireExtraConfirms() {
    var page = document.body && document.body.dataset.page;

    // Inventory: Add Category, Add Location (button-click,
    // not <form>), and the Add buttons live next to text inputs.
    if (page === "inventory") {
      // v10.15: the old prevent-then-replay-.click() handshake
      // relied on a dataset flag that could race on some browsers
      // (Brave/Chromium dispatch the synthetic replay click before
      // the flag reset is observed), producing an INFINITE "Add
      // this category?" loop. The robust fix: only show the modal
      // for GENUINE user clicks (e.isTrusted === true). The replay
      // .click() is synthetic (isTrusted === false) so it falls
      // straight through to the native handler — no flag needed.
      // A per-button reentrancy lock prevents stacking the modal if
      // the user double-taps the trigger while one is already open.
      var addCatBtn = document.getElementById("asset-category-add-btn");
      if (addCatBtn && !addCatBtn.__v111_confirm_wired) {
        addCatBtn.__v111_confirm_wired = true;
        addCatBtn.addEventListener("click", function (e) {
          // Synthetic replay (or any programmatic click): let the
          // native inventory.js handler run untouched.
          if (!e.isTrusted) return;
          if (addCatBtn.__v115_confirming) {
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
            return;
          }
          var inp = document.getElementById("asset-category-new");
          var name = inp ? inp.value.trim() : "";
          if (!name) return; // let original handler show its own error
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          addCatBtn.__v115_confirming = true;
          window.IMS.confirm({
            title: "Add this category?",
            message: "Add category <strong>" + escapeHTML(name) + "</strong> to inventory.",
            allowHTML: true,
            confirmText: "Yes, add category",
            cancelText: "Cancel",
            tone: "primary",
          }).then(function (ok) {
            addCatBtn.__v115_confirming = false;
            if (!ok) return;
            // Replay as a synthetic click — the guard above sees
            // isTrusted === false and forwards to the native add.
            addCatBtn.click();
          });
        }, true);
      }

      var addLocBtn = document.getElementById("asset-location-add-btn");
      if (addLocBtn && !addLocBtn.__v111_confirm_wired) {
        addLocBtn.__v111_confirm_wired = true;
        addLocBtn.addEventListener("click", function (e) {
          if (!e.isTrusted) return;
          if (addLocBtn.__v115_confirming) {
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
            return;
          }
          var inp = document.getElementById("asset-location-new");
          var name = inp ? inp.value.trim() : "";
          if (!name) return;
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          addLocBtn.__v115_confirming = true;
          window.IMS.confirm({
            title: "Add this location?",
            message: "Add location <strong>" + escapeHTML(name) + "</strong>.",
            allowHTML: true,
            confirmText: "Yes, add location",
            cancelText: "Cancel",
            tone: "primary",
          }).then(function (ok) {
            addLocBtn.__v115_confirming = false;
            if (!ok) return;
            addLocBtn.click();
          });
        }, true);
      }
    }

    // Forgot Password submission
    if (page === "index") {
      var fpForm = document.getElementById("forgot-form");
      if (fpForm && !fpForm.__v111_confirm_wired) {
        fpForm.__v111_confirm_wired = true;
        fpForm.addEventListener("submit", function (e) {
          if (fpForm.dataset.imsConfirmed === "1") {
            fpForm.dataset.imsConfirmed = "";
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          window.IMS.confirm({
            title: "Send password reset request?",
            message:
              "An administrator will review your request and verify your identity " +
              "in person before issuing a temporary password.",
            confirmText: "Yes, send request",
            cancelText: "Cancel",
            tone: "primary",
          }).then(function (ok) {
            if (!ok) return;
            fpForm.dataset.imsConfirmed = "1";
            fpForm.requestSubmit ? fpForm.requestSubmit() : fpForm.dispatchEvent(new Event("submit", { cancelable: true }));
          });
        }, true);
      }
    }

    // Mark all notifications read → ask first
    var markAll = document.getElementById("notif-mark-all-btn");
    if (markAll && !markAll.__v111_confirm_wired) {
      markAll.__v111_confirm_wired = true;
      markAll.addEventListener("click", function (e) {
        if (markAll.dataset.imsConfirmed === "1") {
          markAll.dataset.imsConfirmed = "";
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        window.IMS.confirm({
          title: "Mark all notifications as read?",
          message: "You won't be able to undo this for individual notifications.",
          confirmText: "Yes, mark all read",
          cancelText: "Cancel",
          tone: "primary",
        }).then(function (ok) {
          if (!ok) return;
          markAll.dataset.imsConfirmed = "1";
          markAll.click();
        });
      }, true);
    }
  }


  /* =====================================================
     6. INIT + MUTATION REOBSERVE
     ===================================================== */
  function init() {
    wrapFilterSelects();
    wireSuccessWatchers();
    wireExtraConfirms();

    // Re-run when new DOM is rendered (transactions.js renders
    // borrow request rows dynamically, inventory.js inserts
    // category/location forms after init, etc.)
    if ("MutationObserver" in window) {
      var obs = new MutationObserver(function (mutations) {
        // Only re-scan if any added node is an element
        var needRescan = false;
        mutations.forEach(function (m) {
          m.addedNodes && m.addedNodes.forEach(function (n) {
            if (n.nodeType === 1) needRescan = true;
          });
        });
        if (needRescan) {
          wrapFilterSelects();
          wireSuccessWatchers();
          wireExtraConfirms();
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
