// ============================================================
// Platonian's IS — Account Settings Module (v10.4)
// ============================================================
// Self-service password change page available to every role.
// Pulls the current user from the bootstrap session, renders
// profile info, and posts to /api/auth.php?action=change_password.
// ============================================================
(() => {
  "use strict";

  // ── MESSAGE HELPER ────────────────────────────────────────
  function setMessage(msg, type = "info") {
    const el = document.getElementById("account-message");
    if (!el) return;
    el.textContent = msg || "";
    el.className = `status-message ${type}-message ${msg ? "show" : ""}`;
  }

  // ── ROLE DESCRIPTIONS ─────────────────────────────────────
  const ROLE_DESC = {
    admin:     "Full access. Can manage users, run audits, and resolve password reset requests.",
    custodian: "Manages assets and approves/checks out items. Cannot manage user accounts.",
    teacher:   "Can borrow and return items, and view personal transaction history.",
    principal: "Read-only access across the system for information management. Cannot make changes.",
  };

  // ── RENDER PROFILE ────────────────────────────────────────
  function renderProfile(user) {
    if (!user) return;
    const name     = user.name     || "—";
    const username = user.username || (user.email || "").split("@")[0] || "—";
    const email    = user.email    || "—";
    const role     = user.role     || "teacher";
    const label    = (window.IMS && window.IMS.roleLabel)     ? window.IMS.roleLabel(role)   : role;
    const initial  = (window.IMS && window.IMS.roleInitial)   ? window.IMS.roleInitial(role) : name.charAt(0);

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set("account-name",     name);
    set("account-username", "@" + username);
    set("account-email",    email);
    set("account-info-role",     label);
    set("account-info-username", username);
    set("account-info-email",    email);
    set("account-info-role-desc", ROLE_DESC[role] || "");

    const badge = document.getElementById("account-role-badge");
    if (badge) {
      badge.textContent = label;
      badge.className = "badge " + role;
    }
    const avatar = document.getElementById("account-avatar");
    if (avatar) avatar.textContent = initial;

    // Super-account banner — only shown if the session user has the flag.
    // The flag is populated by /me, which reads from password_changes-aware
    // session data. We also fall back to a direct GET if needed.
    showSuperLineIfApplicable(user);
  }

  async function showSuperLineIfApplicable(user) {
    const line = document.getElementById("account-super-line");
    if (!line) return;
    // v10.16: only the ICT Coordinator (superadmin) is a self-recovery
    // super account, so the line is only relevant for that role.
    if (user.role !== "superadmin") return;
    if (user.is_super_account) line.style.display = "flex";
  }

  // ── PASSWORD STRENGTH METER ───────────────────────────────
  function scorePassword(pw) {
    if (!pw) return { score: 0, label: "Enter a password", cls: "" };
    let s = 0;
    if (pw.length >= 6)  s++;
    if (pw.length >= 10) s++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
    if (/[0-9]/.test(pw)) s++;
    if (/[^A-Za-z0-9]/.test(pw)) s++;
    const map = [
      { label: "Too short",  cls: "weak"   },
      { label: "Weak",       cls: "weak"   },
      { label: "Fair",       cls: "fair"   },
      { label: "Good",       cls: "good"   },
      { label: "Strong",     cls: "strong" },
      { label: "Very strong",cls: "strong" },
    ];
    return { score: s, ...map[Math.min(s, 5)] };
  }

  function updateStrengthMeter() {
    const pw    = document.getElementById("new-password")?.value || "";
    const fill  = document.getElementById("pw-strength-fill");
    const label = document.getElementById("pw-strength-label");
    if (!fill || !label) return;
    const r = scorePassword(pw);
    const pct = (r.score / 5) * 100;
    fill.style.width = pct + "%";
    fill.className = "pw-strength-fill pw-strength-" + (r.cls || "weak");
    label.textContent = r.label;
  }

  function updateConfirmHint() {
    const pw = document.getElementById("new-password")?.value || "";
    const c  = document.getElementById("confirm-password")?.value || "";
    const hint = document.getElementById("confirm-hint");
    if (!hint) return;
    if (!c) { hint.textContent = "Re-type your new password to confirm."; hint.className = "hint-text"; return; }
    if (pw === c) { hint.textContent = "✓ Passwords match."; hint.className = "hint-text hint-ok"; }
    else          { hint.textContent = "Passwords don't match yet.";  hint.className = "hint-text hint-warn"; }
  }

  // ── SUBMIT HANDLER ────────────────────────────────────────
  async function handleSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById("change-password-submit");
    const cur = document.getElementById("current-password")?.value || "";
    const nxt = document.getElementById("new-password")?.value     || "";
    const cnf = document.getElementById("confirm-password")?.value || "";

    const fail = (msg) => {
      setMessage(msg, "error");
      if (btn) { btn.disabled = false; btn.textContent = "Update Password"; }
    };

    if (!cur || !nxt || !cnf) return fail("Please fill in all three fields.");
    if (nxt.length < 6)       return fail("New password must be at least 6 characters.");
    if (nxt !== cnf)          return fail("New password and confirmation don't match.");
    if (nxt === cur)          return fail("Your new password must be different from your current one.");

    if (btn) { btn.disabled = true; btn.textContent = "Updating…"; }
    setMessage("");

    const res = await window.API.changePassword(cur, nxt, cnf);
    if (!res.ok) return fail(res.error || "Could not update password. Please try again.");

    setMessage("✓ Password updated successfully. Use your new password from now on.", "success");
    document.getElementById("change-password-form")?.reset();
    updateStrengthMeter();
    updateConfirmHint();
    if (btn) { btn.disabled = false; btn.textContent = "Update Password"; }
  }

  // ── PASSWORD TOGGLES ──────────────────────────────────────
  function wireToggles() {
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
  }

  // ── INIT ──────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", async () => {
    if (!document.body || document.body.dataset.page !== "account") return;
    if (window.API && window.API.bootstrap) await window.API.bootstrap();
    const user = window.IMS.requireAuth("account");
    if (!user) return;
    window.IMS.initLayout("account", "Account Settings");

    renderProfile(user);

    document.getElementById("change-password-form")?.addEventListener("submit", handleSubmit);
    document.getElementById("new-password")?.addEventListener("input", () => { updateStrengthMeter(); updateConfirmHint(); });
    document.getElementById("confirm-password")?.addEventListener("input", updateConfirmHint);
    wireToggles();
    updateStrengthMeter();
  });
})();
