/* ============================================================
   Platonian's IS — v10.10 Enhancements
   Loaded LAST, after v10.9.js. Adds / fixes:

     1. IMS.confirm() — shared accessible confirmation modal
        used in place of window.confirm() for any destructive
        or "are you sure" action.

     2. Force-password-change flag — clear on logout, clear
        when the bootstrap response says mustChangePassword
        is false. Fixes the bug where every account got the
        force-change banner because the sessionStorage flag
        was sticky.

     3. Change-password "previous password" wording — the
        backend rejects when new === current. Make the error
        wording explicit so users stop confusing "current
        password" with "previous (older) password".

     4. Confirmation wiring — intercept these submit / click
        events and route them through IMS.confirm():
          - Update Password (account.html)
          - Backup Database (reports.html)
          - Restore Backup (reports.html)
          - Borrow request submit (borrow.html)
          - Approve / Reject borrow request (transactions.html)
          - Return item submit (transactions.html, return form)
          - Update Lending Policy (policy.html)
          - Add / Edit / Delete asset (inventory.html)
          - Add / Edit / Delete user (users.html)
   ============================================================ */
(function () {
  "use strict";

  function $(sel, root) { return (root || document).querySelector(sel); }


  /* =====================================================
     1. SHARED CONFIRMATION MODAL — IMS.confirm()
     ===================================================== */

  // Returns a Promise<boolean>. Resolves true when the user
  // confirms, false on cancel / Esc / backdrop click.
  function imsConfirm(opts) {
    return new Promise(function (resolve) {
      var o = opts || {};
      var title       = o.title       || "Are you sure?";
      var message     = o.message     || "";
      var confirmText = o.confirmText || "Confirm";
      var cancelText  = o.cancelText  || "Cancel";
      var tone        = o.tone        || "primary"; // primary | danger | warn
      var icon        = o.icon        || null;

      // Remove any existing instance so the modal never stacks
      var prev = document.getElementById("ims-confirm-backdrop");
      if (prev) prev.remove();

      var iconClass = (tone === "danger") ? "danger" : (tone === "warn" ? "warn" : "");
      var btnConfirmClass = (tone === "danger") ? "btn-danger" : "btn-primary";

      // Default tone-based icon if none provided
      var defaultIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><circle cx="12" cy="12" r="10"/></svg>';
      var iconHTML = icon || defaultIcon;

      var backdrop = document.createElement("div");
      backdrop.className = "ims-confirm-backdrop";
      backdrop.id = "ims-confirm-backdrop";
      backdrop.setAttribute("role", "dialog");
      backdrop.setAttribute("aria-modal", "true");
      backdrop.setAttribute("aria-labelledby", "ims-confirm-title");
      backdrop.innerHTML =
        '<div class="ims-confirm-box">' +
          '<div class="ims-confirm-head">' +
            '<div class="ims-confirm-icon ' + iconClass + '">' + iconHTML + '</div>' +
            '<div class="ims-confirm-title" id="ims-confirm-title">' + escapeHTML(title) + '</div>' +
          '</div>' +
          (message
            ? '<div class="ims-confirm-message">' + (o.allowHTML ? message : escapeHTML(message)) + '</div>'
            : '') +
          '<div class="ims-confirm-actions">' +
            '<button type="button" class="btn btn-secondary" data-ims-confirm-cancel>' + escapeHTML(cancelText) + '</button>' +
            '<button type="button" class="btn ' + btnConfirmClass + '" data-ims-confirm-ok>' + escapeHTML(confirmText) + '</button>' +
          '</div>' +
        '</div>';

      document.body.appendChild(backdrop);
      // Trigger transition on the next paint
      requestAnimationFrame(function () { backdrop.classList.add("open"); });

      var okBtn = backdrop.querySelector("[data-ims-confirm-ok]");
      var cancelBtn = backdrop.querySelector("[data-ims-confirm-cancel]");

      // Focus the cancel button by default — safer than focusing
      // the destructive action.
      setTimeout(function () {
        if (cancelBtn && tone === "danger") cancelBtn.focus();
        else if (okBtn) okBtn.focus();
      }, 60);

      function cleanup(result) {
        backdrop.classList.remove("open");
        document.removeEventListener("keydown", onKey);
        setTimeout(function () {
          if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        }, 220);
        resolve(result);
      }
      function onKey(e) {
        if (e.key === "Escape") cleanup(false);
        else if (e.key === "Enter" && document.activeElement === okBtn) cleanup(true);
      }
      document.addEventListener("keydown", onKey);

      okBtn.addEventListener("click", function () { cleanup(true); });
      cancelBtn.addEventListener("click", function () { cleanup(false); });
      backdrop.addEventListener("click", function (e) {
        if (e.target === backdrop) cleanup(false);
      });
    });
  }

  function escapeHTML(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Expose globally
  window.IMS = window.IMS || {};
  window.IMS.confirm = imsConfirm;


  /* =====================================================
     2. FORCE-PASSWORD-CHANGE FLAG — STICKY-FLAG BUG FIX
     The previous v10.9 logic only ever SET the
     ims_force_pw sessionStorage flag (on login when
     mustChangePassword:true), never CLEARED it. Result:
     after a user with the flag logs out, the next user
     to log in on the same tab still triggers the force
     mode because the flag is still there.

     Fix: clear the flag on logout, and OVERRIDE
     API.login's response handler to set EXPLICITLY based
     on the server's mustChangePassword field (set when
     true, clear when false). Also clear on bootstrap if
     the /me response says we're past the force point.
     ===================================================== */

  function clearForcePwFlag() {
    try {
      sessionStorage.removeItem("ims_force_pw");
    } catch (e) {}
  }

  function patchLoginForcePwHandling() {
    if (!window.API || typeof window.API.login !== "function") return;
    if (window.API.__v110_login_patched) return;
    var orig = window.API.login;
    window.API.login = async function (username, password) {
      var res = await orig.call(window.API, username, password);
      try {
        if (res && res.ok) {
          // Explicit set/clear based on server flag — fixes the
          // sticky-flag bug. If the server didn't include a flag
          // at all, treat that as "false" (no force).
          var needs = (res.mustChangePassword === true ||
                       res.must_change_password === true);
          if (needs) {
            sessionStorage.setItem("ims_force_pw", "1");
          } else {
            sessionStorage.removeItem("ims_force_pw");
          }
        } else {
          // Failed login attempt — don't leave a flag dangling
          sessionStorage.removeItem("ims_force_pw");
        }
      } catch (e) {}
      return res;
    };
    window.API.__v110_login_patched = true;
  }

  function patchLogoutForcePwHandling() {
    if (!window.API || typeof window.API.logout !== "function") return;
    if (window.API.__v110_logout_patched) return;
    var orig = window.API.logout;
    window.API.logout = async function () {
      var res = await orig.apply(window.API, arguments);
      // Always clear the flag on logout, no matter the response
      clearForcePwFlag();
      return res;
    };
    window.API.__v110_logout_patched = true;
  }

  // Also wire the logout button directly so even if API.logout
  // throws or is bypassed, the flag still gets cleared before
  // navigation.
  function wireLogoutButtonForceClear() {
    var btn = document.getElementById("logout-btn");
    if (!btn || btn.__v110_logout_wired) return;
    btn.__v110_logout_wired = true;
    // Capture-phase listener so we run BEFORE app.js's listener
    // navigates away.
    btn.addEventListener("click", function () {
      clearForcePwFlag();
    }, true);
  }


  /* =====================================================
     3. CHANGE-PASSWORD WORDING + CONFIRMATION
     The account page change-password submit:
       a) intercept and show a confirmation prompt
       b) rewrite the "new must differ from current" error
          so it's crystal clear (and translate the backend
          version too).
     ===================================================== */

  function clarifyChangePasswordError(form) {
    if (!form || form.__v110_err_watched) return;
    form.__v110_err_watched = true;
    var msgEl = document.getElementById("account-message");
    if (!msgEl) return;

    // Use a MutationObserver to rewrite the error text the
    // moment account.js writes it.
    var obs = new MutationObserver(function () {
      var t = (msgEl.textContent || "").trim();
      if (!t) return;
      // Match both the frontend message ("Your new password
      // must be different from your current one.") and the
      // backend version ("New password must be different
      // from your current password.").
      if (/different from your current/i.test(t)) {
        msgEl.textContent =
          "You typed the same password in both 'Current Password' and 'New Password'. " +
          "The new password needs to be different from the one you're signing in with right now.";
      } else if (/at least 6 characters/i.test(t) || /must be at least \d+ characters/i.test(t)) {
        // Reword so users don't get blocked by a silent
        // length mismatch between frontend (3) and backend (6).
        msgEl.textContent =
          "Your new password is too short. Please use at least 6 characters.";
      } else if (/current password is incorrect/i.test(t)) {
        msgEl.textContent =
          "The 'Current Password' you entered does not match your account. " +
          "If you were given a temporary password by the Administrator, type that one here exactly as written.";
      }
    });
    obs.observe(msgEl, { childList: true, characterData: true, subtree: true });
  }

  function wireChangePasswordConfirmation() {
    var form = document.getElementById("change-password-form");
    if (!form || form.__v110_confirm_wired) return;
    form.__v110_confirm_wired = true;

    clarifyChangePasswordError(form);

    // Intercept submit in CAPTURE phase so we run BEFORE
    // account.js's listener and can cancel/resume.
    form.addEventListener("submit", function (e) {
      // If we've already confirmed in this invocation, let it
      // through.
      if (form.dataset.imsConfirmed === "1") {
        form.dataset.imsConfirmed = "";
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      var cur = (document.getElementById("current-password") || {}).value || "";
      var nxt = (document.getElementById("new-password")     || {}).value || "";
      var cnf = (document.getElementById("confirm-password") || {}).value || "";

      // Cheap client validation — let account.js handle the
      // rest after we confirm
      if (!cur || !nxt || !cnf || nxt !== cnf || nxt.length < 6 || nxt === cur) {
        // Re-fire the submit so account.js's own validation
        // shows the right error
        form.dataset.imsConfirmed = "1";
        if (typeof form.requestSubmit === "function") form.requestSubmit();
        else form.dispatchEvent(new Event("submit", { cancelable: true }));
        return;
      }

      imsConfirm({
        title: "Update your password?",
        message:
          "You'll need to sign in with the new password next time. " +
          "Make sure you've remembered it before continuing.",
        confirmText: "Yes, update password",
        cancelText: "Cancel",
        tone: "primary",
      }).then(function (ok) {
        if (!ok) return;
        form.dataset.imsConfirmed = "1";
        if (typeof form.requestSubmit === "function") form.requestSubmit();
        else form.dispatchEvent(new Event("submit", { cancelable: true }));
      });
    }, true);
  }


  /* =====================================================
     4. CONFIRMATION WIRING — BACKUP / RESTORE / etc.
     We intercept clicks in capture phase, ask for
     confirmation, then re-dispatch the click with a
     marker so we don't loop.
     ===================================================== */

  function wireClickConfirm(btn, opts) {
    if (!btn || btn.__v110_click_wired) return;
    btn.__v110_click_wired = true;
    btn.addEventListener("click", function (e) {
      if (btn.dataset.imsConfirmed === "1") {
        btn.dataset.imsConfirmed = "";
        return; // re-fired, let it through
      }
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      imsConfirm(opts).then(function (ok) {
        if (!ok) return;
        btn.dataset.imsConfirmed = "1";
        btn.click();
      });
    }, true);
  }

  function wireBackupRestoreConfirms() {
    var page = document.body && document.body.dataset.page;
    if (page !== "reports") return;

    var backupBtn = document.getElementById("backup-database-btn");
    wireClickConfirm(backupBtn, {
      title: "Download a database backup?",
      message:
        "This will save a JSON snapshot of the entire database to your Downloads folder. " +
        "Keep it somewhere safe — it contains all assets, users, and transaction records.",
      confirmText: "Yes, download backup",
      cancelText: "Cancel",
      tone: "primary",
    });

    // For Restore, the visible control is a <label> wrapping a
    // file input. We need to intercept the file-input change,
    // not the label click, because clicking the label opens the
    // native picker first.
    var restoreInput = document.getElementById("restore-database-input");
    if (restoreInput && !restoreInput.__v110_wired) {
      restoreInput.__v110_wired = true;
      restoreInput.addEventListener("change", function (e) {
        if (restoreInput.dataset.imsConfirmed === "1") {
          restoreInput.dataset.imsConfirmed = "";
          return;
        }
        var file = restoreInput.files && restoreInput.files[0];
        if (!file) return;
        // Cancel default propagation — we'll re-dispatch
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        imsConfirm({
          title: "Restore database from backup?",
          message:
            "This will <strong>overwrite ALL current data</strong> with the contents of <strong>" +
            escapeHTML(file.name) + "</strong>. " +
            "Make sure you've downloaded a current backup first. This cannot be undone.",
          allowHTML: true,
          confirmText: "Yes, overwrite everything",
          cancelText: "Cancel",
          tone: "danger",
        }).then(function (ok) {
          if (!ok) {
            // Clear the input so the same file can be re-selected
            restoreInput.value = "";
            return;
          }
          // Re-dispatch a change event with the marker set
          restoreInput.dataset.imsConfirmed = "1";
          restoreInput.dispatchEvent(new Event("change", { bubbles: true }));
        });
      }, true);
    }
  }

  function wireBorrowConfirms() {
    var page = document.body && document.body.dataset.page;
    if (page !== "borrow") return;
    var form = document.getElementById("borrow-form");
    if (!form || form.__v110_confirm_wired) return;
    form.__v110_confirm_wired = true;

    form.addEventListener("submit", function (e) {
      if (form.dataset.imsConfirmed === "1") {
        form.dataset.imsConfirmed = "";
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      var sel = document.getElementById("borrow-asset-id");
      var qtyEl = document.getElementById("borrow-quantity");
      var opt = sel && sel.options[sel.selectedIndex];
      var assetLabel = opt ? opt.textContent : "this asset";
      var qty = qtyEl ? qtyEl.value : "1";

      imsConfirm({
        title: "Submit borrow request?",
        message:
          "You're requesting <strong>" + escapeHTML(qty) + "</strong> of <strong>" +
          escapeHTML(assetLabel) + "</strong>. " +
          "An admin or custodian will review and either approve or reject it.",
        allowHTML: true,
        confirmText: "Yes, submit request",
        cancelText: "Cancel",
        tone: "primary",
      }).then(function (ok) {
        if (!ok) return;
        form.dataset.imsConfirmed = "1";
        if (typeof form.requestSubmit === "function") form.requestSubmit();
        else form.dispatchEvent(new Event("submit", { cancelable: true }));
      });
    }, true);
  }

  function wireApproveRejectConfirms() {
    // v10.20: DISABLED. This used the prevent-then-replay-btn.click()
    // handshake which looped the confirm dialog forever on the
    // Check In / Check Out page (the replayed synthetic click was
    // re-processed by transactions.js's own onclick worker). The whole
    // approve/reject flow — confirm, API call, and refresh — now lives
    // in v10.20.js as a single self-contained handler. Left as a no-op
    // so older call sites don't break.
    return;
  }

  function wireReturnConfirm() {
    var page = document.body && document.body.dataset.page;
    var isTxnPage = page === "transactions";
    var isReturnPage = page === "return";
    if (!isTxnPage && !isReturnPage) return;

    // Transactions page uses #return-form, return.html uses
    // #teacher-return-form. Wire whichever exists.
    var formIds = ["return-form", "teacher-return-form"];
    formIds.forEach(function (id) {
      var form = document.getElementById(id);
      if (!form || form.__v110_confirm_wired) return;
      form.__v110_confirm_wired = true;

      form.addEventListener("submit", function (e) {
        if (form.dataset.imsConfirmed === "1") {
          form.dataset.imsConfirmed = "";
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        // Find a select inside this form to describe what's
        // being returned
        var sel = form.querySelector("select");
        var opt = sel && sel.options[sel.selectedIndex];
        var label = opt ? opt.textContent : "this transaction";

        imsConfirm({
          title: "Mark this item as returned?",
          message:
            "Returning: <strong>" + escapeHTML(label) + "</strong>. " +
            "The asset quantity will be added back to inventory.",
          allowHTML: true,
          confirmText: "Yes, return item",
          cancelText: "Cancel",
          tone: "primary",
        }).then(function (ok) {
          if (!ok) return;
          form.dataset.imsConfirmed = "1";
          if (typeof form.requestSubmit === "function") form.requestSubmit();
          else form.dispatchEvent(new Event("submit", { cancelable: true }));
        });
      }, true);
    });

    // Also intercept the Check-Out (admin/custodian) form on
    // the same page if it exists
    var checkoutForm = document.getElementById("checkout-form");
    if (checkoutForm && !checkoutForm.__v110_confirm_wired) {
      checkoutForm.__v110_confirm_wired = true;
      checkoutForm.addEventListener("submit", function (e) {
        if (checkoutForm.dataset.imsConfirmed === "1") {
          checkoutForm.dataset.imsConfirmed = "";
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        var sel = document.getElementById("checkout-asset-id");
        var qtyEl = document.getElementById("checkout-quantity");
        var opt = sel && sel.options[sel.selectedIndex];
        var label = opt ? opt.textContent : "this asset";
        var q = qtyEl ? qtyEl.value : "1";

        imsConfirm({
          title: "Check out this asset?",
          message:
            "Checking out <strong>" + escapeHTML(q) + "</strong> of <strong>" +
            escapeHTML(label) + "</strong>. This creates a transaction record.",
          allowHTML: true,
          confirmText: "Yes, check out",
          cancelText: "Cancel",
          tone: "primary",
        }).then(function (ok) {
          if (!ok) return;
          checkoutForm.dataset.imsConfirmed = "1";
          if (typeof checkoutForm.requestSubmit === "function") checkoutForm.requestSubmit();
          else checkoutForm.dispatchEvent(new Event("submit", { cancelable: true }));
        });
      }, true);
    }
  }

  function wireInventoryConfirms() {
    var page = document.body && document.body.dataset.page;
    if (page !== "inventory") return;

    // Asset form submit (add OR edit — we detect via the
    // submit button label / editingAssetId on the form)
    var assetForm = document.getElementById("asset-form");
    if (assetForm && !assetForm.__v110_confirm_wired) {
      assetForm.__v110_confirm_wired = true;
      assetForm.addEventListener("submit", function (e) {
        if (assetForm.dataset.imsConfirmed === "1") {
          assetForm.dataset.imsConfirmed = "";
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        var btn = document.getElementById("asset-submit-btn");
        var isEdit = btn && /save changes/i.test(btn.textContent || "");
        var name = (document.getElementById("asset-name") || {}).value || "(unnamed)";

        imsConfirm({
          title: isEdit ? "Save changes to this asset?" : "Add this asset to inventory?",
          message: isEdit
            ? "Updating the record for <strong>" + escapeHTML(name) + "</strong>."
            : "Adding <strong>" + escapeHTML(name) + "</strong> to inventory.",
          allowHTML: true,
          confirmText: isEdit ? "Yes, save changes" : "Yes, add asset",
          cancelText: "Cancel",
          tone: "primary",
        }).then(function (ok) {
          if (!ok) return;
          assetForm.dataset.imsConfirmed = "1";
          if (typeof assetForm.requestSubmit === "function") assetForm.requestSubmit();
          else assetForm.dispatchEvent(new Event("submit", { cancelable: true }));
        });
      }, true);
    }

    // Override window.confirm for the delete-asset path so the
    // existing inventory.js delete handler routes through our
    // modal instead of the browser-native dialog. We restore
    // the original after a microtask so other confirms aren't
    // affected long-term. To avoid layering issues, we patch
    // it for the lifetime of the page — every confirm() call
    // gets the styled modal.
    overrideNativeConfirm();
  }

  function wireUsersConfirms() {
    var page = document.body && document.body.dataset.page;
    if (page !== "users") return;

    var userForm = document.getElementById("users-form");
    if (userForm && !userForm.__v110_confirm_wired) {
      userForm.__v110_confirm_wired = true;
      userForm.addEventListener("submit", function (e) {
        if (userForm.dataset.imsConfirmed === "1") {
          userForm.dataset.imsConfirmed = "";
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        var btn = document.getElementById("users-submit-btn");
        var isEdit = btn && /save|update/i.test(btn.textContent || "");
        var name = (document.getElementById("user-name") || {}).value || "this user";

        imsConfirm({
          title: isEdit ? "Save changes to this user?" : "Create this user account?",
          message:
            (isEdit ? "Updating " : "Adding ") + "<strong>" + escapeHTML(name) + "</strong>" +
            (isEdit ? "" : ". They'll receive their starting password from you in person."),
          allowHTML: true,
          confirmText: isEdit ? "Yes, save" : "Yes, create user",
          cancelText: "Cancel",
          tone: "primary",
        }).then(function (ok) {
          if (!ok) return;
          userForm.dataset.imsConfirmed = "1";
          if (typeof userForm.requestSubmit === "function") userForm.requestSubmit();
          else userForm.dispatchEvent(new Event("submit", { cancelable: true }));
        });
      }, true);
    }

    overrideNativeConfirm();
  }

  function wirePolicyConfirm() {
    var page = document.body && document.body.dataset.page;
    if (page !== "policy") return;

    var form = document.getElementById("policy-form");
    if (!form || form.__v110_confirm_wired) return;
    form.__v110_confirm_wired = true;

    form.addEventListener("submit", function (e) {
      if (form.dataset.imsConfirmed === "1") {
        form.dataset.imsConfirmed = "";
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      imsConfirm({
        title: "Update the lending policy?",
        message:
          "These changes will apply to all future borrow requests immediately. " +
          "Teachers will see the updated rules on the Borrow page.",
        confirmText: "Yes, update policy",
        cancelText: "Cancel",
        tone: "primary",
      }).then(function (ok) {
        if (!ok) return;
        form.dataset.imsConfirmed = "1";
        if (typeof form.requestSubmit === "function") form.requestSubmit();
        else form.dispatchEvent(new Event("submit", { cancelable: true }));
      });
    }, true);
  }


  /* =====================================================
     Override window.confirm() globally so existing
     calls (inventory delete, user delete, category
     delete, etc.) all get the same styled modal. We
     ASYNC-ify it via a wrapper that returns a Promise,
     but to stay backward-compatible with code that uses
     `if (!confirm(...))` synchronously, we offer
     window.confirmAsync as the new shape and keep the
     sync one untouched. Instead of overriding the
     native confirm (which is sync), we hook the
     specific click handlers above. Below is a no-op
     placeholder for compatibility.
     ===================================================== */
  function overrideNativeConfirm() {
    // No-op. We considered overriding window.confirm, but since
    // it's synchronous and our modal is async, the safer move
    // is to leave window.confirm alone (it still works for
    // legacy paths) and intercept the specific buttons we want.
    // Future versions can migrate those paths to IMS.confirm()
    // directly.
  }

  // For delete buttons that we know about (inventory delete,
  // user delete, category delete) — intercept in capture phase
  // on document so we catch them no matter when they're
  // rendered.
  function wireDeleteDelegations() {
    if (document.__v110_delete_wired) return;
    document.__v110_delete_wired = true;

    document.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest("button");
      if (!btn) return;
      if (btn.dataset.imsConfirmed === "1") {
        btn.dataset.imsConfirmed = "";
        return;
      }

      // inventory.js renders:
      //   <button data-action="delete" data-id="AST-0001">Delete</button>
      // users.js renders:
      //   <button data-action="delete" data-email="x@x.com">Delete</button>
      // inventory.js category delete uses:
      //   <button data-delete-cat="Electronics">Delete</button>
      var action = btn.getAttribute("data-action");
      var deleteAssetId  = (action === "delete" && btn.hasAttribute("data-id"))    ? btn.getAttribute("data-id")    : null;
      var deleteUserEmail = (action === "delete" && btn.hasAttribute("data-email")) ? btn.getAttribute("data-email") : null;
      var deleteCategory  = btn.getAttribute("data-delete-cat");

      // Only intercept the delete shape — skip if the button
      // is, say, an Edit (action="edit") or one of the
      // approve/reject buttons we handle elsewhere.
      var isDelete = !!(deleteAssetId || deleteUserEmail || deleteCategory);
      if (!isDelete) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      var title, msg;
      if (deleteAssetId) {
        title = "Delete this asset?";
        msg   = "Asset <strong>" + escapeHTML(deleteAssetId) + "</strong> will be permanently removed. " +
                "Any historical transactions referencing it will keep the ID for the record.";
      } else if (deleteUserEmail) {
        title = "Delete this user?";
        msg   = "User <strong>" + escapeHTML(deleteUserEmail) + "</strong> will be removed. " +
                "They will no longer be able to sign in.";
      } else {
        title = "Delete this category?";
        msg   = "Category <strong>" + escapeHTML(deleteCategory) + "</strong> will be removed. " +
                "Assets currently assigned to it will need to be re-categorised.";
      }

      imsConfirm({
        title: title,
        message: msg,
        allowHTML: true,
        confirmText: "Yes, delete",
        cancelText: "Cancel",
        tone: "danger",
      }).then(function (ok) {
        if (!ok) return;
        btn.dataset.imsConfirmed = "1";
        // Suppress the existing window.confirm in the handler
        // by stubbing it for one tick — the handler calls
        // confirm() first, then proceeds.
        var origConfirm = window.confirm;
        window.confirm = function () { return true; };
        try { btn.click(); }
        finally {
          // Restore after a tick so other code is unaffected.
          setTimeout(function () { window.confirm = origConfirm; }, 0);
        }
      });
    }, true);
  }


  /* =====================================================
     INIT
     ===================================================== */
  function init() {
    // Force-pw flag fixes — run early so the patches are in
    // place before any auth flow.
    patchLoginForcePwHandling();
    patchLogoutForcePwHandling();
    wireLogoutButtonForceClear();

    // Confirmation wiring — page-by-page
    wireChangePasswordConfirmation();
    wireBackupRestoreConfirms();
    wireBorrowConfirms();
    wireApproveRejectConfirms();
    wireReturnConfirm();
    wireInventoryConfirms();
    wireUsersConfirms();
    wirePolicyConfirm();
    wireDeleteDelegations();

    // Re-wire on later DOM changes (the logout button, the
    // form ids, etc. should already exist, but app.js may
    // re-render the sidebar after init).
    if ("MutationObserver" in window) {
      var obs = new MutationObserver(function () {
        wireLogoutButtonForceClear();
        wireChangePasswordConfirmation();
        wireBackupRestoreConfirms();
        wireBorrowConfirms();
        wireApproveRejectConfirms();
        wireReturnConfirm();
        wireInventoryConfirms();
        wireUsersConfirms();
        wirePolicyConfirm();
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
