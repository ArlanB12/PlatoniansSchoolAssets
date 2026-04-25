// ============================================================
// Platonian's School Assets — API Layer (v8)
// ============================================================

const API_BASE = 'api';

// ── UNIT SYSTEM ─────────────────────────────────────────────
const CATEGORY_DEFAULT_UNITS = {
  'consumables': 'piece',
  'electronics': 'unit',
  'office equipment': 'unit',
  'audio': 'unit',
  'furniture': 'piece',
  'sports equipment': 'piece',
  'tools': 'piece',
};

const NAME_UNIT_MAP = [
  { keywords: ['chalk'],                              unit: 'box'    },
  { keywords: ['whiteboard marker', 'marker'],        unit: 'box'    },
  { keywords: ['ballpen', 'pen', 'pencil'],           unit: 'box'    },
  { keywords: ['staple'],                             unit: 'box'    },
  { keywords: ['bond paper', 'paper'],                unit: 'rim'    },
  { keywords: ['manila paper'],                       unit: 'bundle' },
  { keywords: ['cartolina'],                          unit: 'bundle' },
  { keywords: ['folder'],                             unit: 'bundle' },
  { keywords: ['tape'],                               unit: 'roll'   },
  { keywords: ['book', 'textbook', 'module'],         unit: 'copy'   },
  { keywords: ['chair', 'table', 'desk'],             unit: 'piece'  },
  { keywords: ['laptop', 'computer', 'desktop'],      unit: 'unit'   },
  { keywords: ['projector', 'printer', 'scanner', 'speaker', 'tv'], unit: 'unit' },
];

const CATEGORY_DEFAULT_LIMITS = {
  'consumables': 5,
  'electronics': 1,
  'office equipment': 2,
  'audio': 2,
  'furniture': 2,
};

function autoDetectUnit(name, category) {
  const lname = String(name || '').toLowerCase();
  for (const entry of NAME_UNIT_MAP) {
    if (entry.keywords.some(kw => lname.includes(kw))) return entry.unit;
  }
  const cat = String(category || '').toLowerCase();
  return CATEGORY_DEFAULT_UNITS[cat] || 'piece';
}

function autoDetectLimit(category) {
  const cat = String(category || '').toLowerCase();
  return CATEGORY_DEFAULT_LIMITS[cat] || 0;
}

function unitLabel(unit, qty) {
  const u = String(unit || 'piece');
  return qty === 1 ? u : u + 's';
}

// ── HELPER ─────────────────────────────────────────────────
async function apiCall(endpoint, action, method = 'GET', body = null) {
  const url = `${API_BASE}/${endpoint}.php?action=${action}`;
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  try {
    const res  = await fetch(url, opts);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      const clean = text.replace(/<[^>]+>/g, '').trim().slice(0, 200);
      console.error(`API non-JSON [${endpoint}/${action}]:`, text);
      return { ok: false, error: clean || `Server error on ${endpoint}/${action}.` };
    }
  } catch (err) {
    console.error(`API fetch failed [${endpoint}/${action}]:`, err);
    return { ok: false, error: 'Cannot reach server. Make sure XAMPP is running.' };
  }
}

// ── AUTH ────────────────────────────────────────────────────
async function apiLogin(email, password, role) {
  return apiCall('auth', 'login', 'POST', { email, password, role });
}
async function apiForgotVerify(email, fullName) {
  return apiCall('auth', 'forgot_verify', 'POST', { email, fullName });
}
async function apiForgotReset(email, token) {
  return apiCall('auth', 'forgot_reset', 'POST', { email, token });
}
async function apiRegister(name, email, role, password) {
  return apiCall('auth', 'register', 'POST', { name, email, role, password });
}
async function apiGetUserTier(email) {
  const url = `${API_BASE}/auth.php?action=get_tier&email=${encodeURIComponent(email)}`;
  try {
    const res = await fetch(url);
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { ok: false, tier: 0 }; }
  } catch { return { ok: false, tier: 0 }; }
}
async function apiOverrideTier(email, override, note, byEmail) {
  return apiCall('auth', 'override_tier', 'POST', { email, override, note, byEmail });
}
async function apiUnlockAccount(email) {
  return apiCall('auth', 'unlock_account', 'POST', { email });
}

// ── ASSETS ─────────────────────────────────────────────────
async function apiGetAssets() {
  const res = await apiCall('assets', 'list');
  return res.ok ? res.assets : [];
}
async function apiAddAsset(payload) {
  return apiCall('assets', 'add', 'POST', payload);
}
async function apiUpdateAsset(payload) {
  return apiCall('assets', 'update', 'POST', payload);
}
async function apiDeleteAsset(id) {
  return apiCall('assets', 'delete', 'POST', { id });
}
async function apiGetCategories() {
  const res = await apiCall('assets', 'categories');
  return res.ok ? res.categories : [];
}
async function apiAddCategory(name) {
  return apiCall('assets', 'add_category', 'POST', { name });
}
async function apiDeleteCategory(name) {
  return apiCall('assets', 'delete_category', 'POST', { name });
}
async function apiGetLocations() {
  const res = await apiCall('assets', 'locations');
  return res.ok ? res.locations : [];
}
async function apiAddLocation(name) {
  return apiCall('assets', 'add_location', 'POST', { name });
}
async function apiNextBulkId() {
  const res = await apiCall('assets', 'next_bulk_id');
  return res.ok ? res.bulkId : ('BLK-' + new Date().getFullYear() + '-001');
}
async function apiSearchSuggest(q) {
  const url = `${API_BASE}/assets.php?action=search_suggest&q=${encodeURIComponent(q)}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return data.ok ? data.suggestions : [];
  } catch { return []; }
}
async function apiUserSuggest(q) {
  const url = `${API_BASE}/assets.php?action=user_suggest&q=${encodeURIComponent(q)}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return data.ok ? data.suggestions : [];
  } catch { return []; }
}
async function apiUploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch(`${API_BASE}/assets.php?action=upload_file`, { method: 'POST', body: formData });
    return await res.json();
  } catch { return { ok: false, error: 'Upload failed.' }; }
}

// ── TRANSACTIONS ────────────────────────────────────────────
async function apiGetTransactions() {
  const res = await apiCall('transactions', 'list');
  return res.ok ? res.transactions : [];
}
async function apiCheckoutAsset(payload) {
  return apiCall('transactions', 'checkout', 'POST', payload);
}
async function apiReturnAsset(transactionId, condition, returnDate) {
  return apiCall('transactions', 'return', 'POST', { transactionId, condition, returnDate });
}
async function apiRunDueCheck() {
  return apiCall('transactions', 'check_due', 'POST', {});
}

// ── USERS ───────────────────────────────────────────────────
async function apiGetUsers() {
  const res = await apiCall('users', 'list');
  return res.ok ? res.users : [];
}
async function apiCreateUser(payload) {
  return apiCall('users', 'create', 'POST', payload);
}
async function apiUpdateUser(oldEmail, payload) {
  return apiCall('users', 'update', 'POST', { oldEmail, ...payload });
}
async function apiDeleteUser(email) {
  return apiCall('users', 'delete', 'POST', { email });
}

// ── BORROW REQUESTS ─────────────────────────────────────────
async function apiGetBorrowRequests() {
  const res = await apiCall('borrow_requests', 'list');
  return res.ok ? res.requests : [];
}
async function apiCreateBorrowRequest(payload) {
  return apiCall('borrow_requests', 'create', 'POST', payload);
}
async function apiApproveBorrowRequest(requestId) {
  return apiCall('borrow_requests', 'approve', 'POST', { requestId });
}
async function apiRejectBorrowRequest(requestId, reason) {
  return apiCall('borrow_requests', 'reject', 'POST', { requestId, reason });
}

// ── AUDIT LOGS ──────────────────────────────────────────────
async function apiGetAuditLogs() {
  const res = await apiCall('audit_logs', 'list');
  return res.ok ? res.auditLogs : [];
}
async function apiSaveAuditLog(payload) {
  return apiCall('audit_logs', 'save', 'POST', payload);
}

// ── LENDING POLICY ──────────────────────────────────────────
async function apiGetLendingPolicy() {
  const res = await apiCall('lending_policy', 'get');
  return res.ok ? res.policy : {};
}
async function apiUpdateLendingPolicy(payload) {
  return apiCall('lending_policy', 'update', 'POST', payload);
}

// ── NOTIFICATIONS ────────────────────────────────────────────
async function apiGetNotifications(email) {
  const url = `${API_BASE}/notifications.php?action=list&email=${encodeURIComponent(email)}`;
  try {
    const res  = await fetch(url);
    const data = await res.json();
    return data.ok ? data : { notifications: [], unread: 0 };
  } catch { return { notifications: [], unread: 0 }; }
}
async function apiMarkRead(email, notifId = 'all') {
  return apiCall('notifications', 'mark_read', 'POST', { email, notifId });
}
async function apiSendNotification(userEmail, type, title, message, link = '') {
  return apiCall('notifications', 'send', 'POST', { userEmail, type, title, message, link });
}

// ── BACKUP ──────────────────────────────────────────────────
async function apiExportBackup() {
  const [assets, transactions, users, requests, logs, categories, locations] = await Promise.all([
    apiGetAssets(), apiGetTransactions(), apiGetUsers(),
    apiGetBorrowRequests(), apiGetAuditLogs(), apiGetCategories(), apiGetLocations()
  ]);
  const backup = {
    backupDate: new Date().toISOString().slice(0, 10),
    backupTime: new Date().toLocaleTimeString(),
    backedUpBy: (getSessionUser() || {}).email || 'unknown',
    systemName: "Platonian's School Assets",
    version: '8.0',
    data: { assets, transactions, users, borrowRequests: requests, auditLogs: logs, categories, locations }
  };
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `platonians_backup_${backup.backupDate}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}
async function apiRestoreBackup(jsonString) {
  try {
    const backup = JSON.parse(jsonString);
    if (!backup || !backup.data) return { ok: false, error: 'Invalid backup file.' };
    return apiCall('backup', 'restore', 'POST', backup.data);
  } catch (e) {
    return { ok: false, error: 'Could not parse backup file.' };
  }
}
async function apiRunAutoBackup() {
  return apiCall('auto_backup', 'run', 'POST', {});
}
async function apiListBackups() {
  const res = await apiCall('auto_backup', 'list');
  return res.ok ? res.backups : [];
}
function apiDownloadBackup(filename) {
  const url = `${API_BASE}/auto_backup.php?action=download&file=${encodeURIComponent(filename)}`;
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

// ── ASSET CONDITION ────────────────────────────────────────
async function apiGetAssetCondition(id) {
  const url = `${API_BASE}/assets.php?action=get_condition&id=${encodeURIComponent(id)}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return data.ok ? data.condition : 'Good';
  } catch { return 'Good'; }
}


async function apiGetFlaggedBorrowers() {
  const url = `${API_BASE}/auth.php?action=get_flagged`;
  try {
    const res  = await fetch(url);
    const data = await res.json();
    return data.ok ? data.flagged : [];
  } catch { return []; }
}

// ── SESSION ─────────────────────────────────────────────────
function getSessionUser() {
  try {
    const u = JSON.parse(sessionStorage.getItem('ims_current_user'));
    return (u && u.email && u.role) ? u : null;
  } catch { return null; }
}
function setSessionUser(user) {
  sessionStorage.setItem('ims_current_user', JSON.stringify(user));
  sessionStorage.setItem('role', user.role);
}
function clearSessionUser() {
  sessionStorage.removeItem('ims_current_user');
  sessionStorage.removeItem('role');
}

// ── EXPORT ──────────────────────────────────────────────────
window.API = {
  login:               apiLogin,
  forgotVerify:        apiForgotVerify,
  forgotReset:         apiForgotReset,
  register:            apiRegister,
  getAssets:           apiGetAssets,
  addAsset:            apiAddAsset,
  updateAsset:         apiUpdateAsset,
  deleteAsset:         apiDeleteAsset,
  getCategories:       apiGetCategories,
  addCategory:         apiAddCategory,
  deleteCategory:      apiDeleteCategory,
  getLocations:        apiGetLocations,
  addLocation:         apiAddLocation,
  nextBulkId:          apiNextBulkId,
  searchSuggest:       apiSearchSuggest,
  userSuggest:         apiUserSuggest,
  uploadFile:          apiUploadFile,
  getTransactions:     apiGetTransactions,
  checkoutAsset:       apiCheckoutAsset,
  returnAsset:         apiReturnAsset,
  runDueCheck:         apiRunDueCheck,
  getUsers:            apiGetUsers,
  createUser:          apiCreateUser,
  updateUser:          apiUpdateUser,
  deleteUser:          apiDeleteUser,
  getBorrowRequests:   apiGetBorrowRequests,
  createBorrowRequest: apiCreateBorrowRequest,
  approveRequest:      apiApproveBorrowRequest,
  rejectRequest:       apiRejectBorrowRequest,
  getAuditLogs:        apiGetAuditLogs,
  saveAuditLog:        apiSaveAuditLog,
  getLendingPolicy:    apiGetLendingPolicy,
  updateLendingPolicy: apiUpdateLendingPolicy,
  getNotifications:    apiGetNotifications,
  markNotificationsRead: apiMarkRead,
  sendNotification:    apiSendNotification,
  exportBackup:        apiExportBackup,
  restoreBackup:       apiRestoreBackup,
  runAutoBackup:       apiRunAutoBackup,
  listBackups:         apiListBackups,
  downloadBackup:      apiDownloadBackup,
  getUserTier:         apiGetUserTier,
  overrideTier:        apiOverrideTier,
  unlockAccount:       apiUnlockAccount,
  getAssetCondition:   apiGetAssetCondition,
  getSessionUser,
  setSessionUser,
  clearSessionUser,
  autoDetectUnit,
  autoDetectLimit,
  unitLabel,
  getFlaggedBorrowers: apiGetFlaggedBorrowers,
};
