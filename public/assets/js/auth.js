// ============================================================
// Platonian's IS — Auth Module (v5)
// 2-step password reset with identity verification
// ============================================================
(() => {
  "use strict";

  let _submitting = false;

  // ── PANELS ─────────────────────────────────────────────────
  function showPanel(id) {
    ["panel-login","panel-forgot","panel-register"].forEach(p => {
      const el = document.getElementById(p);
      if (el) el.style.display = p === id ? "block" : "none";
    });
    clearMessages();
    _submitting = false;
  }

  function clearMessages() {
    ["login-error","forgot-error","register-error","register-success"].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.textContent = ""; el.className = "status-message"; }
    });
    const s1 = document.getElementById("forgot-step1");
    const s2 = document.getElementById("forgot-step2");
    if (s1) { s1.style.display = "block"; s1.classList.remove('panel-fade-out','panel-fade-in'); }
    if (s2) { s2.style.display = "none";  s2.classList.remove('panel-fade-in'); }
    // Reset the forgot form so a fresh attempt starts clean
    document.getElementById("forgot-form")?.reset();
    const cnt = document.getElementById("forgot-reason-count");
    if (cnt) { cnt.textContent = "0 / 500"; cnt.className = "char-count"; }
  }

  function showMsg(id, msg, type = "error") {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg || "";
    el.className = `status-message ${type}-message ${msg ? "show" : ""}`;
  }

  function wireToggle(inputId, btnId) {
    const inp = document.getElementById(inputId);
    const btn = document.getElementById(btnId);
    if (!inp || !btn) return;
    btn.addEventListener("click", () => {
      const show = inp.type === "password";
      inp.type = show ? "text" : "password";
      btn.textContent = show ? "Hide" : "Show";
    });
  }

  // ── LOGIN ───────────────────────────────────────────────────
  async function handleLogin(e) {
    e.preventDefault();
    if (_submitting) return;
    _submitting = true;
    const btn = e.target.querySelector("button[type='submit']");
    if (btn) { btn.disabled = true; btn.textContent = "Signing in…"; }
    showMsg("login-error", "");

    // v10.5: usernames may contain uppercase and symbols, but the
    // server still matches case-insensitively, so we lowercase before
    // sending. The visible field keeps the user's original casing.
    const username = document.getElementById("login-username")?.value.trim().toLowerCase();
    const pw       = document.getElementById("login-password")?.value;

    const fail = (msg) => {
      showMsg("login-error", msg);
      if (btn) { btn.disabled = false; btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg><span>Sign In</span>'; }
      _submitting = false;
    };

    if (!username || !pw) return fail("Please enter your username and password.");
    const res = await window.API.login(username, pw);

    // Tier 3 / 4: login blocked — show the restriction message
    if (!res.ok && res.blocked) return fail(res.error || "Account restricted.");
    if (!res.ok) return fail(res.error || "Invalid credentials.");

    window.API.setSessionUser(res.user);

    // Tier 1 / 2: store warning so dashboard can show banner
    if (res.tier && res.tier > 0) {
      sessionStorage.setItem('platonian_tier_warning', JSON.stringify({
        tier: res.tier, message: res.warning, info: res.overdueInfo
      }));
    } else {
      sessionStorage.removeItem('platonian_tier_warning');
    }

    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
    window.location.href = "dashboard.html";
  }

  // ── FORGOT: Submit a reset REQUEST (v10.3) ─────────────────
  // No password change happens here. The Admin reviews the request,
  // verifies the user in person, then approves it from policy.html.
  //
  // v10.4: if the response says { isSuper: true, tempPassword: ... }
  // the user is on a super account (admin/custodian flagged for
  // self-recovery) and we show the temp password directly. The same
  // success card is reused with a different message + the password.
  async function handleForgotRequest(e) {
    e.preventDefault();
    if (_submitting) return;
    _submitting = true;
    const btn = e.target.querySelector("button[type='submit']");
    const setBtn = (txt, disabled) => { if (btn) { btn.disabled = disabled; btn.innerHTML = txt; } };
    setBtn('<span class="btn-spinner"></span><span>Submitting…</span>', true);
    showMsg("forgot-error", "");

    const identifier = document.getElementById("forgot-username")?.value.trim().toLowerCase();
    const reason     = document.getElementById("forgot-reason")?.value.trim();

    const fail = (msg) => {
      showMsg("forgot-error", msg);
      setBtn('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg><span>Submit Request</span>', false);
      _submitting = false;
      document.getElementById(!identifier ? "forgot-username" : "forgot-reason")?.focus();
    };

    if (!identifier) return fail("Please enter your username.");
    if (!reason || reason.length < 10) return fail("Please describe why you need a reset (at least 10 characters).");
    if (reason.length > 500) return fail("Reason is too long (max 500 characters).");

    const res = await window.API.forgotRequest(identifier, reason);
    if (!res.ok) return fail(res.error || "Could not submit your request. Please try again.");

    // Success — animate to confirmation screen
    document.getElementById("forgot-step1").classList.add('panel-fade-out');
    setTimeout(() => {
      document.getElementById("forgot-step1").style.display = "none";
      document.getElementById("forgot-step1").classList.remove('panel-fade-out');
      const step2 = document.getElementById("forgot-step2");
      step2.style.display = "block";
      step2.classList.add('panel-fade-in');
    }, 240);

    const codeEl  = document.getElementById("forgot-request-code");
    if (codeEl) codeEl.textContent = res.request_code || "—";

    // v10.4 — super-account branch: show the temp password on screen
    // instead of "wait for admin approval".
    const superBox    = document.getElementById("forgot-super-box");
    const normalSteps = document.getElementById("forgot-success-steps-normal");
    const titleEl     = document.getElementById("forgot-success-title");
    const lineEl      = document.getElementById("forgot-success-line");
    if (res.isSuper && res.tempPassword) {
      if (titleEl) titleEl.textContent = "Super-Account Recovery";
      if (lineEl)  lineEl.textContent  = "Use this temporary password to sign in, then change it from Account Settings.";
      if (normalSteps) normalSteps.style.display = "none";
      if (superBox) {
        superBox.style.display = "block";
        const pwEl = document.getElementById("forgot-super-temp-pw");
        if (pwEl) pwEl.textContent = res.tempPassword;
        const userEl = document.getElementById("forgot-super-username");
        if (userEl) userEl.textContent = res.username || identifier;
      }
    } else {
      if (titleEl) titleEl.textContent = "Request submitted!";
      if (lineEl)  lineEl.textContent  = "Your reference code is:";
      if (normalSteps) normalSteps.style.display = "flex";
      if (superBox) superBox.style.display = "none";
    }

    setBtn('<span>Submit Request</span>', false);
    _submitting = false;
  }

  // ── REGISTER ────────────────────────────────────────────────
  async function handleRegister(e) {
    e.preventDefault();
    if (_submitting) return;
    _submitting = true;
    const btn = e.target.querySelector("button[type='submit']");
    if (btn) { btn.disabled = true; btn.textContent = "Creating…"; }
    showMsg("register-error", "");
    showMsg("register-success", "");

    const name     = document.getElementById("reg-name")?.value.trim();
    const usernameRaw = document.getElementById("reg-username")?.value.trim();
    // v10.5: keep the username as the user typed it for display, but
    // send a lowercased copy to the server so logins are case-insensitive.
    const username = usernameRaw.toLowerCase();
    // v10.5: email is auto-synthesized from the username (the UI field
    // is hidden). The server still wants a value in the email column.
    const email    = window.IMS.usernameToEmail(username);
    const role     = document.getElementById("reg-role")?.value.trim().toLowerCase();
    const pw       = document.getElementById("reg-password")?.value;
    const cpw      = document.getElementById("reg-confirm-password")?.value;

    const fail = (msg) => {
      showMsg("register-error", msg);
      if (btn) { btn.disabled = false; btn.textContent = "Create Account"; }
      _submitting = false;
    };

    if (!name)     return fail("Full name is required.");
    if (!username) return fail("Username is required.");
    // v10.5: usernames may now include uppercase and symbols (no spaces / @).
    if (username.length < 3 || username.length > 32)
      return fail("Username must be between 3 and 32 characters.");
    if (/[\s@]/.test(username))
      return fail("Username cannot contain spaces or @ symbols.");
    if (!role)     return fail("Please select a role.");
    if (role === "admin" || role === "superadmin")
      return fail("Privileged accounts cannot be self-registered. Contact the ICT Coordinator.");
    if (!pw || pw.length < 6) return fail("Password must be at least 6 characters.");
    if (pw !== cpw)           return fail("Passwords do not match.");

    // Keep the hidden email input in sync so any downstream code that
    // reads it still gets a usable value.
    const emailField = document.getElementById("reg-email");
    if (emailField) emailField.value = email;

    const res = await window.API.register(name, username, email, role, pw);
    if (!res.ok) return fail(res.error || "Registration failed. Please try again.");

    showMsg("register-success", `Account created for ${name}! Redirecting to sign in…`, "success");
    document.getElementById("register-form")?.reset();
    setTimeout(() => {
      showPanel("panel-login");
      const lu = document.getElementById("login-username");
      if (lu) lu.value = username;
    }, 2200);
    _submitting = false;
    if (btn) { btn.disabled = false; btn.textContent = "Create Account"; }
  }

  // ── LOGIN PAGE STATS ────────────────────────────────────────
  // v10.2: fetch from the new /auth.php?action=public_stats endpoint
  // which does not require an authenticated session. The previous
  // call (window.API.getAssets) silently failed with a 401 — that's
  // why the stat boxes always displayed "—" on the login page.
  async function renderLoginStats() {
    const totalEl = document.getElementById("login-total-assets");
    const unitEl  = document.getElementById("login-total-equipment");
    if (!totalEl && !unitEl) return;
    try {
      const stats = await window.API.getPublicStats();
      if (totalEl) totalEl.textContent = Number(stats.totalAssets || 0).toLocaleString();
      if (unitEl)  unitEl.textContent  = Number(stats.totalUnits  || 0).toLocaleString();
    } catch {
      if (totalEl) totalEl.textContent = "0";
      if (unitEl)  unitEl.textContent  = "0";
    }
  }

  // ── INIT ────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", async () => {
    if (!document.body || document.body.dataset.page !== "login") return;

    // Already logged in → redirect
    const cu = window.API.getSessionUser();
    if (cu) { window.location.href = "dashboard.html"; return; }

    showPanel("panel-login");
    renderLoginStats();

    // Wire forms
    document.getElementById("login-form")?.addEventListener("submit",    handleLogin);
    document.getElementById("forgot-form")?.addEventListener("submit",   handleForgotRequest);
    document.getElementById("register-form")?.addEventListener("submit", handleRegister);

    // Password toggles
    wireToggle("login-password",       "pw-toggle-btn");
    wireToggle("reg-password",         "reg-pw-toggle-btn");
    wireToggle("reg-confirm-password", "reg-confirm-pw-toggle-btn");

    // Nav links
    document.getElementById("go-forgot")?.addEventListener("click",         () => showPanel("panel-forgot"));
    document.getElementById("go-register")?.addEventListener("click",       () => showPanel("panel-register"));
    document.getElementById("back-from-forgot")?.addEventListener("click",  () => showPanel("panel-login"));
    document.getElementById("back-from-register")?.addEventListener("click",() => showPanel("panel-login"));
    document.getElementById("forgot-go-login-btn")?.addEventListener("click", () => showPanel("panel-login"));

    // Live character counter for the reason textarea
    const reasonEl = document.getElementById("forgot-reason");
    const countEl  = document.getElementById("forgot-reason-count");
    if (reasonEl && countEl) {
      const updateCount = () => {
        const n = reasonEl.value.length;
        countEl.textContent = `${n} / 500`;
        countEl.classList.toggle('char-count-warn',  n > 0 && n < 10);
        countEl.classList.toggle('char-count-ok',   n >= 10 && n <= 500);
        countEl.classList.toggle('char-count-over', n > 500);
      };
      reasonEl.addEventListener("input", updateCount);
      updateCount();
    }
  });
})();
