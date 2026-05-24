// ============================================================
// Platonian's IS — Users Module (MySQL/API version)
// ============================================================
(() => {
  "use strict";

  let editingEmail = null;
  let searchTerm   = "";
  let _flaggedBound = false; // guards double-binding of the flagged-table click handler

  function setMessage(msg, type = "info") {
    const el = document.getElementById("users-message");
    if (!el) return;
    el.textContent = msg || "";
    el.className = `status-message ${type}-message ${msg ? "show" : ""}`;
  }

  function validEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||"").trim());
  }

  function resetForm() {
    const form      = document.getElementById("users-form");
    const submitBtn = document.getElementById("users-submit-btn");
    const cancelBtn = document.getElementById("users-cancel-btn");
    const pwInput   = document.getElementById("user-password");
    const pwHint    = document.getElementById("user-password-hint");
    const roleInput = document.getElementById("user-role");
    if (!form || !submitBtn || !cancelBtn || !pwInput || !pwHint || !roleInput) return;
    form.reset();
    roleInput.value   = "teacher";
    editingEmail      = null;
    submitBtn.textContent = "Add User";
    cancelBtn.hidden  = true;
    pwInput.required  = true;
    pwInput.type      = "password";
    pwHint.textContent = "Use at least 6 characters.";
    // Reset any "Hide" → "Show" toggle button state
    const tgl = document.querySelector('.pw-toggle[data-toggle-for="user-password"]');
    if (tgl) tgl.textContent = "Show";
  }

  function beginEdit(user) {
    const submitBtn = document.getElementById("users-submit-btn");
    const cancelBtn = document.getElementById("users-cancel-btn");
    const pwInput   = document.getElementById("user-password");
    const pwHint    = document.getElementById("user-password-hint");
    if (!submitBtn || !cancelBtn || !pwInput || !pwHint) return;
    editingEmail = user.email;
    document.getElementById("user-name").value     = user.name     || "";
    const unameEl = document.getElementById("user-username");
    if (unameEl) unameEl.value                     = user.username || (user.email || "").split("@")[0];
    // v10.5: email is hidden but we still keep the value in sync so update flows work.
    const emailEl = document.getElementById("user-email");
    if (emailEl) emailEl.value                     = user.email    || "";
    document.getElementById("user-role").value     = user.role     || "teacher";
    pwInput.value    = "";
    pwInput.required = false;
    submitBtn.textContent = "Save Changes";
    cancelBtn.hidden = false;
    pwHint.textContent = "Leave blank to keep current password.";
    setMessage(`Editing ${user.username || user.email}.`, "info");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function renderUsersTable() {
    const body = document.getElementById("users-table-body");
    if (!body) return;
    const users      = await window.API.getUsers();
    const currentUser = window.API.getSessionUser();
    // v10.16: only the ICT Coordinator (superadmin) manages users.
    // The Principal (admin) can open this page but is view-only.
    const isViewer    = currentUser && currentUser.role !== "superadmin";
    const supers     = users.filter(u => u.role === "superadmin").length;
    const term       = searchTerm.trim().toLowerCase();
    const filtered   = users.filter(u => {
      if (!term) return true;
      return [u.name, u.username, window.IMS.roleLabel(u.role)].some(v => String(v||"").toLowerCase().includes(term));
    });
    body.innerHTML = filtered.length ? filtered.map(u => {
      const isSelf      = currentUser && currentUser.email.toLowerCase() === u.email.toLowerCase();
      const isLastSuper = u.role === "superadmin" && supers <= 1;
      const delDisabled = isSelf || isLastSuper || isViewer;
      const editDisabled = isViewer;
      const delTitle    = isViewer ? "Read-only role." : isSelf ? "Cannot delete your own account." : isLastSuper ? "At least one ICT Coordinator required." : "Delete user";
      const uname       = u.username || (u.email || "").split("@")[0];

      // Super-account toggle (self-recovery via Forgot Password). Only
      // meaningful for the ICT superadmin; everyone else shows n/a.
      let superCell;
      if (u.role === "superadmin") {
        if (isViewer) {
          superCell = u.is_super_account
            ? '<span class="badge-super">🔐 Yes</span>'
            : '<span style="color:var(--ink-muted);font-size:0.75rem;">No</span>';
        } else {
          superCell = `<label class="super-switch" title="Allow this account to self-recover via Forgot Password.">
            <input type="checkbox" data-action="super-toggle" data-email="${window.IMS.escapeHtml(u.email)}" ${u.is_super_account ? "checked" : ""}>
            <span class="super-switch-slider"></span>
          </label>`;
        }
      } else {
        superCell = '<span style="color:var(--ink-muted);font-size:0.72rem;">n/a</span>';
      }

      return `<tr>
        <td>${window.IMS.escapeHtml(u.name)}</td>
        <td><span class="mono-cell">${window.IMS.escapeHtml(uname)}</span></td>
        <td><span class="badge ${window.IMS.escapeHtml(u.role)}">${window.IMS.escapeHtml(window.IMS.roleLabel(u.role))}</span></td>
        <td>${superCell}</td>
        <td><div class="action-cell">
          <button class="btn btn-secondary btn-sm" type="button" data-action="edit"   data-email="${window.IMS.escapeHtml(u.email)}" ${editDisabled?"disabled":""} title="${editDisabled?'Read-only role.':'Edit user'}">Edit</button>
          <button class="btn btn-danger btn-sm"    type="button" data-action="delete" data-email="${window.IMS.escapeHtml(u.email)}" ${delDisabled?"disabled":""} title="${window.IMS.escapeHtml(delTitle)}">Delete</button>
        </div></td>
      </tr>`;
    }).join("") : '<tr><td colspan="5">No users found.</td></tr>';

    // v10.4: hide the registration form entirely for principals
    if (isViewer) {
      const form = document.getElementById("users-form");
      if (form) form.style.display = "none";
      const formLabel = document.querySelector(".section-label");
      if (formLabel) formLabel.textContent = "User Management (View-Only)";
    }
  }

  async function handleFormSubmit(e) {
    e.preventDefault();
    const submitBtn = document.getElementById("users-submit-btn");
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Saving…"; }
    const name        = document.getElementById("user-name").value.trim();
    const usernameRaw = (document.getElementById("user-username")?.value || "").trim();
    const username    = usernameRaw.toLowerCase();
    // v10.5: synthesize email from username — the email field is hidden.
    const email       = window.IMS.usernameToEmail(username);
    const role        = document.getElementById("user-role").value.trim().toLowerCase();
    const password    = document.getElementById("user-password").value;
    if (!name || !username || !role) {
      setMessage("Please complete name, username, and role.", "error");
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = editingEmail ? "Save Changes" : "Add User"; }
      return;
    }
    // v10.5: usernames may now include uppercase and symbols (no spaces or @).
    if (username.length < 3 || username.length > 32) {
      setMessage("Username must be 3-32 characters.", "error");
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = editingEmail ? "Save Changes" : "Add User"; }
      return;
    }
    if (/[\s@]/.test(username)) {
      setMessage("Username cannot contain spaces or @ symbols.", "error");
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = editingEmail ? "Save Changes" : "Add User"; }
      return;
    }
    // Keep the hidden email field in sync so any code that still reads
    // it (e.g. legacy edit flow) sees the synthesized value.
    const emailField = document.getElementById("user-email");
    if (emailField) emailField.value = email;

    if (!editingEmail) {
      if (!password || password.trim().length < 6) {
        setMessage("Password must be at least 6 characters.", "error");
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Add User"; }
        return;
      }
      const res = await window.API.createUser({ name, username, email, role, password });
      if (!res.ok) { setMessage(res.error || "Create failed.", "error"); if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Add User"; } return; }
      setMessage(`User ${username} added.`, "success");
    } else {
      if (password && password.trim().length < 6) {
        setMessage("Password must be at least 6 characters if provided.", "error");
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Save Changes"; }
        return;
      }
      const res = await window.API.updateUser(editingEmail, { name, username, email, role, password });
      if (!res.ok) { setMessage(res.error || "Update failed.", "error"); if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Save Changes"; } return; }
      setMessage(`User ${username} updated.`, "success");
    }
    resetForm();
    await renderUsersTable();
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Add User"; }
  }

  async function handleTableClick(e) {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-action");
    const email  = String(btn.getAttribute("data-email")||"").trim().toLowerCase();
    if (!action || !email) return;
    if (action === "edit") {
      const users = await window.API.getUsers();
      const target = users.find(u => u.email === email);
      if (!target) { setMessage("User not found.", "error"); return; }
      beginEdit(target);
      return;
    }
    if (action === "delete") {
      if (!confirm(`Delete user ${email}?`)) return;
      const res = await window.API.deleteUser(email);
      if (!res.ok) { setMessage(res.error || "Delete failed.", "error"); return; }
      if (editingEmail && editingEmail === email) resetForm();
      setMessage(`User ${email} deleted.`, "success");
      await renderUsersTable();
    }
  }

  // v10.4: Super-account toggle (change event, not click)
  async function handleTableChange(e) {
    const inp = e.target.closest("input[data-action='super-toggle']");
    if (!inp) return;
    const email   = String(inp.getAttribute("data-email")||"").trim().toLowerCase();
    const isSuper = !!inp.checked;
    if (!email) return;
    const res = await window.API.setSuperAccount(email, isSuper);
    if (!res.ok) {
      setMessage(res.error || "Could not update super-account flag.", "error");
      // Revert the toggle visually
      inp.checked = !isSuper;
      return;
    }
    setMessage(isSuper
      ? `Super-account enabled for ${email}. They can now use Forgot Password to self-recover.`
      : `Super-account disabled for ${email}.`, "success");
    // Re-render so the table reflects the canonical server state.
    await renderUsersTable();
  }

  document.addEventListener("DOMContentLoaded", async () => {
    if (!document.body || document.body.dataset.page !== "users") return;
    // v10: ensure server session + CSRF token are loaded before any UI runs
    if (window.API && window.API.bootstrap) await window.API.bootstrap();
    const user = window.IMS.requireAuth("users");
    if (!user) return;
    window.IMS.initLayout("users", "Users");
    const form      = document.getElementById("users-form");
    const cancelBtn = document.getElementById("users-cancel-btn");
    const tBody     = document.getElementById("users-table-body");
    const searchInp = document.getElementById("users-search");
    if (form)      form.addEventListener("submit", handleFormSubmit);
    if (cancelBtn) cancelBtn.addEventListener("click", () => { resetForm(); setMessage(""); });
    if (tBody)     tBody.addEventListener("click",  handleTableClick);
    if (tBody)     tBody.addEventListener("change", handleTableChange);
    if (searchInp) searchInp.addEventListener("input", async () => { searchTerm = searchInp.value || ""; await renderUsersTable(); });

    // v10.5 — wire any .pw-toggle[data-toggle-for] buttons on this page
    document.querySelectorAll(".pw-toggle[data-toggle-for]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id  = btn.getAttribute("data-toggle-for");
        const inp = document.getElementById(id);
        if (!inp) return;
        const show = inp.type === "password";
        inp.type = show ? "text" : "password";
        btn.textContent = show ? "Hide" : "Show";
      });
    });

    resetForm();
    await renderUsersTable();

    // ── Flagged Borrowers Panel ──────────────────────────────
    // Oversight info — visible to ICT (superadmin) and Principal (admin).
    if (user.role === "superadmin" || user.role === "admin") {
      await renderFlaggedTable();
    }
  });

  // ── TIER LABEL HELPER ────────────────────────────────────
  function tierLabel(tier, overridden) {
    if (overridden) return `<span style="background:#dcfce7;color:#166534;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;">✅ Override Active</span>`;
    const map = {
      0: `<span style="background:#f1f5f9;color:#64748b;padding:2px 10px;border-radius:999px;font-size:12px;">Clean</span>`,
      1: `<span style="background:#fef3c7;color:#92400e;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;">⚠️ Tier 1 — Warning</span>`,
      2: `<span style="background:#fff7ed;color:#c2410c;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;">🚫 Tier 2 — Suspended</span>`,
      3: `<span style="background:#fee2e2;color:#991b1b;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;">🔒 Tier 3 — Restricted</span>`,
      4: `<span style="background:#4c0519;color:#fecdd3;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;">🚨 Tier 4 — Escalated</span>`,
    };
    return map[tier] || map[0];
  }

  async function renderFlaggedTable() {
    const tbody   = document.getElementById("flagged-table-body");
    const empty   = document.getElementById("flagged-empty");
    const section = document.getElementById("flagged-section");
    if (!tbody) return;

    const flagged = await window.API.getFlaggedBorrowers();

    if (!flagged.length) {
      tbody.innerHTML = "";
      if (empty) { empty.style.display = "block"; }
      return;
    }
    if (empty) empty.style.display = "none";

    tbody.innerHTML = flagged.map(f => {
      const esc = window.IMS.escapeHtml || (s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
      const actionBtn = f.overridden
        ? `<button class="btn btn-secondary btn-sm" data-action="revoke" data-email="${esc(f.email)}" data-name="${esc(f.name)}" type="button">Revoke Override</button>`
        : `<button class="btn btn-primary btn-sm" data-action="lift" data-email="${esc(f.email)}" data-name="${esc(f.name)}" type="button">Lift Restriction</button>`;
      const noteHtml = f.overrideNote
        ? `<div style="font-size:0.72rem;color:var(--gray-500);margin-top:2px;">Note: ${esc(f.overrideNote)}</div>` : "";
      return `<tr>
        <td><strong>${esc(f.name)}</strong><div style="font-size:0.75rem;color:var(--gray-400);">${esc(f.email)}</div></td>
        <td>${esc(f.assetName)}<div style="font-size:0.75rem;color:var(--gray-400);">${esc(f.txnId)}</div></td>
        <td class="mono-cell">${esc(f.returnDate)}</td>
        <td><strong style="color:${f.daysLate >= 7 ? '#dc2626' : '#f97316'};">${f.daysLate}d</strong></td>
        <td>${tierLabel(f.tier, f.overridden)}${noteHtml}</td>
        <td style="font-size:0.75rem;color:var(--gray-500);">${f.overrideBy ? `By: ${esc(f.overrideBy)}` : "—"}</td>
        <td>${actionBtn}</td>
      </tr>`;
    }).join("");

    // Wire action buttons (guard against double-binding on re-render)
    if (!_flaggedBound) {
      tbody.addEventListener("click", handleFlaggedClick);
      _flaggedBound = true;
    }
  }

  async function handleFlaggedClick(e) {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const email  = btn.dataset.email;
    const name   = btn.dataset.name;
    const user   = window.API.getSessionUser();

    const modal      = document.getElementById("override-modal");
    const titleEl    = document.getElementById("override-modal-title");
    const subEl      = document.getElementById("override-modal-sub");
    const noteEl     = document.getElementById("override-note");
    const confirmBtn = document.getElementById("override-confirm-btn");
    const cancelBtn  = document.getElementById("override-cancel-btn");
    if (!modal) return;

    titleEl.textContent = action === "lift" ? "Lift Restriction" : "Revoke Override";
    subEl.textContent   = action === "lift"
      ? `Grant temporary override for ${name} (${email}). They will be able to log in and borrow even with overdue items.`
      : `Revoke the override for ${name}. Their tier restrictions will apply again.`;
    noteEl.value = "";
    modal.style.display = "flex";

    // One-time confirm handler
    const onConfirm = async () => {
      const note = noteEl.value.trim();
      if (!note) { noteEl.style.borderColor = "#dc2626"; noteEl.focus(); return; }
      noteEl.style.borderColor = "";
      confirmBtn.disabled = true; confirmBtn.textContent = "Saving…";
      // v10: byEmail is no longer trusted from the client — server reads it from the session.
      await window.API.overrideTier(email, action === "lift", note);
      modal.style.display = "none";
      confirmBtn.disabled = false; confirmBtn.textContent = "Confirm";
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn.removeEventListener("click", onCancel);
      await renderFlaggedTable();
    };
    const onCancel = () => {
      modal.style.display = "none";
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn.removeEventListener("click", onCancel);
    };
    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn.addEventListener("click",  onCancel);
  }
})();
