// ============================================================
// Platonian's School Assets — v10.20 frontend patch
// ============================================================
// Loaded LAST, after every base + v10.x script. Additive only.
//
// Fixes in this round:
//   1. Infinite approve / reject confirm loop on the Check In /
//      Check Out page. The old code (v10.10.js) confirmed, then
//      REPLAYED btn.click(), which transactions.js's own onclick
//      worker re-processed — re-opening the confirm dialog forever.
//      We now own the whole flow in ONE delegated handler: confirm
//      once, call the API once, refresh once. No click replay.
//   2. Reject reason is collected in a proper modal textarea
//      instead of the native window.prompt().
//   3. Belt-and-braces guard so a single click can never trigger
//      two overlapping approve/reject API calls (debounce by id).
// ============================================================

(function () {
  "use strict";

  var inFlight = {}; // reqId -> true while an action is running

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

  // Confirm using the shared modal; resolves to true/false.
  function confirmDialog(opts) {
    if (window.IMS && typeof window.IMS.confirm === "function") {
      return window.IMS.confirm(opts);
    }
    // Fallback to native confirm if the shared modal isn't available.
    return Promise.resolve(window.confirm(opts && opts.title ? opts.title : "Are you sure?"));
  }

  // A small modal that asks for an optional rejection reason and
  // resolves to { ok:true, reason } or { ok:false }.
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

      function cleanup(result) {
        backdrop.classList.remove("open");
        document.removeEventListener("keydown", onKey);
        setTimeout(function () { if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop); }, 220);
        resolve(result);
      }
      function onKey(e) {
        if (e.key === "Escape") cleanup({ ok: false });
      }
      document.addEventListener("keydown", onKey);

      okBtn.addEventListener("click", function () {
        cleanup({ ok: true, reason: (textarea && textarea.value ? textarea.value.trim() : "") });
      });
      cancelBtn.addEventListener("click", function () { cleanup({ ok: false }); });
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
    if (!u) return;
    if (window.IMS && typeof window.IMS.__refreshTransactionsPage === "function") {
      await window.IMS.__refreshTransactionsPage(u);
    } else if (window.IMS && typeof window.IMS.__renderPendingRequests === "function") {
      await window.IMS.__renderPendingRequests(u);
    }
  }

  async function doApprove(reqId, btn) {
    if (inFlight[reqId]) return;
    inFlight[reqId] = true;
    setRowBusy(btn, true, "Approving…");
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
    setRowBusy(btn, true, "Rejecting…");
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

  // ── SINGLE GLOBAL HANDLER ──────────────────────────────────
  // One capture-phase listener on `document`, installed exactly
  // once for the whole page lifetime. It does NOT depend on the
  // tbody node (which gets its innerHTML rewritten on every
  // refresh) and it never replays clicks, so there is no way for
  // the confirm dialog to re-open in a loop.
  //
  // A hard global lock (`actionOpen`) blocks a second
  // approve/reject from starting while one is mid-flight or while
  // its confirm dialog is still on screen.
  var actionOpen = false;

  function onDocClick(e) {
    // v10.21 supersedes this handler entirely (single owner of the
    // approve/reject flow). Stand down so the dialog can never be
    // opened twice for one click.
    if (window.__v1021_supersede_v1020) return;
    if (!document.body || document.body.dataset.page !== "transactions") return;
    var t = e.target;
    var btn = (t && t.closest) ? t.closest("button[data-action]") : null;
    if (!btn) return;
    // Only act on buttons that live inside the pending-requests table.
    if (!btn.closest("#pending-requests-body")) return;

    var action = btn.getAttribute("data-action");
    if (action !== "approve" && action !== "reject") return;
    var reqId = btn.getAttribute("data-reqid") || "";

    // We fully own this click — stop every other listener.
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();

    // Guard: one action at a time, and never twice for the same id.
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
      });
    } else {
      askRejectReason(reqId).then(function (out) {
        actionOpen = false;
        if (out && out.ok) doReject(reqId, out.reason, btn);
      });
    }
  }

  function wireApproveReject() {
    if (document.__v1020_doc_wired) return;
    document.__v1020_doc_wired = true;
    // Capture phase so we run before any legacy bubble-phase
    // worker and can stopImmediatePropagation it out of existence.
    document.addEventListener("click", onDocClick, true);
  }

  function boot() {
    wireApproveReject();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
