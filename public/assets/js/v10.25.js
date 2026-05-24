// ============================================================
// Platonian's School Assets - v10.25 frontend patch
// ============================================================
// Loaded LAST. Additive only.
//
// FEATURE: turn the hard-to-scan native <select> dropdowns on the
// Check Out, Return, and Borrow forms into a SEARCHABLE input with
// autosuggest. Typing filters the list; clicking a suggestion picks
// the item.
//
// DESIGN (why this is safe):
//   The native <select> stays in the DOM as the single source of
//   truth. We hide it, lay a text input + suggestion box over it,
//   and on pick we set select.value and fire a 'change' event. So
//   every existing handler that reads
//     document.getElementById('checkout-asset-id').value
//   or listens for 'change' on it keeps working untouched —
//   quantity auto-update, condition auto-fill, submit validation.
//
//   A MutationObserver re-syncs the search input whenever the page
//   repopulates the select's <option> list (e.g. after a checkout
//   refreshes available stock).
// ============================================================

(function () {
  "use strict";

  var esc = (window.IMS && window.IMS.escapeHtml)
    ? window.IMS.escapeHtml
    : function (s) {
        return String(s == null ? "" : s)
          .replace(/&/g, "&amp;").replace(/</g, "&lt;")
          .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      };

  // Targets: [selectId, placeholder]
  var TARGETS = [
    ["checkout-asset-id",      "Search asset by ID or name…"],
    ["return-transaction-id",  "Search by transaction ID, asset, or borrower…"],
    ["borrow-asset-id",        "Search asset by name…"],
    ["teacher-return-transaction-id", "Search by transaction ID or asset…"],
    ["room-audit-location",    "Search for a room / location…"],
    ["asset-location",         "Search or pick a room / location…"],
  ];

  function makeSearchable(selectId, placeholder) {
    var sel = document.getElementById(selectId);
    if (!sel) return;
    if (sel.dataset.searchable === "1") return; // already wired
    sel.dataset.searchable = "1";

    // Hide the native select but keep it in the DOM and functional.
    sel.style.display = "none";
    // A hidden field with `required` can make the browser try to focus an
    // invisible element on submit (and warn in the console). All these forms
    // validate in JS anyway, so drop the native constraint; the search input
    // visually carries the requirement instead.
    if (sel.required) { sel.required = false; sel.dataset.wasRequired = "1"; }

    var wrap = document.createElement("div");
    wrap.className = "searchable-select";
    wrap.style.position = "relative";

    var input = document.createElement("input");
    input.type = "text";
    input.className = "field-input searchable-select-input";
    input.setAttribute("autocomplete", "off");
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "false");
    input.placeholder = placeholder || "Search…";

    var box = document.createElement("div");
    box.className = "suggest-box";

    // Insert the wrapper right after the native select.
    sel.parentNode.insertBefore(wrap, sel.nextSibling);
    wrap.appendChild(input);
    wrap.appendChild(box);

    // ---- helpers --------------------------------------------
    function realOptions() {
      // Skip placeholder options (empty value) like "No assets available".
      return Array.prototype.filter.call(sel.options, function (o) {
        return o.value !== "";
      });
    }

    function syncInputFromSelect() {
      var opt = sel.options[sel.selectedIndex];
      if (opt && opt.value !== "") {
        input.value = opt.textContent.trim();
        input.dataset.picked = "1";
      } else {
        // No real selection — if there are no real options, reflect the
        // placeholder text so the user understands why.
        var ro = realOptions();
        if (!ro.length && sel.options.length) {
          input.value = "";
          input.placeholder = sel.options[0].textContent.trim() || placeholder;
          input.disabled = true;
        } else {
          input.disabled = false;
          input.placeholder = placeholder;
          if (input.dataset.picked !== "1") input.value = "";
        }
      }
    }

    function pick(optValue, optText) {
      sel.value = optValue;
      input.value = optText;
      input.dataset.picked = "1";
      box.style.display = "none";
      input.setAttribute("aria-expanded", "false");
      // Fire change so existing listeners (qty update, condition fill) run.
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function render(filter) {
      var q = String(filter || "").trim().toLowerCase();
      var opts = realOptions();
      var matches = opts.filter(function (o) {
        return o.textContent.toLowerCase().indexOf(q) !== -1;
      });
      if (!matches.length) {
        box.innerHTML = '<div class="suggest-empty">No matching items.</div>';
        box.style.display = "block";
        input.setAttribute("aria-expanded", "true");
        return;
      }
      box.innerHTML = matches.map(function (o) {
        return '<div class="suggest-item" data-value="' + esc(o.value) + '">' +
                 '<span class="suggest-name">' + esc(o.textContent.trim()) + "</span>" +
               "</div>";
      }).join("");
      box.style.display = "block";
      input.setAttribute("aria-expanded", "true");
      Array.prototype.forEach.call(box.querySelectorAll(".suggest-item"), function (item) {
        item.addEventListener("mousedown", function (e) {
          // mousedown (not click) so it fires before input blur hides the box.
          e.preventDefault();
          var val = item.getAttribute("data-value");
          var opt = opts.filter(function (o) { return o.value === val; })[0];
          pick(val, opt ? opt.textContent.trim() : item.textContent.trim());
        });
      });
    }

    // ---- events ---------------------------------------------
    input.addEventListener("focus", function () {
      if (input.disabled) return;
      render(""); // show full list on focus
    });
    input.addEventListener("input", function () {
      input.dataset.picked = "";
      sel.value = ""; // clear underlying selection while typing
      render(input.value);
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { box.style.display = "none"; input.setAttribute("aria-expanded", "false"); }
    });
    document.addEventListener("click", function (e) {
      if (!wrap.contains(e.target)) {
        box.style.display = "none";
        input.setAttribute("aria-expanded", "false");
        // If the user typed but never picked, snap back to the current
        // valid selection (or clear) so the form never submits a stray
        // text value the <select> doesn't actually hold.
        if (input.dataset.picked !== "1") syncInputFromSelect();
      }
    });

    // Re-sync whenever the option list is rebuilt by the app.
    var mo = new MutationObserver(function () {
      // Preserve a picked value if it still exists after repopulation.
      var picked = sel.value;
      var stillThere = Array.prototype.some.call(sel.options, function (o) {
        return o.value === picked && picked !== "";
      });
      if (!stillThere) { input.dataset.picked = ""; }
      syncInputFromSelect();
    });
    mo.observe(sel, { childList: true });

    // Initial sync.
    syncInputFromSelect();
  }

  function wireAll() {
    TARGETS.forEach(function (t) { makeSearchable(t[0], t[1]); });
  }

  // The selects are populated asynchronously after page init, so wire
  // on load and also retry a few times to catch late-rendered forms.
  function boot() {
    wireAll();
    var tries = 0;
    var iv = setInterval(function () {
      wireAll();
      if (++tries >= 10) clearInterval(iv); // ~3s of retries, then stop
    }, 300);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
