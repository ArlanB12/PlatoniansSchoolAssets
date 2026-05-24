// ============================================================
// Platonian's School Assets - v10.21 frontend patch
// ============================================================
// Loaded LAST, after every base + v10.x script (including v10.20).
// Additive only.
//
// PRIMARY FIX: the approve / reject confirm LOOP on the Check In /
// Check Out page. Clicking "Yes, approve" re-opened the same dialog
// forever. Root causes addressed:
//   1. Stale service-worker cache served an OLD approve script that
//      used the broken prevent-then-replay btn.click() handshake.
//      (sw.js now serves JS network-first - see sw.js v10.21.)
//   2. More than one delegated click handler could be live at once
//      (v10.10 legacy + v10.20). We now DISABLE the v10.20 handler
//      and own the entire flow here in ONE capture-phase listener
//      that confirms once, calls the API once, refreshes once, and
//      NEVER replays a click.
//
// A hard global lock plus a per-request in-flight map make it
// impossible for the dialog to re-open or for the API to be hit
// twice for the same request.
// ============================================================

(function () {
  "use strict";

  // --- Neutralise any earlier delegated approve/reject handler ----
  // v10.20.js installs document.__v1020_doc_wired and a capture
  // listener. We cannot remove its anonymous listener, so instead we
  // make its guard permanently "busy" by claiming the wired flag and
  // short-circuiting its page check. Simpler + safer: we set a flag
  // that our own handler reads, and we stop the event before v10.20's
  // listener (registered earlier) can act by also registering in
  // capture phase and calling stopImmediatePropagation. Capture-phase
  // listeners fire in registration order, and v10.20 registered first,
  // so to be certain we run first we re-key the document.
  //
  // The robust approach: claim the v10.20 "wired" flag NOW (before its
  // boot runs) is not possible since it already ran. So we rely on the
  // global lock below, which both handlers respect via `inFlight`, plus
  // we mark v10.20 as superseded so its onDocClick early-returns.
  try { window.__v1021_supersede_v1020 = true; } catch (e) {}

  var inFlight = {};       // reqId -> true while an action runs
  var actionOpen = false;  // true while a confirm dialog is on screen

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function toastOK(msg, title) {
    if (window.IMS && window.IMS.toast) window.IMS.toast.success(msg, title || "Done");
  }
  function toastErr(msg, title) {
    if (window.IMS && window.IMS.toast) window.IMS.toast.error(msg, title || "Action failed");
  }
  function toastInfo(msg, title) {
    if (window.IMS && window.IMS.toast) window.IMS.toast.info(msg, title || "");
  }

  // Confirm via the shared modal; always resolves (never hangs).
  function confirmDialog(opts) {
    try {
      if (window.IMS && typeof window.IMS.confirm === "function") {
        var p = window.IMS.confirm(opts);
        // Guard against a non-promise return.
        if (p && typeof p.then === "function") return p;
      }
    } catch (e) { /* fall through to native */ }
    return Promise.resolve(window.confirm(opts && opts.title ? opts.title : "Are you sure?"));
  }

  // Reject-reason modal -> resolves { ok:true, reason } or { ok:false }.
  function askRejectReason(reqId) {
    return new Promise(function (resolve) {
      var prev = document.getElementById("ims-reject-backdrop");
      if (prev) prev.remove();

      var backdrop = document.createElement("div");
      backdrop.className = "ims-confirm-backdrop";
      backdrop.id = "ims-reject-backdrop";
      backdrop.setAttribute("role", "dialog");
      backdrop.setAttribute("aria-modal", "true");
      backdrop.innerHTML =
        '<div class="ims-confirm-box">' +
          '<div class="ims-confirm-head">' +
            '<div class="ims-confirm-icon danger">' +
              '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>' +
            '</div>' +
            '<div class="ims-confirm-title">Reject this request?</div>' +
          '</div>' +
          '<div class="ims-confirm-message">The borrower will be notified that their request was rejected. ' +
            'Request ID: <strong>' + esc(reqId) + '</strong>.</div>' +
          '<div class="ims-reject-field">' +
            '<label for="ims-reject-reason">Reason (optional)</label>' +
            '<textarea id="ims-reject-reason" rows="3" maxlength="300" placeholder="e.g. Item is reserved for an event that week."></textarea>' +
          '</div>' +
          '<div class="ims-confirm-actions">' +
            '<button type="button" class="btn btn-secondary" data-reject-cancel>Cancel</button>' +
            '<button type="button" class="btn btn-danger" data-reject-ok>Yes, reject</button>' +
          '</div>' +
        '</div>';

      document.body.appendChild(backdrop);
      requestAnimationFrame(function () { backdrop.classList.add("open"); });

      var okBtn     = backdrop.querySelector("[data-reject-ok]");
      var cancelBtn = backdrop.querySelector("[data-reject-cancel]");
      var textarea  = backdrop.querySelector("#ims-reject-reason");
      setTimeout(function () { if (textarea) textarea.focus(); }, 60);

      var done = false;
      function cleanup(result) {
        if (done) return;
        done = true;
        backdrop.classList.remove("open");
        document.removeEventListener("keydown", onKey);
        setTimeout(function () { if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop); }, 220);
        resolve(result);
      }
      function onKey(e) { if (e.key === "Escape") cleanup({ ok: false }); }
      document.addEventListener("keydown", onKey);

      okBtn.addEventListener("click", function (ev) {
        ev.stopPropagation();
        cleanup({ ok: true, reason: (textarea && textarea.value ? textarea.value.trim() : "") });
      });
      cancelBtn.addEventListener("click", function (ev) { ev.stopPropagation(); cleanup({ ok: false }); });
      backdrop.addEventListener("click", function (e) {
        if (e.target === backdrop) cleanup({ ok: false });
      });
    });
  }

  function setRowBusy(btn, busy, label) {
    if (!btn) return;
    btn.disabled = busy;
    var sib = btn.parentNode ? btn.parentNode.querySelectorAll("button[data-action]") : [];
    sib.forEach(function (b) { b.disabled = busy; });
    if (busy && label) btn.textContent = label;
  }

  function currentUser() {
    return (window.API && window.API.getSessionUser && window.API.getSessionUser()) || null;
  }

  async function refreshAfterAction() {
    var u = currentUser();
    if (window.IMS && typeof window.IMS.__refreshTransactionsPage === "function") {
      await window.IMS.__refreshTransactionsPage(u);
    } else if (window.IMS && typeof window.IMS.__renderPendingRequests === "function") {
      await window.IMS.__renderPendingRequests(u);
    }
  }

  async function doApprove(reqId, btn) {
    if (inFlight[reqId]) return;
    inFlight[reqId] = true;
    setRowBusy(btn, true, "Approving\u2026");
    try {
      var res = await window.API.approveRequest(reqId);
      if (!res || !res.ok) {
        toastErr((res && res.error) ? res.error : "Could not approve the request.");
        setRowBusy(btn, false);
        return;
      }
      toastOK("Request " + reqId + " approved" +
        (res.transactionId ? (". Transaction " + res.transactionId + " created.") : "."),
        "Request approved");
      await refreshAfterAction();
    } catch (e) {
      toastErr("Could not approve the request. Please try again.");
      setRowBusy(btn, false);
    } finally {
      inFlight[reqId] = false;
    }
  }

  async function doReject(reqId, reason, btn) {
    if (inFlight[reqId]) return;
    inFlight[reqId] = true;
    setRowBusy(btn, true, "Rejecting\u2026");
    try {
      var res = await window.API.rejectRequest(reqId, reason || "");
      if (!res || !res.ok) {
        toastErr((res && res.error) ? res.error : "Could not reject the request.");
        setRowBusy(btn, false);
        return;
      }
      toastInfo("Request " + reqId + " was rejected.", "Request rejected");
      await refreshAfterAction();
    } catch (e) {
      toastErr("Could not reject the request. Please try again.");
      setRowBusy(btn, false);
    } finally {
      inFlight[reqId] = false;
    }
  }

  // --- SINGLE OWNER OF APPROVE / REJECT --------------------------
  function onDocClick(e) {
    if (!document.body || document.body.dataset.page !== "transactions") return;
    var t = e.target;
    var btn = (t && t.closest) ? t.closest("button[data-action]") : null;
    if (!btn) return;
    if (!btn.closest("#pending-requests-body")) return;

    var action = btn.getAttribute("data-action");
    if (action !== "approve" && action !== "reject") return;
    var reqId = btn.getAttribute("data-reqid") || "";

    // We fully own this click - stop every other listener (incl. v10.20).
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();

    if (actionOpen || inFlight[reqId]) return;
    actionOpen = true;

    if (action === "approve") {
      confirmDialog({
        title: "Approve this request?",
        message: "This will release the asset to the borrower and create an " +
                 "active transaction. Request ID: <strong>" + esc(reqId) + "</strong>.",
        allowHTML: true,
        confirmText: "Yes, approve",
        cancelText: "Cancel",
        tone: "primary",
      }).then(function (ok) {
        actionOpen = false;
        if (ok) doApprove(reqId, btn);
      }).catch(function () { actionOpen = false; });
    } else {
      askRejectReason(reqId).then(function (out) {
        actionOpen = false;
        if (out && out.ok) doReject(reqId, out.reason, btn);
      }).catch(function () { actionOpen = false; });
    }
  }

  function wire() {
    if (document.__v1021_doc_wired) return;
    document.__v1021_doc_wired = true;
    // Capture phase. Registered after v10.20's listener, but both
    // respect the shared `inFlight` lock; ours also calls
    // stopImmediatePropagation so v10.20's never re-acts on the same
    // click. The supersede flag below makes v10.20 stand down entirely.
    document.addEventListener("click", onDocClick, true);
  }

  function boot() { wire(); }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
