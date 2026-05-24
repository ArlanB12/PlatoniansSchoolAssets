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
  // v10.22 — multi-file attachments.
  //   stagedFiles  : File objects chosen in the form, not yet uploaded
  //   editingFiles : existing filenames (already on the server) kept on edit
  let stagedFiles      = [];   // [{ id, file }]
  let editingFiles     = [];   // ["file_abc.jpg", ...]
  let searchTerm       = "";
  let depedFilterActive = false;
  let activeUser       = null;
  let selectedAuditLocation = "";
  let roomAuditSelections   = {};
  let allAssets = [];

  // ── DepEd book detector ────────────────────────────────────
  // The DepEd filter is meant for learning materials that are lent
  // to students and tracked by Bulk ID — textbooks and self-learning
  // modules distributed by DepEd. An item qualifies when it:
  //   1. is a bulk item (is_bulk), AND
  //   2. has a Bulk ID (BLK-YYYY-NNN), AND
  //   3. is in the books / learning-materials category.
  // This keeps the filter from showing every bulk asset (chairs,
  // markers, projectors) and limits it to student-lent books.
  function isDepEdBook(a) {
    if (!a) return false;
    if (!a.isBulk) return false;
    if (!a.bulkId || !String(a.bulkId).trim()) return false;
    const cat  = String(a.category || "").toLowerCase();
    const name = String(a.name || "").toLowerCase();
    const isBookCategory = cat.includes("book") || cat.includes("module");
    const looksLikeBook  = /\b(book|textbook|module|workbook|learner'?s?|reader)\b/.test(name);
    return isBookCategory || looksLikeBook;
  }

  // v10.4: Sorting state. Default sort = newest added first.
  // Keys map to fields on the asset object; "natural" means use the
  // user-friendly value (e.g. status badges sort by status string).
  let sortBy  = "dateAdded";
  let sortDir = "desc"; // 'asc' or 'desc'

  const SORT_OPTIONS = [
    { key: "dateAdded",      label: "Date Added",   defaultDir: "desc" },
    { key: "name",           label: "Asset Name",   defaultDir: "asc"  },
    { key: "id",             label: "Asset ID",     defaultDir: "asc"  },
    { key: "category",       label: "Category",     defaultDir: "asc"  },
    { key: "quantity",       label: "Quantity",     defaultDir: "desc" },
    { key: "unitCost",       label: "Unit Cost",    defaultDir: "desc" },
    { key: "location",       label: "Location",     defaultDir: "asc"  },
    { key: "status",         label: "Status",       defaultDir: "asc"  },
    { key: "maxCheckoutQty", label: "Max Limit",    defaultDir: "desc" },
  ];

  // Compare function that handles numbers, dates (ISO strings), and text.
  function compareAssets(a, b, key, dir) {
    let va = a[key];
    let vb = b[key];
    // Numeric coercion for known numeric keys
    if (["quantity", "unitCost", "maxCheckoutQty"].includes(key)) {
      va = Number(va) || 0;
      vb = Number(vb) || 0;
    } else if (key === "dateAdded") {
      // ISO yyyy-mm-dd sorts lexicographically, but coerce blanks to a
      // very-early date so they fall to the end of descending sorts.
      va = String(va || "0000-00-00");
      vb = String(vb || "0000-00-00");
    } else {
      va = String(va == null ? "" : va).toLowerCase();
      vb = String(vb == null ? "" : vb).toLowerCase();
    }
    let cmp = 0;
    if (va < vb) cmp = -1;
    else if (va > vb) cmp = 1;
    return dir === "desc" ? -cmp : cmp;
  }

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
    // v10.22 — clear attachment state + preview gallery
    stagedFiles  = [];
    editingFiles = [];
    const descEl = document.getElementById("asset-description");
    if (descEl) descEl.value = "";
    renderFilePreview();
    const submitBtn = document.getElementById("asset-submit-btn");
    const cancelBtn = document.getElementById("asset-cancel-btn");
    if (submitBtn) submitBtn.textContent = "Add Asset";
    if (cancelBtn) cancelBtn.hidden = true;
    syncUnitPreview();
    syncLimitPreview();
  }

  // ── v10.22: FORM FILE PREVIEW (multi-file) ─────────────────
  // Renders thumbnails for both already-uploaded files (edit mode) and
  // newly chosen files, each with a remove (✕) button. Lives in the
  // #asset-file-preview container injected into the form.
  function fileUid() { return "f" + Math.random().toString(36).slice(2, 9); }

  function renderFilePreview() {
    const wrap = document.getElementById("asset-file-preview");
    if (!wrap) return;
    const total = editingFiles.length + stagedFiles.length;
    if (!total) { wrap.innerHTML = ""; wrap.classList.remove("has-files"); return; }
    wrap.classList.add("has-files");

    // Existing (server) files
    const existingTiles = editingFiles.map(fn => {
      const fEsc    = esc(String(fn));
      const url     = `uploads/${encodeURIComponent(String(fn))}`;
      const urlEsc  = esc(url);
      const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(fn);
      const isPDF   = /\.pdf$/i.test(fn);
      const media = isImage
        ? `<img src="${urlEsc}" alt="${fEsc}">`
        : `<div class="file-tile-icon">${isPDF ? "📄" : "📎"}<span>${isPDF ? "PDF" : "File"}</span></div>`;
      return `
        <div class="upload-tile" data-existing="${fEsc}">
          <div class="upload-tile-media">${media}</div>
          <button type="button" class="upload-tile-remove" data-remove-existing="${fEsc}" title="Remove this file" aria-label="Remove file">✕</button>
        </div>`;
    }).join("");

    // Newly staged (not-yet-uploaded) files — object URLs for image preview
    const stagedTiles = stagedFiles.map(s => {
      const f       = s.file;
      const isImage = /^image\//.test(f.type);
      const isPDF   = f.type === "application/pdf";
      const media = isImage
        ? `<img src="${URL.createObjectURL(f)}" alt="${esc(f.name)}">`
        : `<div class="file-tile-icon">${isPDF ? "📄" : "📎"}<span>${isPDF ? "PDF" : "File"}</span></div>`;
      return `
        <div class="upload-tile" data-staged="${s.id}">
          <div class="upload-tile-media">${media}</div>
          <button type="button" class="upload-tile-remove" data-remove-staged="${s.id}" title="Remove this file" aria-label="Remove file">✕</button>
          <span class="upload-tile-new">new</span>
        </div>`;
    }).join("");

    wrap.innerHTML = existingTiles + stagedTiles;

    wrap.querySelectorAll("[data-remove-existing]").forEach(btn => {
      btn.addEventListener("click", () => {
        const fn = btn.getAttribute("data-remove-existing");
        editingFiles = editingFiles.filter(x => x !== fn);
        renderFilePreview();
      });
    });
    wrap.querySelectorAll("[data-remove-staged]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-remove-staged");
        stagedFiles = stagedFiles.filter(s => s.id !== id);
        renderFilePreview();
      });
    });
  }

  // Add freshly chosen File objects to the staging list (dedupe by
  // name+size so picking the same file twice doesn't double up).
  function addStagedFiles(fileList) {
    Array.from(fileList || []).forEach(f => {
      const dup = stagedFiles.some(s => s.file.name === f.name && s.file.size === f.size);
      if (!dup) stagedFiles.push({ id: fileUid(), file: f });
    });
    renderFilePreview();
  }

  // ── RENDER TABLE ───────────────────────────────────────────
  function renderInventoryTable() {
    const body = document.getElementById("inventory-table-body");
    if (!body) return;
    const q   = searchTerm.trim().toLowerCase();
    let filtered = allAssets.filter(a => {
      // DepEd filter: show ONLY learning materials lent to students that
      // carry a Bulk ID — i.e. textbooks / modules distributed by DepEd.
      // An item qualifies when it is bulk, has a bulk ID, and belongs to
      // the books / learning-materials category.
      if (depedFilterActive && !isDepEdBook(a)) return false;
      if (!q) return true;
      return [a.id, a.name, a.category, a.bulkId||""].some(v => String(v||"").toLowerCase().includes(q));
    });

    // v10.4: apply sorting after filtering
    filtered = filtered.slice().sort((a, b) => compareAssets(a, b, sortBy, sortDir));

    // Reflect the current sort key + direction on the table headers
    updateSortIndicators();

    if (!filtered.length) {
      const msg = depedFilterActive
        ? "No DepEd books or learning modules (with a Bulk ID) found."
        : "No assets found.";
      body.innerHTML = `<tr><td colspan="11">${msg}</td></tr>`;
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
      // v10.22: small badge showing how many files are attached. The
      // actual files now live inside the Details panel (no more inline
      // View button / IAR File column).
      // v10.23: replaced the raw 📎 emoji (which rendered as a black box on
      // some Windows systems with no emoji font) with an inline SVG paperclip
      // plus an explicit "N file(s)" label so the meaning is clear.
      const fileCount = Array.isArray(a.receiptFiles) ? a.receiptFiles.length
                      : (a.receiptFile ? 1 : 0);
      const clipSvg = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px;"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`;
      const fileChip = fileCount > 0
        ? `<span class="file-count-chip" title="${fileCount} file${fileCount === 1 ? "" : "s"} attached (photo / receipt / IAR) — open Details to view">${clipSvg} ${fileCount} file${fileCount === 1 ? "" : "s"}</span>`
        : "";
      // v10.4: Details button — opens a panel with the full spec sheet + file gallery
      const detailsBtn = `<button class="btn btn-secondary btn-sm details-btn" data-action="details" data-id="${esc(a.id)}" type="button" title="View full item details">🔍 Details</button>`;
      return `<tr>
        <td class="mono-cell">${esc(a.id)}</td>
        <td>${bulkBadge}${esc(a.name)} ${fileChip}</td>
        <td>${window.IMS.createCategoryBadge(a.category)}</td>
        <td>${bulkIdCell}</td>
        <td><span class="qty-unit">${esc(a.quantity)}</span> <span class="unit-tag">${esc(plural(Number(a.quantity), a.unit||"piece"))}</span></td>
        <td>${limitCell}</td>
        <td>${esc(cost)}</td>
        <td>${esc(a.location)}</td>
        <td>${window.IMS.createStatusBadge(a.status)}</td>
        <td class="mono-cell">${esc(a.dateAdded||"—")}</td>
        <td class="action-cell">
          <div class="action-cell-inner">
          ${detailsBtn}
          <button class="btn btn-secondary btn-sm" data-action="edit"     data-id="${esc(a.id)}" type="button">Edit</button>
          <button class="btn btn-secondary btn-sm" data-action="setlimit" data-id="${esc(a.id)}" type="button" title="Quickly change max borrow limit for this item" style="background:#fff7ed;border-color:#f97316;color:#c2410c;">Set Limit</button>
          <button class="btn btn-danger btn-sm"    data-action="delete"   data-id="${esc(a.id)}" type="button">Delete</button>
          </div>
        </td>
      </tr>`;
    }).join("");
  }

  // ── SORT HEADER INDICATORS ────────────────────────────────
  // Adds .sort-asc / .sort-desc to whichever <th> matches sortBy.
  function updateSortIndicators() {
    const ths = document.querySelectorAll("#inventory-table thead th.sortable");
    ths.forEach(th => {
      const key = th.getAttribute("data-sort-key");
      th.classList.toggle("sort-asc",  key === sortBy && sortDir === "asc");
      th.classList.toggle("sort-desc", key === sortBy && sortDir === "desc");
    });
    // Also reflect on the dropdown / direction button if present
    const sel = document.getElementById("inventory-sort-select");
    const dir = document.getElementById("inventory-sort-dir-btn");
    if (sel) sel.value = sortBy;
    if (dir) {
      dir.textContent = sortDir === "asc" ? "↑" : "↓";
      dir.setAttribute("aria-pressed", "true");
      dir.setAttribute("title", `Sort ${sortDir === "asc" ? "ascending" : "descending"} — click to flip`);
    }
  }

  // ── ITEM DETAILS MODAL (v10.4) ────────────────────────────
  // Opens a sheet showing the full asset record + a preview of the
  // uploaded receipt/photo (image inline, PDF iframe, others as a
  // download tile). Read-only — Edit is still done via the form.
  function openDetailsPanel(assetId) {
    const a = allAssets.find(x => x.id === assetId);
    if (!a) return;

    const peso = (v) => Number(v) > 0
      ? new Intl.NumberFormat("en-PH", { style:"currency", currency:"PHP", maximumFractionDigits:2 }).format(v)
      : "—";
    const dash = (v) => (v == null || v === "" ? "—" : v);

    // Build the file gallery (v10.22) — supports multiple attachments
    // shown as neat tiles. Falls back to the single legacy file.
    const files = Array.isArray(a.receiptFiles) && a.receiptFiles.length
      ? a.receiptFiles
      : (a.receiptFile ? [a.receiptFile] : []);
    let filePreview = `<div class="details-file-empty">No files uploaded for this item.</div>`;
    if (files.length) {
      const tiles = files.map(f => {
        const fEsc    = esc(String(f));
        const url     = `uploads/${encodeURIComponent(String(f))}`;
        const urlEsc  = esc(url);
        const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(f);
        const isPDF   = /\.pdf$/i.test(f);
        let thumb;
        if (isImage)    thumb = `<img src="${urlEsc}" alt="${fEsc}" loading="lazy">`;
        else if (isPDF) thumb = `<div class="file-tile-icon">📄<span>PDF</span></div>`;
        else            thumb = `<div class="file-tile-icon">📎<span>File</span></div>`;
        return `
          <a class="file-tile" href="${urlEsc}" target="_blank" rel="noopener" data-file="${fEsc}" title="${fEsc}">
            <div class="file-tile-media">${thumb}</div>
            <div class="file-tile-name">${fEsc}</div>
          </a>`;
      }).join("");
      filePreview = `<div class="file-tile-grid">${tiles}</div>`;
    }

    const totalValue = Number(a.unitCost) > 0 && Number(a.quantity) > 0
      ? peso(Number(a.unitCost) * Number(a.quantity))
      : "—";

    const bulkLine = a.isBulk
      ? `<span class="deped-badge">DepEd / Bulk</span> ${a.bulkId ? `<span class="bulk-id-tag" style="margin-left:0.4rem;">${esc(a.bulkId)}</span>` : ""}`
      : '<span style="color:var(--ink-muted);font-size:0.82rem;">Standard item (not bulk)</span>';

    document.getElementById("details-modal")?.remove();
    const modal = document.createElement("div");
    modal.id = "details-modal";
    modal.className = "details-modal";
    modal.innerHTML = `
      <div class="details-sheet" role="dialog" aria-modal="true" aria-labelledby="details-modal-title">
        <div class="details-header">
          <div>
            <div class="details-title" id="details-modal-title">${esc(a.name)}</div>
            <div class="details-subtitle">${esc(a.id)}</div>
            <div style="margin-top:0.5rem;">${bulkLine}</div>
          </div>
          <button class="details-close" id="details-close-btn" type="button" aria-label="Close">✕</button>
        </div>
        <div class="details-body">
          <div class="details-section-title">Description / Details</div>
          ${a.description && String(a.description).trim()
            ? `<div class="details-description">${esc(a.description)}</div>`
            : `<div class="details-description details-description-empty">No description was added for this item. Use Edit to add brand, model, serial range, color, or condition notes.</div>`}
          <div class="details-section-title">Specifications</div>
          <div class="details-grid">
            <div class="details-cell">
              <div class="details-cell-label">Category</div>
              <div class="details-cell-value">${esc(dash(a.category))}</div>
            </div>
            <div class="details-cell">
              <div class="details-cell-label">Quantity</div>
              <div class="details-cell-value">${esc(a.quantity)} ${esc(plural(Number(a.quantity), a.unit || "piece"))}</div>
            </div>
            <div class="details-cell">
              <div class="details-cell-label">Unit Type</div>
              <div class="details-cell-value">${esc(dash(a.unit))}</div>
            </div>
            <div class="details-cell">
              <div class="details-cell-label">Max Borrow Limit</div>
              <div class="details-cell-value">${a.maxCheckoutQty > 0 ? esc(a.maxCheckoutQty) + " " + esc(plural(a.maxCheckoutQty, a.unit||"piece")) : "No limit"}</div>
            </div>
            <div class="details-cell">
              <div class="details-cell-label">Condition</div>
              <div class="details-cell-value">${esc(dash(a.condition))}</div>
            </div>
            <div class="details-cell">
              <div class="details-cell-label">Status</div>
              <div class="details-cell-value">${window.IMS.createStatusBadge(a.status)}</div>
            </div>
            <div class="details-cell">
              <div class="details-cell-label">Location</div>
              <div class="details-cell-value">${esc(dash(a.location))}</div>
            </div>
            <div class="details-cell">
              <div class="details-cell-label">Date Added</div>
              <div class="details-cell-value mono">${esc(dash(a.dateAdded))}</div>
            </div>
          </div>

          <div class="details-section-title">Financial</div>
          <div class="details-grid">
            <div class="details-cell">
              <div class="details-cell-label">Unit Cost</div>
              <div class="details-cell-value">${esc(peso(a.unitCost))}</div>
            </div>
            <div class="details-cell">
              <div class="details-cell-label">Total Estimated Value</div>
              <div class="details-cell-value">${esc(totalValue)}</div>
            </div>
          </div>

          <div class="details-section-title">Uploaded Files / Receipts</div>
          ${filePreview}
        </div>
        <div class="details-footer">
          <button class="btn btn-secondary" id="details-footer-close" type="button">Close</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.addEventListener("click", e => { if (e.target === modal) close(); });
    document.getElementById("details-close-btn")?.addEventListener("click", close);
    document.getElementById("details-footer-close")?.addEventListener("click", close);
    // v10.22 — open a file tile in the in-app viewer instead of a raw tab.
    modal.querySelectorAll(".file-tile").forEach(tile => {
      tile.addEventListener("click", e => {
        e.preventDefault();
        openFileViewer(tile.getAttribute("data-file"));
      });
    });
    // Escape key to close
    const onKey = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); } };
    document.addEventListener("keydown", onKey);
  }

  // ── FILE VIEWER MODAL ─────────────────────────────────────
  function openFileViewer(filename) {
    // filename comes from data-file attribute → originates from asset.receiptFile
    // which the server generates as 'file_<hex>.<ext>'. Escape anyway because
    // restored backups could carry legacy unsafe names.
    const f       = String(filename || "");
    const fEsc    = window.IMS.escapeHtml(f);
    const url     = `uploads/${encodeURIComponent(f)}`;
    const urlEsc  = window.IMS.escapeHtml(url);
    const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(f);
    const isPDF   = /\.pdf$/i.test(f);

    // Remove existing modal if any
    document.getElementById("file-viewer-modal")?.remove();

    const modal = document.createElement("div");
    modal.id = "file-viewer-modal";
    modal.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;padding:1rem;";

    let content = "";
    if (isImage) {
      content = `<img src="${urlEsc}" alt="${fEsc}" style="max-width:100%;max-height:80vh;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.4);">`;
    } else if (isPDF) {
      content = `<iframe src="${urlEsc}" style="width:min(900px,90vw);height:80vh;border:none;border-radius:8px;"></iframe>`;
    } else {
      content = `<div style="background:#fff;padding:2rem;border-radius:12px;text-align:center;"><p style="margin-bottom:1rem;">📎 ${fEsc}</p><a href="${urlEsc}" download class="btn btn-primary">Download File</a></div>`;
    }

    modal.innerHTML = `
      <div style="position:relative;max-width:95vw;">
        <button id="fv-close" style="position:absolute;top:-2.5rem;right:0;background:rgba(255,255,255,0.2);color:#fff;border:none;border-radius:50%;width:2rem;height:2rem;font-size:1.2rem;cursor:pointer;line-height:1;" title="Close">✕</button>
        <a href="${urlEsc}" download target="_blank" style="position:absolute;top:-2.5rem;left:0;background:rgba(255,255,255,0.2);color:#fff;border:none;border-radius:6px;padding:0.2rem 0.6rem;font-size:0.8rem;text-decoration:none;">⬇ Download</a>
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
    // v10.22 — load existing attachments + description into the form
    editingFiles = Array.isArray(a.receiptFiles) && a.receiptFiles.length
      ? a.receiptFiles.slice()
      : (a.receiptFile ? [a.receiptFile] : []);
    stagedFiles = [];
    const descEl = document.getElementById("asset-description");
    if (descEl) descEl.value = a.description || "";
    renderFilePreview();
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
    const descEl   = document.getElementById("asset-description");
    const description = descEl ? descEl.value.trim() : "";
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

    // v10.22 — upload all newly staged files (multiple). Existing files
    // kept from an edit are preserved in editingFiles.
    let receiptFiles = editingFiles.slice();
    if (stagedFiles.length) {
      if (submitBtn) submitBtn.textContent = "Uploading…";
      const upRes = await window.API.uploadFiles(stagedFiles.map(s => s.file));
      if (!upRes.ok) {
        setMessage(upRes.error || "File upload failed.", "error");
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = editingAssetId ? "Save Changes" : "Add Asset"; }
        return;
      }
      receiptFiles = receiptFiles.concat(upRes.filenames || []);
    }
    const uploadedFilename = receiptFiles[0] || "";

    const conditionEl = document.getElementById("asset-condition");
    const condition = conditionEl ? conditionEl.value : "Good";
    const payload = { name, description, category, quantity: qty, unit, maxCheckoutQty, condition, unitCost, location, status, dateAdded,
                      receiptFile: uploadedFilename, receiptFiles, isBulk, bulkId };

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
  // v10.23: the audit now records ACTUAL COUNTS per item instead of a single
  // Found / Missing / Needs Repair tag. For each asset the custodian enters
  //    found  = how many units were physically present
  //    repair = how many of those present units need repair
  // Missing is derived automatically as  expected - found  (clamped at 0).
  // This lets a custodian record e.g. "found 50 of 80 boxes of chalk, 5 of
  // them need repair" — something the old 3-button toggle could not express.
  function normalizeLocation(v) { return String(v||"").trim().toLowerCase(); }

  function roomAssetsByLocation(loc) {
    return allAssets.filter(a => normalizeLocation(a.location) === normalizeLocation(loc));
  }

  // Returns a clean {found, repair} object for an asset, defaulting to a full
  // "all found, none for repair" count the first time it is seen.
  function auditEntry(asset) {
    const expected = Math.max(0, Number(asset.quantity) || 0);
    let e = roomAuditSelections[asset.id];
    if (!e || typeof e !== "object") {
      e = { found: expected, repair: 0 };
      roomAuditSelections[asset.id] = e;
    }
    // clamp
    e.found  = Math.min(expected, Math.max(0, Number(e.found)  || 0));
    e.repair = Math.min(e.found,   Math.max(0, Number(e.repair) || 0));
    return e;
  }

  function auditMissing(asset) {
    const expected = Math.max(0, Number(asset.quantity) || 0);
    const e = auditEntry(asset);
    return Math.max(0, expected - e.found);
  }

  function calculateAuditSummary(assets) {
    const s = { expectedUnits:0, foundUnits:0, missingUnits:0, needsRepairUnits:0, variance:0 };
    assets.forEach(a => {
      const expected = Math.max(0, Number(a.quantity) || 0);
      const e = auditEntry(a);
      s.expectedUnits    += expected;
      s.foundUnits       += e.found;
      s.needsRepairUnits += e.repair;
      s.missingUnits     += Math.max(0, expected - e.found);
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
      const expected = Math.max(0, Number(a.quantity) || 0);
      const unit     = plural(expected, a.unit || "piece");
      const e        = auditEntry(a);
      const missing  = Math.max(0, expected - e.found);

      // Quick "All Found" shortcut button so a clean room audit is one tap.
      const allFoundActive = (e.found === expected && e.repair === 0) ? "active" : "";

      // A small live status pill so the row reads at a glance.
      let pill;
      if (missing > 0 && e.repair > 0) {
        pill = `<span class="audit-pill audit-pill-mixed">${missing} missing · ${e.repair} repair</span>`;
      } else if (missing > 0) {
        pill = `<span class="audit-pill audit-pill-missing">${missing} missing</span>`;
      } else if (e.repair > 0) {
        pill = `<span class="audit-pill audit-pill-repair">${e.repair} need repair</span>`;
      } else {
        pill = `<span class="audit-pill audit-pill-ok">all accounted for</span>`;
      }

      return `<tr>
        <td class="mono-cell">${esc(a.id)}</td>
        <td>${esc(a.name)}</td>
        <td>${expected} ${esc(unit)}</td>
        <td>${window.IMS.createStatusBadge(a.status)}</td>
        <td>
          <div class="audit-count-row">
            <label class="audit-count-field">
              <span class="audit-count-label">Found</span>
              <input type="number" class="field-input audit-count-input" min="0" max="${expected}" step="1"
                     value="${e.found}" data-audit-id="${esc(a.id)}" data-audit-field="found"
                     title="How many units were physically present (max ${expected})">
            </label>
            <label class="audit-count-field">
              <span class="audit-count-label">Needs Repair</span>
              <input type="number" class="field-input audit-count-input" min="0" max="${e.found}" step="1"
                     value="${e.repair}" data-audit-id="${esc(a.id)}" data-audit-field="repair"
                     title="How many of the FOUND units need repair (max ${e.found})">
            </label>
            <span class="audit-missing-readout" title="Auto-calculated: Expected minus Found">
              <span class="audit-count-label">Missing</span>
              <strong>${missing}</strong>
            </span>
          </div>
          <div class="audit-row-foot">
            <button class="btn btn-secondary btn-sm audit-allfound-btn ${allFoundActive}" type="button"
                    data-audit-action="all-found" data-audit-id="${esc(a.id)}">All ${expected} Found</button>
            ${pill}
          </div>
        </td>
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

    const items = assets.map(a => {
      const expected = Math.max(0, Number(a.quantity) || 0);
      const e        = auditEntry(a);
      const missing  = Math.max(0, expected - e.found);
      // Headline verification label kept for backward-compatible reporting.
      let verification = "Found";
      if (e.found === 0)        verification = "Missing";
      else if (missing > 0)     verification = "Partially Found";
      else if (e.repair > 0)    verification = "Needs Repair";

      // The status we want the asset to carry AFTER the audit so the
      // dashboard analytics reflect what the custodian found on the floor:
      //   - any unit needs repair      → "Needs Repair"
      //   - everything missing         → "Missing"
      //   - otherwise leave it alone (Available / current)
      let updatedStatus = a.status;
      if (e.repair > 0)         updatedStatus = "Needs Repair";
      else if (e.found === 0)   updatedStatus = "Missing";

      return {
        assetId:          a.id,
        assetName:        a.name,
        location:         a.location,
        unit:             a.unit || "piece",
        expectedQuantity: expected,
        foundQuantity:    e.found,
        repairQuantity:   e.repair,
        missingQuantity:  missing,
        verification,
        previousStatus:   a.status,
        updatedStatus,
      };
    });

    const res = await window.API.saveAuditLog({
      location:    selectedAuditLocation,
      auditedOn:   window.IMS.todayISO(),
      auditedBy:   activeUser.name || window.IMS.roleLabel(activeUser.role),
      auditorRole: activeUser.role,
      summary,
      items,
    });
    if (!res.ok) { setAuditMessage(res.error || "Save failed.", "error"); return; }

    const repairNote  = summary.needsRepairUnits > 0 ? ` ${summary.needsRepairUnits} flagged for repair.` : "";
    const missingNote = summary.missingUnits > 0 ? ` ${summary.missingUnits} unaccounted for.` : "";
    setAuditMessage(`Audit ${res.logId||""} saved for ${selectedAuditLocation}.${repairNote}${missingNote}`, "success");

    // v10.24 — show a real results screen so the custodian can SEE what the
    // audit found, not just a one-line toast. This is the "summary that
    // represents the results" of the room audit.
    openAuditResultsModal({
      logId:    res.logId || "",
      location: selectedAuditLocation,
      auditedOn: window.IMS.todayISO(),
      auditedBy: activeUser.name || window.IMS.roleLabel(activeUser.role),
      auditorRole: activeUser.role,
      summary,
      items,
    });

    await loadAndRender();
  }

  // ── ROOM AUDIT RESULTS MODAL (v10.24) ──────────────────────
  // After Finalize, pop a clean report: headline counts, an accuracy
  // figure, the list of problem items (missing / partial / for repair),
  // and a Print button so it can be filed. This is what was missing —
  // previously the audit just saved silently with a tiny toast.
  function openAuditResultsModal(audit) {
    const s = audit.summary || {};
    const items = Array.isArray(audit.items) ? audit.items : [];

    const expected = Number(s.expectedUnits) || 0;
    const found    = Number(s.foundUnits) || 0;
    const missing  = Number(s.missingUnits) || 0;
    const repair   = Number(s.needsRepairUnits) || 0;
    const accuracy = expected > 0 ? Math.round((found / expected) * 100) : 100;

    // Overall verdict — what the audit means at a glance.
    let verdict, verdictClass;
    if (missing === 0 && repair === 0) {
      verdict = "All units accounted for and in good condition.";
      verdictClass = "audit-verdict-ok";
    } else if (missing === 0) {
      verdict = `All units present, but ${repair} need repair.`;
      verdictClass = "audit-verdict-warn";
    } else {
      verdict = `${missing} unit${missing === 1 ? "" : "s"} unaccounted for${repair ? `, ${repair} need repair` : ""}.`;
      verdictClass = "audit-verdict-bad";
    }

    // Only the items that need attention are listed. A fully-found, no-repair
    // room shows a clean "nothing to flag" panel instead of a noisy table.
    const flagged = items.filter(it =>
      (Number(it.missingQuantity) || 0) > 0 || (Number(it.repairQuantity) || 0) > 0
    );

    const issueRows = flagged.map(it => {
      const unit  = plural(Number(it.expectedQuantity) || 0, it.unit || "piece");
      const miss  = Number(it.missingQuantity) || 0;
      const rep   = Number(it.repairQuantity) || 0;
      let tag;
      if (miss > 0 && rep > 0) {
        tag = `<span class="audit-res-tag audit-res-tag-mixed">${miss} missing · ${rep} repair</span>`;
      } else if (miss > 0) {
        tag = (Number(it.foundQuantity) || 0) === 0
          ? `<span class="audit-res-tag audit-res-tag-missing">${miss} missing (all)</span>`
          : `<span class="audit-res-tag audit-res-tag-missing">${miss} missing</span>`;
      } else {
        tag = `<span class="audit-res-tag audit-res-tag-repair">${rep} need repair</span>`;
      }
      return `<tr>
        <td class="mono-cell">${esc(it.assetId)}</td>
        <td>${esc(it.assetName)}</td>
        <td>${esc(it.expectedQuantity)} ${esc(unit)}</td>
        <td>${esc(it.foundQuantity)}</td>
        <td>${tag}</td>
      </tr>`;
    }).join("");

    const issuesBlock = flagged.length
      ? `<div class="details-section-title">Items needing attention (${flagged.length})</div>
         <div class="table-card audit-res-table-card">
           <table class="audit-res-table">
             <thead><tr>
               <th>Asset ID</th><th>Asset Name</th><th>Expected</th><th>Found</th><th>Result</th>
             </tr></thead>
             <tbody>${issueRows}</tbody>
           </table>
         </div>`
      : `<div class="audit-res-clean">
           <div class="audit-res-clean-icon">✓</div>
           <div>
             <strong>Nothing to flag.</strong>
             <div>Every item in this room was found and is in good condition.</div>
           </div>
         </div>`;

    document.getElementById("audit-results-modal")?.remove();
    const modal = document.createElement("div");
    modal.id = "audit-results-modal";
    modal.className = "details-modal";
    modal.innerHTML = `
      <div class="details-sheet audit-res-sheet" role="dialog" aria-modal="true" aria-labelledby="audit-res-title">
        <div class="details-header">
          <div>
            <div class="details-title" id="audit-res-title">Room Audit Results</div>
            <div class="details-subtitle">${esc(audit.location)}${audit.logId ? ` · ${esc(audit.logId)}` : ""}</div>
            <div class="audit-res-meta">
              Audited ${esc(audit.auditedOn)} by ${esc(audit.auditedBy)} (${esc(window.IMS.roleLabel(audit.auditorRole) || audit.auditorRole)})
            </div>
          </div>
          <button class="details-close" id="audit-res-close-btn" type="button" aria-label="Close">✕</button>
        </div>

        <div class="details-body">
          <div class="audit-res-verdict ${verdictClass}">${esc(verdict)}</div>

          <div class="audit-res-stat-grid">
            <div class="audit-res-stat">
              <div class="audit-res-stat-label">Expected</div>
              <div class="audit-res-stat-value">${expected}</div>
            </div>
            <div class="audit-res-stat audit-res-stat-found">
              <div class="audit-res-stat-label">Found</div>
              <div class="audit-res-stat-value">${found}</div>
            </div>
            <div class="audit-res-stat audit-res-stat-missing">
              <div class="audit-res-stat-label">Missing</div>
              <div class="audit-res-stat-value">${missing}</div>
            </div>
            <div class="audit-res-stat audit-res-stat-repair">
              <div class="audit-res-stat-label">Needs Repair</div>
              <div class="audit-res-stat-value">${repair}</div>
            </div>
            <div class="audit-res-stat audit-res-stat-accuracy">
              <div class="audit-res-stat-label">Accuracy</div>
              <div class="audit-res-stat-value">${accuracy}%</div>
            </div>
          </div>

          <div class="audit-res-bar" title="${found} of ${expected} units accounted for">
            <div class="audit-res-bar-fill" style="width:${Math.min(100, accuracy)}%;"></div>
          </div>

          ${issuesBlock}

          <div class="audit-res-note">
            Asset records were updated from these findings: items with units needing
            repair are now marked <strong>Needs Repair</strong>, fully missing items are
            marked <strong>Missing</strong>, and items found in good order are restored to
            <strong>Available</strong>. The dashboard analytics reflect this audit.
          </div>
        </div>

        <div class="details-footer audit-res-footer">
          <button class="btn btn-secondary" id="audit-res-print-btn" type="button">🖨 Print / Save PDF</button>
          <button class="btn btn-primary" id="audit-res-done-btn" type="button">Done</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.addEventListener("click", e => { if (e.target === modal) close(); });
    document.getElementById("audit-res-close-btn")?.addEventListener("click", close);
    document.getElementById("audit-res-done-btn")?.addEventListener("click", close);
    document.getElementById("audit-res-print-btn")?.addEventListener("click", () =>
      printAuditResults(audit, { expected, found, missing, repair, accuracy, verdict, flagged })
    );
    const onKey = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); } };
    document.addEventListener("keydown", onKey);
  }

  // Opens a printable report in a new window (also works as Save-as-PDF
  // from the browser print dialog) so the audit can be filed on paper.
  function printAuditResults(audit, c) {
    const rows = c.flagged.map(it => {
      const miss = Number(it.missingQuantity) || 0;
      const rep  = Number(it.repairQuantity) || 0;
      const result = miss > 0 && rep > 0 ? `${miss} missing, ${rep} repair`
        : miss > 0 ? `${miss} missing`
        : `${rep} need repair`;
      return `<tr>
        <td>${esc(it.assetId)}</td><td>${esc(it.assetName)}</td>
        <td style="text-align:center;">${esc(it.expectedQuantity)}</td>
        <td style="text-align:center;">${esc(it.foundQuantity)}</td>
        <td>${esc(result)}</td></tr>`;
    }).join("");

    const issuesTable = c.flagged.length
      ? `<h3>Items Needing Attention (${c.flagged.length})</h3>
         <table>
           <thead><tr><th>Asset ID</th><th>Asset Name</th><th>Expected</th><th>Found</th><th>Result</th></tr></thead>
           <tbody>${rows}</tbody>
         </table>`
      : `<p class="clean">All items were found and in good condition. Nothing to flag.</p>`;

    const w = window.open("", "_blank", "width=820,height=900");
    if (!w) { setAuditMessage("Allow pop-ups to print the audit report.", "error"); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8">
      <title>Room Audit Report — ${esc(audit.location)}</title>
      <style>
        *{box-sizing:border-box;} body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;margin:32px;}
        h1{font-size:20px;margin:0 0 2px;} h3{margin:22px 0 8px;font-size:14px;}
        .sub{color:#475569;font-size:13px;margin-bottom:2px;}
        .meta{color:#64748b;font-size:12px;margin-bottom:18px;}
        .verdict{padding:10px 14px;border-radius:8px;font-weight:bold;font-size:14px;margin:14px 0 18px;
                 border:1px solid #cbd5e1;background:#f1f5f9;}
        .grid{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:6px;}
        .stat{flex:1;min-width:110px;border:1px solid #cbd5e1;border-radius:8px;padding:10px 12px;}
        .stat .l{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.04em;}
        .stat .v{font-size:22px;font-weight:bold;margin-top:2px;}
        table{width:100%;border-collapse:collapse;font-size:12.5px;}
        th,td{border:1px solid #cbd5e1;padding:7px 9px;text-align:left;}
        th{background:#f1f5f9;}
        .clean{padding:12px;border:1px dashed #94a3b8;border-radius:8px;color:#475569;}
        .foot{margin-top:24px;font-size:11px;color:#94a3b8;}
        @media print{ body{margin:14mm;} button{display:none;} }
      </style></head><body>
      <h1>Don Servillano Platon Memorial National High School</h1>
      <div class="sub">Room Audit Report — ${esc(audit.location)}${audit.logId ? ` (${esc(audit.logId)})` : ""}</div>
      <div class="meta">Audited ${esc(audit.auditedOn)} by ${esc(audit.auditedBy)}</div>
      <div class="verdict">${esc(c.verdict)}</div>
      <div class="grid">
        <div class="stat"><div class="l">Expected</div><div class="v">${c.expected}</div></div>
        <div class="stat"><div class="l">Found</div><div class="v">${c.found}</div></div>
        <div class="stat"><div class="l">Missing</div><div class="v">${c.missing}</div></div>
        <div class="stat"><div class="l">Needs Repair</div><div class="v">${c.repair}</div></div>
        <div class="stat"><div class="l">Accuracy</div><div class="v">${c.accuracy}%</div></div>
      </div>
      ${issuesTable}
      <p class="foot">Generated by Platonian's IS. Internal reference for property accountability.</p>
      <script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script>
      </body></html>`);
    w.document.close();
  }

  // ── VIEW MANAGEMENT ────────────────────────────────────────
  function updateInventoryView(role) {
    const reg   = document.getElementById("register");
    const mgmt  = document.getElementById("inventory-management-section");
    const audit = document.getElementById("room-audit-section");
    const isReg = window.location.hash === "#register";
    if (!reg || !mgmt) return;
    // v10.16: only the Custodian writes inventory (add/edit/remove,
    // registration, room audit). The Principal (admin) and ICT
    // (superadmin) are view-only here.
    const isViewer = role === "admin" || role === "superadmin" || role === "principal";
    if (role === "custodian") {
      reg.hidden   = !isReg;
      mgmt.hidden  = isReg;
      if (audit) audit.hidden = isReg;
    } else if (isViewer) {
      // View-only — hide the registration form and the room-audit
      // section entirely. The inventory table stays visible.
      reg.hidden  = true;
      mgmt.hidden = false;
      if (audit) audit.hidden = true;
    } else {
      reg.hidden = mgmt.hidden = false;
      if (audit) audit.hidden = false;
    }
    const tp = document.getElementById("topbar-page");
    if (tp) tp.textContent = isReg ? "Asset Registration" : "Inventory Management";

    // Strip action buttons for view-only roles (defense in depth — the
    // server role guards block writes anyway, but no dangling buttons).
    if (isViewer) {
      const tbody = document.getElementById("inventory-table-body");
      if (tbody) {
        tbody.classList.add("hide-write-actions");
      }
    }
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

    // ── v10.4: SORT CONTROLS ────────────────────────────────
    const sortSel    = document.getElementById("inventory-sort-select");
    const sortDirBtn = document.getElementById("inventory-sort-dir-btn");
    const sortReset  = document.getElementById("inventory-sort-reset-btn");

    if (sortSel) {
      sortSel.value = sortBy; // sync UI with default state
      sortSel.addEventListener("change", () => {
        sortBy = sortSel.value;
        // Snap to that field's natural default direction the first time
        const opt = SORT_OPTIONS.find(o => o.key === sortBy);
        if (opt) sortDir = opt.defaultDir;
        renderInventoryTable();
      });
    }
    if (sortDirBtn) {
      sortDirBtn.addEventListener("click", () => {
        sortDir = sortDir === "asc" ? "desc" : "asc";
        renderInventoryTable();
      });
    }
    if (sortReset) {
      sortReset.addEventListener("click", () => {
        sortBy  = "dateAdded";
        sortDir = "desc";
        renderInventoryTable();
      });
    }
    // Clickable column headers — click to sort by that column,
    // click again to flip direction.
    document.querySelectorAll("#inventory-table thead th.sortable").forEach(th => {
      th.addEventListener("click", () => {
        const key = th.getAttribute("data-sort-key");
        if (!key) return;
        if (key === sortBy) {
          sortDir = sortDir === "asc" ? "desc" : "asc";
        } else {
          sortBy = key;
          const opt = SORT_OPTIONS.find(o => o.key === key);
          sortDir = opt ? opt.defaultDir : "asc";
        }
        renderInventoryTable();
      });
    });

    if (form) form.addEventListener("submit", submitAsset);
    if (cancelBtn) cancelBtn.addEventListener("click", () => { resetForm(); setMessage(""); });

    // v10.22 — multi-file picker: stage chosen files for preview, then
    // clear the native input so re-picking the same file still fires.
    const receiptInp = document.getElementById("asset-receipt");
    if (receiptInp) {
      receiptInp.addEventListener("change", () => {
        addStagedFiles(receiptInp.files);
        receiptInp.value = "";
      });
    }
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
      renderLocationList();
      setMessage(`Location "${res.location}" added.`, "success");
    }
    if (addLocBtn) addLocBtn.addEventListener("click", addLocation);
    if (newLocInp) newLocInp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addLocation(); } });

    // v10.22 — delete a location / room. Backend blocks deletion while
    // items are still stored there and returns a helpful message.
    async function deleteLocation(name) {
      const ok = window.IMS && window.IMS.confirm
        ? await window.IMS.confirm({
            title: `Delete location "${name}"?`,
            message: "Items still stored in this room must be moved or removed first. This cannot be undone.",
            confirmText: "Delete location",
            cancelText: "Cancel",
            tone: "danger",
          })
        : window.confirm(`Delete location "${name}"?`);
      if (!ok) return;
      const res = await window.API.deleteLocation(name);
      if (!res.ok) { setMessage(res.error || "Cannot delete location.", "error"); return; }
      await refreshDropdowns();
      populateLocationOptions();
      refreshRoomAuditInterface();
      renderLocationList();
      setMessage(`Location "${name}" deleted.`, "success");
    }

    // List of existing locations with delete buttons (mirrors categories).
    async function renderLocationList() {
      const listEl = document.getElementById("location-manage-list");
      if (!listEl) return;
      const locs = await window.API.getLocations();
      if (!locs.length) { listEl.innerHTML = '<em style="color:var(--gray-400);font-size:0.8rem;">No locations yet.</em>'; return; }
      listEl.innerHTML = locs.map(l =>
        `<div class="cat-list-item">
           <span>${esc(l)}</span>
           <button class="btn btn-danger btn-sm" data-delete-loc="${esc(l)}" type="button" title="Delete location">✕</button>
         </div>`
      ).join("");
      listEl.querySelectorAll("[data-delete-loc]").forEach(btn => {
        btn.addEventListener("click", () => deleteLocation(btn.getAttribute("data-delete-loc")));
      });
    }
    renderLocationList();

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
      // Quick "All Found" shortcut.
      auditBody.addEventListener("click", e => {
        const btn = e.target.closest("button[data-audit-action='all-found']");
        if (!btn) return;
        const id = btn.getAttribute("data-audit-id");
        if (!id) return;
        const asset = roomAssetsByLocation(selectedAuditLocation).find(a => a.id === id);
        if (!asset) return;
        roomAuditSelections[id] = { found: Math.max(0, Number(asset.quantity) || 0), repair: 0 };
        renderAuditTable();
      });

      // Live count entry — recalculates without losing focus where possible.
      // We re-render on change (not every keystroke) so the cursor stays put
      // while typing, but the Missing readout + summary still refresh.
      auditBody.addEventListener("input", e => {
        const inp = e.target.closest("input.audit-count-input");
        if (!inp) return;
        const id    = inp.getAttribute("data-audit-id");
        const field = inp.getAttribute("data-audit-field");
        if (!id || !field) return;
        const asset = roomAssetsByLocation(selectedAuditLocation).find(a => a.id === id);
        if (!asset) return;
        const expected = Math.max(0, Number(asset.quantity) || 0);
        const e2 = roomAuditSelections[id] || { found: expected, repair: 0 };
        let val = Math.max(0, Math.floor(Number(inp.value) || 0));
        if (field === "found") {
          val = Math.min(expected, val);
          e2.found = val;
          if (e2.repair > val) e2.repair = val;   // repair can't exceed found
        } else { // repair
          val = Math.min(e2.found, val);
          e2.repair = val;
        }
        roomAuditSelections[id] = e2;
        // Update only the live readouts so typing isn't interrupted.
        renderAuditSummary(roomAssetsByLocation(selectedAuditLocation));
        const row = inp.closest("tr");
        if (row) {
          const missing = Math.max(0, expected - e2.found);
          const ro = row.querySelector(".audit-missing-readout strong");
          if (ro) ro.textContent = missing;
          // keep repair max + displayed value in sync (if found was lowered
          // below the current repair count, repair is clamped down too)
          const repairInp = row.querySelector("input[data-audit-field='repair']");
          if (repairInp) {
            repairInp.max = String(e2.found);
            if (field === "found" && Number(repairInp.value) > e2.found) {
              repairInp.value = String(e2.repair);
            }
          }
        }
      });

      // On blur, do a full re-render to refresh pills / clamp display.
      auditBody.addEventListener("change", e => {
        const inp = e.target.closest("input.audit-count-input");
        if (!inp) return;
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
        if (action === "details") { openDetailsPanel(id); return; }
        if (action === "viewfile") {
          const file = btn.getAttribute("data-file");
          if (file) openFileViewer(file);
          return;
        }

        // ── Quick inline limit edit (v10.22: styled modal, no prompt) ─
        if (action === "setlimit") {
          const assets  = window._cachedAssets || await window.API.getAssets();
          const asset   = assets.find(a => a.id === id);
          if (!asset) return;
          const result = await openSetLimitModal(asset);
          if (result === null) return; // cancelled
          const newLimit = Math.max(0, parseInt(result, 10) || 0);
          const unit     = asset.unit || "piece";
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

  // ── v10.22: SET-LIMIT MODAL ───────────────────────────────
  // Replaces the native window.prompt() (which showed an ugly
  // "localhost says" dialog). Resolves to the entered string, or null
  // if cancelled.
  function openSetLimitModal(asset) {
    return new Promise(resolve => {
      const unit    = asset.unit || "piece";
      const current = asset.maxCheckoutQty || 0;
      document.getElementById("setlimit-modal")?.remove();
      const modal = document.createElement("div");
      modal.id = "setlimit-modal";
      modal.className = "details-modal setlimit-modal";
      modal.innerHTML = `
        <div class="setlimit-box" role="dialog" aria-modal="true" aria-labelledby="setlimit-title">
          <div class="setlimit-head">
            <div class="setlimit-icon">📦</div>
            <div>
              <div class="setlimit-title" id="setlimit-title">Set Max Borrow Limit</div>
              <div class="setlimit-sub">${esc(asset.name)}</div>
            </div>
          </div>
          <div class="setlimit-body">
            <div class="setlimit-meta">
              <span>Unit: <strong>${esc(unit)}</strong></span>
              <span>Current limit: <strong>${current === 0 ? "no limit" : current}</strong></span>
            </div>
            <label class="setlimit-label" for="setlimit-input">Enter new limit <span>(0 = no limit)</span></label>
            <input id="setlimit-input" class="field-input" type="number" min="0" inputmode="numeric" value="${current}">
          </div>
          <div class="setlimit-actions">
            <button type="button" class="btn btn-secondary" id="setlimit-cancel">Cancel</button>
            <button type="button" class="btn btn-primary" id="setlimit-ok">Save Limit</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
      const input = modal.querySelector("#setlimit-input");
      setTimeout(() => { input.focus(); input.select(); }, 60);

      const cleanup = (val) => {
        modal.remove();
        document.removeEventListener("keydown", onKey);
        resolve(val);
      };
      const onKey = (e) => {
        if (e.key === "Escape") cleanup(null);
        else if (e.key === "Enter") cleanup(input.value);
      };
      document.addEventListener("keydown", onKey);
      modal.addEventListener("click", e => { if (e.target === modal) cleanup(null); });
      modal.querySelector("#setlimit-cancel").addEventListener("click", () => cleanup(null));
      modal.querySelector("#setlimit-ok").addEventListener("click", () => cleanup(input.value));
    });
  }

  // ── UTILITY ────────────────────────────────────────────────
  function esc(v) { return window.IMS.escapeHtml(v); }

  // ── INIT ───────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", async () => {
    if (!document.body || document.body.dataset.page !== "inventory") return;
    // v10: ensure server session + CSRF token are loaded before any UI runs
    if (window.API && window.API.bootstrap) await window.API.bootstrap();
    const user = window.IMS.requireAuth("inventory");
    if (!user) return;
    activeUser = user;
    window.IMS.initLayout("inventory", "Inventory Management");
    await refreshDropdowns();
    resetForm();
    bindEvents();
    await loadAndRender();
    updateInventoryView(user.role);
    // v10.17 — make sure the right nav item is highlighted on first
    // load (e.g. landing directly on inventory.html#register) and on
    // every subsequent hash switch between the two inventory views.
    if (window.IMS.refreshNavActive) window.IMS.refreshNavActive();
    window.addEventListener("hashchange", () => {
      updateInventoryView(user.role);
      if (window.IMS.refreshNavActive) window.IMS.refreshNavActive();
    });
  });
})();
