// ============================================================
// Platonian's IS — Transactions Module (MySQL/API version)
// ============================================================
(() => {
  "use strict";

  let _txnSubmitting = false;

  const DEFAULT_CONDITION = "Good";

  function setMsg(id, msg, type = "info") {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg || "";
    el.className = `status-message ${type}-message ${msg ? "show" : ""}`;
  }

  function isOverdue(t) {
    return t.status === "Borrowed" && t.returnDate && t.returnDate < window.IMS.todayISO();
  }

  function qty(v) { return Math.max(1, Math.floor(Number(v) || 1)); }

  // Proper plural: 1 box, 2 boxes | 1 rim, 2 rims | 1 piece, 2 pieces
  function plural(n, unit) {
    const u = String(unit || 'piece');
    if (n === 1) return u;
    // irregular plurals
    const irreg = { box:'boxes', piece:'pieces', bunch:'bunches', brush:'brushes' };
    if (irreg[u]) return irreg[u];
    return u + 's';
  }

  function qtyWithUnit(q, unit) {
    const u = unit || "piece";
    return `${q} ${q === 1 ? u : u + "s"}`;
  }

  // ── NAME AUTOCOMPLETE ─────────────────────────────────────
  function wireNameAutocomplete(inputId, hiddenEmailId) {
    const inp = document.getElementById(inputId);
    if (!inp) return;
    let box = document.getElementById(inputId + "-suggest");
    if (!box) {
      box = document.createElement("div");
      box.id = inputId + "-suggest";
      box.className = "suggest-box";
      inp.parentNode.style.position = "relative";
      inp.parentNode.appendChild(box);
    }
    let timer;
    inp.addEventListener("input", () => {
      clearTimeout(timer);
      const q = inp.value.trim();
      if (q.length < 1) { box.style.display = "none"; return; }
      timer = setTimeout(async () => {
        const sugs = await window.API.userSuggest(q);
        if (!sugs.length) { box.style.display = "none"; return; }
        box.innerHTML = sugs.map(s =>
          `<div class="suggest-item" data-name="${window.IMS.escapeHtml(s.name)}" data-email="${window.IMS.escapeHtml(s.email)}">
             <span class="suggest-name">${window.IMS.escapeHtml(s.name)}</span>
             <span class="suggest-meta">${window.IMS.escapeHtml(s.role)} · ${window.IMS.escapeHtml(s.email)}</span>
           </div>`
        ).join("");
        box.style.display = "block";
        box.querySelectorAll(".suggest-item").forEach(item => {
          item.addEventListener("click", () => {
            inp.value = item.getAttribute("data-name");
            const hiddenEl = document.getElementById(hiddenEmailId);
            if (hiddenEl) hiddenEl.value = item.getAttribute("data-email");
            box.style.display = "none";
          });
        });
      }, 220);
    });
    document.addEventListener("click", e => {
      if (!inp.contains(e.target) && !box.contains(e.target)) box.style.display = "none";
    });
  }

  // ── POPULATE SELECTS ──────────────────────────────────────
  async function populateAssetSelect(selectId, qtyInputId) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const assets = await window.API.getAssets();
    const available = assets.filter(a => Number(a.quantity) > 0);
    if (!available.length) {
      sel.innerHTML = '<option value="">No assets available</option>';
    } else {
      sel.innerHTML = available.map(a => {
        const u = a.unit || "piece";
        const maxInfo = a.maxCheckoutQty > 0 ? ` · max ${a.maxCheckoutQty} ${plural(a.maxCheckoutQty, u)}` : "";
        return `<option value="${esc(a.id)}" data-max="${a.maxCheckoutQty||0}" data-unit="${esc(u)}">${esc(a.id)} — ${esc(a.name)} (${a.quantity} ${plural(a.quantity, u)} available${maxInfo})</option>`;
      }).join("");
    }
    if (qtyInputId) updateQtyInput(selectId, qtyInputId, assets);
  }

  function updateQtyInput(selectId, qtyInputId, assetsList) {
    const sel  = document.getElementById(selectId);
    const inp  = document.getElementById(qtyInputId);
    if (!sel || !inp || !assetsList) return;
    const asset = assetsList.find(a => a.id === sel.value);
    if (!asset) return;
    const avail = Math.max(1, Number(asset.quantity) || 0);
    const maxQty = asset.maxCheckoutQty > 0 ? Math.min(asset.maxCheckoutQty, avail) : avail;
    inp.max   = String(maxQty);
    inp.min   = "1";
    inp.step  = "1";
    inp.value = String(Math.min(qty(inp.value)||1, maxQty));
    inp.disabled = avail <= 0;
    // Show limit hint
    const hint = document.getElementById(qtyInputId + "-hint");
    if (hint) {
      const u = asset.unit || "piece";
      hint.textContent = asset.maxCheckoutQty > 0
        ? `Max ${asset.maxCheckoutQty} ${u}(s) per request. ${avail} ${u}(s) in stock.`
        : `${avail} ${u}(s) in stock.`;
    }
  }

  async function populateBorrowedTransactions(selectId, user, teacherOnly) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const txns = await window.API.getTransactions();
    const borrowed = txns.filter(t => {
      if (t.status !== "Borrowed") return false;
      if (!teacherOnly) return true;
      return t.role === "teacher" && String(t.borrower||"").toLowerCase() === String(user.name||"").toLowerCase();
    });
    if (!borrowed.length) {
      sel.innerHTML = '<option value="">No borrowed items</option>';
      return;
    }
    sel.innerHTML = borrowed.map(t => {
      const u = t.assetUnit || "piece";
      return `<option value="${esc(t.id)}">${esc(t.id)} — ${esc(t.assetName||t.assetId)} · ${qty(t.quantity)} ${u}(s) · ${esc(t.borrower)}</option>`;
    }).join("");
  }

  // ── TRANSACTION TABLE ROW ─────────────────────────────────
  function txnRow(t, showBorrower = true) {
    const status = isOverdue(t) ? "Overdue" : t.status;
    const q = qty(t.quantity);
    const u = t.assetUnit || "piece";
    const dateVal = t.status === "Returned" ? (t.actualReturnDate||t.returnDate) : t.returnDate;
    const third = showBorrower ? (t.borrower||"Unknown") : (t.assetName||t.assetId);
    return `<tr>
      <td class="mono-cell">${esc(t.id)}</td>
      <td class="mono-cell">${esc(t.assetId)}</td>
      <td>${esc(q)} <span class="unit-tag">${esc(plural(Number(t.quantity), u))}</span></td>
      <td>${esc(third)}</td>
      <td class="mono-cell">${esc(t.borrowDate||"—")}</td>
      <td class="mono-cell ${isOverdue(t)?"overdue-date":""}">${esc(dateVal||"—")}</td>
      <td>${window.IMS.createStatusBadge(status)}</td>
    </tr>`;
  }

  // ── TRANSACTIONS PAGE ─────────────────────────────────────
  async function renderTransactionCards(user) {
    const txns = await window.API.getTransactions();
    const visible = txns.filter(t => user.role !== "teacher" || (t.role==="teacher" && String(t.borrower||"").toLowerCase()===String(user.name||"").toLowerCase()));
    const borrowed = visible.filter(t => t.status === "Borrowed");
    const returned = visible.filter(t => t.status === "Returned");
    const overdue  = borrowed.filter(isOverdue);
    const setText = (id, v) => { const el=document.getElementById(id); if(el) el.textContent=String(v); };
    setText("txn-total-count",    visible.length);
    setText("txn-borrowed-count", borrowed.length);
    setText("txn-returned-count", returned.length);
    setText("txn-overdue-count",  overdue.length);
  }

  async function renderTransactionHistory(user) {
    const body   = document.getElementById("transaction-history-body");
    const filter = document.getElementById("txn-status-filter");
    if (!body) return;
    const txns = await window.API.getTransactions();
    const fv = filter ? filter.value : "All";
    let visible = txns.filter(t => user.role !== "teacher" || (t.role==="teacher" && String(t.borrower||"").toLowerCase()===String(user.name||"").toLowerCase()));
    if (fv !== "All") visible = visible.filter(t => (isOverdue(t) ? "Overdue" : t.status) === fv);
    body.innerHTML = visible.length ? visible.map(t => txnRow(t, true)).join("") : '<tr><td colspan="7">No transactions found.</td></tr>';
  }

  async function renderPendingRequests(user) {
    const body    = document.getElementById("pending-requests-body");
    const countEl = document.getElementById("pending-requests-count");
    if (!body) return;
    const requests = await window.API.getBorrowRequests();
    const pending  = requests.filter(r => r.status === "Pending");
    if (countEl) countEl.textContent = pending.length > 0 ? `${pending.length} pending request${pending.length>1?"s":""}` : "No pending requests";

    if (!requests.length) { body.innerHTML = '<tr><td colspan="9">No borrow requests yet.</td></tr>'; return; }

    const statusColors = { Pending:"#b45309", Approved:"#166534", Rejected:"#991b1b" };
    const statusBg     = { Pending:"#fef3c7", Approved:"#dcfce7", Rejected:"#fee2e2" };

    body.innerHTML = [...requests].reverse().map(r => {
      const color  = statusColors[r.status] || "#334155";
      const bg     = statusBg[r.status] || "#e2e8f0";
      const badge  = `<span style="background:${bg};color:${color};padding:2px 10px;border-radius:999px;font-size:12px;font-weight:500;">${esc(r.status)}</span>`;
      const u      = r.assetUnit || "piece";
      const actions = r.status === "Pending"
        ? `<button class="btn btn-primary btn-sm" data-action="approve" data-reqid="${esc(r.requestId)}" type="button">Approve</button>
           <button class="btn btn-danger btn-sm"  data-action="reject"  data-reqid="${esc(r.requestId)}" type="button">Reject</button>`
        : `<span style="font-size:12px;color:#6b7280;">${r.status==="Approved"?"Released":"Declined"}</span>`;
      return `<tr>
        <td class="mono-cell">${esc(r.requestId)}</td>
        <td>${esc(r.assetName||r.assetId)}</td>
        <td>${esc(r.borrower)}</td>
        <td>${esc(qty(r.quantity))} <span class="unit-tag">${esc(plural(Number(r.quantity), u))}</span></td>
        <td class="mono-cell">${esc(r.borrowDate||"—")}</td>
        <td class="mono-cell">${esc(r.returnDate||"—")}</td>
        <td>${badge}</td>
        <td>${r.status==="Rejected"&&r.rejectionReason ? esc(r.rejectionReason) : "—"}</td>
        <td class="action-cell">${actions}</td>
      </tr>`;
    }).join("");

    body.onclick = async (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const action = btn.getAttribute("data-action");
      const reqId  = btn.getAttribute("data-reqid");

      if (action === "approve") {
        btn.disabled = true; btn.textContent = "Approving…";
        const res = await window.API.approveRequest(reqId);
        if (!res.ok) {
          setMsg("pending-requests-message", `Cannot approve: ${res.error}`, "error");
          btn.disabled = false; btn.textContent = "Approve";
          return;
        }
        setMsg("pending-requests-message", `Request ${reqId} approved. Transaction ${res.transactionId} created.`, "success");
        await refreshTransactionsPage(user);
      } else if (action === "reject") {
        const reason = window.prompt("Enter rejection reason (optional):") || "";
        const res = await window.API.rejectRequest(reqId, reason);
        if (!res.ok) { setMsg("pending-requests-message", res.error || "Reject failed.", "error"); return; }
        setMsg("pending-requests-message", `Request ${reqId} rejected.`, "info");
        await renderPendingRequests(user);
      }
    };
  }

  async function refreshTransactionsPage(user) {
    const assets = await window.API.getAssets();
    await populateAssetSelect("checkout-asset-id", "checkout-quantity");
    await populateBorrowedTransactions("return-transaction-id", user, false);
    await renderTransactionCards(user);
    await renderTransactionHistory(user);
    if (user.role !== "teacher") await renderPendingRequests(user);
  }

  async function initTransactionsPage() {
    const user = window.IMS.requireAuth("transactions");
    if (!user) return;
    const title = user.role === "teacher" ? "View Borrowed Assets" : user.role === "admin" ? "Transaction Logs" : "Check In / Check Out";
    window.IMS.initLayout("transactions", title);

    if (user.role === "teacher") {
      const cs = document.getElementById("checkout-section");
      const rs = document.getElementById("return-section");
      if (cs) cs.hidden = true;
      if (rs) rs.hidden = true;
    }

    // Checkout form
    const checkoutForm = document.getElementById("checkout-form");
    if (checkoutForm && user.role !== "teacher") {
      const assets = await window.API.getAssets();
      await populateAssetSelect("checkout-asset-id", "checkout-quantity");
      const bdInp = document.getElementById("checkout-borrow-date");
      const rdInp = document.getElementById("checkout-return-date");
      const today = window.IMS.todayISO();
      if (bdInp) { bdInp.value = today; bdInp.min = today; }
      if (rdInp) { rdInp.value = today; rdInp.min = today; }
      // Keep return date min in sync with borrow date
      if (bdInp && rdInp) {
        bdInp.addEventListener("change", () => {
          rdInp.min = bdInp.value || today;
          if (rdInp.value < bdInp.value) rdInp.value = bdInp.value;
        });
      }
      document.getElementById("checkout-asset-id")?.addEventListener("change", async () => {
        const fresh = await window.API.getAssets();
        updateQtyInput("checkout-asset-id", "checkout-quantity", fresh);
      });

      // Borrower name autocomplete
      wireNameAutocomplete("checkout-borrower-name", "checkout-borrower-email-hidden");

      checkoutForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (_txnSubmitting) return; _txnSubmitting = true;
        const submitBtn = checkoutForm.querySelector("button[type='submit']");
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Processing…"; }
        const assetId    = document.getElementById("checkout-asset-id").value;
        const quantity   = parseInt(document.getElementById("checkout-quantity").value, 10) || 1;
        const borrower   = document.getElementById("checkout-borrower-name").value.trim();
        const borrowerEmailHidden = document.getElementById("checkout-borrower-email-hidden");
        const borrowerEmail = borrowerEmailHidden ? borrowerEmailHidden.value.trim() : "";
        const role       = document.getElementById("checkout-role").value;
        const borrowDate = document.getElementById("checkout-borrow-date").value;
        const returnDate = document.getElementById("checkout-return-date").value;
        const condition  = document.getElementById("checkout-condition").value || DEFAULT_CONDITION;

        // Client-side date validation
        if (borrowDate < today) {
          setMsg("transactions-message", "Borrow date cannot be in the past.", "error");
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Check Out"; }
          _txnSubmitting = false; return;
        }
        if (returnDate < today || returnDate < borrowDate) {
          setMsg("transactions-message", "Return date must be today or later and on/after the borrow date.", "error");
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Check Out"; }
          _txnSubmitting = false; return;
        }
        if (!assetId || !borrower || !borrowDate || !returnDate) {
          setMsg("transactions-message", "Please complete all check-out fields.", "error");
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Check Out"; }
          _txnSubmitting = false; return;
        }
        const res = await window.API.checkoutAsset({ assetId, quantity, borrower, borrowerEmail, role, borrowDate, returnDate, condition });
        if (!res.ok) {
          setMsg("transactions-message", res.error, "error");
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Check Out"; }
          _txnSubmitting = false; return;
        }
        checkoutForm.reset();
        if (bdInp) { bdInp.value = today; bdInp.min = today; }
        if (rdInp) { rdInp.value = today; rdInp.min = today; }
        setMsg("transactions-message", `Asset checked out. Transaction ${res.transactionId} created.`, "success");
        _txnSubmitting = false;
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Check Out"; }
        await refreshTransactionsPage(user);
      });
    }

    // Return form
    const returnForm = document.getElementById("return-form");
    if (returnForm && user.role !== "teacher") {
      await populateBorrowedTransactions("return-transaction-id", user, false);
      const retDateInp = document.getElementById("return-date");
      const todayStr   = window.IMS.todayISO();
      if (retDateInp) { retDateInp.value = todayStr; retDateInp.max = todayStr; }
      returnForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const submitBtn = returnForm.querySelector("button[type='submit']");
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Processing…"; }
        const txnId      = document.getElementById("return-transaction-id").value;
        const condition  = document.getElementById("return-condition").value || DEFAULT_CONDITION;
        const returnDate = document.getElementById("return-date").value;
        if (!txnId || !returnDate) {
          setMsg("transactions-message", "Please complete all return fields.", "error");
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Check In"; }
          return;
        }
        const res = await window.API.returnAsset(txnId, condition, returnDate);
        if (!res.ok) {
          setMsg("transactions-message", res.error, "error");
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Check In"; }
          return;
        }
        returnForm.reset();
        if (retDateInp) { retDateInp.value = todayStr; retDateInp.max = todayStr; }
        setMsg("transactions-message", `Transaction ${txnId} returned successfully.`, "success");
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Check In"; }
        await refreshTransactionsPage(user);
      });
    }

    const filterSel = document.getElementById("txn-status-filter");
    if (filterSel) filterSel.addEventListener("change", () => renderTransactionHistory(user));

    await refreshTransactionsPage(user);
  }

  // ── BORROW PAGE (Teacher) ─────────────────────────────────
  async function renderTeacherBorrowedTable(user, bodyId, borrowedOnly) {
    const body = document.getElementById(bodyId);
    if (!body) return;
    const txns = await window.API.getTransactions();
    const visible = txns.filter(t => {
      if (t.role !== "teacher") return false;
      if (borrowedOnly && t.status !== "Borrowed") return false;
      return String(t.borrower||"").toLowerCase() === String(user.name||"").toLowerCase();
    });
    body.innerHTML = visible.length ? visible.map(t => txnRow(t, false)).join("") : '<tr><td colspan="7">No records found.</td></tr>';
  }

  async function renderMyRequests(user) {
    const body = document.getElementById("my-requests-body");
    if (!body) return;
    const requests = await window.API.getBorrowRequests();
    const mine = requests.filter(r => String(r.borrower||"").toLowerCase() === String(user.name||"").toLowerCase());
    if (!mine.length) { body.innerHTML = '<tr><td colspan="8">No borrow requests yet.</td></tr>'; return; }
    const statusColors = { Pending:"#b45309", Approved:"#166534", Rejected:"#991b1b" };
    const statusBg     = { Pending:"#fef3c7", Approved:"#dcfce7", Rejected:"#fee2e2" };
    body.innerHTML = [...mine].reverse().map(r => {
      const color = statusColors[r.status]||"#334155";
      const bg    = statusBg[r.status]||"#e2e8f0";
      const badge = `<span style="background:${bg};color:${color};padding:2px 10px;border-radius:999px;font-size:12px;font-weight:500;">${esc(r.status)}</span>`;
      const u = r.assetUnit || "piece";
      return `<tr>
        <td class="mono-cell">${esc(r.requestId)}</td>
        <td>${esc(r.assetName||r.assetId)}</td>
        <td>${esc(qty(r.quantity))} <span class="unit-tag">${esc(plural(Number(r.quantity), u))}</span></td>
        <td class="mono-cell">${esc(r.borrowDate||"—")}</td>
        <td class="mono-cell">${esc(r.returnDate||"—")}</td>
        <td>${badge}</td>
        <td style="color:#6b7280;font-size:13px;">${r.status==="Rejected"&&r.rejectionReason?esc(r.rejectionReason):"—"}</td>
      </tr>`;
    }).join("");
  }

  async function refreshBorrowPage(user) {
    const assets = await window.API.getAssets();
    const available = assets.filter(a => Number(a.quantity) > 0);
    const sel = document.getElementById("borrow-asset-id");
    const submitBtn = document.querySelector("#borrow-form button[type='submit']");
    if (sel) {
      if (!available.length) {
        sel.innerHTML = '<option value="">No assets available for borrowing</option>';
        if (submitBtn) submitBtn.disabled = true;
      } else {
        sel.innerHTML = available.map(a => {
          const u = a.unit || "piece";
          const maxInfo = a.maxCheckoutQty > 0 ? ` · max ${a.maxCheckoutQty} ${plural(a.maxCheckoutQty, u)}` : "";
          return `<option value="${esc(a.id)}" data-max="${a.maxCheckoutQty||0}" data-avail="${a.quantity}" data-unit="${esc(u)}">${esc(a.name)} (${a.quantity} ${plural(a.quantity, u)} available${maxInfo})</option>`;
        }).join("");
        if (submitBtn) submitBtn.disabled = false;
        updateQtyInput("borrow-asset-id", "borrow-quantity", assets);
      }
    }
    await renderMyRequests(user);
    await renderTeacherBorrowedTable(user, "teacher-borrowed-body", false);
  }

  async function initBorrowPage() {
    const user = window.IMS.requireAuth("borrow");
    if (!user) return;
    window.IMS.initLayout("borrow", "Borrow Item");

    // Load and display lending policy banner
    try {
      const policy = await window.API.getLendingPolicy();
      const note     = policy.policy_note     ? policy.policy_note.value     : "";
      const lateNote = policy.late_fee_note   ? policy.late_fee_note.value   : "";
      const maxDays  = policy.max_borrow_days ? policy.max_borrow_days.value : "";
      const banner   = document.getElementById("lending-policy-banner");
      const txt      = document.getElementById("lending-policy-text");
      const late     = document.getElementById("lending-late-text");
      if (banner && (note || lateNote)) {
        if (txt) txt.textContent = note || "";
        if (late && lateNote) late.textContent = "⚠️ " + lateNote;
        banner.style.display = "block";
      }
    } catch { /* non-critical */ }

    // ── Accountability: check tier, disable form if suspended ─
    if (user.role === "teacher") {
      const tierData = (() => {
        try { return JSON.parse(sessionStorage.getItem("platonian_tier_warning") || "null"); }
        catch { return null; }
      })();
      if (tierData && tierData.tier >= 2) {
        const main  = document.querySelector("main") || document.querySelector(".main-content");
        const form  = document.getElementById("borrow-form");
        const color = tierData.tier >= 3 ? "#dc2626" : "#f97316";
        const icon  = tierData.tier >= 3 ? "🔒" : "🚫";
        // Show blocking banner
        const banner = document.createElement("div");
        banner.style.cssText = `background:#fff1f2;border-left:5px solid ${color};color:#7f1d1d;
          padding:1.1rem 1.25rem;border-radius:8px;margin-bottom:1.25rem;font-size:0.9rem;
          font-weight:600;display:flex;gap:0.6rem;align-items:flex-start;line-height:1.5;`;
        banner.innerHTML = `<span style="font-size:1.4rem;flex-shrink:0;">${icon}</span>
          <div><div>${tierData.message}</div>
          <div style="font-weight:400;font-size:0.82rem;margin-top:0.35rem;">
            Return the overdue item to the Property Custodian to restore your borrowing privileges.
          </div></div>`;
        if (main) main.insertBefore(banner, main.firstChild);
        // Disable the entire borrow form
        if (form) {
          form.style.opacity = "0.4";
          form.style.pointerEvents = "none";
          form.style.userSelect = "none";
          const submitBtn = form.querySelector("button[type='submit']");
          if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Borrowing Suspended"; }
        }
        return; // stop further form wiring
      }
    }

    const borrowerInp = document.getElementById("borrow-borrower-name");
    const qtyInp  = document.getElementById("borrow-quantity");
    const bdInp   = document.getElementById("borrow-date");
    const rdInp   = document.getElementById("borrow-return-date");
    const assetSel = document.getElementById("borrow-asset-id");
    const todayVal = window.IMS.todayISO();
    if (borrowerInp) borrowerInp.value = user.name || "Teacher";
    if (qtyInp) qtyInp.value = "1";
    if (bdInp) { bdInp.value = todayVal; bdInp.min = todayVal; }
    if (rdInp) { rdInp.value = todayVal; rdInp.min = todayVal; }
    if (bdInp && rdInp) {
      bdInp.addEventListener("change", () => {
        rdInp.min = bdInp.value || todayVal;
        if (rdInp.value < bdInp.value) rdInp.value = bdInp.value;
      });
    }
    if (assetSel) {
      assetSel.addEventListener("change", async () => {
        const assets = await window.API.getAssets();
        updateQtyInput("borrow-asset-id", "borrow-quantity", assets);
      });
    }
    const form = document.getElementById("borrow-form");
    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (_txnSubmitting) return; _txnSubmitting = true;
        const submitBtn = form.querySelector("button[type='submit']");
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Submitting…"; }
        const assetId    = document.getElementById("borrow-asset-id").value;
        const quantity   = parseInt(document.getElementById("borrow-quantity").value, 10) || 1;
        const borrower   = document.getElementById("borrow-borrower-name").value.trim();
        const borrowDate = document.getElementById("borrow-date").value;
        const returnDate = document.getElementById("borrow-return-date").value;
        const condition  = document.getElementById("borrow-condition").value || DEFAULT_CONDITION;

        if (borrowDate < todayVal || returnDate < todayVal || returnDate < borrowDate) {
          setMsg("borrow-message", "Dates cannot be in the past. Return date must be on or after borrow date.", "error");
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Submit Request"; }
          _txnSubmitting = false; return;
        }
        if (!assetId || !borrower || !borrowDate || !returnDate) {
          setMsg("borrow-message", "Please complete all fields.", "error");
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Submit Request"; }
          _txnSubmitting = false; return;
        }
        const borrowerEmail = user.email || "";
        const res = await window.API.createBorrowRequest({ assetId, quantity, borrower, borrowerEmail, role:"teacher", borrowDate, returnDate, condition });
        if (!res.ok) {
          setMsg("borrow-message", res.error, "error");
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Submit Request"; }
          _txnSubmitting = false; return;
        }
        form.reset();
        if (borrowerInp) borrowerInp.value = user.name || "Teacher";
        if (qtyInp) qtyInp.value = "1";
        if (bdInp) { bdInp.value = todayVal; bdInp.min = todayVal; }
        if (rdInp) { rdInp.value = todayVal; rdInp.min = todayVal; }
        setMsg("borrow-message", `Request ${res.requestId} submitted. Waiting for approval.`, "success");
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Submit Request"; }
        _txnSubmitting = false;
        await refreshBorrowPage(user);
      });
    }
    await refreshBorrowPage(user);
  }

  // ── RETURN PAGE (Teacher) ─────────────────────────────────
  async function refreshReturnPage(user) {
    await populateBorrowedTransactions("teacher-return-transaction-id", user, true);
    await renderTeacherBorrowedTable(user, "teacher-pending-body", true);
  }

  async function initReturnPage() {
    const user = window.IMS.requireAuth("return");
    if (!user) return;
    window.IMS.initLayout("return", "Return Item");
    const rdInp = document.getElementById("teacher-return-date");
    if (rdInp) rdInp.value = window.IMS.todayISO();
    const form = document.getElementById("teacher-return-form");
    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const submitBtn = form.querySelector("button[type='submit']");
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Processing…"; }
        const txnId    = document.getElementById("teacher-return-transaction-id").value;
        const condition = document.getElementById("teacher-return-condition").value || DEFAULT_CONDITION;
        const returnDate = document.getElementById("teacher-return-date").value;
        if (!txnId || !returnDate) {
          setMsg("return-message", "Please complete all return fields.", "error");
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Return Item"; }
          return;
        }
        const res = await window.API.returnAsset(txnId, condition, returnDate);
        if (!res.ok) {
          setMsg("return-message", res.error, "error");
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Return Item"; }
          return;
        }
        form.reset();
        if (rdInp) rdInp.value = window.IMS.todayISO();
        setMsg("return-message", `Transaction ${txnId} returned successfully.`, "success");
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Return Item"; }
        await refreshReturnPage(user);
      });
    }
    await refreshReturnPage(user);
  }

  // ── REPORTS PAGE ──────────────────────────────────────────
  async function renderReportTables() {
    const [assets, txns] = await Promise.all([window.API.getAssets(), window.API.getTransactions()]);
    const lowStock = assets.filter(a => Number(a.quantity) < window.IMS.LOW_STOCK_THRESHOLD);

    const invBody = document.getElementById("inventory-summary-body");
    if (invBody) {
      invBody.innerHTML = assets.length ? assets.map(a => `<tr>
        <td class="mono-cell">${esc(a.id)}</td>
        <td>${esc(a.name)}</td>
        <td>${esc(a.category)}</td>
        <td>${esc(a.quantity)} <span class="unit-tag">${esc(plural(Number(a.quantity), a.unit||"piece"))}</span></td>
        <td>${esc(a.location)}</td>
        <td>${window.IMS.createStatusBadge(a.status)}</td>
      </tr>`).join("") : '<tr><td colspan="6">No inventory records.</td></tr>';
    }

    const txnBody = document.getElementById("report-transactions-body");
    if (txnBody) {
      txnBody.innerHTML = txns.length ? txns.map(t => {
        const status = isOverdue(t) ? "Overdue" : t.status;
        const retDate = t.status === "Returned" ? (t.actualReturnDate||t.returnDate) : t.returnDate;
        const u = t.assetUnit || "piece";
        return `<tr>
          <td class="mono-cell">${esc(t.id)}</td>
          <td class="mono-cell">${esc(t.assetId)}</td>
          <td>${esc(qty(t.quantity))} <span class="unit-tag">${esc(plural(Number(t.quantity), u))}</span></td>
          <td>${esc(t.borrower)}</td>
          <td>${esc(window.IMS.roleLabel(t.role))}</td>
          <td class="mono-cell">${esc(t.borrowDate||"—")}</td>
          <td class="mono-cell">${esc(retDate||"—")}</td>
          <td>${window.IMS.createStatusBadge(status)}</td>
        </tr>`;
      }).join("") : '<tr><td colspan="8">No transactions.</td></tr>';
    }

    const lsBody = document.getElementById("low-stock-body");
    if (lsBody) {
      lsBody.innerHTML = lowStock.length ? lowStock.map(a => `<tr>
        <td class="mono-cell">${esc(a.id)}</td>
        <td>${esc(a.name)}</td>
        <td>${esc(a.category)}</td>
        <td>${esc(a.quantity)} <span class="unit-tag">${esc(plural(Number(a.quantity), a.unit||"piece"))}</span></td>
        <td>${esc(a.location)}</td>
      </tr>`).join("") : '<tr><td colspan="5">No low stock items.</td></tr>';
    }
  }

  async function initReportsPage() {
    const user = window.IMS.requireAuth("reports");
    if (!user) return;
    window.IMS.initLayout("reports", "Reports");
    await renderReportTables();

    // CSV export buttons
    document.querySelectorAll(".report-export-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const tableId = btn.getAttribute("data-table");
        const fileName = btn.getAttribute("data-file");
        if (tableId) window.IMS.exportTableToCsv(tableId, fileName || `${tableId}.csv`);
      });
    });

    const exportAllBtn = document.getElementById("export-all-btn");
    if (exportAllBtn) {
      exportAllBtn.addEventListener("click", () => {
        window.IMS.exportTableToCsv("inventory-summary-table", "inventory_summary.csv");
        window.IMS.exportTableToCsv("report-transactions-table", "transaction_history.csv");
        window.IMS.exportTableToCsv("low-stock-table", "low_stock_items.csv");
      });
    }

    const masterBtn = document.getElementById("reports-master-export-btn");
    if (masterBtn) {
      masterBtn.addEventListener("click", () => {
        window.IMS.exportMasterInventoryCsv(`master_inventory_${window.IMS.todayISO()}.csv`);
      });
    }

    const analyticsBtn = document.getElementById("analytics-summary-export-btn");
    if (analyticsBtn) {
      analyticsBtn.addEventListener("click", () => {
        window.IMS.exportAnalyticsSummaryCsv(user, `analytics_summary_${window.IMS.todayISO()}.csv`);
      });
    }

    // Backup — reads from MySQL
    // Run auto-backup now button
    const runNowBtn = document.getElementById("run-backup-now-btn");
    if (runNowBtn) {
      runNowBtn.addEventListener("click", async () => {
        runNowBtn.disabled = true;
        runNowBtn.textContent = "Saving…";
        const res = await window.API.runAutoBackup();
        if (res.ok) {
          runNowBtn.textContent = "✓ Saved";
          if (window.IMS && window.IMS.fetchNotifications) {
            // Refresh backup list
            setTimeout(() => {
              const mod = document.getElementById("auto-backup-list");
              if (mod) mod.innerHTML = '<div style="font-size:0.82rem;color:var(--gray-500);">Refreshing…</div>';
              // Re-render by triggering the app.js module
              if (window.API.listBackups) {
                window.API.listBackups().then(backups => {
                  if (!backups.length) { mod.innerHTML = '<div style="font-size:0.82rem;color:var(--gray-500);">No backups found.</div>'; return; }
                  mod.innerHTML = backups.map(b => {
                    const kb = (b.size/1024).toFixed(1);
                    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:0.55rem 0;border-bottom:1px solid var(--gray-100);font-size:0.82rem;">
                      <div><span style="font-family:'DM Mono',monospace;color:var(--gray-700);">${b.filename}</span><span style="color:var(--gray-400);margin-left:0.5rem;">${b.date} · ${kb} KB</span></div>
                      <button class="btn btn-secondary btn-sm" onclick="window.API.downloadBackup('${b.filename}')" type="button">↓ Download</button>
                    </div>`;
                  }).join('');
                });
              }
            }, 500);
          }
        } else {
          runNowBtn.textContent = "Failed";
        }
        setTimeout(() => { runNowBtn.disabled = false; runNowBtn.textContent = "Run Backup Now"; }, 3000);
      });
    }

    const backupBtn = document.getElementById("backup-database-btn");
    if (backupBtn && user.role === "admin") {
      backupBtn.addEventListener("click", async () => {
        backupBtn.disabled = true;
        backupBtn.textContent = "Preparing backup…";
        await window.API.exportBackup();
        backupBtn.textContent = "✓ Backup Downloaded";
        setTimeout(() => { backupBtn.innerHTML = "&#8681; Backup Database"; backupBtn.disabled = false; }, 3000);
      });
    } else if (backupBtn) { backupBtn.hidden = true; }

    // Restore — writes to MySQL
    const restoreInput = document.getElementById("restore-database-input");
    const restoreLabel = document.getElementById("restore-database-label");
    if (restoreInput && user.role === "admin") {
      restoreInput.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const ok = confirm(`Restore database from "${file.name}"?\n\nThis will OVERWRITE all current data.\nMake sure you have a current backup first.`);
        if (!ok) { restoreInput.value = ""; return; }
        const json = await file.text();
        const res = await window.API.restoreBackup(json);
        if (!res.ok) { alert(`Restore failed: ${res.error}`); return; }
        const s = res.summary;
        alert(`Database restored!\n\nAssets: ${s.assets}\nTransactions: ${s.transactions}\nUsers: ${s.users}\n\nPage will reload.`);
        window.location.reload();
        restoreInput.value = "";
      });
    } else if (restoreLabel) { restoreLabel.hidden = true; }
  }

  // ── UTILITIES ─────────────────────────────────────────────
  function esc(v) { return window.IMS.escapeHtml(v); }

  // ── INIT ──────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", () => {
    if (!document.body || !window.IMS) return;
    const page = document.body.dataset.page;
    if (page === "transactions") { initTransactionsPage(); return; }
    if (page === "borrow")       { initBorrowPage();       return; }
    if (page === "return")       { initReturnPage();       return; }
    if (page === "reports")      { initReportsPage();      return; }
  });
})();
