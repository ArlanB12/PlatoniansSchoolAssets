// ============================================================
// Platonian's IS — Users Module (MySQL/API version)
// ============================================================
(() => {
  "use strict";

  let editingEmail = null;
  let searchTerm   = "";

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
    pwHint.textContent = "Use at least 3 characters.";
  }

  function beginEdit(user) {
    const submitBtn = document.getElementById("users-submit-btn");
    const cancelBtn = document.getElementById("users-cancel-btn");
    const pwInput   = document.getElementById("user-password");
    const pwHint    = document.getElementById("user-password-hint");
    if (!submitBtn || !cancelBtn || !pwInput || !pwHint) return;
    editingEmail = user.email;
    document.getElementById("user-name").value  = user.name  || "";
    document.getElementById("user-email").value = user.email || "";
    document.getElementById("user-role").value  = user.role  || "teacher";
    pwInput.value    = "";
    pwInput.required = false;
    submitBtn.textContent = "Save Changes";
    cancelBtn.hidden = false;
    pwHint.textContent = "Leave blank to keep current password.";
    setMessage(`Editing ${user.email}.`, "info");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function renderUsersTable() {
    const body = document.getElementById("users-table-body");
    if (!body) return;
    const users      = await window.API.getUsers();
    const currentUser = window.API.getSessionUser();
    const admins     = users.filter(u => u.role === "admin").length;
    const term       = searchTerm.trim().toLowerCase();
    const filtered   = users.filter(u => {
      if (!term) return true;
      return [u.name, u.email, window.IMS.roleLabel(u.role)].some(v => String(v||"").toLowerCase().includes(term));
    });
    body.innerHTML = filtered.length ? filtered.map(u => {
      const isSelf      = currentUser && currentUser.email.toLowerCase() === u.email.toLowerCase();
      const isLastAdmin = u.role === "admin" && admins <= 1;
      const delDisabled = isSelf || isLastAdmin;
      const delTitle    = isSelf ? "Cannot delete your own account." : isLastAdmin ? "At least one admin required." : "Delete user";
      return `<tr>
        <td>${window.IMS.escapeHtml(u.name)}</td>
        <td>${window.IMS.escapeHtml(u.email)}</td>
        <td><span class="badge ${window.IMS.escapeHtml(u.role)}">${window.IMS.escapeHtml(window.IMS.roleLabel(u.role))}</span></td>
        <td><div class="action-cell">
          <button class="btn btn-secondary btn-sm" type="button" data-action="edit"   data-email="${window.IMS.escapeHtml(u.email)}">Edit</button>
          <button class="btn btn-danger btn-sm"    type="button" data-action="delete" data-email="${window.IMS.escapeHtml(u.email)}" ${delDisabled?"disabled":""} title="${window.IMS.escapeHtml(delTitle)}">Delete</button>
        </div></td>
      </tr>`;
    }).join("") : '<tr><td colspan="4">No users found.</td></tr>';
  }

  async function handleFormSubmit(e) {
    e.preventDefault();
    const submitBtn = document.getElementById("users-submit-btn");
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Saving…"; }
    const name     = document.getElementById("user-name").value.trim();
    const email    = document.getElementById("user-email").value.trim().toLowerCase();
    const role     = document.getElementById("user-role").value.trim().toLowerCase();
    const password = document.getElementById("user-password").value;
    if (!name || !email || !role) {
      setMessage("Please complete name, email, and role.", "error");
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = editingEmail ? "Save Changes" : "Add User"; }
      return;
    }
    if (!validEmail(email)) {
      setMessage("Please provide a valid email address.", "error");
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = editingEmail ? "Save Changes" : "Add User"; }
      return;
    }
    if (!editingEmail) {
      if (!password || password.trim().length < 3) {
        setMessage("Password must be at least 3 characters.", "error");
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Add User"; }
        return;
      }
      const res = await window.API.createUser({ name, email, role, password });
      if (!res.ok) { setMessage(res.error || "Create failed.", "error"); if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Add User"; } return; }
      setMessage(`User ${email} added.`, "success");
    } else {
      if (password && password.trim().length < 3) {
        setMessage("Password must be at least 3 characters if provided.", "error");
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Save Changes"; }
        return;
      }
      const res = await window.API.updateUser(editingEmail, { name, email, role, password });
      if (!res.ok) { setMessage(res.error || "Update failed.", "error"); if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Save Changes"; } return; }
      setMessage(`User ${email} updated.`, "success");
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

  document.addEventListener("DOMContentLoaded", async () => {
    if (!document.body || document.body.dataset.page !== "users") return;
    const user = window.IMS.requireAuth("users");
    if (!user) return;
    window.IMS.initLayout("users", "Users");
    const form      = document.getElementById("users-form");
    const cancelBtn = document.getElementById("users-cancel-btn");
    const tBody     = document.getElementById("users-table-body");
    const searchInp = document.getElementById("users-search");
    if (form)      form.addEventListener("submit", handleFormSubmit);
    if (cancelBtn) cancelBtn.addEventListener("click", () => { resetForm(); setMessage(""); });
    if (tBody)     tBody.addEventListener("click", handleTableClick);
    if (searchInp) searchInp.addEventListener("input", async () => { searchTerm = searchInp.value || ""; await renderUsersTable(); });
    resetForm();
    await renderUsersTable();

    // ── Flagged Borrowers Panel ──────────────────────────────
    if (user.role === "admin" || user.role === "custodian") {
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

    // Wire action buttons
    tbody.addEventListener("click", handleFlaggedClick);
  }

  // Track to avoid double-binding
  let _flaggedBound = false;
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
      await window.API.overrideTier(email, action === "lift", note, user?.email || "admin");
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
