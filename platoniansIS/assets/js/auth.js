// ============================================================
// Platonian's IS — Auth Module (v5)
// 2-step password reset with identity verification
// ============================================================
(() => {
  "use strict";

  let _submitting = false;
  let _resetToken = null;
  let _resetEmail = null;

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
    ["login-error","forgot-error","forgot-success","register-error","register-success"].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.textContent = ""; el.className = "status-message"; }
    });
    const fr = document.getElementById("forgot-result");
    if (fr) fr.style.display = "none";
    const s1 = document.getElementById("forgot-step1");
    const s2 = document.getElementById("forgot-step2");
    if (s1) s1.style.display = "block";
    if (s2) s2.style.display = "none";
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

    const role  = document.getElementById("login-role")?.value.trim().toLowerCase();
    const email = document.getElementById("login-email")?.value.trim().toLowerCase();
    const pw    = document.getElementById("login-password")?.value;

    const fail = (msg) => {
      showMsg("login-error", msg);
      if (btn) { btn.disabled = false; btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg><span>Sign In</span>'; }
      _submitting = false;
    };

    if (!role || !email || !pw) return fail("Please complete all fields.");
    const res = await window.API.login(email, pw, role);

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

  // ── FORGOT: STEP 1 — Verify identity ───────────────────────
  async function handleForgotVerify(e) {
    e.preventDefault();
    if (_submitting) return;
    _submitting = true;
    const btn = e.target.querySelector("button[type='submit']");
    if (btn) { btn.disabled = true; btn.textContent = "Verifying…"; }
    showMsg("forgot-error", "");

    const email    = document.getElementById("forgot-email")?.value.trim().toLowerCase();
    const fullName = document.getElementById("forgot-fullname")?.value.trim();

    const fail = (msg) => {
      showMsg("forgot-error", msg);
      if (btn) { btn.disabled = false; btn.textContent = "Verify Identity"; }
      _submitting = false;
    };

    if (!email || !fullName) return fail("Please enter both your email and full name.");
    const res = await window.API.forgotVerify(email, fullName);
    if (!res.ok) return fail(res.error || "Verification failed. Check your email and name.");

    // Identity verified — now do the reset
    _resetToken = res.token;
    _resetEmail = res.email;
    const resetRes = await window.API.forgotReset(res.email, res.token);
    if (!resetRes.ok) return fail(resetRes.error || "Reset failed. Please try again.");

    // Show step 2 result
    document.getElementById("forgot-step1").style.display = "none";
    document.getElementById("forgot-step2").style.display = "block";
    showMsg("forgot-success", "Identity verified! Your password has been reset successfully.", "success");
    document.getElementById("forgot-found-email").textContent  = resetRes.email;
    document.getElementById("forgot-found-password").textContent = resetRes.tempPassword;
    document.getElementById("forgot-result").style.display = "block";

    // Pre-fill login form
    const le = document.getElementById("login-email");
    const lr = document.getElementById("login-role");
    const lp = document.getElementById("login-password");
    if (le) le.value = resetRes.email;
    if (lr) lr.value = resetRes.role || "";
    if (lp) lp.value = resetRes.tempPassword;

    if (btn) { btn.disabled = false; btn.textContent = "Verify Identity"; }
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

    const name  = document.getElementById("reg-name")?.value.trim();
    const email = document.getElementById("reg-email")?.value.trim().toLowerCase();
    const role  = document.getElementById("reg-role")?.value.trim().toLowerCase();
    const pw    = document.getElementById("reg-password")?.value;
    const cpw   = document.getElementById("reg-confirm-password")?.value;

    const fail = (msg) => {
      showMsg("register-error", msg);
      if (btn) { btn.disabled = false; btn.textContent = "Create Account"; }
      _submitting = false;
    };

    if (!name)  return fail("Full name is required.");
    if (!email) return fail("Email address is required.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Enter a valid email address.");
    if (!role)  return fail("Please select a role.");
    if (role === "admin") return fail("Admin accounts cannot be self-registered. Contact an Administrator.");
    if (!pw || pw.length < 6) return fail("Password must be at least 6 characters.");
    if (pw !== cpw) return fail("Passwords do not match.");

    const res = await window.API.register(name, email, role, pw);
    if (!res.ok) return fail(res.error || "Registration failed. Please try again.");

    showMsg("register-success", `Account created for ${name}! Redirecting to sign in…`, "success");
    document.getElementById("register-form")?.reset();
    setTimeout(() => {
      showPanel("panel-login");
      const le = document.getElementById("login-email");
      const lr = document.getElementById("login-role");
      if (le) le.value = email;
      if (lr) lr.value = role;
    }, 2200);
    _submitting = false;
    if (btn) { btn.disabled = false; btn.textContent = "Create Account"; }
  }

  // ── LOGIN PAGE STATS ────────────────────────────────────────
  async function renderLoginStats() {
    try {
      const assets = await window.API.getAssets();
      const totalEl = document.getElementById("login-total-assets");
      const unitEl  = document.getElementById("login-total-equipment");
      if (totalEl) totalEl.textContent = assets.length;
      if (unitEl)  unitEl.textContent  = assets.reduce((s, a) => s + (Number(a.quantity) || 0), 0);
    } catch { /* stats non-critical */ }
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
    document.getElementById("forgot-form")?.addEventListener("submit",   handleForgotVerify);
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
  });
})();
