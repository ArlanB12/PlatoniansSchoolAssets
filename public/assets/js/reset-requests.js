/* ============================================================
   Platonian's IS — Password Reset Requests Module (v10.8)
   Extracted from the policy.html inline script so the card
   can live wherever it makes sense (now on users.html, where
   admins manage user accounts — the right place for it).

   Public surface: window.IMS.initResetRequests(opts)
     - looks for #reset-requests-card in the DOM; if missing,
       silently no-ops (safe to call on pages that don't show
       the card)
     - admin-only; hides the card for non-admin sessions
     - polls every 30s while the tab is visible
   ============================================================ */
(function () {
  "use strict";

  let _currentResetTab = 'pending';
  let _resetPollTimer  = null;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function fmtAge(mins) {
    if (mins < 1)  return 'just now';
    if (mins < 60) return mins + ' min' + (mins === 1 ? '' : 's') + ' ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return hrs + ' hour' + (hrs === 1 ? '' : 's') + ' ago';
    const days = Math.floor(hrs / 24);
    return days + ' day' + (days === 1 ? '' : 's') + ' ago';
  }

  function ageClass(mins) {
    if (mins < 60)    return 'age-fresh';
    if (mins < 60*24) return 'age-aging';
    return 'age-stale';
  }

  function statusBadge(status) {
    const map = {
      pending:   'badge-warn|⏳ Pending',
      approved:  'badge-success|✓ Approved',
      denied:    'badge-locked|✕ Denied',
      expired:   'badge-muted|⌛ Expired',
      cancelled: 'badge-muted|⊘ Cancelled',
    };
    const v = map[status] || ('badge-muted|' + status);
    const [cls, txt] = v.split('|');
    return '<span class="badge ' + cls + '">' + esc(txt) + '</span>';
  }

  async function loadResetRequests() {
    const listEl = document.getElementById("reset-requests-list");
    const cardEl = document.getElementById("reset-requests-card");
    if (!listEl) return;

    const user = window.API && window.API.getSessionUser && window.API.getSessionUser();
    if (!user || user.role !== "superadmin") {
      if (cardEl) cardEl.style.display = "none";
      return;
    }

    try {
      const res = await window.API.listResetRequests(_currentResetTab);
      if (!res.ok) {
        listEl.innerHTML = '<p class="locked-error">' + esc(res.error || 'Could not load requests.') + '</p>';
        return;
      }

      const countEl = document.getElementById("reset-pending-count");
      if (countEl) {
        if (res.pendingCount > 0) {
          countEl.textContent = res.pendingCount;
          countEl.style.display = 'inline-flex';
        } else {
          countEl.style.display = 'none';
        }
      }

      const requests = res.requests || [];
      if (!requests.length) {
        const emptyMsg = _currentResetTab === 'pending'
          ? 'No pending reset requests. The queue is clear.'
          : 'No requests in this category.';
        listEl.innerHTML =
          '<div class="locked-empty">' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>' +
            '<span>' + esc(emptyMsg) + '</span>' +
          '</div>';
        return;
      }

      listEl.innerHTML = '<div class="reset-request-grid">' +
        requests.map((r, idx) => {
          const isPending = r.status === 'pending';
          const resolved = r.resolvedAt
            ? '<div class="rr-resolved">Resolved by <strong>' + esc(r.resolvedBy || '—') + '</strong>' +
              (r.adminNote ? ' · <em>' + esc(r.adminNote) + '</em>' : '') + '</div>'
            : '';
          const actions = isPending
            ? '<div class="rr-actions">' +
                '<button type="button" class="btn btn-danger btn-sm" data-deny="' + esc(r.requestCode) + '">' +
                  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>' +
                  'Deny' +
                '</button>' +
                '<button type="button" class="btn btn-primary btn-sm" data-approve="' + esc(r.requestCode) + '">' +
                  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' +
                  'Approve &amp; Reveal Password' +
                '</button>' +
              '</div>'
            : '';

          return '<article class="reset-request-card rr-' + esc(r.status) + '" style="animation-delay:' + (idx * 60) + 'ms;">' +
            '<header class="rr-header">' +
              '<div class="rr-code">' + esc(r.requestCode) + '</div>' +
              statusBadge(r.status) +
            '</header>' +
            '<div class="rr-user">' +
              '<div class="rr-avatar">' + esc((r.name || '?')[0].toUpperCase()) + '</div>' +
              '<div>' +
                '<div class="rr-name">' + esc(r.name) + '</div>' +
                '<div class="rr-meta"><span class="mono-cell">' + esc(r.username) + '</span> · <span>' + esc(r.userEmail) + '</span></div>' +
              '</div>' +
            '</div>' +
            '<div class="rr-reason">' +
              '<div class="rr-reason-label">Reason given</div>' +
              '<div class="rr-reason-text">' + esc(r.reason) + '</div>' +
            '</div>' +
            '<div class="rr-footer">' +
              '<span class="rr-age ' + ageClass(r.ageMinutes) + '">' +
                '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
                esc(fmtAge(r.ageMinutes)) +
              '</span>' +
              (r.requesterIp ? '<span class="rr-ip" title="Requester IP">IP: ' + esc(r.requesterIp) + '</span>' : '') +
            '</div>' +
            resolved +
            actions +
          '</article>';
        }).join('') +
      '</div>';

      listEl.querySelectorAll("[data-approve]").forEach(btn => {
        btn.addEventListener("click", () => openApproveModal(btn.getAttribute("data-approve")));
      });
      listEl.querySelectorAll("[data-deny]").forEach(btn => {
        btn.addEventListener("click", () => openDenyModal(btn.getAttribute("data-deny")));
      });
    } catch (err) {
      listEl.innerHTML = '<p class="locked-error">Could not load reset requests.</p>';
    }
  }

  function openModal(html) {
    const m = document.getElementById("reset-modal");
    const c = document.getElementById("reset-modal-content");
    if (!m || !c) return;
    c.innerHTML = html;
    m.style.display = "flex";
    requestAnimationFrame(() => m.classList.add("reset-modal-open"));
  }
  function closeModal() {
    const m = document.getElementById("reset-modal");
    if (!m) return;
    m.classList.remove("reset-modal-open");
    setTimeout(() => { m.style.display = "none"; }, 220);
  }

  function openApproveModal(code) {
    const html =
      '<div class="rmodal-head">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9c2.39 0 4.68.94 6.36 2.64"/></svg>' +
        '<h3>Approve Reset Request</h3>' +
      '</div>' +
      '<p class="rmodal-sub">Approving will generate a new temporary password for request <strong>' + esc(code) + '</strong>. ' +
      '<span class="rmodal-warn">Only continue if you have verified the requester\'s identity in person.</span></p>' +
      '<div class="form-group">' +
        '<label for="approve-note">Note (optional)</label>' +
        '<input type="text" id="approve-note" maxlength="500" placeholder="e.g. Verified ID, handed password in office.">' +
      '</div>' +
      '<div class="rmodal-actions">' +
        '<button type="button" class="btn btn-secondary" id="rmodal-cancel">Cancel</button>' +
        '<button type="button" class="btn btn-primary" id="rmodal-confirm">Yes, Approve</button>' +
      '</div>';
    openModal(html);

    document.getElementById("rmodal-cancel").addEventListener("click", closeModal);
    document.getElementById("rmodal-confirm").addEventListener("click", async (e) => {
      const note = document.getElementById("approve-note")?.value.trim() || '';
      const btn = e.target;
      btn.disabled = true; btn.textContent = "Approving…";
      const res = await window.API.approveResetRequest(code, note);
      if (!res.ok) {
        btn.disabled = false; btn.textContent = "Yes, Approve";
        alert(res.error || "Approval failed.");
        return;
      }
      showApprovedPasswordModal(res);
    });
  }

  function showApprovedPasswordModal(res) {
    const html =
      '<div class="rmodal-head rmodal-head-success">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' +
        '<h3>Approved — Hand This Password to the User</h3>' +
      '</div>' +
      '<p class="rmodal-sub">Request <strong>' + esc(res.requestCode) + '</strong> · User <strong>' + esc(res.username) + '</strong></p>' +
      '<div class="rmodal-pw-wrap">' +
        '<div class="rmodal-pw-label">Temporary password</div>' +
        '<div class="rmodal-pw" id="rmodal-pw-value">' + esc(res.tempPassword) + '</div>' +
        '<button type="button" class="btn btn-secondary btn-sm" id="rmodal-copy">' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>' +
          'Copy' +
        '</button>' +
      '</div>' +
      '<div class="rmodal-note">' +
        '⚠ This password is shown <strong>once</strong>. Write it down or copy it now. ' +
        'For security, do not send it over chat or email. Hand it to the user in person, and remind them to change it on first login.' +
      '</div>' +
      '<div class="rmodal-actions">' +
        '<button type="button" class="btn btn-primary" id="rmodal-done">Done</button>' +
      '</div>';
    openModal(html);

    document.getElementById("rmodal-copy").addEventListener("click", async (e) => {
      try {
        await navigator.clipboard.writeText(res.tempPassword);
        e.target.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Copied';
        setTimeout(() => {
          e.target.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>Copy';
        }, 1800);
      } catch {
        alert("Could not copy. Please select the password and copy it manually.");
      }
    });
    document.getElementById("rmodal-done").addEventListener("click", () => {
      closeModal();
      loadResetRequests();
    });
  }

  function openDenyModal(code) {
    const html =
      '<div class="rmodal-head rmodal-head-danger">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6"/><path d="M9 9l6 6"/></svg>' +
        '<h3>Deny Reset Request</h3>' +
      '</div>' +
      '<p class="rmodal-sub">You are about to deny request <strong>' + esc(code) + '</strong>. The user will be notified.</p>' +
      '<div class="form-group">' +
        '<label for="deny-note">Reason (required)</label>' +
        '<textarea id="deny-note" rows="3" maxlength="500" placeholder="e.g. Could not verify identity. Please visit the office in person."></textarea>' +
      '</div>' +
      '<div class="rmodal-actions">' +
        '<button type="button" class="btn btn-secondary" id="rmodal-cancel">Cancel</button>' +
        '<button type="button" class="btn btn-danger" id="rmodal-confirm">Deny Request</button>' +
      '</div>';
    openModal(html);

    document.getElementById("rmodal-cancel").addEventListener("click", closeModal);
    document.getElementById("rmodal-confirm").addEventListener("click", async (e) => {
      const note = document.getElementById("deny-note")?.value.trim() || '';
      if (!note) { alert("Please provide a reason."); return; }
      const btn = e.target;
      btn.disabled = true; btn.textContent = "Denying…";
      const res = await window.API.denyResetRequest(code, note);
      if (!res.ok) {
        btn.disabled = false; btn.textContent = "Deny Request";
        alert(res.error || "Failed to deny.");
        return;
      }
      closeModal();
      loadResetRequests();
    });
  }

  function wireResetTabs() {
    document.querySelectorAll(".reset-tab").forEach(t => {
      t.addEventListener("click", () => {
        document.querySelectorAll(".reset-tab").forEach(x => x.classList.remove("active"));
        t.classList.add("active");
        _currentResetTab = t.getAttribute("data-tab") || "pending";
        loadResetRequests();
      });
    });
  }

  async function initResetRequests() {
    const cardEl = document.getElementById("reset-requests-card");
    if (!cardEl) return;  // No-op on pages without the card
    await loadResetRequests();
    wireResetTabs();
    if (_resetPollTimer) clearInterval(_resetPollTimer);
    _resetPollTimer = setInterval(() => {
      if (document.visibilityState === "visible") loadResetRequests();
    }, 30000);
    document.querySelector("#reset-modal .reset-modal-backdrop")?.addEventListener("click", closeModal);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModal();
    });
  }

  // Expose so any page can opt-in
  window.IMS = window.IMS || {};
  window.IMS.initResetRequests = initResetRequests;
  window.IMS.reloadResetRequests = loadResetRequests;
})();
