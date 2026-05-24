/* ============================================================
   Platonian's IS — v10.9 Enhancements
   Loaded AFTER v10.7.js. Adds:

     1. Quick Actions topbar trigger — promotes every
        [data-management-control="true"] button into a single
        popover so the topbar title row stays aligned with
        the page title (fixes the Reports DL-button overflow).

     2. Monthly Transaction Activity range filter — wires up
        the existing #dashboard-month-filter <select> with
        Daily / Weekly / Monthly / Quarterly / Yearly options
        and rebuilds the chart on change.

     3. Force-password-change gate — after login, if the
        server flagged must_change_password, redirect to
        account.html?force=1. On account.html with ?force=1,
        a banner appears and the rest of the nav is locked
        until the password change succeeds.
   ============================================================ */
(function () {
  "use strict";

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* =====================================================
     1. QUICK ACTIONS — TOPBAR TRIGGER + POPOVER
     ===================================================== */

  function qaIconFor(label) {
    var key = String(label || "").toLowerCase();
    if (key.indexOf("master") >= 0) {
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
    }
    if (key.indexOf("analytics") >= 0 || key.indexOf("summary") >= 0) {
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-5"/></svg>';
    }
    if (key.indexOf("all csv") >= 0 || key.indexOf("export") >= 0) {
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    }
    if (key.indexOf("backup") >= 0) {
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></svg>';
    }
    if (key.indexOf("restore") >= 0) {
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="9"/></svg>';
  }

  function qaLabelFor(el) {
    var t = (el.textContent || "").replace(/\s+/g, " ").trim();
    t = t.replace(/^[\u2300-\u27FF\u2900-\u29FF\u2B00-\u2BFF\u2190-\u21FF]\s*/, "");
    return t || (el.getAttribute("aria-label") || "Action");
  }

  function buildQuickActionsTrigger() {
    var topRight = $(".topbar .topbar-right") || $(".topbar-right");
    if (!topRight) return;

    // Collect the topbar's management-control buttons. These are still
    // in the DOM (the v10.9 CSS hides them visually); we forward clicks
    // to the originals so no existing handlers need to change.
    var originals = $$('[data-management-control="true"]', topRight);

    // Always remove a prior trigger so re-renders don't stack them.
    var prev = $("#qa-trigger-wrapper", topRight);
    if (prev) prev.remove();

    if (!originals.length) return;

    var wrapper = document.createElement("div");
    wrapper.id = "qa-trigger-wrapper";
    wrapper.className = "qa-wrapper";

    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = "qa-trigger-btn";
    btn.className = "qa-trigger";
    btn.setAttribute("aria-haspopup", "menu");
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>' +
      '<span>Quick Actions</span>' +
      '<span class="qa-trigger-count">' + originals.length + '</span>';

    var pop = document.createElement("div");
    pop.id = "qa-popover";
    pop.className = "qa-popover";
    pop.setAttribute("role", "menu");

    var title = document.createElement("div");
    title.className = "qa-popover-title";
    title.textContent = "Page Actions";
    pop.appendChild(title);

    originals.forEach(function (orig) {
      var label = qaLabelFor(orig);
      var item = document.createElement("button");
      item.type = "button";
      item.className = "qa-item";
      item.setAttribute("role", "menuitem");
      item.innerHTML = qaIconFor(label) + '<span>' + label + '</span>';
      item.addEventListener("click", function (e) {
        e.preventDefault();
        closePopover();
        // Forward to the original. <label>-wrapped file inputs need
        // the inner <input> clicked, not the label, to open reliably
        // across browsers.
        setTimeout(function () {
          if (orig.tagName === "LABEL") {
            var fi = orig.querySelector('input[type="file"]');
            if (fi) { fi.click(); } else { orig.click(); }
          } else {
            orig.click();
          }
        }, 120);
      });
      pop.appendChild(item);
    });

    wrapper.appendChild(btn);
    wrapper.appendChild(pop);

    // Insert the trigger BEFORE the theme-toggle so it sits to the
    // left of the icon cluster (theme / notifs / avatar).
    var themeToggle = topRight.querySelector(".theme-toggle");
    if (themeToggle) {
      topRight.insertBefore(wrapper, themeToggle);
    } else {
      topRight.appendChild(wrapper);
    }

    function openPopover() {
      pop.classList.add("open");
      btn.setAttribute("aria-expanded", "true");
      document.addEventListener("click", onDocClick, true);
      document.addEventListener("keydown", onKey, true);
    }
    function closePopover() {
      pop.classList.remove("open");
      btn.setAttribute("aria-expanded", "false");
      document.removeEventListener("click", onDocClick, true);
      document.removeEventListener("keydown", onKey, true);
    }
    function onDocClick(e) {
      if (!wrapper.contains(e.target)) closePopover();
    }
    function onKey(e) {
      if (e.key === "Escape") closePopover();
    }

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (pop.classList.contains("open")) {
        closePopover();
      } else {
        openPopover();
      }
    });
  }

  function initQuickActions() {
    // Wait for layout to settle so the topbar buttons exist.
    setTimeout(buildQuickActionsTrigger, 50);

    // Re-build if app.js re-renders the topbar (rare, but cheap to handle).
    var topbar = $(".topbar");
    if (topbar && "MutationObserver" in window) {
      var obs = new MutationObserver(function () {
        if (!document.getElementById("qa-trigger-wrapper")) {
          buildQuickActionsTrigger();
        }
      });
      obs.observe(topbar, { childList: true, subtree: true });
    }
  }


  /* =====================================================
     2. MONTHLY TRANSACTION ACTIVITY — RANGE FILTER
     ===================================================== */

  // Expose a shared helper so the chart re-render can be driven
  // by the select. The select is non-functional in v10.8 — its
  // only <option> is "All Months" and there's no change handler.
  // We populate the options and wire the handler here, leaving
  // app.js alone (it still draws the default chart on load).
  function populateMonthFilter() {
    var sel = document.getElementById("dashboard-month-filter");
    if (!sel) return;

    // Already populated by a prior init? Skip.
    if (sel.dataset.v109 === "1") return;
    sel.dataset.v109 = "1";

    sel.innerHTML =
      '<option value="monthly_8">Monthly (Last 8)</option>' +
      '<option value="monthly_12">Monthly (Last 12)</option>' +
      '<option value="daily_30">Daily (Last 30 days)</option>' +
      '<option value="weekly_12">Weekly (Last 12 weeks)</option>' +
      '<option value="quarterly_8">Quarterly (Last 8)</option>' +
      '<option value="yearly_5">Yearly (Last 5)</option>';

    sel.addEventListener("change", function () {
      rerenderActivityChart(sel.value);
    });
  }

  // Build a labels + checkOut + returned series for any of the
  // ranges above by inspecting the transactions cache that app.js
  // exposes via window.IMS or the global getTransactionsForDashboard
  // fallback. We don't reach into app.js's private scope — we read
  // from window.API.* which is the public surface.
  function getTxnsForChart() {
    // Prefer the dashboard cache that app.js seeds on render.
    try {
      if (window.IMS && typeof window.IMS.getDashboardTransactions === "function") {
        return window.IMS.getDashboardTransactions() || [];
      }
    } catch (e) {}
    // Fallback: read from sessionStorage like the legacy UI does.
    try {
      var raw = sessionStorage.getItem("ims_cache_transactions");
      if (raw) return JSON.parse(raw) || [];
    } catch (e) {}
    return [];
  }

  function rangeBuckets(mode) {
    var now = new Date();
    var labels = [], keys = [], keyFn;

    function pad2(n) { return n < 10 ? "0" + n : "" + n; }
    function isoDay(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
    function startOfWeek(d) {
      var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      var dow = x.getDay(); // 0=Sun
      x.setDate(x.getDate() - dow);
      return x;
    }
    function weekKey(d) { var s = startOfWeek(d); return isoDay(s); }
    function monthKey(d) { return d.getFullYear() + "-" + d.getMonth(); }
    function quarterKey(d) { return d.getFullYear() + "-Q" + (Math.floor(d.getMonth() / 3) + 1); }
    function yearKey(d) { return "" + d.getFullYear(); }

    if (mode === "daily_30") {
      keyFn = isoDay;
      for (var i = 29; i >= 0; i--) {
        var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        keys.push(isoDay(d));
        labels.push(d.toLocaleDateString(undefined, { month: "short", day: "numeric" }));
      }
    } else if (mode === "weekly_12") {
      keyFn = weekKey;
      var anchor = startOfWeek(now);
      for (var j = 11; j >= 0; j--) {
        var w = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - j * 7);
        keys.push(weekKey(w));
        labels.push("Wk of " + w.toLocaleDateString(undefined, { month: "short", day: "numeric" }));
      }
    } else if (mode === "quarterly_8") {
      keyFn = quarterKey;
      var curQ = Math.floor(now.getMonth() / 3);
      for (var k = 7; k >= 0; k--) {
        var qIndex = curQ - k;
        var year = now.getFullYear();
        while (qIndex < 0) { qIndex += 4; year -= 1; }
        keys.push(year + "-Q" + (qIndex + 1));
        labels.push("Q" + (qIndex + 1) + " " + year);
      }
    } else if (mode === "yearly_5") {
      keyFn = yearKey;
      for (var y = 4; y >= 0; y--) {
        var yr = now.getFullYear() - y;
        keys.push("" + yr);
        labels.push("" + yr);
      }
    } else {
      // monthly_8 (default) or monthly_12
      var n = (mode === "monthly_12") ? 12 : 8;
      keyFn = monthKey;
      var first = new Date(now.getFullYear(), now.getMonth(), 1);
      for (var m = n - 1; m >= 0; m--) {
        var p = new Date(first.getFullYear(), first.getMonth() - m, 1);
        keys.push(monthKey(p));
        labels.push(p.toLocaleDateString(undefined, { month: "short" }) +
          ((mode === "monthly_12") ? " " + ("" + p.getFullYear()).slice(2) : ""));
      }
    }

    return { labels: labels, keys: keys, keyFn: keyFn };
  }

  function activityFor(mode) {
    var b = rangeBuckets(mode);
    var lookup = new Map();
    b.keys.forEach(function (k, idx) { lookup.set(k, idx); });

    var checkOut = new Array(b.keys.length).fill(0);
    var returned = new Array(b.keys.length).fill(0);
    var txns = getTxnsForChart();

    txns.forEach(function (t) {
      if (t.borrowDate) {
        var d = new Date(t.borrowDate);
        if (!isNaN(d.getTime())) {
          var idx = lookup.get(b.keyFn(d));
          if (idx != null) checkOut[idx] += 1;
        }
      }
      var rs = t.actualReturnDate || t.returnDate;
      if (t.status === "Returned" && rs) {
        var r = new Date(rs);
        if (!isNaN(r.getTime())) {
          var ridx = lookup.get(b.keyFn(r));
          if (ridx != null) returned[ridx] += 1;
        }
      }
    });

    return { labels: b.labels, checkOut: checkOut, returned: returned };
  }

  function rerenderActivityChart(mode) {
    var canvas = document.getElementById("monthly-activity-chart");
    if (!canvas || typeof Chart === "undefined") return;

    // Destroy any existing chart bound to this canvas
    try {
      if (window.Chart && typeof Chart.getChart === "function") {
        var existing = Chart.getChart(canvas);
        if (existing) existing.destroy();
      }
    } catch (e) {}

    var data = activityFor(mode);
    var isDark = document.documentElement.classList.contains("dark");
    var gridColor = isDark ? "rgba(148, 163, 184, 0.18)" : "#e2e8f0";
    var tickColor = isDark ? "#cbd5e1" : "#64748b";

    new Chart(canvas, {
      type: "line",
      data: {
        labels: data.labels,
        datasets: [
          {
            label: "Check-Out",
            data: data.checkOut,
            borderColor: "#3b82f6",
            backgroundColor: "rgba(59,130,246,0.15)",
            pointBackgroundColor: "#3b82f6",
            pointBorderColor: "#3b82f6",
            pointRadius: 4,
            pointHoverRadius: 5,
            borderWidth: 3,
            tension: 0.38,
            fill: false,
          },
          {
            label: "Returned",
            data: data.returned,
            borderColor: "#8b5cf6",
            backgroundColor: "rgba(139,92,246,0.15)",
            pointBackgroundColor: "#8b5cf6",
            pointBorderColor: "#8b5cf6",
            pointRadius: 4,
            pointHoverRadius: 5,
            borderWidth: 3,
            tension: 0.38,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            ticks: { precision: 0, color: tickColor },
            grid: { color: gridColor },
          },
          x: {
            ticks: { color: tickColor, autoSkip: true, maxRotation: 0 },
            grid: { display: false },
          },
        },
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              boxWidth: 10,
              usePointStyle: true,
              pointStyle: "rect",
              color: tickColor,
            },
          },
        },
      },
    });
  }

  function initChartFilter() {
    if (document.body && document.body.dataset.page !== "dashboard") return;
    // Wait for app.js's initial render to finish so we don't fight it.
    setTimeout(populateMonthFilter, 100);
  }


  /* =====================================================
     3. FORCE-PASSWORD-CHANGE GATE
     ===================================================== */

  // After a successful login the API response may include
  // mustChangePassword:true. Stash it in sessionStorage so a
  // page reload (or a direct deep-link) still enforces it.
  function patchLoginResponse() {
    if (!window.API || typeof window.API.login !== "function") return;
    if (window.API.__v109_patched) return;
    var origLogin = window.API.login;
    window.API.login = async function (username, password) {
      var res = await origLogin.call(window.API, username, password);
      try {
        if (res && res.ok && (res.mustChangePassword === true || res.must_change_password === true)) {
          sessionStorage.setItem("ims_force_pw", "1");
        }
      } catch (e) {}
      return res;
    };
    window.API.__v109_patched = true;
  }

  // On the login page, after auth.js calls window.location.href = "dashboard.html",
  // intercept that redirect when the force flag is set.
  function gateLoginRedirect() {
    if (!document.body || document.body.dataset.page !== "login") return;
    // Re-route on the next tick after auth.js's submit handler runs.
    // We watch sessionStorage so the timing doesn't matter.
    var watcher = setInterval(function () {
      if (sessionStorage.getItem("ims_force_pw") === "1") {
        clearInterval(watcher);
        // Replace any pending dashboard.html navigation
        window.location.replace("account.html?force=1");
      }
    }, 60);
    // Stop watching after 8s either way
    setTimeout(function () { clearInterval(watcher); }, 8000);
  }

  // On any page other than account.html, redirect to account.html?force=1
  // if the flag is still set (e.g. user typed a direct URL).
  function enforceForceMode() {
    if (!document.body) return;
    var page = document.body.dataset.page;
    if (page === "login" || page === "account") return;
    if (sessionStorage.getItem("ims_force_pw") === "1") {
      window.location.replace("account.html?force=1");
    }
  }

  // On account.html?force=1: render the banner, lock the nav,
  // patch the change-password submit so it clears the flag on success.
  function setupAccountPageForceMode() {
    if (!document.body || document.body.dataset.page !== "account") return;

    var url = new URL(window.location.href);
    var isForce = url.searchParams.get("force") === "1" ||
                  sessionStorage.getItem("ims_force_pw") === "1";
    if (!isForce) return;

    sessionStorage.setItem("ims_force_pw", "1");
    document.body.classList.add("force-pw-mode");

    // Inject banner above the change-password form.
    var main = document.querySelector(".main-content") || document.body;
    if (main && !document.getElementById("force-pw-banner")) {
      var banner = document.createElement("div");
      banner.id = "force-pw-banner";
      banner.className = "force-pw-banner";
      banner.setAttribute("role", "alert");
      banner.innerHTML =
        '<div class="force-pw-banner-icon" aria-hidden="true">' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="10" x="5" y="11" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>' +
        '</div>' +
        '<div>' +
          '<strong>You must change your password before continuing.</strong>' +
          'You are signed in with a temporary password issued by the Administrator. ' +
          'For security, please set a new password below. The rest of the system is locked until you do.' +
        '</div>';
      main.insertBefore(banner, main.firstChild);
    }

    // Watch the change-password form. When the submit succeeds the
    // form is reset by account.js — we listen for that side-effect via
    // a periodic check of the status message OR patch the API method.
    if (window.API && typeof window.API.changePassword === "function" && !window.API.__v109_force_patched) {
      var origCP = window.API.changePassword;
      window.API.changePassword = async function (cur, nxt, cnf) {
        var res = await origCP.call(window.API, cur, nxt, cnf);
        if (res && res.ok) {
          sessionStorage.removeItem("ims_force_pw");
          document.body.classList.remove("force-pw-mode");
          var banner = document.getElementById("force-pw-banner");
          if (banner) banner.remove();
          // Hop to dashboard after a short pause so the user sees
          // the success message account.js writes.
          setTimeout(function () { window.location.href = "dashboard.html"; }, 1400);
        }
        return res;
      };
      window.API.__v109_force_patched = true;
    }
  }

  function initForceMode() {
    patchLoginResponse();
    gateLoginRedirect();
    enforceForceMode();
    setupAccountPageForceMode();
  }


  /* =====================================================
     INIT
     ===================================================== */
  function init() {
    initQuickActions();
    initChartFilter();
    initForceMode();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
