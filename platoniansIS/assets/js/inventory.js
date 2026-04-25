// ============================================================
// Platonian's IS — Inventory Module (MySQL/API version)
// ============================================================
(() => {
  "use strict";

  // Proper plural helper
  function plural(n, unit) {
    const u = String(unit || 'piece');
    if (n === 1) return u;
    const irreg = { box:'boxes', piece:'pieces', bunch:'bunches', brush:'brushes' };
    return irreg[u] || (u + 's');
  }

  let editingAssetId   = null;
  let editingReceiptFile = "";
  let searchTerm       = "";
  let depedFilterActive = false;
  let activeUser       = null;
  let selectedAuditLocation = "";
  let roomAuditSelections   = {};
  let allAssets = [];

  // ── MESSAGES ──────────────────────────────────────────────
  function setMsg(id, msg, type = "info") {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg || "";
    el.className = `status-message ${type}-message ${msg ? "show" : ""}`;
  }
  const setMessage      = (m, t) => setMsg("inventory-message", m, t);
  const setAuditMessage = (m, t) => setMsg("room-audit-message", m, t);

  // ── UNIT FIELD ─────────────────────────────────────────────
  function syncUnitPreview() {
    const name     = (document.getElementById("asset-name")?.value || "").trim();
    const category = document.getElementById("asset-category")?.value || "";
    const unitInput = document.getElementById("asset-unit");
    const unitPreview = document.getElementById("unit-preview");
    if (!unitInput) return;
    // Only auto-fill if field is empty or hasn't been manually touched
    if (!unitInput.dataset.manuallySet || unitInput.dataset.manuallySet === "false") {
      const detected = window.API.autoDetectUnit(name, category);
      unitInput.value = detected;
    }
    if (unitPreview) unitPreview.textContent = unitInput.value || "piece";
  }

  function syncLimitPreview() {
    const category = document.getElementById("asset-category")?.value || "";
    const limitInput = document.getElementById("asset-max-checkout");
    if (!limitInput) return;
    if (!limitInput.dataset.manuallySet || limitInput.dataset.manuallySet === "false") {
      const def = window.API.autoDetectLimit(category);
      limitInput.value = def;
    }
  }

  // ── FORM HELPERS ───────────────────────────────────────────
  function populateCategoryOptions(selected = "") {
    const sel = document.getElementById("asset-category");
    if (!sel || !window._cachedCategories) return;
    sel.innerHTML = window._cachedCategories
      .map(c => `<option value="${esc(c)}">${esc(c)}</option>`)
      .join("");
    if (selected) {
      const lc = selected.toLowerCase();
      const match = window._cachedCategories.find(c => c.toLowerCase() === lc);
      sel.value = match || selected;
      if (!sel.value) {
        sel.insertAdjacentHTML("beforeend", `<option value="${esc(selected)}">${esc(selected)}</option>`);
        sel.value = selected;
      }
    }
  }

  function populateLocationOptions(selected = "") {
    const sel = document.getElementById("asset-location");
    if (!sel || !window._cachedLocations) return;
    sel.innerHTML = window._cachedLocations
      .map(l => `<option value="${esc(l)}">${esc(l)}</option>`)
      .join("");
    if (selected) {
      const lc = selected.toLowerCase();
      const match = window._cachedLocations.find(l => l.toLowerCase() === lc);
      sel.value = match || selected;
      if (!sel.value) {
        sel.insertAdjacentHTML("beforeend", `<option value="${esc(selected)}">${esc(selected)}</option>`);
        sel.value = selected;
      }
    }
  }

  async function refreshDropdowns() {
    const [cats, locs] = await Promise.all([window.API.getCategories(), window.API.getLocations()]);
    window._cachedCategories = cats;
    window._cachedLocations  = locs;
    populateCategoryOptions();
    populateLocationOptions();
  }

  function resetForm() {
    const form = document.getElementById("asset-form");
    if (!form) return;
    form.reset();
    const unitInput  = document.getElementById("asset-unit");
    const limitInput = document.getElementById("asset-max-checkout");
    if (unitInput)  { unitInput.dataset.manuallySet  = "false"; }
    if (limitInput) { limitInput.dataset.manuallySet = "false"; }
    populateCategoryOptions();
    populateLocationOptions();
    const dateInput = document.getElementById("asset-date-added");
    if (dateInput) dateInput.value = window.IMS.todayISO();
    const bulkChk = document.getElementById("asset-is-bulk");
    const bulkRow = document.getElementById("bulk-id-row");
    const bulkId  = document.getElementById("asset-bulk-id");
    if (bulkChk) bulkChk.checked = false;
    if (bulkRow) bulkRow.style.display = "none";
    if (bulkId)  bulkId.value = "";
    editingAssetId    = null;
    editingReceiptFile = "";
    const submitBtn = document.getElementById("asset-submit-btn");
    const cancelBtn = document.getElementById("asset-cancel-btn");
    if (submitBtn) submitBtn.textContent = "Add Asset";
    if (cancelBtn) cancelBtn.hidden = true;
    syncUnitPreview();
    syncLimitPreview();
  }

  // ── RENDER TABLE ───────────────────────────────────────────
  function renderInventoryTable() {
    const body = document.getElementById("inventory-table-body");
    if (!body) return;
    const q   = searchTerm.trim().toLowerCase();
    const filtered = allAssets.filter(a => {
      if (depedFilterActive && !a.isBulk) return false;
      if (!q) return true;
      return [a.id, a.name, a.category, a.bulkId||""].some(v => String(v||"").toLowerCase().includes(q));
    });
    if (!filtered.length) {
      body.innerHTML = `<tr><td colspan="12">No assets found.</td></tr>`;
      return;
    }
    body.innerHTML = filtered.map(a => {
      const cost = Number(a.unitCost) > 0
        ? new Intl.NumberFormat("en-PH", { style:"currency", currency:"PHP", maximumFractionDigits:0 }).format(a.unitCost)
        : "—";
      const bulkBadge  = a.isBulk ? `<span class="deped-badge">DepEd</span> ` : "";
      const bulkIdCell = a.isBulk && a.bulkId ? `<span class="bulk-id-tag">${esc(a.bulkId)}</span>` : "—";
      const limitCell  = a.maxCheckoutQty > 0
        ? `<span class="limit-badge" title="Max ${a.maxCheckoutQty} ${a.unit||'piece'}(s) per request">max ${a.maxCheckoutQty} <span style="font-weight:400;opacity:0.75;">${esc(a.unit||'piece')}</span></span>`
        : `<span style="color:var(--gray-400);font-size:0.78rem;">no limit</span>`;
      // File/receipt cell — viewable link if file exists
      let fileCell = "—";
      if (a.receiptFile) {
        const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(a.receiptFile);
        const isPDF   = /\.pdf$/i.test(a.receiptFile);
        const icon    = isImage ? "🖼️" : isPDF ? "📄" : "📎";
        fileCell = `<button class="btn btn-secondary btn-sm" data-action="viewfile" data-id="${esc(a.id)}" data-file="${esc(a.receiptFile)}" type="button" title="View attached file">${icon} View</button>`;
      }
      return `<tr>
        <td class="mono-cell">${esc(a.id)}</td>
        <td>${bulkBadge}${esc(a.name)}</td>
        <td>${window.IMS.createCategoryBadge(a.category)}</td>
        <td>${bulkIdCell}</td>
        <td><span class="qty-unit">${esc(a.quantity)}</span> <span class="unit-tag">${esc(plural(Number(a.quantity), a.unit||"piece"))}</span></td>
        <td>${limitCell}</td>
        <td>${esc(cost)}</td>
        <td>${esc(a.location)}</td>
        <td>${window.IMS.createStatusBadge(a.status)}</td>
        <td class="mono-cell">${esc(a.dateAdded||"—")}</td>
        <td>${fileCell}</td>
        <td class="action-cell">
          <button class="btn btn-secondary btn-sm" data-action="edit"     data-id="${esc(a.id)}" type="button">Edit</button>
          <button class="btn btn-secondary btn-sm" data-action="setlimit" data-id="${esc(a.id)}" type="button" title="Quickly change max borrow limit for this item" style="background:#fff7ed;border-color:#f97316;color:#c2410c;">Set Limit</button>
          <button class="btn btn-danger btn-sm"    data-action="delete"   data-id="${esc(a.id)}" type="button">Delete</button>
        </td>
      </tr>`;
    }).join("");
  }

  // ── FILE VIEWER MODAL ─────────────────────────────────────
  function openFileViewer(filename) {
    const url = `uploads/${filename}`;
    const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(filename);
    const isPDF   = /\.pdf$/i.test(filename);

    // Remove existing modal if any
    document.getElementById("file-viewer-modal")?.remove();

    const modal = document.createElement("div");
    modal.id = "file-viewer-modal";
    modal.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;padding:1rem;";

    let content = "";
    if (isImage) {
      content = `<img src="${url}" alt="${filename}" style="max-width:100%;max-height:80vh;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.4);">`;
    } else if (isPDF) {
      content = `<iframe src="${url}" style="width:min(900px,90vw);height:80vh;border:none;border-radius:8px;"></iframe>`;
    } else {
      content = `<div style="background:#fff;padding:2rem;border-radius:12px;text-align:center;"><p style="margin-bottom:1rem;">📎 ${filename}</p><a href="${url}" download class="btn btn-primary">Download File</a></div>`;
    }

    modal.innerHTML = `
      <div style="position:relative;max-width:95vw;">
        <button id="fv-close" style="position:absolute;top:-2.5rem;right:0;background:rgba(255,255,255,0.2);color:#fff;border:none;border-radius:50%;width:2rem;height:2rem;font-size:1.2rem;cursor:pointer;line-height:1;" title="Close">✕</button>
        <a href="${url}" download target="_blank" style="position:absolute;top:-2.5rem;left:0;background:rgba(255,255,255,0.2);color:#fff;border:none;border-radius:6px;padding:0.2rem 0.6rem;font-size:0.8rem;text-decoration:none;">⬇ Download</a>
        ${content}
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });
    document.getElementById("fv-close")?.addEventListener("click", () => modal.remove());
  }

  async function loadAndRender() {
    allAssets = await window.API.getAssets();
    window._cachedAssets = allAssets; // cache for inline quick-edit
    renderInventoryTable();
    refreshRoomAuditInterface();
  }

  // ── EDIT / DELETE ──────────────────────────────────────────
  function startEdit(assetId) {
    const a = allAssets.find(x => x.id === assetId);
    if (!a) return;
    editingAssetId    = a.id;
    editingReceiptFile = a.receiptFile || "";
    document.getElementById("asset-name").value     = a.name || "";
    populateCategoryOptions(a.category || "");
    document.getElementById("asset-quantity").value  = Number(a.quantity) || 0;
    const costInput = document.getElementById("asset-unit-cost");
    if (costInput) costInput.value = a.unitCost > 0 ? a.unitCost : "";

    // Unit & limit — mark as manually set so auto-detect doesn't override
    const unitInput  = document.getElementById("asset-unit");
    const limitInput = document.getElementById("asset-max-checkout");
    if (unitInput) {
      unitInput.value = a.unit || "piece";
      unitInput.dataset.manuallySet = "true";
    }
    if (limitInput) {
      limitInput.value = a.maxCheckoutQty || 0;
      limitInput.dataset.manuallySet = "true";
    }

    const bulkChk = document.getElementById("asset-is-bulk");
    const bulkRow = document.getElementById("bulk-id-row");
    const bulkId  = document.getElementById("asset-bulk-id");
    if (bulkChk && bulkRow && bulkId) {
      bulkChk.checked = Boolean(a.isBulk);
      bulkRow.style.display = a.isBulk ? "block" : "none";
      bulkId.value = a.bulkId || "";
    }
    populateLocationOptions(a.location || "");
    document.getElementById("asset-status").value   = a.status || "Available";
    const condEl = document.getElementById("asset-condition");
    if (condEl) condEl.value = a.condition || "Good";
    document.getElementById("asset-date-added").value = a.dateAdded || window.IMS.todayISO();
    const submitBtn = document.getElementById("asset-submit-btn");
    const cancelBtn = document.getElementById("asset-cancel-btn");
    if (submitBtn) submitBtn.textContent = "Save Changes";
    if (cancelBtn) cancelBtn.hidden = false;
    const unitPreview = document.getElementById("unit-preview");
    if (unitPreview) unitPreview.textContent = a.unit || "piece";
    if (activeUser?.role === "custodian" && window.location.hash !== "#register") {
      window.location.hash = "#register";
      updateInventoryView(activeUser.role);
    }
    setMessage(`Editing ${a.id}.`, "info");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteAsset(assetId) {
    if (!confirm(`Delete asset ${assetId}? This cannot be undone.`)) return;
    const res = await window.API.deleteAsset(assetId);
    if (!res.ok) { setMessage(res.error || "Delete failed.", "error"); return; }
    setMessage(`Asset ${assetId} deleted.`, "success");
    await loadAndRender();
  }

  // ── FORM SUBMIT ────────────────────────────────────────────
  async function submitAsset(e) {
    e.preventDefault();
    const submitBtn = document.getElementById("asset-submit-btn");
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Saving…"; }

    const name     = document.getElementById("asset-name").value.trim();
    const category = document.getElementById("asset-category").value;
    const qty      = Number(document.getElementById("asset-quantity").value);
    const unitEl   = document.getElementById("asset-unit");
    const unit     = (unitEl ? unitEl.value.trim() : "") || window.API.autoDetectUnit(name, category);
    const limitEl  = document.getElementById("asset-max-checkout");
    const maxCheckoutQty = limitEl ? Math.max(0, parseInt(limitEl.value || "0", 10)) : 0;
    const costRaw  = parseFloat(document.getElementById("asset-unit-cost")?.value || "0");
    const unitCost = isNaN(costRaw) || costRaw < 0 ? 0 : costRaw;
    const location = document.getElementById("asset-location").value.trim();
    const status   = document.getElementById("asset-status").value;
    const dateAdded = document.getElementById("asset-date-added").value || window.IMS.todayISO();
    const receiptInput = document.getElementById("asset-receipt");
    const file     = receiptInput?.files?.[0] || null;
    const bulkChk  = document.getElementById("asset-is-bulk");
    const isBulk   = bulkChk ? bulkChk.checked : false;
    const bulkId   = isBulk ? (document.getElementById("asset-bulk-id")?.value.trim() || "") : "";

    if (!name || !category || !location) {
      setMessage("Asset name, category, and location are required.", "error");
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = editingAssetId ? "Save Changes" : "Add Asset"; }
      return;
    }
    if (!Number.isFinite(qty) || qty < 0) {
      setMessage("Quantity must be 0 or more.", "error");
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = editingAssetId ? "Save Changes" : "Add Asset"; }
      return;
    }

    // Upload file to server if a new file was chosen
    let uploadedFilename = editingReceiptFile;
    if (file) {
      if (submitBtn) submitBtn.textContent = "Uploading…";
      const upRes = await window.API.uploadFile(file);
      if (!upRes.ok) {
        setMessage(upRes.error || "File upload failed.", "error");
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = editingAssetId ? "Save Changes" : "Add Asset"; }
        return;
      }
      uploadedFilename = upRes.filename;
    }

    const conditionEl = document.getElementById("asset-condition");
    const condition = conditionEl ? conditionEl.value : "Good";
    const payload = { name, category, quantity: qty, unit, maxCheckoutQty, condition, unitCost, location, status, dateAdded,
                      receiptFile: uploadedFilename, isBulk, bulkId };

    let res;
    if (!editingAssetId) {
      res = await window.API.addAsset(payload);
      if (res.ok) setMessage(`Asset ${res.id} added successfully.`, "success");
    } else {
      res = await window.API.updateAsset({ id: editingAssetId, ...payload });
      if (res.ok) setMessage(`Asset ${editingAssetId} updated successfully.`, "success");
    }

    if (!res.ok) {
      setMessage(res.error || "Save failed.", "error");
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = editingAssetId ? "Save Changes" : "Add Asset"; }
      return;
    }

    await refreshDropdowns();
    resetForm();
    await loadAndRender();
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Add Asset"; }
  }

  // ── ROOM AUDIT ─────────────────────────────────────────────
  function normalizeLocation(v) { return String(v||"").trim().toLowerCase(); }

  function roomAssetsByLocation(loc) {
    return allAssets.filter(a => normalizeLocation(a.location) === normalizeLocation(loc));
  }

  function calculateAuditSummary(assets) {
    const s = { expectedUnits:0, foundUnits:0, missingUnits:0, needsRepairUnits:0, variance:0 };
    assets.forEach(a => {
      const q = Number(a.quantity) || 0;
      s.expectedUnits += q;
      const v = roomAuditSelections[a.id] || "Found";
      if (v === "Missing")      { s.missingUnits += q; return; }
      s.foundUnits += q;
      if (v === "Needs Repair") s.needsRepairUnits += q;
    });
    s.variance = s.expectedUnits - s.foundUnits;
    return s;
  }

  function renderAuditSummary(assets) {
    const s = calculateAuditSummary(assets);
    ["expected-units","found-units","missing-units","needs-repair-units","variance-units"].forEach((k,i) => {
      const el = document.getElementById("audit-" + k);
      if (el) el.textContent = Object.values(s)[i];
    });
    return s;
  }

  function renderAuditTable() {
    const body = document.getElementById("room-audit-body");
    if (!body) return;
    if (!selectedAuditLocation) {
      body.innerHTML = `<tr><td colspan="5">Select a location to begin room audit.</td></tr>`;
      renderAuditSummary([]);
      return;
    }
    const assets = roomAssetsByLocation(selectedAuditLocation);
    if (!assets.length) {
      body.innerHTML = `<tr><td colspan="5">No assets in ${esc(selectedAuditLocation)}.</td></tr>`;
      renderAuditSummary([]);
      return;
    }
    body.innerHTML = assets.map(a => {
      const v = roomAuditSelections[a.id] || "Found";
      roomAuditSelections[a.id] = v;
      const mkBtn = (label, cls) => {
        const active = v === label ? "active" : "";
        return `<button class="btn btn-secondary btn-sm audit-toggle-btn ${cls} ${active}" type="button"
          data-audit-action="set-verification" data-audit-id="${esc(a.id)}" data-audit-value="${esc(label)}">${label}</button>`;
      };
      return `<tr>
        <td class="mono-cell">${esc(a.id)}</td>
        <td>${esc(a.name)}</td>
        <td>${esc(a.quantity)} ${esc(plural(Number(a.quantity), a.unit||"piece"))}</td>
        <td>${window.IMS.createStatusBadge(a.status)}</td>
        <td><div class="audit-toggle-group">
          ${mkBtn("Found","state-found")}
          ${mkBtn("Missing","state-missing")}
          ${mkBtn("Needs Repair","state-needs-repair")}
        </div></td>
      </tr>`;
    }).join("");
    renderAuditSummary(assets);
  }

  function populateAuditLocations() {
    const sel = document.getElementById("room-audit-location");
    if (!sel) return;
    const locs = [...new Map(allAssets.map(a => [normalizeLocation(a.location), a.location])).values()].sort();
    const prev = selectedAuditLocation;
    sel.innerHTML = '<option value="">Select location</option>'
      + locs.map(l => `<option value="${esc(l)}">${esc(l)}</option>`).join("");
    if (prev && locs.some(l => normalizeLocation(l) === normalizeLocation(prev))) {
      sel.value = prev;
    } else {
      selectedAuditLocation = "";
      roomAuditSelections = {};
    }
  }

  function refreshRoomAuditInterface() {
    populateAuditLocations();
    renderAuditTable();
  }

  async function finalizeRoomAudit() {
    if (!selectedAuditLocation) { setAuditMessage("Select a location first.", "error"); return; }
    const assets = roomAssetsByLocation(selectedAuditLocation);
    if (!assets.length) { setAuditMessage("No assets to audit here.", "error"); return; }
    const summary = calculateAuditSummary(assets);
    const items = assets.map(a => ({
      assetId:          a.id,
      assetName:        a.name,
      location:         a.location,
      expectedQuantity: Number(a.quantity) || 0,
      verification:     roomAuditSelections[a.id] || "Found",
      previousStatus:   a.status,
      updatedStatus:    roomAuditSelections[a.id] === "Missing" ? "Missing" : a.status,
    }));
    const res = await window.API.saveAuditLog({
      location:    selectedAuditLocation,
      auditedOn:   window.IMS.todayISO(),
      auditedBy:   activeUser.name || window.IMS.roleLabel(activeUser.role),
      auditorRole: activeUser.role,
      summary,
      items,
    });
    if (!res.ok) { setAuditMessage(res.error || "Save failed.", "error"); return; }
    setAuditMessage(`Audit ${res.logId||""} saved for ${selectedAuditLocation}.`, "success");
    await loadAndRender();
  }

  // ── VIEW MANAGEMENT ────────────────────────────────────────
  function updateInventoryView(role) {
    const reg   = document.getElementById("register");
    const mgmt  = document.getElementById("inventory-management-section");
    const audit = document.getElementById("room-audit-section");
    const isReg = window.location.hash === "#register";
    if (!reg || !mgmt) return;
    if (role === "custodian") {
      reg.hidden   = !isReg;
      mgmt.hidden  = isReg;
      if (audit) audit.hidden = isReg;
    } else {
      reg.hidden = mgmt.hidden = false;
      if (audit) audit.hidden = false;
    }
    const tp = document.getElementById("topbar-page");
    if (tp) tp.textContent = isReg ? "Asset Registration" : "Inventory Management";
  }

  // ── BIND EVENTS ────────────────────────────────────────────
  function bindEvents() {
    const form       = document.getElementById("asset-form");
    const cancelBtn  = document.getElementById("asset-cancel-btn");
    const searchInp  = document.getElementById("inventory-search");
    const tBody      = document.getElementById("inventory-table-body");
    const addCatBtn  = document.getElementById("asset-category-add-btn");
    const newCatInp  = document.getElementById("asset-category-new");
    const addLocBtn  = document.getElementById("asset-location-add-btn");
    const newLocInp  = document.getElementById("asset-location-new");
    const masterExpBtn = document.getElementById("inventory-master-export-btn");
    const auditLocSel  = document.getElementById("room-audit-location");
    const auditLoadBtn = document.getElementById("room-audit-load-btn");
    const auditFinBtn  = document.getElementById("room-audit-finalize-btn");
    const auditBody    = document.getElementById("room-audit-body");
    const bulkChk    = document.getElementById("asset-is-bulk");
    const bulkRow    = document.getElementById("bulk-id-row");
    const bulkIdInp  = document.getElementById("asset-bulk-id");
    const bulkGenBtn = document.getElementById("asset-bulk-id-generate-btn");
    const depedBtn   = document.getElementById("inventory-deped-filter-btn");
    const nameInp    = document.getElementById("asset-name");
    const catSel     = document.getElementById("asset-category");
    const unitInp    = document.getElementById("asset-unit");
    const limitInp   = document.getElementById("asset-max-checkout");

    // Auto-detect unit & limit when name/category changes
    if (nameInp) nameInp.addEventListener("input", () => { if (unitInp) unitInp.dataset.manuallySet = "false"; syncUnitPreview(); });
    if (catSel)  catSel.addEventListener("change",  () => { if (unitInp) unitInp.dataset.manuallySet = "false"; if (limitInp) limitInp.dataset.manuallySet = "false"; syncUnitPreview(); syncLimitPreview(); });
    if (unitInp) unitInp.addEventListener("input",  () => { unitInp.dataset.manuallySet = "true"; const p = document.getElementById("unit-preview"); if(p) p.textContent = unitInp.value || "piece"; });
    if (limitInp) limitInp.addEventListener("input", () => { limitInp.dataset.manuallySet = "true"; });

    // Bulk toggle
    if (bulkChk && bulkRow) {
      bulkChk.addEventListener("change", async () => {
        bulkRow.style.display = bulkChk.checked ? "block" : "none";
        if (bulkChk.checked && bulkIdInp && !bulkIdInp.value.trim()) {
          bulkIdInp.value = await window.API.nextBulkId();
        }
        if (!bulkChk.checked && bulkIdInp) bulkIdInp.value = "";
      });
    }
    if (bulkGenBtn && bulkIdInp) {
      bulkGenBtn.addEventListener("click", async () => {
        bulkIdInp.value = await window.API.nextBulkId();
      });
    }

    // DepEd filter
    if (depedBtn) {
      depedBtn.addEventListener("click", () => {
        depedFilterActive = !depedFilterActive;
        depedBtn.style.background   = depedFilterActive ? "#dcfce7" : "";
        depedBtn.style.borderColor  = depedFilterActive ? "#0f766e" : "";
        renderInventoryTable();
      });
    }

    if (form) form.addEventListener("submit", submitAsset);
    if (cancelBtn) cancelBtn.addEventListener("click", () => { resetForm(); setMessage(""); });
    if (searchInp) searchInp.addEventListener("input", e => { searchTerm = e.target.value || ""; renderInventoryTable(); });

    // Add category
    async function addCategory() {
      const inp = document.getElementById("asset-category-new");
      const name = inp?.value.trim();
      if (!name) { setMessage("Enter a category name first.", "error"); return; }
      const res = await window.API.addCategory(name);
      if (!res.ok) { setMessage(res.error || "Unable to add category.", "error"); return; }
      if (inp) inp.value = "";
      await refreshDropdowns();
      populateCategoryOptions(res.category);
      setMessage(`Category "${res.category}" added.`, "success");
    }
    if (addCatBtn) addCatBtn.addEventListener("click", addCategory);
    if (newCatInp) newCatInp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addCategory(); } });

    // Delete category
    async function deleteCategory(name) {
      if (!confirm(`Delete category "${name}"? This cannot be undone.`)) return;
      const res = await window.API.deleteCategory(name);
      if (!res.ok) { setMessage(res.error || "Cannot delete category.", "error"); return; }
      await refreshDropdowns();
      setMessage(`Category "${name}" deleted.`, "success");
    }

    // Category list with delete buttons (render after each refresh)
    async function renderCategoryList() {
      const listEl = document.getElementById("category-manage-list");
      if (!listEl) return;
      const cats = await window.API.getCategories();
      if (!cats.length) { listEl.innerHTML = '<em style="color:var(--gray-400);font-size:0.8rem;">No categories yet.</em>'; return; }
      listEl.innerHTML = cats.map(c =>
        `<div class="cat-list-item">
           <span>${esc(c)}</span>
           <button class="btn btn-danger btn-sm" data-delete-cat="${esc(c)}" type="button" title="Delete category">✕</button>
         </div>`
      ).join("");
      listEl.querySelectorAll("[data-delete-cat]").forEach(btn => {
        btn.addEventListener("click", () => deleteCategory(btn.getAttribute("data-delete-cat")));
      });
    }
    renderCategoryList();

    // Search autocomplete
    const searchInpEl = document.getElementById("inventory-search");
    if (searchInpEl) {
      let suggestBox = document.getElementById("inventory-suggest-box");
      if (!suggestBox) {
        suggestBox = document.createElement("div");
        suggestBox.id = "inventory-suggest-box";
        suggestBox.className = "suggest-box";
        searchInpEl.parentNode.style.position = "relative";
        searchInpEl.parentNode.appendChild(suggestBox);
      }
      let suggestTimer;
      searchInpEl.addEventListener("input", e => {
        searchTerm = e.target.value || "";
        renderInventoryTable();
        clearTimeout(suggestTimer);
        const q = searchTerm.trim();
        if (q.length < 1) { suggestBox.style.display = "none"; return; }
        suggestTimer = setTimeout(async () => {
          const sugs = await window.API.searchSuggest(q);
          if (!sugs.length) { suggestBox.style.display = "none"; return; }
          suggestBox.innerHTML = sugs.map(s =>
            `<div class="suggest-item" data-value="${esc(s.name)}">
               <span class="suggest-name">${esc(s.name)}</span>
               <span class="suggest-meta">${esc(s.category)} · ${s.qty} ${esc(s.unit)}</span>
             </div>`
          ).join("");
          suggestBox.style.display = "block";
          suggestBox.querySelectorAll(".suggest-item").forEach(item => {
            item.addEventListener("click", () => {
              searchInpEl.value = item.getAttribute("data-value");
              searchTerm = searchInpEl.value;
              renderInventoryTable();
              suggestBox.style.display = "none";
            });
          });
        }, 220);
      });
      document.addEventListener("click", e => {
        if (!searchInpEl.contains(e.target) && !suggestBox.contains(e.target))
          suggestBox.style.display = "none";
      });
    }

    // Add location
    async function addLocation() {
      const inp = document.getElementById("asset-location-new");
      const name = inp?.value.trim();
      if (!name) { setMessage("Enter a location name first.", "error"); return; }
      const res = await window.API.addLocation(name);
      if (!res.ok) { setMessage(res.error || "Unable to add location.", "error"); return; }
      if (inp) inp.value = "";
      await refreshDropdowns();
      populateLocationOptions(res.location);
      refreshRoomAuditInterface();
      setMessage(`Location "${res.location}" added.`, "success");
    }
    if (addLocBtn) addLocBtn.addEventListener("click", addLocation);
    if (newLocInp) newLocInp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addLocation(); } });

    // Master export
    if (masterExpBtn) {
      masterExpBtn.addEventListener("click", () => {
        window.IMS.exportMasterInventoryCsv(`master_inventory_${window.IMS.todayISO()}.csv`);
      });
    }

    // Room audit
    if (auditLocSel) {
      auditLocSel.addEventListener("change", e => {
        selectedAuditLocation = String(e.target.value || "").trim();
        roomAuditSelections = {};
        renderAuditTable();
      });
    }
    if (auditLoadBtn) {
      auditLoadBtn.addEventListener("click", () => {
        if (auditLocSel) selectedAuditLocation = String(auditLocSel.value || "").trim();
        roomAuditSelections = {};
        renderAuditTable();
        if (!selectedAuditLocation) { setAuditMessage("Select a location to load assets.", "error"); return; }
        const count = roomAssetsByLocation(selectedAuditLocation).length;
        setAuditMessage(`Loaded ${count} asset record(s) for ${selectedAuditLocation}.`, "info");
      });
    }
    if (auditFinBtn) auditFinBtn.addEventListener("click", finalizeRoomAudit);
    if (auditBody) {
      auditBody.addEventListener("click", e => {
        const btn = e.target.closest("button[data-audit-action='set-verification']");
        if (!btn) return;
        const id  = btn.getAttribute("data-audit-id");
        const val = btn.getAttribute("data-audit-value");
        if (!id || !val) return;
        roomAuditSelections[id] = val;
        renderAuditTable();
      });
    }

    // Table actions (edit / delete / set-limit inline)
    if (tBody) {
      tBody.addEventListener("click", async e => {
        const btn = e.target.closest("button[data-action]");
        if (!btn) return;
        const action = btn.getAttribute("data-action");
        const id     = btn.getAttribute("data-id");
        if (!id) return;
        if (action === "edit")   startEdit(id);
        if (action === "delete") await deleteAsset(id);
        if (action === "viewfile") {
          const file = btn.getAttribute("data-file");
          if (file) openFileViewer(file);
          return;
        }

        // ── Quick inline limit edit ───────────────────────────
        if (action === "setlimit") {
          const assets  = window._cachedAssets || await window.API.getAssets();
          const asset   = assets.find(a => a.id === id);
          if (!asset) return;
          const current = asset.maxCheckoutQty || 0;
          const unit    = asset.unit || "piece";
          const val = prompt(
            `Set Max Borrow Limit for "${asset.name}"\n` +
            `Unit: ${unit}   Current limit: ${current === 0 ? "no limit" : current}\n\n` +
            `Enter new limit (0 = no limit):`,
            current
          );
          if (val === null) return; // cancelled
          const newLimit = Math.max(0, parseInt(val, 10) || 0);
          const payload  = { ...asset, maxCheckoutQty: newLimit };
          const res = await window.API.updateAsset(payload);
          if (res.ok) {
            setMessage(`Max borrow limit for ${asset.name} updated to ${newLimit === 0 ? "no limit" : newLimit + " " + unit + "(s)"}.`, "success");
            await loadAndRender();
          } else {
            setMessage(res.error || "Update failed.", "error");
          }
        }
      });
    }
  }

  // ── UTILITY ────────────────────────────────────────────────
  function esc(v) { return window.IMS.escapeHtml(v); }

  // ── INIT ───────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", async () => {
    if (!document.body || document.body.dataset.page !== "inventory") return;
    const user = window.IMS.requireAuth("inventory");
    if (!user) return;
    activeUser = user;
    window.IMS.initLayout("inventory", "Inventory Management");
    await refreshDropdowns();
    resetForm();
    bindEvents();
    await loadAndRender();
    updateInventoryView(user.role);
    window.addEventListener("hashchange", () => updateInventoryView(user.role));
  });
})();
