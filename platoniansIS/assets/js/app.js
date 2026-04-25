(() => {
  "use strict";

  const STORAGE_KEYS = {
    assets: "ims_assets",
    transactions: "ims_transactions",
    auditLogs: "ims_audit_logs",
    users: "ims_users",
    categories: "ims_categories",
    locations: "ims_locations",
    assetCounter: "ims_asset_counter",
    transactionCounter: "ims_transaction_counter",
    borrowRequests: "ims_borrow_requests",
    requestCounter: "ims_request_counter",
    bulkCounter: "ims_bulk_counter",
    seeded: "ims_seeded",
    currentUser: "ims_current_user",
    role: "role"
  };

  const LOW_STOCK_THRESHOLD = 5;
  const DEFAULT_USERS = [
    { email: "admin@test.com", password: "123", role: "admin", name: "Administrator" },
    { email: "custodian@test.com", password: "123", role: "custodian", name: "Property Custodian" },
    { email: "teacher@test.com", password: "123", role: "teacher", name: "Teacher" }
  ];

  const ROLE_META = {
    admin: { label: "Admin", color: "#0d9488", initials: "A" },
    custodian: { label: "Property Custodian", color: "#14b8a6", initials: "C" },
    teacher: { label: "Teacher", color: "#2dd4bf", initials: "T" }
  };

  const DEFAULT_CATEGORIES = [
    "Electronics",
    "Office Equipment",
    "Audio",
    "Furniture",
    "Consumables"
  ];
  const DEFAULT_LOCATIONS = [
    "Admin Office",
    "Audio Room",
    "AV Room",
    "Faculty Room",
    "ICT Room",
    "Supply Room"
  ];
  const CATEGORY_TAG_PALETTE = [
    { bg: "#dbeafe", text: "#1d4ed8" },
    { bg: "#dcfce7", text: "#166534" },
    { bg: "#fef3c7", text: "#92400e" },
    { bg: "#fee2e2", text: "#b91c1c" },
    { bg: "#f3e8ff", text: "#6b21a8" },
    { bg: "#cffafe", text: "#155e75" },
    { bg: "#e2e8f0", text: "#334155" },
    { bg: "#ffedd5", text: "#9a3412" }
  ];

  const NAVIGATION = {
    admin: [
      { id: "dashboard", label: "Dashboard", href: "dashboard.html", icon: "layout-dashboard" },
      { id: "inventory", label: "Inventory", href: "inventory.html", icon: "package" },
      { id: "reports", label: "Reports", href: "reports.html", icon: "file-text" },
      { id: "users", label: "Users", href: "users.html", icon: "users" },
      { id: "transactions", label: "Transaction Logs", href: "transactions.html", icon: "scroll-text" },
      { id: "policy", label: "Lending Policy", href: "policy.html", icon: "clipboard-check" }
    ],
    custodian: [
      { id: "dashboard", label: "Dashboard", href: "dashboard.html", icon: "layout-dashboard" },
      { id: "inventory", label: "Inventory Management", href: "inventory.html", icon: "package" },
      { id: "reports", label: "Reports", href: "reports.html", icon: "file-text" },
      { id: "transactions", label: "Check In / Check Out", href: "transactions.html", icon: "repeat" },
      { id: "assetRegistration", label: "Asset Registration", href: "inventory.html#register", icon: "clipboard-check" },
      { id: "policy", label: "Lending Policy", href: "policy.html", icon: "clipboard-check" }
    ],
    teacher: [
      { id: "dashboard", label: "Dashboard", href: "dashboard.html", icon: "layout-dashboard" },
      { id: "borrow", label: "Borrow Item", href: "borrow.html", icon: "send" },
      { id: "return", label: "Return Item", href: "return.html", icon: "inbox" },
      { id: "transactions", label: "View Borrowed Assets", href: "transactions.html", icon: "file-text" }
    ]
  };

  const PAGE_PERMISSIONS = {
    dashboard:    ["admin", "custodian", "teacher"],
    inventory:    ["admin", "custodian"],
    transactions: ["admin", "custodian", "teacher"],
    borrow:       ["teacher"],
    return:       ["teacher"],
    reports:      ["admin", "custodian"],
    users:        ["admin"],
    policy:       ["admin", "custodian"],
  };

  const DEFAULT_ASSETS = [
    {
      id: "AST-0001",
      name: "Laptop",
      category: "Electronics",
      quantity: 8,
      unitCost: 42000,
      location: "ICT Room",
      status: "Available",
      dateAdded: "2026-01-10",
      receiptFile: "laptop_invoice.pdf"
    },
    {
      id: "AST-0002",
      name: "Projector",
      category: "Electronics",
      quantity: 4,
      unitCost: 28000,
      location: "AV Room",
      status: "Available",
      dateAdded: "2026-01-12",
      receiptFile: "projector_receipt.jpg"
    },
    {
      id: "AST-0003",
      name: "Printer",
      category: "Office Equipment",
      quantity: 3,
      unitCost: 9500,
      location: "Admin Office",
      status: "In Use",
      dateAdded: "2026-01-18",
      receiptFile: "printer_receipt.png"
    },
    {
      id: "AST-0004",
      name: "Speaker",
      category: "Audio",
      quantity: 6,
      unitCost: 6500,
      location: "Audio Room",
      status: "Available",
      dateAdded: "2026-01-22",
      receiptFile: "speaker_receipt.pdf"
    },
    {
      id: "AST-0005",
      name: "Chalk",
      category: "Consumables",
      quantity: 80,
      unitCost: 45,
      location: "Supply Room",
      status: "Available",
      dateAdded: "2026-01-24",
      receiptFile: "chalk_purchase.pdf"
    },
    {
      id: "AST-0006",
      name: "Bond Paper A4",
      category: "Consumables",
      quantity: 60,
      unitCost: 260,
      location: "Supply Room",
      status: "Available",
      dateAdded: "2026-01-24",
      receiptFile: "bondpaper_a4_receipt.pdf"
    },
    {
      id: "AST-0007",
      name: "Bond Paper Legal",
      category: "Consumables",
      quantity: 45,
      unitCost: 290,
      location: "Supply Room",
      status: "Available",
      dateAdded: "2026-01-25",
      receiptFile: "bondpaper_legal_receipt.pdf"
    },
    {
      id: "AST-0008",
      name: "Whiteboard Marker",
      category: "Consumables",
      quantity: 35,
      unitCost: 120,
      location: "Faculty Room",
      status: "Available",
      dateAdded: "2026-01-25",
      receiptFile: "marker_receipt.jpg"
    },
    {
      id: "AST-0009",
      name: "Manila Paper",
      category: "Consumables",
      quantity: 50,
      unitCost: 18,
      location: "Supply Room",
      status: "Available",
      dateAdded: "2026-01-26",
      receiptFile: "manila_paper_receipt.pdf"
    },
    {
      id: "AST-0010",
      name: "Cartolina",
      category: "Consumables",
      quantity: 40,
      unitCost: 22,
      location: "Supply Room",
      status: "Available",
      dateAdded: "2026-01-26",
      receiptFile: "cartolina_receipt.pdf"
    }
  ];

  const DEFAULT_CONSUMABLE_ASSETS = DEFAULT_ASSETS.filter((asset) => {
    return String(asset.category || "").trim().toLowerCase() === "consumables";
  });
  const CONSUMABLE_KEYWORDS = [
    "chalk",
    "bond paper",
    "marker",
    "manila",
    "cartolina"
  ];

  const DEFAULT_TRANSACTIONS = [
    {
      id: "TRX-0001",
      assetId: "AST-0001",
      assetName: "Laptop",
      quantity: 1,
      borrower: "Teacher",
      role: "teacher",
      borrowDate: "2026-02-20",
      returnDate: "2026-03-05",
      condition: "Good",
      status: "Borrowed",
      actualReturnDate: "",
      returnedCondition: ""
    },
    {
      id: "TRX-0002",
      assetId: "AST-0004",
      assetName: "Speaker",
      quantity: 1,
      borrower: "Property Custodian",
      role: "custodian",
      borrowDate: "2026-02-12",
      returnDate: "2026-02-18",
      condition: "Good",
      status: "Returned",
      actualReturnDate: "2026-02-18",
      returnedCondition: "Good"
    }
  ];

  const chartRegistry = {};

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function parseJson(value, fallback) {
    try {
      const parsed = JSON.parse(value);
      return parsed == null ? fallback : parsed;
    } catch (_error) {
      return fallback;
    }
  }

  function readArray(key) {
    return parseJson(localStorage.getItem(key), []);
  }

  function writeArray(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function extractNumericId(id, prefix) {
    if (typeof id !== "string" || !id.startsWith(prefix)) {
      return 0;
    }
    const value = Number(id.replace(prefix, ""));
    return Number.isFinite(value) ? value : 0;
  }

  function toPaddedId(prefix, numericValue) {
    return `${prefix}${String(numericValue).padStart(4, "0")}`;
  }

  function todayISO() {
    return new Date().toISOString().split("T")[0];
  }

  function toDisplayDate(dateString) {
    if (!dateString) {
      return "-";
    }
    const parsed = new Date(dateString);
    if (Number.isNaN(parsed.getTime())) {
      return dateString;
    }
    return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function toPositiveNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function resolveAssetUnitCost(asset) {
    return toPositiveNumber(asset?.unitCost);
  }

  function normalizeAssetNameKey(name) {
    return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  function normalizeCategoryName(name) {
    return String(name || "").trim().replace(/\s+/g, " ");
  }

  function normalizeLocationName(name) {
    return String(name || "").trim().replace(/\s+/g, " ");
  }

  function categorySort(categories) {
    return categories.slice().sort((left, right) => left.localeCompare(right));
  }

  function locationSort(locations) {
    return locations.slice().sort((left, right) => left.localeCompare(right));
  }

  function saveCategories(categories) {
    const normalized = Array.isArray(categories)
      ? categories
        .map((category) => normalizeCategoryName(category))
        .filter(Boolean)
      : [];
    const unique = Array.from(new Set(normalized));
    const finalCategories = unique.length > 0 ? categorySort(unique) : categorySort(DEFAULT_CATEGORIES);
    localStorage.setItem(STORAGE_KEYS.categories, JSON.stringify(finalCategories));
    return finalCategories;
  }

  function getCategories() {
    const stored = parseJson(localStorage.getItem(STORAGE_KEYS.categories), []);
    if (!Array.isArray(stored) || stored.length === 0) {
      return categorySort(DEFAULT_CATEGORIES);
    }
    return saveCategories(stored);
  }

  function ensureCategoriesForAssets(assets) {
    const assetCategories = Array.isArray(assets)
      ? assets
        .map((asset) => normalizeCategoryName(asset?.category))
        .filter(Boolean)
      : [];
    const merged = Array.from(new Set([...getCategories(), ...assetCategories]));
    return saveCategories(merged);
  }

  function addCategory(categoryName) {
    const normalized = normalizeCategoryName(categoryName);
    if (!normalized) {
      return { ok: false, error: "Category name is required." };
    }
    const categories = getCategories();
    const exists = categories.some((category) => category.toLowerCase() === normalized.toLowerCase());
    if (exists) {
      return { ok: true, category: categories.find((category) => category.toLowerCase() === normalized.toLowerCase()) };
    }
    const next = saveCategories([...categories, normalized]);
    const category = next.find((entry) => entry.toLowerCase() === normalized.toLowerCase()) || normalized;
    return { ok: true, category };
  }

  function saveLocations(locations) {
    const normalized = Array.isArray(locations)
      ? locations
        .map((location) => normalizeLocationName(location))
        .filter(Boolean)
      : [];
    const unique = Array.from(new Set(normalized));
    const finalLocations = unique.length > 0 ? locationSort(unique) : locationSort(DEFAULT_LOCATIONS);
    localStorage.setItem(STORAGE_KEYS.locations, JSON.stringify(finalLocations));
    return finalLocations;
  }

  function getLocations() {
    const stored = parseJson(localStorage.getItem(STORAGE_KEYS.locations), []);
    if (!Array.isArray(stored) || stored.length === 0) {
      return locationSort(DEFAULT_LOCATIONS);
    }
    return saveLocations(stored);
  }

  function ensureLocationsForAssets(assets) {
    const assetLocations = Array.isArray(assets)
      ? assets
        .map((asset) => normalizeLocationName(asset?.location))
        .filter(Boolean)
      : [];
    const merged = Array.from(new Set([...getLocations(), ...assetLocations]));
    return saveLocations(merged);
  }

  function addLocation(locationName) {
    const normalized = normalizeLocationName(locationName);
    if (!normalized) {
      return { ok: false, error: "Location name is required." };
    }
    const locations = getLocations();
    const exists = locations.some((location) => location.toLowerCase() === normalized.toLowerCase());
    if (exists) {
      return { ok: true, location: locations.find((location) => location.toLowerCase() === normalized.toLowerCase()) };
    }
    const next = saveLocations([...locations, normalized]);
    const location = next.find((entry) => entry.toLowerCase() === normalized.toLowerCase()) || normalized;
    return { ok: true, location };
  }

  function categoryColorPair(category) {
    const normalized = normalizeCategoryName(category).toLowerCase();
    let hash = 0;
    for (let index = 0; index < normalized.length; index += 1) {
      hash = ((hash << 5) - hash) + normalized.charCodeAt(index);
      hash |= 0;
    }
    const paletteIndex = Math.abs(hash) % CATEGORY_TAG_PALETTE.length;
    return CATEGORY_TAG_PALETTE[paletteIndex];
  }

  function createCategoryBadge(category) {
    const label = normalizeCategoryName(category) || "Uncategorized";
    const color = categoryColorPair(label);
    return `<span class="badge category-badge" style="background:${color.bg};color:${color.text};">${escapeHtml(label)}</span>`;
  }

  function isConsumableAssetRecord(asset) {
    const category = String(asset?.category || "").trim().toLowerCase();
    if (category.includes("consumable")) {
      return true;
    }

    const name = normalizeAssetNameKey(asset?.name);
    return CONSUMABLE_KEYWORDS.some((keyword) => name.includes(keyword));
  }

  function ensureDefaultConsumableAssets(assets) {
    if (!Array.isArray(assets)) {
      return false;
    }

    const existingNames = new Set(
      assets.map((asset) => normalizeAssetNameKey(asset.name))
    );
    let nextNumericId = assets.reduce((maxValue, asset) => {
      return Math.max(maxValue, extractNumericId(asset.id, "AST-"));
    }, 0) + 1;
    let added = false;

    DEFAULT_CONSUMABLE_ASSETS.forEach((template) => {
      const key = normalizeAssetNameKey(template.name);
      if (existingNames.has(key)) {
        return;
      }

      assets.push({
        ...clone(template),
        id: toPaddedId("AST-", nextNumericId)
      });
      existingNames.add(key);
      nextNumericId += 1;
      added = true;
    });

    return added;
  }

  function formatCurrency(value) {
    const amount = Number(value);
    const safeAmount = Number.isFinite(amount) ? amount : 0;
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "PHP",
      maximumFractionDigits: 0
    }).format(safeAmount);
  }

  function normalizeRole(role) {
    return ["admin", "custodian", "teacher"].includes(role) ? role : "teacher";
  }

  function roleLabel(role) {
    return ROLE_META[normalizeRole(role)].label;
  }

  function roleColor(role) {
    return ROLE_META[normalizeRole(role)].color;
  }

  function roleInitial(role) {
    return ROLE_META[normalizeRole(role)].initials;
  }

  function normalizeUserRecord(user) {
    const role = normalizeRole(user?.role);
    const email = String(user?.email || "").trim().toLowerCase();
    const name = String(user?.name || roleLabel(role)).trim() || roleLabel(role);
    const password = String(user?.password || "").trim();
    return { email, password, role, name };
  }

  function getUsers() {
    const storedUsers = parseJson(localStorage.getItem(STORAGE_KEYS.users), []);
    if (!Array.isArray(storedUsers) || storedUsers.length === 0) {
      return clone(DEFAULT_USERS);
    }
    return storedUsers
      .map((user) => normalizeUserRecord(user))
      .filter((user) => Boolean(user.email && user.password));
  }

  function saveUsers(users) {
    const normalized = Array.isArray(users)
      ? users
          .map((user) => normalizeUserRecord(user))
          .filter((user) => Boolean(user.email && user.password))
      : [];

    const finalUsers = normalized.length > 0 ? normalized : clone(DEFAULT_USERS);
    localStorage.setItem(STORAGE_KEYS.users, JSON.stringify(finalUsers));
    return finalUsers;
  }

  function getUserByCredentials(email, password) {
    const targetEmail = String(email || "").trim().toLowerCase();
    const targetPassword = String(password || "");
    return getUsers().find((user) => user.email === targetEmail && user.password === targetPassword) || null;
  }

  function createUser(payload) {
    const user = normalizeUserRecord(payload);
    if (!user.email || !user.password) {
      return { ok: false, error: "Email and password are required." };
    }

    const users = getUsers();
    if (users.some((entry) => entry.email === user.email)) {
      return { ok: false, error: "A user with this email already exists." };
    }

    users.push(user);
    saveUsers(users);
    return { ok: true, user };
  }

  function updateUser(email, payload) {
    const targetEmail = String(email || "").trim().toLowerCase();
    const users = getUsers();
    const index = users.findIndex((user) => user.email === targetEmail);
    if (index < 0) {
      return { ok: false, error: "User not found." };
    }

    const current = users[index];
    const nextEmail = payload?.email != null ? String(payload.email).trim().toLowerCase() : current.email;
    const nextRole = payload?.role != null ? normalizeRole(payload.role) : current.role;
    const nextName = payload?.name != null
      ? (String(payload.name).trim() || roleLabel(nextRole))
      : current.name;
    const requestedPassword = payload?.password != null ? String(payload.password).trim() : "";
    const nextPassword = requestedPassword || current.password;

    if (!nextEmail || !nextPassword) {
      return { ok: false, error: "Email and password are required." };
    }

    const duplicate = users.find((user, userIndex) => user.email === nextEmail && userIndex !== index);
    if (duplicate) {
      return { ok: false, error: "A user with this email already exists." };
    }

    const adminCount = users.filter((user) => user.role === "admin").length;
    if (current.role === "admin" && nextRole !== "admin" && adminCount <= 1) {
      return { ok: false, error: "At least one admin account is required." };
    }

    const updatedUser = {
      email: nextEmail,
      password: nextPassword,
      role: nextRole,
      name: nextName
    };

    users[index] = updatedUser;
    saveUsers(users);

    const sessionUser = getCurrentUser();
    if (sessionUser && sessionUser.email.toLowerCase() === targetEmail) {
      setCurrentUser({
        email: updatedUser.email,
        role: updatedUser.role,
        name: updatedUser.name
      });
    }

    return { ok: true, user: updatedUser };
  }

  function deleteUser(email) {
    const targetEmail = String(email || "").trim().toLowerCase();
    const users = getUsers();
    const index = users.findIndex((user) => user.email === targetEmail);
    if (index < 0) {
      return { ok: false, error: "User not found." };
    }

    const userToDelete = users[index];
    const sessionUser = getCurrentUser();
    if (sessionUser && sessionUser.email.toLowerCase() === targetEmail) {
      return { ok: false, error: "You cannot delete your currently signed-in account." };
    }

    const adminCount = users.filter((user) => user.role === "admin").length;
    if (userToDelete.role === "admin" && adminCount <= 1) {
      return { ok: false, error: "At least one admin account is required." };
    }

    users.splice(index, 1);
    saveUsers(users);
    return { ok: true };
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getCurrentUser() {
    const user = parseJson(sessionStorage.getItem(STORAGE_KEYS.currentUser), null);
    if (user && user.email && user.role) {
      return { ...user, role: normalizeRole(user.role) };
    }

    const role = sessionStorage.getItem(STORAGE_KEYS.role);
    if (!role) {
      return null;
    }
    const fallback = getUsers().find((entry) => entry.role === role);
    return fallback ? { email: fallback.email, role: fallback.role, name: fallback.name } : null;
  }

  function setCurrentUser(user) {
    const safeUser = {
      email: String(user.email || "").trim().toLowerCase(),
      role: normalizeRole(user.role),
      name: String(user.name || roleLabel(user.role)).trim() || roleLabel(user.role)
    };
    sessionStorage.setItem(STORAGE_KEYS.currentUser, JSON.stringify(safeUser));
    sessionStorage.setItem(STORAGE_KEYS.role, safeUser.role);
  }

  function clearSession() {
    sessionStorage.removeItem(STORAGE_KEYS.currentUser);
    sessionStorage.removeItem(STORAGE_KEYS.role);
  }

  function ensureCounters(assets, transactions) {
    const highestAsset = assets.reduce((maxValue, asset) => {
      return Math.max(maxValue, extractNumericId(asset.id, "AST-"));
    }, 0);
    const highestTransaction = transactions.reduce((maxValue, transaction) => {
      return Math.max(maxValue, extractNumericId(transaction.id, "TRX-"));
    }, 0);

    const storedAssetCounter = Number(localStorage.getItem(STORAGE_KEYS.assetCounter));
    if (!Number.isFinite(storedAssetCounter) || storedAssetCounter <= highestAsset) {
      localStorage.setItem(STORAGE_KEYS.assetCounter, String(highestAsset + 1));
    }

    const storedTransactionCounter = Number(localStorage.getItem(STORAGE_KEYS.transactionCounter));
    if (!Number.isFinite(storedTransactionCounter) || storedTransactionCounter <= highestTransaction) {
      localStorage.setItem(STORAGE_KEYS.transactionCounter, String(highestTransaction + 1));
    }
  }

  function ensureDemoData() {
    if (!localStorage.getItem(STORAGE_KEYS.borrowRequests)) {
      writeArray(STORAGE_KEYS.borrowRequests, []);
    }

    const assets = readArray(STORAGE_KEYS.assets);
    const transactions = readArray(STORAGE_KEYS.transactions);
    const users = parseJson(localStorage.getItem(STORAGE_KEYS.users), []);
    const seeded = localStorage.getItem(STORAGE_KEYS.seeded) === "true";

    if (!seeded || assets.length === 0) {
      writeArray(STORAGE_KEYS.assets, clone(DEFAULT_ASSETS));
    }
    if (!seeded || transactions.length === 0) {
      writeArray(STORAGE_KEYS.transactions, clone(DEFAULT_TRANSACTIONS));
    }
    if (!Array.isArray(users) || users.length === 0) {
      saveUsers(clone(DEFAULT_USERS));
    } else {
      saveUsers(users);
    }

    const finalAssets = readArray(STORAGE_KEYS.assets);
    const assetsWithDefaults = clone(finalAssets);
    if (ensureDefaultConsumableAssets(assetsWithDefaults)) {
      writeArray(STORAGE_KEYS.assets, assetsWithDefaults);
    }

    const readyAssets = readArray(STORAGE_KEYS.assets);
    ensureCategoriesForAssets(readyAssets);
    ensureLocationsForAssets(readyAssets);
    const finalTransactions = readArray(STORAGE_KEYS.transactions);
    ensureCounters(readyAssets, finalTransactions);
    localStorage.setItem(STORAGE_KEYS.seeded, "true");
  }

  function getAssets() {
    return readArray(STORAGE_KEYS.assets);
  }

  function saveAssets(assets) {
    const normalized = assets.map((asset) => ({
      ...asset,
      quantity: Number(asset.quantity) || 0,
      unitCost: toPositiveNumber(asset.unitCost)
    }));
    writeArray(STORAGE_KEYS.assets, normalized);
    ensureCategoriesForAssets(normalized);
    ensureLocationsForAssets(normalized);
    ensureCounters(normalized, getTransactions());
  }

  function getTransactions() {
    const transactions = readArray(STORAGE_KEYS.transactions);
    if (!Array.isArray(transactions)) {
      return [];
    }
    return transactions.map((transaction) => {
      const quantityValue = Number(transaction?.quantity);
      const normalizedQuantity = Number.isFinite(quantityValue) && quantityValue > 0
        ? Math.floor(quantityValue)
        : 1;
      return {
        ...transaction,
        quantity: normalizedQuantity
      };
    });
  }

  function saveTransactions(transactions) {
    const normalized = (Array.isArray(transactions) ? transactions : []).map((transaction) => {
      const quantityValue = Number(transaction?.quantity);
      const normalizedQuantity = Number.isFinite(quantityValue) && quantityValue > 0
        ? Math.floor(quantityValue)
        : 1;
      return {
        ...transaction,
        quantity: normalizedQuantity
      };
    });
    writeArray(STORAGE_KEYS.transactions, normalized);
    ensureCounters(getAssets(), normalized);
  }

  function getAuditLogs() {
    return readArray(STORAGE_KEYS.auditLogs);
  }

  function saveAuditLogs(logs) {
    const safeLogs = Array.isArray(logs) ? logs : [];
    writeArray(STORAGE_KEYS.auditLogs, safeLogs);
    return safeLogs;
  }

  function logRoomAudit(payload = {}) {
    const summary = payload?.summary || {};
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const record = {
      id: `ADT-${Date.now()}`,
      location: String(payload?.location || "").trim(),
      auditedOn: payload?.auditedOn || todayISO(),
      auditedAt: new Date().toISOString(),
      auditedBy: String(payload?.auditedBy || "").trim(),
      auditorRole: normalizeRole(payload?.auditorRole),
      summary: {
        expectedUnits: Number(summary.expectedUnits) || 0,
        foundUnits: Number(summary.foundUnits) || 0,
        missingUnits: Number(summary.missingUnits) || 0,
        needsRepairUnits: Number(summary.needsRepairUnits) || 0,
        variance: Number(summary.variance) || 0
      },
      items: items.map((item) => ({
        assetId: String(item?.assetId || "").trim(),
        assetName: String(item?.assetName || "").trim(),
        location: String(item?.location || "").trim(),
        expectedQuantity: Number(item?.expectedQuantity) || 0,
        verification: String(item?.verification || "").trim() || "Found",
        previousStatus: String(item?.previousStatus || "").trim(),
        updatedStatus: String(item?.updatedStatus || "").trim()
      }))
    };

    const logs = getAuditLogs();
    logs.unshift(record);
    saveAuditLogs(logs);
    return record;
  }

  function nextAssetId() {
    const currentCounter = Number(localStorage.getItem(STORAGE_KEYS.assetCounter));
    const safeCounter = Number.isFinite(currentCounter) && currentCounter > 0 ? currentCounter : 1;
    localStorage.setItem(STORAGE_KEYS.assetCounter, String(safeCounter + 1));
    return toPaddedId("AST-", safeCounter);
  }

  function nextTransactionId() {
    const currentCounter = Number(localStorage.getItem(STORAGE_KEYS.transactionCounter));
    const safeCounter = Number.isFinite(currentCounter) && currentCounter > 0 ? currentCounter : 1;
    localStorage.setItem(STORAGE_KEYS.transactionCounter, String(safeCounter + 1));
    return toPaddedId("TRX-", safeCounter);
  }

  function nextBulkId() {
    const year = new Date().getFullYear();
    const current = Number(localStorage.getItem(STORAGE_KEYS.bulkCounter));
    const safe = Number.isFinite(current) && current > 0 ? current : 1;
    localStorage.setItem(STORAGE_KEYS.bulkCounter, String(safe + 1));
    return `BLK-${year}-${String(safe).padStart(3, "0")}`;
  }

  function getLowStockAssets() {
    return getAssets().filter((asset) => Number(asset.quantity) < LOW_STOCK_THRESHOLD);
  }

  function normalizeComparableText(value) {
    return String(value || "").trim().toLowerCase();
  }

  function transactionVisibleToDashboardUser(transaction, user) {
    if (!user || user.role !== "teacher") {
      return true;
    }

    const borrower = normalizeComparableText(transaction.borrower);
    const userName = normalizeComparableText(user.name || "");
    const role = normalizeComparableText(transaction.role);
    return role === "teacher" && borrower === userName;
  }

  function getTransactionsForDashboard(user) {
    return getTransactions().filter((transaction) => transactionVisibleToDashboardUser(transaction, user));
  }

  function getDashboardStats(user = null) {
    const assets = getAssets();
    const transactions = getTransactionsForDashboard(user);
    const borrowedAssets = transactions.filter((transaction) => transaction.status === "Borrowed");
    const returnedAssets = transactions.filter((transaction) => transaction.status === "Returned");
    const overdue = borrowedAssets.filter((transaction) => {
      return transaction.returnDate && transaction.returnDate < todayISO();
    }).length;

    if (user && user.role === "teacher") {
      const assetsById = new Map(assets.map((asset) => [String(asset.id || ""), asset]));
      const borrowedValue = borrowedAssets.reduce((sum, transaction) => {
        const transactionQuantity = Number(transaction?.quantity) > 0 ? Number(transaction.quantity) : 1;
        const asset = assetsById.get(String(transaction.assetId || ""));
        if (asset) {
          return sum + (resolveAssetUnitCost(asset) * transactionQuantity);
        }
        return sum + resolveAssetUnitCost({
          name: transaction.assetName || "",
          category: ""
        }) * transactionQuantity;
      }, 0);
      const uniqueBorrowedAssets = new Set(
        transactions
          .map((transaction) => String(transaction.assetId || "").trim())
          .filter(Boolean)
      );

      return {
        totalAssets: uniqueBorrowedAssets.size,
        totalQuantity: transactions.length,
        totalEquipmentValue: borrowedValue,
        borrowedAssets: borrowedAssets.length,
        lowStock: 0,
        overdue,
        needsRepair: 0,
        returnedAssets: returnedAssets.length
      };
    }

    const totalQuantity = assets.reduce((sum, asset) => sum + (Number(asset.quantity) || 0), 0);
    const totalEquipmentValue = assets.reduce((sum, asset) => {
      const quantity = Number(asset.quantity) || 0;
      return sum + (resolveAssetUnitCost(asset) * quantity);
    }, 0);
    const lowStock = assets.filter((asset) => Number(asset.quantity) < LOW_STOCK_THRESHOLD).length;
    const needsRepair = assets.reduce((sum, asset) => {
      const isUnderRepair = String(asset.status || "").trim().toLowerCase() === "under repair";
      if (!isUnderRepair) {
        return sum;
      }
      return sum + (Number(asset.quantity) || 0);
    }, 0);

    return {
      totalAssets: assets.length,
      totalQuantity,
      totalEquipmentValue,
      borrowedAssets: borrowedAssets.length,
      lowStock,
      overdue,
      needsRepair,
      returnedAssets: returnedAssets.length
    };
  }

  function getCategoryBreakdown() {
    const map = new Map();
    getAssets().forEach((asset) => {
      const category = String(asset.category || "Uncategorized").trim() || "Uncategorized";
      map.set(category, (map.get(category) || 0) + 1);
    });
    return Array.from(map.entries()).map(([label, value]) => ({ label, value }));
  }

  function getCategorySummary(user = null) {
    if (user && user.role === "teacher") {
      const assetsById = new Map(
        getAssets().map((asset) => [String(asset.id || ""), asset])
      );
      const summaryMap = new Map();
      const transactions = getTransactionsForDashboard(user);

      transactions.forEach((transaction) => {
        const asset = assetsById.get(String(transaction.assetId || ""));
        const category = String(asset?.category || "Uncategorized").trim() || "Uncategorized";
        const current = summaryMap.get(category) || { assetTypes: 0, totalUnits: 0 };
        current.assetTypes += 1;
        if (transaction.status === "Returned") {
          current.totalUnits += 1;
        }
        summaryMap.set(category, current);
      });

      return Array.from(summaryMap.entries()).map(([label, values]) => ({
        label,
        assetTypes: values.assetTypes,
        totalUnits: values.totalUnits
      }));
    }

    const summaryMap = new Map();
    getAssets().forEach((asset) => {
      const category = String(asset.category || "Uncategorized").trim() || "Uncategorized";
      const current = summaryMap.get(category) || { assetTypes: 0, totalUnits: 0 };
      current.assetTypes += 1;
      current.totalUnits += Number(asset.quantity) || 0;
      summaryMap.set(category, current);
    });
    return Array.from(summaryMap.entries()).map(([label, values]) => ({
      label,
      assetTypes: values.assetTypes,
      totalUnits: values.totalUnits
    }));
  }

  function getConditionBreakdown(user = null) {
    if (user && user.role === "teacher") {
      const bucket = new Map();
      const transactions = getTransactionsForDashboard(user);

      transactions.forEach((transaction) => {
        const borrowCondition = String(transaction.condition || "").trim() || "Good";
        bucket.set(borrowCondition, (bucket.get(borrowCondition) || 0) + 1);

        const returnedCondition = String(transaction.returnedCondition || "").trim();
        if (returnedCondition) {
          bucket.set(returnedCondition, (bucket.get(returnedCondition) || 0) + 1);
        }
      });

      const entries = Array.from(bucket.entries())
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value);
      return entries.length ? entries : [{ label: "No Data", value: 1 }];
    }

    const bucket = {
      Good: 0,
      Fair: 0,
      New: 0
    };

    getAssets().forEach((asset) => {
      const status = String(asset.status || "").toLowerCase();
      if (status === "available") {
        bucket.Good += Number(asset.quantity) || 0;
      } else if (status === "in use") {
        bucket.Fair += Number(asset.quantity) || 0;
      } else {
        bucket.New += Math.max(1, Number(asset.quantity) || 0);
      }
    });

    const entries = Object.entries(bucket)
      .filter(([, value]) => value > 0)
      .map(([label, value]) => ({ label, value }));
    return entries.length ? entries : [{ label: "New", value: 1 }];
  }

  function getMonthlyTransactionActivity(rangeMonths = 8, user = null) {
    const labels = [];
    const keys = [];
    const now = new Date();
    const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    for (let i = rangeMonths - 1; i >= 0; i -= 1) {
      const point = new Date(firstOfThisMonth.getFullYear(), firstOfThisMonth.getMonth() - i, 1);
      labels.push(point.toLocaleDateString(undefined, { month: "short" }));
      keys.push(`${point.getFullYear()}-${point.getMonth()}`);
    }

    const lookup = new Map(keys.map((key, index) => [key, index]));
    const checkOut = new Array(rangeMonths).fill(0);
    const returned = new Array(rangeMonths).fill(0);
    const transactions = getTransactionsForDashboard(user);

    transactions.forEach((transaction) => {
      if (transaction.borrowDate) {
        const borrowDate = new Date(transaction.borrowDate);
        if (!Number.isNaN(borrowDate.getTime())) {
          const key = `${borrowDate.getFullYear()}-${borrowDate.getMonth()}`;
          const index = lookup.get(key);
          if (index != null) {
            checkOut[index] += 1;
          }
        }
      }

      const returnSource = transaction.actualReturnDate || transaction.returnDate;
      if (transaction.status === "Returned" && returnSource) {
        const returnDate = new Date(returnSource);
        if (!Number.isNaN(returnDate.getTime())) {
          const key = `${returnDate.getFullYear()}-${returnDate.getMonth()}`;
          const index = lookup.get(key);
          if (index != null) {
            returned[index] += 1;
          }
        }
      }
    });

    return { labels, checkOut, returned };
  }

  function getQuantityBreakdown() {
    return getAssets()
      .map((asset) => ({
        label: asset.name,
        value: Number(asset.quantity) || 0
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }

  function getRecentTransactions(limit = 6, user = null) {
    return getTransactionsForDashboard(user)
      .slice()
      .sort((a, b) => String(b.borrowDate || "").localeCompare(String(a.borrowDate || "")))
      .slice(0, limit);
  }

  function getFrequentlyUsedItems(limit = 5, user = null) {
    const maxItems = Number.isFinite(Number(limit)) ? Math.max(1, Number(limit)) : 5;
    const assetsById = new Map(
      getAssets().map((asset) => [String(asset.id || ""), asset])
    );
    const summary = new Map();
    const transactions = getTransactionsForDashboard(user);

    transactions.forEach((transaction) => {
      const assetId = String(transaction.assetId || "").trim();
      if (!assetId) {
        return;
      }

      const current = summary.get(assetId) || {
        assetId,
        assetName: String(transaction.assetName || assetId),
        category: "Uncategorized",
        useCount: 0,
        outOrConsumedCount: 0,
        lastBorrowDate: ""
      };

      current.useCount += 1;
      if (transaction.status === "Borrowed") {
        current.outOrConsumedCount += 1;
      }

      const borrowDate = String(transaction.borrowDate || "");
      if (borrowDate && borrowDate > current.lastBorrowDate) {
        current.lastBorrowDate = borrowDate;
      }

      const asset = assetsById.get(assetId);
      if (asset) {
        current.assetName = String(asset.name || current.assetName);
        current.category = String(asset.category || current.category || "Uncategorized");
      }

      current.isConsumable = isConsumableAssetRecord({
        name: current.assetName,
        category: current.category
      });

      summary.set(assetId, current);
    });

    return Array.from(summary.values())
      .sort((left, right) => {
        if (right.useCount !== left.useCount) {
          return right.useCount - left.useCount;
        }
        if (right.outOrConsumedCount !== left.outOrConsumedCount) {
          return right.outOrConsumedCount - left.outOrConsumedCount;
        }
        return String(right.lastBorrowDate || "").localeCompare(String(left.lastBorrowDate || ""));
      })
      .slice(0, maxItems);
  }

  function icon(name) {
    const icons = {
      "layout-dashboard": '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="7" height="9" x="3" y="3" rx="1"></rect><rect width="7" height="5" x="14" y="3" rx="1"></rect><rect width="7" height="9" x="14" y="12" rx="1"></rect><rect width="7" height="5" x="3" y="16" rx="1"></rect></svg>',
      package: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"></path><path d="m3.3 7 8.7 5 8.7-5"></path><path d="M12 22V12"></path></svg>',
      repeat: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m17 2 4 4-4 4"></path><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><path d="m7 22-4-4 4-4"></path><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>',
      "clipboard-check": '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="8" height="4" x="8" y="2" rx="1"></rect><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><path d="m9 14 2 2 4-4"></path></svg>',
      "file-text": '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"></path><path d="M14 2v6h6"></path><path d="M16 13H8"></path><path d="M16 17H8"></path></svg>',
      users: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>',
      "scroll-text": '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"></path><path d="M19 17V5a2 2 0 0 0-2-2H4"></path><path d="M15 8h-5"></path><path d="M15 12h-5"></path></svg>',
      send: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m22 2-7 20-4-9-9-4Z"></path><path d="M22 2 11 13"></path></svg>',
      inbox: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"></polyline><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path></svg>'
    };
    return icons[name] || "";
  }

  function isNavItemActive(item, navItems, pageFile, pageHash, pageKey) {
    const [itemFile, itemHashRaw] = item.href.split("#");
    const itemHash = itemHashRaw ? `#${itemHashRaw}` : "";
    if (itemFile !== pageFile) {
      return false;
    }
    if (itemHash) {
      return pageHash === itemHash;
    }
    if (!pageHash) {
      return true;
    }
    const hashMappedToOtherNav = navItems.some((otherItem) => {
      const [otherFile, otherHashRaw] = otherItem.href.split("#");
      const otherHash = otherHashRaw ? `#${otherHashRaw}` : "";
      return otherFile === pageFile && otherHash === pageHash;
    });
    if (hashMappedToOtherNav) {
      return false;
    }
    return item.id === pageKey;
  }

  function renderSidebar(pageKey, user) {
    const navElement = document.getElementById("sidebar-nav");
    if (!navElement) {
      return;
    }
    const navItems = NAVIGATION[user.role] || [];
    const pageFile = window.location.pathname.split("/").pop() || "dashboard.html";
    const pageHash = window.location.hash || "";
    navElement.innerHTML = navItems
      .map((item) => {
        const activeClass = isNavItemActive(item, navItems, pageFile, pageHash, pageKey) ? "active" : "";
        return `<a class="nav-item ${activeClass}" href="${item.href}">
          <span class="nav-icon">${icon(item.icon)}</span>
          <span>${escapeHtml(item.label)}</span>
        </a>`;
      })
      .join("");
  }

  function applyUserToLayout(user) {
    const name = user.name || roleLabel(user.role);
    const label = roleLabel(user.role);
    const avatar = roleInitial(user.role);
    const color = roleColor(user.role);

    const userTargets = [
      { nameId: "sb-name", roleId: "sb-role", avatarId: "sb-avatar" },
      { nameId: "tb-name", roleId: "tb-role", avatarId: "tb-avatar" }
    ];

    userTargets.forEach((target) => {
      const nameElement = document.getElementById(target.nameId);
      const roleElement = document.getElementById(target.roleId);
      const avatarElement = document.getElementById(target.avatarId);
      if (nameElement) {
        nameElement.textContent = name;
      }
      if (roleElement) {
        roleElement.textContent = label;
      }
      if (avatarElement) {
        avatarElement.textContent = avatar;
        avatarElement.style.background = color;
      }
    });

    const welcomeName = document.getElementById("welcome-user-name");
    if (welcomeName) {
      welcomeName.textContent = name;
    }
    const welcomeRole = document.getElementById("welcome-role-label");
    if (welcomeRole) {
      welcomeRole.textContent = `${label} Dashboard`;
    }
  }

  function applyManagementControlVisibility(user) {
    const role = normalizeRole(user?.role);
    const shouldHide = role === "teacher";
    const controls = document.querySelectorAll("[data-management-control='true']");
    controls.forEach((control) => {
      control.hidden = shouldHide;
    });
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = String(value);
    }
  }

  function restoreLegacyLogos() {
    const logos = document.querySelectorAll("img.site-logo-img");
    logos.forEach((logo) => {
      logo.setAttribute("src", "assets/img/logo.png");
      if (!logo.getAttribute("alt")) {
        logo.setAttribute("alt", "Platonian's School Assets logo");
      }
    });
  }

  function wireSidebarToggle() {
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("sidebar-overlay");
    const menuButton = document.getElementById("mobile-menu-btn");

    if (!sidebar || !overlay || !menuButton) {
      return;
    }

    function closeSidebar() {
      sidebar.classList.remove("open");
      overlay.classList.remove("show");
    }

    function openSidebar() {
      sidebar.classList.add("open");
      overlay.classList.add("show");
    }

    menuButton.addEventListener("click", () => {
      if (sidebar.classList.contains("open")) {
        closeSidebar();
      } else {
        openSidebar();
      }
    });

    overlay.addEventListener("click", closeSidebar);

    const nav = document.getElementById("sidebar-nav");
    if (nav) {
      nav.addEventListener("click", (event) => {
        if (event.target.closest("a")) {
          closeSidebar();
        }
      });
    }

    window.addEventListener("resize", () => {
      if (window.innerWidth > 900) {
        closeSidebar();
      }
    });
  }

  function initLayout(pageKey, pageTitle) {
    const user = getCurrentUser();
    if (!user) {
      return null;
    }

    setText("topbar-page", pageTitle || roleLabel(user.role));
    const readableDate = new Date().toLocaleDateString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric"
    });
    setText("topbar-date", readableDate);
    setText("dashboard-date-pill", readableDate);

    applyUserToLayout(user);
    applyManagementControlVisibility(user);
    renderSidebar(pageKey, user);
    wireSidebarToggle();

    const logoutButton = document.getElementById("logout-btn");
    if (logoutButton) {
      logoutButton.addEventListener("click", () => {
        clearSession();
        window.location.href = "index.html";
      });
    }

    return user;
  }

  function isPageAllowed(role, pageKey) {
    if (!pageKey || !PAGE_PERMISSIONS[pageKey]) {
      return true;
    }
    return PAGE_PERMISSIONS[pageKey].includes(role);
  }

  function getFallbackPage(role) {
    const navItems = NAVIGATION[role] || [];
    return navItems.length > 0 ? navItems[0].href : "dashboard.html";
  }

  function requireAuth(pageKey) {
    ensureDemoData();
    const user = getCurrentUser();
    const currentPage = pageKey || "";
    if (!user && currentPage !== "login") {
      window.location.href = "index.html";
      return null;
    }

    if (user && !isPageAllowed(user.role, currentPage)) {
      window.location.href = getFallbackPage(user.role);
      return null;
    }
    return user;
  }

  function chartColors(count) {
    const palette = ["#14b8a6", "#0d9488", "#2dd4bf", "#059669", "#047857", "#22c55e", "#0891b2", "#0f766e"];
    return Array.from({ length: count }, (_, index) => palette[index % palette.length]);
  }

  function destroyChart(key) {
    if (chartRegistry[key]) {
      chartRegistry[key].destroy();
      chartRegistry[key] = null;
    }
  }

  function renderCategoryChart(canvasId, user = null) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === "undefined") {
      return;
    }
    destroyChart(canvasId);
    const entries = getCategorySummary(user);
    const labels = entries.map((entry) => entry.label);
    const assetTypes = entries.map((entry) => entry.assetTypes);
    const totalUnits = entries.map((entry) => entry.totalUnits);
    const primaryLabel = user && user.role === "teacher" ? "Borrow Count" : "Asset Types";
    const secondaryLabel = user && user.role === "teacher" ? "Returned Count" : "Total Units";
    chartRegistry[canvasId] = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: primaryLabel,
            data: assetTypes,
            backgroundColor: "#6366f1",
            borderRadius: 5,
            maxBarThickness: 34
          },
          {
            label: secondaryLabel,
            data: totalUnits,
            backgroundColor: "#3b82f6",
            borderRadius: 5,
            maxBarThickness: 34
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            ticks: { precision: 0 },
            grid: { color: "#e2e8f0" }
          },
          x: {
            grid: { display: false }
          }
        },
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              boxWidth: 10,
              usePointStyle: true,
              pointStyle: "rect"
            }
          }
        }
      }
    });
  }

  function renderConditionLegend(entries, colors) {
    const legendContainer = document.getElementById("condition-overview-legend");
    if (!legendContainer) {
      return;
    }
    legendContainer.innerHTML = entries
      .map((entry, index) => `<div class="legend-row">
          <div><span class="legend-dot" style="background:${colors[index]};"></span>${escapeHtml(entry.label)}</div>
          <div>${escapeHtml(entry.value)}</div>
        </div>`)
      .join("");
  }

  function renderConditionChart(canvasId, user = null) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === "undefined") {
      return;
    }
    destroyChart(canvasId);
    const entries = getConditionBreakdown(user);
    const colors = ["#3b82f6", "#f59e0b", "#8b5cf6"];
    chartRegistry[canvasId] = new Chart(canvas, {
      type: "doughnut",
      data: {
        labels: entries.map((entry) => entry.label),
        datasets: [
          {
            data: entries.map((entry) => entry.value),
            backgroundColor: colors.slice(0, entries.length),
            borderWidth: 0,
            hoverOffset: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "64%",
        plugins: {
          legend: { display: false }
        }
      }
    });
    renderConditionLegend(entries, colors);
  }

  function renderMonthlyActivityChart(canvasId, user = null) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === "undefined") {
      return;
    }
    destroyChart(canvasId);
    const activity = getMonthlyTransactionActivity(8, user);
    chartRegistry[canvasId] = new Chart(canvas, {
      type: "line",
      data: {
        labels: activity.labels,
        datasets: [
          {
            label: "Check-Out",
            data: activity.checkOut,
            borderColor: "#3b82f6",
            backgroundColor: "rgba(59,130,246,0.15)",
            pointBackgroundColor: "#3b82f6",
            pointBorderColor: "#3b82f6",
            pointRadius: 4,
            pointHoverRadius: 5,
            borderWidth: 3,
            tension: 0.38,
            fill: false
          },
          {
            label: "Returned",
            data: activity.returned,
            borderColor: "#8b5cf6",
            backgroundColor: "rgba(139,92,246,0.15)",
            pointBackgroundColor: "#8b5cf6",
            pointBorderColor: "#8b5cf6",
            pointRadius: 4,
            pointHoverRadius: 5,
            borderWidth: 3,
            tension: 0.38,
            fill: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            ticks: { precision: 0 },
            grid: { color: "#e2e8f0" }
          },
          x: {
            grid: { display: false }
          }
        },
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              boxWidth: 10,
              usePointStyle: true,
              pointStyle: "rect"
            }
          }
        }
      }
    });
  }

  function createStatusBadge(status) {
    const normalized = String(status || "").toLowerCase();
    const className = normalized
      .replace(/\s+/g, "-")
      .replace(/[^a-z-]/g, "");
    return `<span class="badge ${className}">${escapeHtml(status || "-")}</span>`;
  }

  function csvEscapeValue(value) {
    return `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
  }

  function objectRowsToCsv(headers, rows) {
    const safeHeaders = Array.isArray(headers) ? headers : [];
    const safeRows = Array.isArray(rows) ? rows : [];
    const lines = [
      safeHeaders.map((header) => csvEscapeValue(header)).join(",")
    ];
    safeRows.forEach((row) => {
      lines.push(
        safeHeaders
          .map((header) => csvEscapeValue(row ? row[header] : ""))
          .join(",")
      );
    });
    return lines.join("\n");
  }

  function downloadCsvContent(csvContent, fileName) {
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function masterInventoryRowsFromAssets(assets = getAssets()) {
    const safeAssets = Array.isArray(assets) ? assets : [];
    return safeAssets.map((asset) => {
      const unitCost = toPositiveNumber(asset?.unitCost);
      return {
        "Asset ID": String(asset?.id || "").trim(),
        "Name": String(asset?.name || "").trim(),
        "Category": String(asset?.category || "").trim(),
        "DepEd / Bulk Item": asset?.isBulk ? "Yes" : "No",
        "Bulk ID": String(asset?.bulkId || "-").trim(),
        "Quantity": Number(asset?.quantity) || 0,
        "Location": String(asset?.location || "").trim(),
        "Status": String(asset?.status || "").trim(),
        "Unit Cost (PHP)": unitCost > 0 ? unitCost : "Not set",
        "IAR File": String(asset?.receiptFile || "Not uploaded").trim(),
        "Date Added": String(asset?.dateAdded || "").trim()
      };
    });
  }

  function exportMasterInventoryCsv(fileName = `master_inventory_${todayISO()}.csv`) {
    const headers = ["Asset ID", "Name", "Category", "DepEd / Bulk Item", "Bulk ID", "Quantity", "Location", "Status", "Unit Cost (PHP)", "IAR File", "Date Added"];
    const rows = masterInventoryRowsFromAssets(getAssets());
    const csv = objectRowsToCsv(headers, rows);
    downloadCsvContent(csv, fileName);
  }

  function analyticsSummaryRows(user = null) {
    const isTeacher = user && user.role === "teacher";
    const primaryMetric = isTeacher ? "Borrow Count" : "Asset Types";
    const secondaryMetric = isTeacher ? "Returned Count" : "Total Units";

    const categoryRows = getCategorySummary(user).map((entry) => ({
      "Chart": "Category Bar Chart",
      "Label": String(entry?.label || "").trim(),
      "Metric 1": primaryMetric,
      "Value 1": Number(entry?.assetTypes) || 0,
      "Metric 2": secondaryMetric,
      "Value 2": Number(entry?.totalUnits) || 0
    }));

    const conditionRows = getConditionBreakdown(user).map((entry) => ({
      "Chart": "Condition Pie Chart",
      "Label": String(entry?.label || "").trim(),
      "Metric 1": "Count",
      "Value 1": Number(entry?.value) || 0,
      "Metric 2": "",
      "Value 2": ""
    }));

    return [...categoryRows, ...conditionRows];
  }

  function exportAnalyticsSummaryCsv(user = null, fileName = `analytics_summary_${todayISO()}.csv`) {
    const headers = ["Chart", "Label", "Metric 1", "Value 1", "Metric 2", "Value 2"];
    const rows = analyticsSummaryRows(user);
    const csv = objectRowsToCsv(headers, rows);
    downloadCsvContent(csv, fileName);
  }

  function exportTableToCsv(tableId, fileName) {
    const table = document.getElementById(tableId);
    if (!table) {
      return;
    }
    const rows = Array.from(table.querySelectorAll("tr"));
    const csv = rows
      .map((row) => {
        const cells = Array.from(row.querySelectorAll("th,td"));
        return cells
          .map((cell) => {
            const cleaned = String(cell.textContent || "").trim().replace(/\s+/g, " ");
            return csvEscapeValue(cleaned);
          })
          .join(",");
      })
      .join("\n");

    downloadCsvContent(csv, fileName || `${tableId}.csv`);
  }

  function initDashboardPage() {
    const user = requireAuth("dashboard");
    if (!user) {
      return;
    }
    initLayout("dashboard", "Dashboard");

    // ── Accountability tier warning banner (teachers only) ──
    if (user.role === "teacher") {
      const tierData = (() => {
        try { return JSON.parse(sessionStorage.getItem("platonian_tier_warning") || "null"); }
        catch { return null; }
      })();
      if (tierData && tierData.tier >= 1) {
        const tierColors = {
          1: { bg: "#fef3c7", border: "#f59e0b", text: "#92400e", icon: "⚠️" },
          2: { bg: "#fff7ed", border: "#f97316", text: "#c2410c", icon: "🚫" },
        };
        const c = tierColors[tierData.tier] || tierColors[2];
        const banner = document.createElement("div");
        banner.id = "accountability-banner";
        banner.style.cssText = `
          background:${c.bg}; border-left:5px solid ${c.border}; color:${c.text};
          padding:1rem 1.25rem; border-radius:8px; margin:0 0 1.25rem 0;
          font-size:0.9rem; font-weight:600; display:flex; align-items:flex-start;
          gap:0.6rem; line-height:1.5;
        `;
        banner.innerHTML = `
          <span style="font-size:1.3rem;flex-shrink:0;">${c.icon}</span>
          <div>
            <div>${tierData.message || ""}</div>
            ${tierData.tier === 2 ? '<div style="font-weight:400;margin-top:0.3rem;font-size:0.82rem;">Your borrow request form has been disabled until the overdue item is returned.</div>' : ""}
          </div>`;
        // Insert before first content inside main
        const main = document.querySelector("main") || document.querySelector(".main-content") || document.body;
        main.insertBefore(banner, main.firstChild);
      }
    }

    const isTeacher = user.role === "teacher";
    const stats = getDashboardStats(user);

    if (isTeacher) {
      setText("stat-1-label", "My Active Borrowed Value");
      setText("stat-1-sub", "Estimated value of items currently borrowed");
      setText("stat-total-assets", formatCurrency(stats.totalEquipmentValue));

      setText("stat-2-label", "My Total Transactions");
      setText("stat-2-sub", "All your borrow and return records");
      setText("stat-total-quantity", stats.totalQuantity);

      setText("stat-3-label", "My Active Check-Outs");
      setText("stat-3-sub", "Items you are currently borrowing");
      setText("stat-borrowed-assets", stats.borrowedAssets);

      setText("stat-4-label", "My Overdue Items");
      setText("stat-4-sub", "Past due date and not yet returned");
      setText("stat-low-stock", stats.overdue);

      setText("mini-active-checkouts", stats.borrowedAssets);
      setText("mini-overdue-items", stats.returnedAssets);
      setText("mini-1-title", "Active Check-Outs");
      setText("mini-1-sub", "Items you currently borrowed");
      setText("mini-2-title", "Returned Items");
      setText("mini-2-sub", "Items you already returned");

      setText("banner-overdue-text", `${stats.overdue} Overdue Item${stats.overdue === 1 ? "" : "s"}`);
      setText("banner-low-stock-text", `${stats.returnedAssets} Returned Item${stats.returnedAssets === 1 ? "" : "s"}`);

      setText("dashboard-side-section-title", "My Active Borrowed Items");
      setText("category-chart-title", "My Transactions by Category");
      setText("condition-chart-title", "My Condition Summary");
      setText("monthly-chart-title", "My Monthly Transaction Activity");
    } else {
      setText("stat-1-label", "Total Equipment Value");
      setText("stat-1-sub", "Estimated value in PHP");
      setText("stat-total-assets", formatCurrency(stats.totalEquipmentValue));

      setText("stat-2-label", "Total Inventory Quantity");
      setText("stat-2-sub", "Estimated units");
      setText("stat-total-quantity", stats.totalQuantity);

      setText("stat-3-label", "Low Stock Alerts");
      setText("stat-3-sub", "Below minimum qty");
      setText("stat-borrowed-assets", stats.lowStock);

      setText("stat-4-label", "Needs Repair");
      setText("stat-4-sub", "Under repair units");
      setText("stat-low-stock", stats.needsRepair);

      setText("mini-active-checkouts", stats.borrowedAssets);
      setText("mini-overdue-items", stats.returnedAssets);
      setText("mini-1-title", "Active Check-Outs");
      setText("mini-1-sub", "Items currently borrowed");
      setText("mini-2-title", "Returned Items");
      setText("mini-2-sub", "Items already returned");

      setText(
        "banner-overdue-text",
        `${stats.needsRepair} Equipment ${stats.needsRepair === 1 ? "Needs" : "Need"} Repair`
      );
      setText("banner-low-stock-text", `${stats.lowStock} Low Stock Alert${stats.lowStock === 1 ? "" : "s"}`);

      setText("dashboard-side-section-title", "Low Stock Alerts");
      setText("category-chart-title", "Assets by Category");
      setText("condition-chart-title", "Condition Overview");
      setText("monthly-chart-title", "Monthly Transaction Activity");
    }

    const lowStockAlertContainer = document.getElementById("dashboard-low-stock-alerts");
    if (lowStockAlertContainer) {
      if (isTeacher) {
        const activeBorrowed = getTransactionsForDashboard(user)
          .filter((transaction) => transaction.status === "Borrowed")
          .slice()
          .sort((a, b) => String(a.returnDate || "").localeCompare(String(b.returnDate || "")))
          .slice(0, 5);

        lowStockAlertContainer.innerHTML = activeBorrowed.length
          ? activeBorrowed
            .map((transaction) => `<div class="stock-alert">
              <div class="stock-alert-header">
                <div>
                  <div class="stock-alert-name">${escapeHtml(transaction.assetName || transaction.assetId)}</div>
                  <div class="stock-alert-id">Due: ${escapeHtml(toDisplayDate(transaction.returnDate))}</div>
                </div>
                <span class="badge borrowed">Borrowed</span>
              </div>
            </div>`)
            .join("")
          : `<div class="stock-alert">
              <div class="stock-alert-name">No active borrowed items.</div>
              <div class="stock-alert-id">All your borrowed items are returned.</div>
            </div>`;
      } else {
        const lowStockItems = getLowStockAssets()
          .slice()
          .sort((a, b) => (Number(a.quantity) || 0) - (Number(b.quantity) || 0))
          .slice(0, 3);

        lowStockAlertContainer.innerHTML = lowStockItems.length
          ? lowStockItems
            .map((asset) => {
              const quantity = Number(asset.quantity) || 0;
              const maxStock = Math.max(LOW_STOCK_THRESHOLD * 2, quantity + LOW_STOCK_THRESHOLD);
              const stockPercent = Math.max(8, Math.round((quantity / maxStock) * 100));
              return `<div class="stock-alert">
                <div class="stock-alert-header">
                  <div>
                    <div class="stock-alert-name">${escapeHtml(asset.name)}</div>
                    <div class="stock-alert-id">${escapeHtml(asset.id)}</div>
                  </div>
                  <span class="badge low-stock">Low Stock</span>
                </div>
                <div class="stock-bar-wrap"><div class="stock-bar" style="width:${stockPercent}%;"></div></div>
                <div class="stock-qty">${escapeHtml(quantity)}/${escapeHtml(maxStock)}</div>
              </div>`;
            })
            .join("")
          : `<div class="stock-alert">
              <div class="stock-alert-name">No low stock alerts right now.</div>
              <div class="stock-alert-id">All items are above minimum quantity.</div>
            </div>`;
      }
    }

    const recentList = document.getElementById("dashboard-recent-list");
    if (recentList) {
      const recent = getRecentTransactions(6, user);
      recentList.innerHTML = recent.length
        ? recent
          .map((transaction) => `<div class="txn-row">
            <div>
              <div class="txn-asset">${escapeHtml(transaction.assetName || transaction.assetId)}</div>
              <div class="txn-date">${escapeHtml(toDisplayDate(transaction.borrowDate))}</div>
            </div>
            <div>
              <div class="txn-borrower">${escapeHtml(transaction.borrower || "Unknown")}</div>
              <div class="txn-dept">${escapeHtml(roleLabel(transaction.role || "teacher"))}</div>
            </div>
            <div>${createStatusBadge(transaction.status)}</div>
          </div>`)
          .join("")
        : `<div class="txn-row">
            <div>No transactions available.</div>
            <div>-</div>
            <div>-</div>
          </div>`;
    }

    const frequentSection = document.getElementById("dashboard-frequent-section");
    if (frequentSection) {
      frequentSection.hidden = isTeacher;
    }

    const frequentlyUsedContainer = document.getElementById("dashboard-frequently-used-list");
    if (frequentlyUsedContainer && !isTeacher) {
      const frequentItems = getFrequentlyUsedItems(6, user);
      frequentlyUsedContainer.innerHTML = frequentItems.length
        ? frequentItems
          .map((item, index) => `<div class="usage-row">
              <div>
                <div class="usage-asset">${index + 1}. ${escapeHtml(item.assetName || item.assetId)}</div>
              </div>
              <div class="usage-metric">
                <div class="usage-value">${escapeHtml(item.useCount)}</div>
                <div class="usage-label">Times Used</div>
              </div>
            </div>`)
          .join("")
        : `<div class="usage-empty">
            No usage data yet.
          </div>`;
    }

    const usersSection = document.getElementById("users-section");
    if (usersSection) {
      usersSection.hidden = true;
    }

    const dashboardAnalyticsExportButton = document.getElementById("dashboard-analytics-export-btn");
    if (dashboardAnalyticsExportButton) {
      dashboardAnalyticsExportButton.addEventListener("click", () => {
        exportAnalyticsSummaryCsv(user, `dashboard_analytics_summary_${todayISO()}.csv`);
      });
    }

    renderCategoryChart("assets-by-category-chart", user);
    renderConditionChart("condition-overview-chart", user);
    renderMonthlyActivityChart("monthly-activity-chart", user);
  }

  function getBorrowRequests() {
    return readArray(STORAGE_KEYS.borrowRequests);
  }

  function saveBorrowRequests(requests) {
    const safe = Array.isArray(requests) ? requests : [];
    writeArray(STORAGE_KEYS.borrowRequests, safe);
    return safe;
  }

  function nextRequestId() {
    const current = Number(localStorage.getItem(STORAGE_KEYS.requestCounter));
    const safe = Number.isFinite(current) && current > 0 ? current : 1;
    localStorage.setItem(STORAGE_KEYS.requestCounter, String(safe + 1));
    return toPaddedId("REQ-", safe);
  }

  function exportFullBackup() {
    const backupObject = {
      backupDate: todayISO(),
      backupTime: new Date().toLocaleTimeString(),
      backedUpBy: (getCurrentUser() || {}).email || "unknown",
      systemName: "Platonian's School Assets",
      version: "1.0",
      data: {
        assets: readArray(STORAGE_KEYS.assets),
        transactions: readArray(STORAGE_KEYS.transactions),
        auditLogs: readArray(STORAGE_KEYS.auditLogs),
        users: readArray(STORAGE_KEYS.users),
        categories: parseJson(localStorage.getItem(STORAGE_KEYS.categories), []),
        locations: parseJson(localStorage.getItem(STORAGE_KEYS.locations), []),
        borrowRequests: readArray(STORAGE_KEYS.borrowRequests),
        assetCounter: Number(localStorage.getItem(STORAGE_KEYS.assetCounter)) || 1,
        transactionCounter: Number(localStorage.getItem(STORAGE_KEYS.transactionCounter)) || 1,
        requestCounter: Number(localStorage.getItem(STORAGE_KEYS.requestCounter)) || 1,
        bulkCounter: Number(localStorage.getItem(STORAGE_KEYS.bulkCounter)) || 1
      }
    };

    const jsonString = JSON.stringify(backupObject, null, 2);
    const blob = new Blob([jsonString], { type: "application/json;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = `platonians_is_backup_${todayISO()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function restoreFromBackup(jsonString) {
    try {
      const backup = JSON.parse(jsonString);
      if (!backup || !backup.data) {
        return { ok: false, error: "Invalid backup file. Missing data section." };
      }
      const d = backup.data;
      if (d.assets && Array.isArray(d.assets)) {
        writeArray(STORAGE_KEYS.assets, d.assets);
      }
      if (d.transactions && Array.isArray(d.transactions)) {
        writeArray(STORAGE_KEYS.transactions, d.transactions);
      }
      if (d.auditLogs && Array.isArray(d.auditLogs)) {
        writeArray(STORAGE_KEYS.auditLogs, d.auditLogs);
      }
      if (d.users && Array.isArray(d.users)) {
        writeArray(STORAGE_KEYS.users, d.users);
      }
      if (d.categories && Array.isArray(d.categories)) {
        localStorage.setItem(STORAGE_KEYS.categories, JSON.stringify(d.categories));
      }
      if (d.locations && Array.isArray(d.locations)) {
        localStorage.setItem(STORAGE_KEYS.locations, JSON.stringify(d.locations));
      }
      if (d.borrowRequests && Array.isArray(d.borrowRequests)) {
        writeArray(STORAGE_KEYS.borrowRequests, d.borrowRequests);
      }
      if (d.assetCounter) {
        localStorage.setItem(STORAGE_KEYS.assetCounter, String(d.assetCounter));
      }
      if (d.transactionCounter) {
        localStorage.setItem(STORAGE_KEYS.transactionCounter, String(d.transactionCounter));
      }
      if (d.requestCounter) {
        localStorage.setItem(STORAGE_KEYS.requestCounter, String(d.requestCounter));
      }
      if (d.bulkCounter) {
        localStorage.setItem(STORAGE_KEYS.bulkCounter, String(d.bulkCounter));
      }
      localStorage.setItem(STORAGE_KEYS.seeded, "true");
      return {
        ok: true,
        summary: {
          assets: (d.assets || []).length,
          transactions: (d.transactions || []).length,
          users: (d.users || []).length,
          backupDate: backup.backupDate || "Unknown",
          backedUpBy: backup.backedUpBy || "Unknown"
        }
      };
    } catch (err) {
      return { ok: false, error: "Could not parse backup file. Make sure it is a valid JSON backup." };
    }
  }

  restoreLegacyLogos();

  window.IMS = {
    STORAGE_KEYS,
    LOW_STOCK_THRESHOLD,
    DEFAULT_USERS,
    NAVIGATION,
    PAGE_PERMISSIONS,
    todayISO,
    toDisplayDate,
    roleLabel,
    roleColor,
    roleInitial,
    escapeHtml,
    ensureDemoData,
    getCurrentUser,
    setCurrentUser,
    clearSession,
    requireAuth,
    initLayout,
    applyManagementControlVisibility,
    getUsers,
    saveUsers,
    getUserByCredentials,
    createUser,
    updateUser,
    deleteUser,
    getAssets,
    saveAssets,
    getCategories,
    addCategory,
    getLocations,
    addLocation,
    getTransactions,
    saveTransactions,
    getAuditLogs,
    saveAuditLogs,
    logRoomAudit,
    nextAssetId,
    nextTransactionId,
    nextBulkId,
    getDashboardStats,
    getCategoryBreakdown,
    getQuantityBreakdown,
    getLowStockAssets,
    getRecentTransactions,
    getFrequentlyUsedItems,
    createCategoryBadge,
    createStatusBadge,
    exportMasterInventoryCsv,
    exportAnalyticsSummaryCsv,
    exportTableToCsv,
    exportFullBackup,
    restoreFromBackup,
    getBorrowRequests,
    saveBorrowRequests,
    nextRequestId,
    initDashboardPage
  };
})();

// ============================================================
// PLATONIAN'S IS — NOTIFICATIONS + CONDITION MODULE
// Appended to app.js — runs after IMS is set up
// ============================================================
(function() {
  "use strict";

  // ── PATCH: requireAuth to use API session ────────────────
  // Override so pages use MySQL-backed session from API.js
  const _origRequireAuth = window.IMS.requireAuth;
  window.IMS.requireAuth = function(pageKey) {
    // Try API session first (MySQL login), fall back to IMS session
    if (window.API && window.API.getSessionUser) {
      const apiUser = window.API.getSessionUser();
      if (apiUser) {
        // Sync into IMS session so rest of IMS code works
        if (window.IMS.setCurrentUser) window.IMS.setCurrentUser(apiUser);
        const PAGE_PERMS = window.IMS.PAGE_PERMISSIONS || {};
        if (pageKey && PAGE_PERMS[pageKey] && !PAGE_PERMS[pageKey].includes(apiUser.role)) {
          const nav = (window.IMS.NAVIGATION || {})[apiUser.role] || [];
          window.location.href = nav.length ? nav[0].href : "dashboard.html";
          return null;
        }
        return { ...apiUser, role: apiUser.role };
      }
      // Not logged in
      if (pageKey !== "login") { window.location.href = "index.html"; return null; }
      return null;
    }
    return _origRequireAuth(pageKey);
  };

  // Patch logout to clear API session too
  const _origClear = window.IMS.clearSession;
  window.IMS.clearSession = function() {
    if (_origClear) _origClear();
    if (window.API && window.API.clearSessionUser) window.API.clearSessionUser();
  };

  // ── NOTIFICATIONS BELL ────────────────────────────────────
  const POLL_INTERVAL = 30000; // 30 seconds
  let notifPollTimer = null;
  let lastUnreadCount = 0;

  function getTypeIcon(type) {
    const icons = {
      request:     "📋",
      approved:    "✅",
      rejected:    "❌",
      checkout:    "📤",
      returned:    "📥",
      new_asset:   "➕",
      low_stock:   "⚠️",
      out_of_stock:"🚫",
      due_soon:    "⏰",
      overdue:     "🔴",
      info:        "ℹ️",
      warning:     "⚠️",
    };
    return icons[type] || "🔔";
  }

  function timeAgo(dateStr) {
    if (!dateStr) return "";
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1)  return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  function renderNotifList(notifications) {
    const list = document.getElementById("notif-list");
    if (!list) return;
    if (!notifications.length) {
      list.innerHTML = '<div class="notif-empty">No notifications yet.</div>';
      return;
    }

    // Map notification type → extra CSS class
    const typeClass = {
      overdue:     'notif-overdue',
      due_soon:    'notif-due-soon',
      low_stock:   'notif-low-stock',
      out_of_stock:'notif-out-of-stock',
    };

    list.innerHTML = notifications.slice(0, 20).map(n => {
      const extra  = typeClass[n.type] || '';
      const unread = !n.isRead ? 'notif-unread' : '';
      // Overdue always shows even if "read" — keep pulsing until item is returned
      const classes = ['notif-item', unread, extra].filter(Boolean).join(' ');
      return `
      <div class="${classes}" data-notif-id="${n.notifId}" data-type="${n.type}">
        <span class="notif-icon">${getTypeIcon(n.type)}</span>
        <div class="notif-body">
          <div class="notif-title">${escHtml(n.title)}</div>
          <div class="notif-msg">${escHtml(n.message || "")}</div>
          <div class="notif-time">${timeAgo(n.createdAt)}</div>
        </div>
      </div>`;
    }).join("");

    // Click to mark read + navigate
    list.querySelectorAll(".notif-item").forEach(item => {
      item.addEventListener("click", async () => {
        const nid  = item.getAttribute("data-notif-id");
        const type = item.getAttribute("data-type");
        const user = window.API.getSessionUser();
        if (user) await window.API.markNotificationsRead(user.email, nid);
        // Only remove unread highlight for non-overdue (overdue keeps pulsing until resolved)
        if (type !== 'overdue') item.classList.remove("notif-unread");
        const n = notifications.find(x => x.notifId === nid);
        if (n && n.link) window.location.href = n.link;
        updateBadge(notifications.filter(x => !x.isRead && x.notifId !== nid).length);
      });
    });
  }

  function updateBadge(count, hasOverdue) {
    const dot    = document.getElementById("notif-dot");
    const badge  = document.getElementById("notif-count-badge");
    const bell   = document.getElementById("notif-bell-btn");
    if (dot)   dot.style.display   = count > 0 ? "block" : "none";
    if (badge) {
      badge.style.display = count > 0 ? "flex" : "none";
      badge.textContent   = count > 9 ? "9+" : String(count);
      // Turn badge red if any overdue notifications exist
      badge.style.background = hasOverdue ? "#dc2626" : "";
    }
    if (bell) {
      // Shake the bell icon when overdue items exist
      bell.classList.toggle("bell-urgent", !!hasOverdue);
    }
  }

  async function fetchAndRenderNotifs() {
    const user = window.API && window.API.getSessionUser ? window.API.getSessionUser() : null;
    if (!user) return;
    try {
      const res   = await window.API.getNotifications(user.email);
      const notifs = res.notifications || [];
      renderNotifList(notifs);
      const hasOverdue = notifs.some(n => n.type === 'overdue' && !n.isRead);
      updateBadge(res.unread || 0, hasOverdue);

      // Browser push for new unread notifications
      if (res.unread > lastUnreadCount && Notification.permission === "granted") {
        const newest = notifs.find(n => !n.isRead);
        if (newest) {
          new Notification(newest.title, {
            body: newest.message || "",
            icon: "assets/img/logo.png",
            tag:  newest.notifId,
          });
        }
      }
      lastUnreadCount = res.unread || 0;
    } catch { /* network failure — silently skip */ }
  }

  function escHtml(s) {
    return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  function initNotificationBell() {
    const bellBtn     = document.getElementById("notif-bell-btn");
    const dropdown    = document.getElementById("notif-dropdown");
    const markAllBtn  = document.getElementById("notif-mark-all-btn");
    if (!bellBtn || !dropdown) return;

    // Toggle dropdown
    bellBtn.addEventListener("click", e => {
      e.stopPropagation();
      const isOpen = dropdown.style.display !== "none";
      dropdown.style.display = isOpen ? "none" : "block";
      if (!isOpen) fetchAndRenderNotifs();
    });

    // Close on outside click
    document.addEventListener("click", e => {
      if (!bellBtn.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.style.display = "none";
      }
    });

    // Mark all read
    if (markAllBtn) {
      markAllBtn.addEventListener("click", async e => {
        e.stopPropagation();
        const user = window.API && window.API.getSessionUser ? window.API.getSessionUser() : null;
        if (!user) return;
        await window.API.markNotificationsRead(user.email, "all");
        updateBadge(0);
        document.querySelectorAll(".notif-item").forEach(i => i.classList.remove("notif-unread"));
        lastUnreadCount = 0;
      });
    }

    // Request browser push permission
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    // Initial fetch + polling
    fetchAndRenderNotifs();
    notifPollTimer = setInterval(fetchAndRenderNotifs, POLL_INTERVAL);

    // ── Due / Overdue check — runs once on load, then every hour ──
    // Only admin/custodian trigger it (they see all transactions)
    async function checkDueAndOverdue() {
      const u = window.API && window.API.getSessionUser ? window.API.getSessionUser() : null;
      if (!u) return;
      try {
        await fetch('api/transactions.php?action=check_due', { method: 'POST' });
        // Refresh notifications so new due/overdue ones appear immediately
        fetchAndRenderNotifs();
      } catch { /* silently skip */ }
    }
    checkDueAndOverdue();
    setInterval(checkDueAndOverdue, 60 * 60 * 1000); // every hour
  }

  // ── CONDITION FIELD MANAGEMENT ────────────────────────────
  // Maps asset status/condition to a user-facing label
  function conditionFromAsset(asset) {
    if (!asset) return "Good";
    // Use explicit condition field if set
    if (asset.condition && asset.condition !== "Good") return asset.condition;
    // Fall back to status-derived condition
    const s = String(asset.status || "").toLowerCase();
    if (s === "under repair") return "Under Repair";
    if (s === "out of stock") return "Fair";
    if (s === "missing")      return "Poor";
    return asset.condition || "Good";
  }

  // Make condition field read-only on teacher borrow form and auto-fill from asset
  function wireConditionAutoFill(assetSelectId, conditionFieldId) {
    const sel  = document.getElementById(assetSelectId);
    const cond = document.getElementById(conditionFieldId);
    if (!sel || !cond) return;

    async function updateCondition() {
      const assetId = sel.value;
      if (!assetId) return;
      try {
        const assets = window._cachedAssets || await window.API.getAssets();
        window._cachedAssets = assets;
        const asset = assets.find(a => a.id === assetId);
        const c = conditionFromAsset(asset);
        cond.value = c;
        // Show a visual indicator
        const hint = document.getElementById(conditionFieldId + "-hint");
        if (hint) hint.textContent = `Condition set by property custodian: ${c}`;
      } catch { cond.value = "Good"; }
    }

    sel.addEventListener("change", updateCondition);
    // Run on page load if there's already a selected value
    if (sel.value) updateCondition();
  }

  // ── INIT ON DOMCONTENTLOADED ──────────────────────────────
  document.addEventListener("DOMContentLoaded", () => {
    // Small delay to let page modules initialize first
    setTimeout(() => {
      initNotificationBell();

      // Wire condition auto-fill on checkout page
      if (document.body.dataset.page === "transactions") {
        wireConditionAutoFill("checkout-asset-id", "checkout-condition");
      }
      // Wire on borrow page (teacher)
      if (document.body.dataset.page === "borrow") {
        wireConditionAutoFill("borrow-asset-id", "borrow-condition");
      }
    }, 300);
  });

  // Expose so other modules can call
  window.IMS.fetchNotifications  = fetchAndRenderNotifs;
  window.IMS.conditionFromAsset  = conditionFromAsset;
}());

// ============================================================
// AUTO-BACKUP MODULE — runs every 24h in background
// Uses server-side backup file dates — no localStorage dependency.
// ============================================================
(function() {
  "use strict";

  function todayStr() {
    return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  }

  async function runAutoBackupIfDue() {
    const user = window.API && window.API.getSessionUser ? window.API.getSessionUser() : null;
    if (!user || user.role === 'teacher') return; // Only admin/custodian trigger backups

    try {
      // Check existing backups on the server — no localStorage needed
      const backups = await window.API.listBackups();
      const today   = todayStr();
      // If a backup already exists for today, skip
      if (backups.some(b => b.filename === `backup_${today}.json`)) return;

      const res = await window.API.runAutoBackup();
      if (res.ok) {
        console.info(`[Platonian IS] Auto-backup saved: ${res.file}`);
      }
    } catch { /* silently skip on error */ }
  }

  // Render backup history list on reports page
  async function renderBackupHistory() {
    const container = document.getElementById('auto-backup-list');
    if (!container) return;
    const backups = await window.API.listBackups();
    if (!backups.length) {
      container.innerHTML = '<div style="font-size:0.82rem; color:var(--gray-500); padding:0.5rem 0;">No auto-backups yet. Backups run automatically every 24 hours.</div>';
      return;
    }
    container.innerHTML = backups.map(b => {
      const kb = (b.size / 1024).toFixed(1);
      return `<div style="display:flex; align-items:center; justify-content:space-between; padding:0.55rem 0; border-bottom:1px solid var(--gray-100); font-size:0.82rem;">
        <div>
          <span style="font-family:'DM Mono',monospace; color:var(--gray-700);">${b.filename}</span>
          <span style="color:var(--gray-400); margin-left:0.5rem;">${b.date} · ${kb} KB</span>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="window.API.downloadBackup('${b.filename}')" type="button">↓ Download</button>
      </div>`;
    }).join('');
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Run backup check on every page load (after short delay)
    setTimeout(runAutoBackupIfDue, 5000);

    // Render backup history on reports page
    if (document.body.dataset.page === 'reports') {
      setTimeout(renderBackupHistory, 600);
    }
  });
}());
