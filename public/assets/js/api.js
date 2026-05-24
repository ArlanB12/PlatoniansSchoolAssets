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
//
// v10 changes:
//   - All requests send the session cookie (credentials: 'include')
//   - All non-GET requests include X-CSRF-Token header from the
//     cached token (populated by apiBootstrap on page load).
//   - A 401 response triggers a redirect to index.html (login),
//     unless we're already on the login page.
//
let _csrfToken = '';
let _bootstrapPromise = null;
let _currentUser = null;

function getCsrfToken() { return _csrfToken; }
function setCsrfToken(t) { _csrfToken = String(t || ''); }

// ── GET MICRO-CACHE ─────────────────────────────────────────
// A single page refresh fans out into several reads of the same
// endpoint (e.g. getTransactions is hit 3x while rebuilding the
// cards, the history table and the return select). Without this,
// each becomes its own network round-trip. We collapse identical
// GETs that happen within a tiny window into ONE request, and we
// drop the whole cache the moment any write (POST) succeeds so a
// stale read can never survive an approve / checkout / return.
const _getCache = new Map();     // url -> { ts, promise }
const _GET_TTL  = 1500;          // ms — long enough to cover one refresh fan-out

function _invalidateGetCache() { _getCache.clear(); }

async function apiCall(endpoint, action, method = 'GET', body = null) {
  const url = `${API_BASE}/${endpoint}.php?action=${action}`;

  // Serve / share in-flight GETs from the micro-cache.
  if (method === 'GET') {
    const hit = _getCache.get(url);
    if (hit && (Date.now() - hit.ts) < _GET_TTL) return hit.promise;
    const p = _doFetch(url, method, body);
    _getCache.set(url, { ts: Date.now(), promise: p });
    // If the request fails, don't poison the cache with a rejected
    // promise — let the next call retry cleanly.
    p.catch(() => _getCache.delete(url));
    return p;
  }

  // Any write invalidates cached reads so the next read is fresh.
  const res = await _doFetch(url, method, body);
  _invalidateGetCache();
  return res;
}

async function _doFetch(url, method, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (method !== 'GET' && _csrfToken) headers['X-CSRF-Token'] = _csrfToken;
  const opts = { method, headers, credentials: 'same-origin' };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  try {
    const res  = await fetch(url, opts);
    const text = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const clean = text.replace(/<[^>]+>/g, '').trim().slice(0, 200);
      console.error(`API non-JSON [${url}]:`, text);
      return { ok: false, error: clean || `Server error on ${url}.` };
    }
    // Auto-redirect to login if the server says we're unauthenticated,
    // unless we're already on the login page (avoid redirect loops).
    if (res.status === 401 && parsed && parsed.authRequired) {
      const path = window.location.pathname || '';
      const onLogin = path.endsWith('/') || path.endsWith('index.html');
      if (!onLogin) {
        clearSessionUser();
        window.location.href = 'index.html';
      }
    }
    return parsed;
  } catch (err) {
    console.error(`API fetch failed [${url}]:`, err);
    return { ok: false, error: 'Cannot reach the server. Please check your connection and try again.' };
  }
}

/**
 * Bootstrap: call /auth.php?action=me ONCE at app start. If a
 * session exists, store the user + CSRF token. If not, return null.
 * Idempotent — repeat calls return the same in-flight promise.
 */
async function apiBootstrap() {
  if (_bootstrapPromise) return _bootstrapPromise;
  _bootstrapPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth.php?action=me`, { credentials: 'same-origin' });
      const data = await res.json();
      if (data && data.ok && data.user) {
        _currentUser = data.user;
        _csrfToken   = data.csrfToken || '';
        // mirror to sessionStorage so legacy UI code can read it
        try {
          sessionStorage.setItem('ims_current_user', JSON.stringify(data.user));
          sessionStorage.setItem('role', data.user.role);
        } catch {}
        return data.user;
      }
    } catch {}
    return null;
  })();
  return _bootstrapPromise;
}

// ── AUTH ────────────────────────────────────────────────────
async function apiLogin(username, password) {
  // v10.2: login now takes a username (the previous email-based call sites
  // are migrated). Role is auto-detected by the server from the user record.
  const res = await apiCall('auth', 'login', 'POST', { username, password });
  // v10: server returns a CSRF token alongside the user; cache it for
  // all subsequent write requests.
  if (res && res.ok && res.csrfToken) {
    setCsrfToken(res.csrfToken);
    _currentUser = res.user;
  }
  return res;
}
async function apiLogout() {
  const res = await apiCall('auth', 'logout', 'POST', {});
  _csrfToken        = '';
  _currentUser      = null;
  _bootstrapPromise = null; // allow re-bootstrap on next login
  clearSessionUser();
  return res;
}
async function apiHealth() {
  try {
    const r = await fetch(`${API_BASE}/health.php`);
    return await r.json();
  } catch (e) {
    return { ok: false, error: 'Health endpoint unreachable.' };
  }
}
// ── v10.3: Admin-mediated reset ────────────────────────────
// The user submits a request. No password change happens here.
async function apiForgotRequest(identifier, reason) {
  return apiCall('auth', 'forgot_request', 'POST', { identifier, reason });
}
async function apiListResetRequests(status = 'pending') {
  const url = `${API_BASE}/auth.php?action=list_reset_requests&status=${encodeURIComponent(status)}`;
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    return await res.json();
  } catch (e) {
    return { ok: false, error: 'Could not load reset requests.' };
  }
}
async function apiApproveResetRequest(requestCode, note = '') {
  return apiCall('auth', 'approve_reset_request', 'POST', { request_code: requestCode, note });
}
async function apiDenyResetRequest(requestCode, note) {
  return apiCall('auth', 'deny_reset_request', 'POST', { request_code: requestCode, note });
}
// ── v10.4: self-service password change ────────────────────
async function apiChangePassword(currentPassword, newPassword, confirmPassword) {
  return apiCall('auth', 'change_password', 'POST', {
    current_password: currentPassword,
    new_password:     newPassword,
    confirm_password: confirmPassword,
  });
}
async function apiListPasswordChanges() {
  const res = await apiCall('auth', 'list_password_changes');
  return res.ok ? res.changes : [];
}
async function apiSetSuperAccount(email, isSuper) {
  return apiCall('auth', 'set_super_account', 'POST', { email, is_super: !!isSuper });
}
async function apiRegister(name, username, email, role, password) {
  return apiCall('auth', 'register', 'POST', { name, username, email, role, password });
}
async function apiGetUserTier(email) {
  const url = `${API_BASE}/auth.php?action=get_tier&email=${encodeURIComponent(email)}`;
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { ok: false, tier: 0 }; }
  } catch { return { ok: false, tier: 0 }; }
}
async function apiOverrideTier(email, override, note) {
  // v10: byEmail is no longer trusted from the client — the server
  // reads it from the session. Argument kept signature-compatible.
  return apiCall('auth', 'override_tier', 'POST', { email, override, note });
}
async function apiUnlockAccount(identifier) {
  // Accepts either a username or an email — server resolves both.
  return apiCall('auth', 'unlock_account', 'POST', { email: identifier });
}
async function apiGetFlaggedBorrowers() {
  const res = await apiCall('auth', 'list_flagged');
  return res.ok ? res.flagged : [];
}
// v10.2: locked accounts — only returns users actually locked or with
// failed-login history. Used by policy.html's "Locked Accounts" panel.
async function apiGetLockedAccounts() {
  const res = await apiCall('auth', 'list_locked');
  return res.ok ? res.locked : [];
}
// v10.2: public stats for the login page (no auth required).
async function apiGetPublicStats() {
  try {
    const r = await fetch(`${API_BASE}/auth.php?action=public_stats`, { credentials: 'same-origin' });
    const j = await r.json();
    return j && j.ok ? j : { ok: false, totalAssets: 0, totalUnits: 0 };
  } catch {
    return { ok: false, totalAssets: 0, totalUnits: 0 };
  }
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
async function apiDeleteLocation(name) {
  return apiCall('assets', 'delete_location', 'POST', { name });
}
async function apiNextBulkId() {
  const res = await apiCall('assets', 'next_bulk_id');
  return res.ok ? res.bulkId : ('BLK-' + new Date().getFullYear() + '-001');
}
async function apiSearchSuggest(q) {
  const url = `${API_BASE}/assets.php?action=search_suggest&q=${encodeURIComponent(q)}`;
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    const data = await res.json();
    return data.ok ? data.suggestions : [];
  } catch { return []; }
}
async function apiUserSuggest(q) {
  const url = `${API_BASE}/assets.php?action=user_suggest&q=${encodeURIComponent(q)}`;
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    const data = await res.json();
    return data.ok ? data.suggestions : [];
  } catch { return []; }
}
async function apiUploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  // Multipart upload — can't use the JSON apiCall() wrapper, so wire
  // credentials + CSRF manually.
  const headers = {};
  if (_csrfToken) headers['X-CSRF-Token'] = _csrfToken;
  try {
    const res = await fetch(`${API_BASE}/assets.php?action=upload_file`, {
      method: 'POST',
      body: formData,
      credentials: 'same-origin',
      headers,
    });
    return await res.json();
  } catch { return { ok: false, error: 'Upload failed.' }; }
}
// v10.22 — upload several files in one request. Returns
// { ok, filenames:[...] }.
async function apiUploadFiles(files) {
  const list = Array.from(files || []);
  if (!list.length) return { ok: true, filenames: [] };
  const formData = new FormData();
  list.forEach(f => formData.append('files[]', f));
  const headers = {};
  if (_csrfToken) headers['X-CSRF-Token'] = _csrfToken;
  try {
    const res = await fetch(`${API_BASE}/assets.php?action=upload_file`, {
      method: 'POST',
      body: formData,
      credentials: 'same-origin',
      headers,
    });
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
// The server now scopes notifications by the session user — the email
// argument is kept for backwards-compatible call sites but ignored.
async function apiGetNotifications(_email) {
  const url = `${API_BASE}/notifications.php?action=list`;
  try {
    const res  = await fetch(url, { credentials: 'same-origin' });
    const data = await res.json();
    return data.ok ? data : { notifications: [], unread: 0 };
  } catch { return { notifications: [], unread: 0 }; }
}
async function apiMarkRead(_email, notifId = 'all') {
  return apiCall('notifications', 'mark_read', 'POST', { notifId });
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
    version: '10',
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
    const res = await fetch(url, { credentials: 'same-origin' });
    const data = await res.json();
    return data.ok ? data.condition : 'Good';
  } catch { return 'Good'; }
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
  // v10 session/bootstrap
  bootstrap:           apiBootstrap,
  logout:              apiLogout,
  health:              apiHealth,
  getCsrfToken,
  setCsrfToken,

  login:               apiLogin,
  forgotRequest:        apiForgotRequest,
  listResetRequests:    apiListResetRequests,
  approveResetRequest:  apiApproveResetRequest,
  denyResetRequest:     apiDenyResetRequest,
  // v10.4
  changePassword:       apiChangePassword,
  listPasswordChanges:  apiListPasswordChanges,
  setSuperAccount:      apiSetSuperAccount,
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
  deleteLocation:      apiDeleteLocation,
  nextBulkId:          apiNextBulkId,
  searchSuggest:       apiSearchSuggest,
  userSuggest:         apiUserSuggest,
  uploadFile:          apiUploadFile,
  uploadFiles:         apiUploadFiles,
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
  getFlaggedBorrowers: apiGetFlaggedBorrowers,
  getLockedAccounts:   apiGetLockedAccounts,
  getPublicStats:      apiGetPublicStats,
  getAssetCondition:   apiGetAssetCondition,
  getSessionUser,
  setSessionUser,
  clearSessionUser,
  autoDetectUnit,
  autoDetectLimit,
  unitLabel,
};
