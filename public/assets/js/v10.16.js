// ============================================================
// Platonian's School Assets — v10.16 frontend patch
// ============================================================
// Loaded LAST, after every base + v10.x script. Additive only.
// Adds three features without touching base files:
//
//   1. Web Push — registers the service worker, asks permission,
//      subscribes the device, and exposes a toggle on the Account
//      page. Works on desktop + mobile (localhost is a secure
//      context, so it runs under XAMPP with no certificate).
//
//   2. Activity Log viewer — a filterable table of system events,
//      injected on reports.html for the Principal (admin) only.
//
//   3. System Maintenance panel — backup / restore / push test,
//      injected on policy.html for the ICT Coordinator (superadmin).
//
// All API calls reuse the same session + CSRF plumbing as api.js.
// ============================================================

(function () {
  "use strict";

  const API_BASE = "api";
  const csrf = () => (window.API && window.API.getCsrfToken && window.API.getCsrfToken()) || null;

  // ── small helpers ────────────────────────────────────────
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }
  function sessionUser() {
    return (window.API && window.API.getSessionUser && window.API.getSessionUser()) || null;
  }
  async function postJSON(endpoint, action, body) {
    const headers = { "Content-Type": "application/json" };
    const t = csrf();
    if (t) headers["X-CSRF-Token"] = t;
    try {
      const res = await fetch(`${API_BASE}/${endpoint}.php?action=${action}`, {
        method: "POST", headers, credentials: "same-origin",
        body: JSON.stringify(body || {}),
      });
      return await res.json();
    } catch (e) {
      return { ok: false, error: "Cannot reach the server." };
    }
  }
  async function getJSON(endpoint, action, qs) {
    try {
      const url = `${API_BASE}/${endpoint}.php?action=${action}${qs ? "&" + qs : ""}`;
      const res = await fetch(url, { credentials: "same-origin" });
      return await res.json();
    } catch (e) {
      return { ok: false, error: "Cannot reach the server." };
    }
  }

  function relativeTime(iso) {
    if (!iso) return "";
    const then = new Date(iso.replace(" ", "T"));
    if (isNaN(then.getTime())) return esc(iso);
    const diff = (Date.now() - then.getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return Math.floor(diff / 60) + "m ago";
    if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
    if (diff < 604800) return Math.floor(diff / 86400) + "d ago";
    return then.toLocaleDateString();
  }

  // =========================================================
  // 1. WEB PUSH
  // =========================================================
  const Push = {
    supported() {
      return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    },

    urlB64ToUint8Array(base64String) {
      const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
      const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
      const raw = atob(base64);
      const out = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
      return out;
    },

    async registerSW() {
      if (!("serviceWorker" in navigator)) return null;
      try {
        // Scope is the directory the SW sits in (public/). Register with
        // a relative path so it works under /platonians_school_assets/public/.
        return await navigator.serviceWorker.register("sw.js");
      } catch (e) {
        console.warn("[push] SW register failed:", e);
        return null;
      }
    },

    async currentSubscription() {
      const reg = await navigator.serviceWorker.ready;
      return reg.pushManager.getSubscription();
    },

    // Subscribe this device + send the subscription to the server.
    async enable() {
      if (!this.supported()) {
        return { ok: false, error: "This browser does not support push notifications." };
      }
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        return { ok: false, error: "Notification permission was denied. Enable it in your browser settings." };
      }
      const reg = await this.registerSW();
      if (!reg) return { ok: false, error: "Could not register the notification worker." };
      await navigator.serviceWorker.ready;

      const keyRes = await getJSON("push", "public_key");
      if (!keyRes || !keyRes.ok || !keyRes.publicKey) {
        return { ok: false, error: keyRes.error || "Server push keys unavailable." };
      }

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: this.urlB64ToUint8Array(keyRes.publicKey),
        });
      }

      const saveRes = await postJSON("push", "subscribe", { subscription: sub.toJSON() });
      return saveRes && saveRes.ok
        ? { ok: true }
        : { ok: false, error: (saveRes && saveRes.error) || "Could not save subscription." };
    },

    async disable() {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await postJSON("push", "unsubscribe", { endpoint: sub.endpoint });
          await sub.unsubscribe();
        }
        return { ok: true };
      } catch (e) {
        return { ok: false, error: "Could not disable notifications." };
      }
    },

    async sendTest() {
      return postJSON("push", "test", {});
    },
  };

  // Quietly register the SW on every page load so existing
  // subscriptions keep receiving pushes even before any toggle.
  function bootPush() {
    if (!Push.supported()) return;
    if (Notification.permission === "granted") {
      // Already granted: ensure the SW is alive and the sub is fresh.
      Push.enable().catch(() => {});
    } else {
      // Not yet granted: just register the worker so it's ready when
      // the user flips the toggle. No prompt here (would be intrusive).
      Push.registerSW().catch(() => {});
    }
  }

  // ── Account-page toggle ──────────────────────────────────
  function injectPushToggle() {
    const onAccount = /account\.html$/.test(location.pathname) || document.getElementById("account-page");
    const anchor = document.querySelector(".account-card, .card, main .section, main");
    if (!anchor || document.getElementById("push-toggle-card")) return;
    if (!/account\.html$/.test(location.pathname)) return;

    const card = document.createElement("div");
    card.id = "push-toggle-card";
    card.className = "card push-card";
    card.innerHTML = `
      <div class="section-label">Device Notifications</div>
      <p class="push-card-desc">
        Get borrow requests, approvals, low-stock and overdue alerts pushed
        straight to this device, even when this tab is in the background.
      </p>
      <div class="push-toggle-row">
        <button id="push-enable-btn" type="button" class="btn btn-primary btn-sm">Enable on this device</button>
        <button id="push-test-btn" type="button" class="btn btn-secondary btn-sm" style="display:none;">Send test</button>
        <span id="push-status" class="push-status"></span>
      </div>
      <p class="push-hint" id="push-hint"></p>
    `;
    anchor.appendChild(card);

    const enableBtn = card.querySelector("#push-enable-btn");
    const testBtn   = card.querySelector("#push-test-btn");
    const statusEl  = card.querySelector("#push-status");
    const hintEl    = card.querySelector("#push-hint");

    async function refresh() {
      if (!Push.supported()) {
        enableBtn.disabled = true;
        statusEl.textContent = "Not supported on this browser";
        statusEl.className = "push-status off";
        return;
      }
      const perm = Notification.permission;
      const sub = await Push.currentSubscription().catch(() => null);
      if (perm === "granted" && sub) {
        statusEl.textContent = "● On";
        statusEl.className = "push-status on";
        enableBtn.textContent = "Turn off";
        enableBtn.dataset.state = "on";
        testBtn.style.display = "";
        hintEl.textContent = "";
      } else if (perm === "denied") {
        statusEl.textContent = "● Blocked";
        statusEl.className = "push-status off";
        enableBtn.disabled = true;
        hintEl.textContent = "Notifications are blocked in your browser settings for this site. Re-enable them there, then reload.";
      } else {
        statusEl.textContent = "● Off";
        statusEl.className = "push-status off";
        enableBtn.textContent = "Enable on this device";
        enableBtn.dataset.state = "off";
        testBtn.style.display = "none";
        hintEl.textContent = "";
      }
    }

    enableBtn.addEventListener("click", async () => {
      enableBtn.disabled = true;
      const turningOn = enableBtn.dataset.state !== "on";
      const res = turningOn ? await Push.enable() : await Push.disable();
      enableBtn.disabled = false;
      if (!res.ok) {
        statusEl.textContent = "● Error";
        statusEl.className = "push-status off";
        hintEl.textContent = res.error || "Something went wrong.";
      }
      await refresh();
    });

    testBtn.addEventListener("click", async () => {
      testBtn.disabled = true;
      testBtn.textContent = "Sending…";
      const res = await Push.sendTest();
      testBtn.textContent = res && res.ok ? "Sent ✓" : "Failed";
      setTimeout(() => { testBtn.textContent = "Send test"; testBtn.disabled = false; }, 2500);
    });

    refresh();
  }

  // =========================================================
  // 2. ACTIVITY LOG VIEWER (Principal / admin)
  // =========================================================
  const ACTION_LABELS = {
    login: "Sign in",
    asset_added: "Asset added",
    asset_updated: "Asset updated",
    asset_removed: "Asset removed",
    condition_updated: "Condition updated",
    room_audit: "Room audit",
    request_approved: "Request approved",
    request_rejected: "Request rejected",
    item_returned: "Item returned",
    policy_updated: "Policy updated",
    password_reset: "Password reset",
    user_created: "User created",
    user_updated: "User updated",
    user_deleted: "User deleted",
  };
  const ACTION_TONE = {
    request_approved: "ok", item_returned: "ok", asset_added: "ok", user_created: "ok",
    request_rejected: "warn", asset_removed: "warn", user_deleted: "warn", password_reset: "warn",
    login: "muted",
  };

  function injectActivityLog() {
    const user = sessionUser();
    if (!user || user.role !== "admin") return;          // Principal-only
    if (!/reports\.html$/.test(location.pathname)) return;
    if (document.getElementById("activity-log-card")) return;

    const host = document.querySelector("main .content, main") || document.querySelector("main");
    if (!host) return;

    const card = document.createElement("section");
    card.id = "activity-log-card";
    card.className = "card activity-card";
    card.innerHTML = `
      <div class="activity-head">
        <div>
          <div class="section-label">Activity Log</div>
          <p class="activity-sub">Every action across the system — who did what, and when.</p>
        </div>
        <div class="activity-controls">
          <input id="activity-search" class="activity-input" type="search" placeholder="Search name, item, detail…">
          <select id="activity-filter" class="activity-input">
            <option value="all">All actions</option>
            <option value="login">Sign ins</option>
            <option value="request_approved">Approvals</option>
            <option value="request_rejected">Rejections</option>
            <option value="asset_added">Asset added</option>
            <option value="asset_removed">Asset removed</option>
            <option value="condition_updated">Condition updates</option>
            <option value="room_audit">Room audits</option>
            <option value="item_returned">Returns</option>
            <option value="password_reset">Password resets</option>
            <option value="policy_updated">Policy updates</option>
            <option value="user_created">User created</option>
            <option value="user_updated">User updated</option>
            <option value="user_deleted">User deleted</option>
          </select>
          <button id="activity-refresh" class="btn btn-secondary btn-sm" type="button">Refresh</button>
        </div>
      </div>
      <div class="activity-table-wrap">
        <table class="activity-table">
          <thead>
            <tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Details</th></tr>
          </thead>
          <tbody id="activity-tbody">
            <tr><td colspan="5" class="activity-empty">Loading…</td></tr>
          </tbody>
        </table>
      </div>
      <div class="activity-foot" id="activity-foot"></div>
    `;
    host.appendChild(card);

    const tbody    = card.querySelector("#activity-tbody");
    const searchEl = card.querySelector("#activity-search");
    const filterEl = card.querySelector("#activity-filter");
    const footEl   = card.querySelector("#activity-foot");

    async function load() {
      tbody.innerHTML = `<tr><td colspan="5" class="activity-empty">Loading…</td></tr>`;
      const qs = `limit=300&action_filter=${encodeURIComponent(filterEl.value)}&q=${encodeURIComponent(searchEl.value.trim())}`;
      const res = await getJSON("activity_log", "list", qs);
      if (!res || !res.ok) {
        tbody.innerHTML = `<tr><td colspan="5" class="activity-empty">${esc((res && res.error) || "Could not load the activity log.")}</td></tr>`;
        footEl.textContent = "";
        return;
      }
      if (!res.logs.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="activity-empty">No activity matches your filters yet.</td></tr>`;
        footEl.textContent = `0 of ${res.total} total events`;
        return;
      }
      tbody.innerHTML = res.logs.map((l) => {
        const label = ACTION_LABELS[l.action] || l.action;
        const tone  = ACTION_TONE[l.action] || "info";
        const roleL = (window.IMS && window.IMS.roleLabel) ? window.IMS.roleLabel(l.actorRole) : l.actorRole;
        return `<tr>
          <td class="act-when" title="${esc(l.createdAt)}">${esc(relativeTime(l.createdAt))}</td>
          <td class="act-who"><span class="act-name">${esc(l.actorName || l.actorEmail)}</span><span class="act-role">${esc(roleL)}</span></td>
          <td><span class="act-badge ${tone}">${esc(label)}</span></td>
          <td class="act-target">${esc(l.target) || "—"}</td>
          <td class="act-details">${esc(l.details) || "—"}</td>
        </tr>`;
      }).join("");
      footEl.textContent = `Showing ${res.logs.length} of ${res.total} total events`;
    }

    let searchTimer = null;
    searchEl.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(load, 250);
    });
    filterEl.addEventListener("change", load);
    card.querySelector("#activity-refresh").addEventListener("click", load);

    load();
  }

  // =========================================================
  // 3. SYSTEM MAINTENANCE PANEL (ICT / superadmin)
  // =========================================================
  function injectMaintenancePanel() {
    const user = sessionUser();
    if (!user || user.role !== "superadmin") return;
    if (!/policy\.html$/.test(location.pathname)) return;
    if (document.getElementById("maintenance-card")) return;

    const host = document.querySelector("main .content, main") || document.querySelector("main");
    if (!host) return;

    const card = document.createElement("section");
    card.id = "maintenance-card";
    card.className = "card maintenance-card";
    card.innerHTML = `
      <div class="section-label">System Maintenance</div>
      <p class="maint-sub">Technical controls for the ICT Coordinator: data backup, restore, and notification checks.</p>
      <div class="maint-grid">
        <div class="maint-tile">
          <h4>Backup database</h4>
          <p>Download a full JSON snapshot of all assets, transactions, users, and logs.</p>
          <button id="maint-backup-btn" class="btn btn-primary btn-sm" type="button">⬇ Download backup</button>
        </div>
        <div class="maint-tile">
          <h4>Restore database</h4>
          <p>Overwrite all current data from a backup file. This cannot be undone.</p>
          <label class="btn btn-danger btn-sm" for="maint-restore-input" style="cursor:pointer;">⬆ Restore from file</label>
          <input id="maint-restore-input" type="file" accept="application/json,.json" style="display:none;">
        </div>
        <div class="maint-tile">
          <h4>Push notifications</h4>
          <p>Send a test push to your own devices to confirm delivery works.</p>
          <button id="maint-push-test" class="btn btn-secondary btn-sm" type="button">Send test push</button>
        </div>
      </div>
      <p class="maint-msg" id="maint-msg"></p>
    `;
    host.appendChild(card);

    const msg = card.querySelector("#maint-msg");
    const setMsg = (t, cls) => { msg.textContent = t; msg.className = "maint-msg " + (cls || ""); };

    // Backup — reuse the existing API helper if present, else direct.
    card.querySelector("#maint-backup-btn").addEventListener("click", async () => {
      try {
        if (window.API && window.API.exportBackup) {
          await window.API.exportBackup();
          setMsg("Backup downloaded.", "ok");
        } else {
          setMsg("Backup helper unavailable on this page.", "err");
        }
      } catch (e) {
        setMsg("Backup failed.", "err");
      }
    });

    // Restore
    card.querySelector("#maint-restore-input").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const ok = confirm(`Restore from "${file.name}"?\n\nThis OVERWRITES all current data. Make sure you have a current backup first.`);
      if (!ok) { e.target.value = ""; return; }
      setMsg("Restoring…", "");
      try {
        const json = await file.text();
        const res = (window.API && window.API.restoreBackup)
          ? await window.API.restoreBackup(json)
          : await postJSON("backup", "restore", JSON.parse(json));
        if (!res || !res.ok) { setMsg("Restore failed: " + ((res && res.error) || "unknown error"), "err"); return; }
        setMsg("Database restored. Reloading…", "ok");
        setTimeout(() => window.location.reload(), 1200);
      } catch (err) {
        setMsg("Restore failed: invalid file.", "err");
      }
      e.target.value = "";
    });

    // Push test
    card.querySelector("#maint-push-test").addEventListener("click", async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true; btn.textContent = "Sending…";
      const res = await Push.sendTest();
      btn.textContent = res && res.ok ? "Sent ✓" : "Failed";
      if (res && res.ok) setMsg("Test push dispatched to your subscribed devices.", "ok");
      else setMsg("No subscribed device found. Enable notifications on this device first (Account → Device Notifications).", "err");
      setTimeout(() => { btn.textContent = "Send test push"; btn.disabled = false; }, 2500);
    });
  }

  // =========================================================
  // BOOT
  // =========================================================
  function boot() {
    bootPush();
    injectPushToggle();
    injectActivityLog();
    injectMaintenancePanel();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // Expose for debugging / other scripts.
  window.PlatoniansPush = Push;
})();
