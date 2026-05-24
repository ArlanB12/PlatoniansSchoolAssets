# Architecture

A short tour of the codebase, intended for someone (including future-you) who needs to make changes without reading every file. Read this in 10–15 minutes and you should know where to look for anything.

---

## High-level shape

```
Browser  ─►  *.html  ─►  api.js  ─►  api/*.php  ─►  MySQL
              │            │
              │            └── window.API (network layer + CSRF token cache)
              │
              └── app.js (window.IMS — single IIFE with 3 logical sections)
                    │
                    ├── auth.js          (login page only)
                    ├── inventory.js     (inventory page)
                    ├── transactions.js  (checkin/out, borrow, return, reports)
                    ├── users.js         (users page)
                    └── entry.js         (bootstrap + page dispatch)
```

- **No build step, no framework.** Every page loads `api.js` + `app.js` + module script + `entry.js`. The only third-party JS is Chart.js (CDN, dashboard only).
- **Two global namespaces:** `window.API` (network layer, CSRF token cache) and `window.IMS` (UI helpers, charts, data getters, session-aware `requireAuth`).
- **PHP endpoints are JSON-only.** Every request returns `{ok: true|false, ...}`. No template engine. No HTML responses.
- **PDO with prepared statements throughout.** No `mysqli`, no string-concatenated SQL.
- **Real PHP `$_SESSION` + CSRF tokens** (v10). Server is the source of truth for auth and role.

---

## Auth & session flow (v10)

This is the part that changed most in v10 — worth understanding before touching anything.

```
            Browser                          Server (PHP)
   ┌──────────────────────────┐    ┌────────────────────────────────┐
   │                          │    │                                │
   │  index.html              │    │  auth.php?action=login         │
   │  ───────────             │    │  ──────────────────────        │
   │  apiLogin(email, pw)     ├────►  - rate_limit_enforce          │
   │                          │    │  - verify password (bcrypt)    │
   │  apiLogin caches:        ◄────┤  - per-account lockout check   │
   │    _csrfToken            │    │  - login_user(): start session,│
   │    _currentUser          │    │    regenerate ID, mint CSRF    │
   │                          │    │  - return {user, csrfToken}    │
   │  Redirect → dashboard    │    │  - Set-Cookie: PLATONIANS_SESS │
   │                          │    │                                │
   │  ──────────────          │    │                                │
   │  dashboard.html loads    │    │  auth.php?action=me            │
   │  entry.js runs:          ├────►  ──────────────────────        │
   │    await apiBootstrap()  │    │  - read $_SESSION['user']      │
   │                          ◄────┤  - return {user, csrfToken}    │
   │  ─────────               │    │                                │
   │  every write request:    │    │                                │
   │    X-CSRF-Token header   ├────►  guard_request_csrf()          │
   │    + cookie (auto)       │    │  - hash_equals(token, session) │
   │                          │    │  - require_auth([roles])       │
   │                          ◄────┤  - 403 / 401 on mismatch       │
   │                          │    │                                │
   └──────────────────────────┘    └────────────────────────────────┘
```

**Key files:**
- `api/_session.php` — `current_user()`, `login_user()`, `logout_user()`, `csrf_token()`, `csrf_check()`, `guard_request_csrf()`, `require_auth($roles)`. Every endpoint requires this.
- `api/_ratelimit.php` — `rate_limit_check()`, `rate_limit_enforce()`, `rate_limit_reset()`. Used by `auth.php` on login/register/forgot.
- `assets/js/api.js` — `apiBootstrap()`, `apiLogin()`, `apiLogout()`, internal `_csrfToken` cache, `X-CSRF-Token` header automatically added by `apiCall()` on non-GET requests.
- `assets/js/entry.js` — calls `apiBootstrap()` once per page load, dispatches page initializer.

**Public endpoints (no auth, no CSRF needed):**
- `auth.php?action=login` (rate-limited 10/min/IP)
- `auth.php?action=register` (rate-limited 5/min/IP)
- `auth.php?action=forgot_verify` (rate-limited 5/min/IP)
- `auth.php?action=forgot_reset`
- `auth.php?action=check_lock`
- `health.php` (no rate limit — health probes need to always work)

Everything else requires an authenticated session AND a valid CSRF token on writes.

---

## Request lifecycle (example: "Approve Borrow Request")

1. **Browser:** `transactions.js` click handler calls `window.API.approveRequest(requestId)`.
2. **api.js → apiCall:** builds POST to `borrow_requests.php?action=approve`, automatically adds:
   - Session cookie (browser sends automatically)
   - `X-CSRF-Token` header (from cached `_csrfToken`)
3. **borrow_requests.php:**
   - `guard_request_csrf()` — validates token via `hash_equals`
   - `require_auth(['admin', 'custodian'])` — checks `$_SESSION['user']['role']`
   - `beginTransaction()` → `SELECT … FOR UPDATE` the asset row
   - Insert transaction, decrement asset quantity, mark request `Approved`, commit
   - Insert notification rows for both staff and borrower
   - `sendJson(['ok' => true, 'transactionId' => 'TRX-####'])`
4. **Browser:** transactions.js re-renders the table.

All write endpoints follow this pattern: CSRF check → role check → DB transaction → mutate → notify → return JSON.

---

## Frontend: `assets/js/`

### `api.js` — the network layer (~470 lines)

Defines:

- **CSRF state** — `_csrfToken`, `_currentUser`, `_bootstrapPromise` (module-level)
- **`apiBootstrap()`** — calls `/auth.php?action=me` once, populates state. Idempotent (returns cached in-flight promise).
- **`apiCall(endpoint, action, method, body)`** — central fetch wrapper. Adds `credentials: 'same-origin'`, `X-CSRF-Token` on non-GETs. Auto-redirects to `index.html` on 401.
- **One function per endpoint action** — `apiLogin`, `apiGetAssets`, `apiCheckoutAsset`, etc.
- **Session helpers** — `getSessionUser`, `setSessionUser`, `clearSessionUser` (read/write sessionStorage; server is still source of truth via the cookie)
- **Utilities** — `autoDetectUnit`, `autoDetectLimit`, `unitLabel` (pure JS, used by inventory)

When adding a new endpoint action: add wrapper here, expose on `window.API`. That's the only place to remember.

### `app.js` — the big one (~2,500 lines, `window.IMS`)

**Single IIFE with three clearly-labeled sections** (merged in v10 from three separate IIFEs):

- **Section 1** — original UI module. Page navigation config, default seed data, layout helpers, data getters, stats + chart rendering, dashboard initializer, CSV export, utility helpers.
- **Section 2** — auth-session patch + notifications + condition autofill. Overrides `requireAuth` to use the API session, adds `syncFromServer()`, wires the notification bell, the hourly due-check, browser push notifications.
- **Section 3** — auto-backup (24h background).

The single-IIFE rewrite keeps `requireAuth` patching for now (Section 2 still overrides Section 1's version) because moving it inline would require restructuring the section boundaries.

### `entry.js` — page bootstrap (~50 lines)

Runs on every page. After DOM ready:
1. If `body[data-public]` is not set, `await window.API.bootstrap()` — hydrate session + CSRF
2. Dispatch from `initByPage[body[data-page]]` — currently only `dashboard` is auto-fired here; module scripts (inventory, transactions, users) wire themselves via their own `DOMContentLoaded`.

Module scripts ALSO call `await window.API.bootstrap()` at the top of their `DOMContentLoaded` handlers — safe because the function is idempotent (returns the same in-flight promise).

### Module scripts (one per page)

- **`auth.js`** — login page only. Public — does NOT call bootstrap (no session yet).
- **`inventory.js`** — inventory CRUD, room audit, file upload, search autocomplete (~750 lines).
- **`transactions.js`** — checkin/out (staff), borrow page (teachers), return page, reports page (~770 lines).
- **`users.js`** — user CRUD, flagged borrowers panel, tier override modal (~270 lines).

---

## Backend: `public/api/`

PHP 8, procedural, PDO. Every endpoint file:

1. `require_once 'config.php';` — DB connection, migrations
2. `require_once '_session.php';` — session + CSRF
3. `guard_request_csrf();` — rejects writes without valid token
4. Per-action: `require_auth([roles]);` then handler logic

### Shared infrastructure

- **`config.php`** — `getDB()` (lazy PDO singleton), `runMigrations()`, `APP_ENV` flag, loads `config.local.php` for credentials.
- **`_session.php`** — session start, CSRF generation/check, `require_auth()`, `login_user()`, `logout_user()`.
- **`_ratelimit.php`** — `rate_limit_enforce()` for public endpoints.

### Endpoint files

| File | Actions | Required role |
|------|---------|---------------|
| `auth.php` | login, register, forgot_verify, forgot_reset, check_lock | public (rate-limited) |
|            | me, logout | authenticated |
|            | get_tier | any authenticated |
|            | list_flagged | admin or custodian |
|            | override_tier, unlock_account | admin only |
| `assets.php` | list, search_suggest, user_suggest, categories, locations, next_bulk_id, get_condition | any authenticated |
|              | add, update, delete, add_category, add_location, upload_file | admin or custodian |
|              | delete_category | admin only |
| `transactions.php` | list, check_due | any authenticated |
|                    | checkout | admin or custodian |
|                    | return | admin, custodian, or teacher (teachers return their own) |
| `borrow_requests.php` | list | any authenticated |
|                       | create | teacher only |
|                       | approve, reject | admin or custodian |
| `users.php` | list, create, update, delete | admin only |
| `notifications.php` | list, mark_read | any authenticated |
|                     | send, send_bulk | admin or custodian |
| `audit_logs.php` | list, save | admin or custodian |
| `lending_policy.php` | get | any authenticated |
|                      | update | admin only |
| `backup.php` | restore | admin only |
| `auto_backup.php` | run, list, download | admin or custodian |
| `health.php` | (no actions) | public |

### Concurrency model

For any endpoint that mutates a counted resource:

```php
$db->beginTransaction();
try {
    $stmt = $db->prepare("SELECT * FROM assets WHERE id = ? FOR UPDATE");
    $stmt->execute([$assetId]);
    // … validate, mutate, commit
    $db->commit();
} catch (PDOException $e) {
    $db->rollBack();
    sendJson(['ok' => false, 'error' => '…']);
}
```

Prevents the classic "both requests read stock=1, both decrement, end up at -1" race.

---

## Database schema

Defined in `database/schema.sql`. 13 tables:

```
users               ← accounts + tier/lockout state
categories          ← lookup
locations           ← lookup
assets              ← inventory items
transactions        ← every checkout/return event
borrow_requests     ← teacher-initiated request queue
notifications       ← in-app notification feed
audit_logs          ← room audit history
lending_policy      ← configurable settings
counters            ← named integer counters (for human-readable IDs)
rate_limit          ← per-IP request counters (v10)
```

Plus indexes for hot paths: `transactions.status`, `transactions.return_date`, `borrow_requests.status`, `assets.category`, `assets.status`, `notifications.type`.

**Migrations** run on every cold DB connection via `runMigrations()` in `config.php` — idempotent `ALTER TABLE … ADD COLUMN IF NOT EXISTS` and `CREATE TABLE IF NOT EXISTS`. Existing v8.x or v9 installs upgrade to v10 just by importing the new PHP files; no manual migration step.

---

## Accountability tier logic

Implemented in `auth.php → getOverdueTier($db, $email)` — single source of truth. Returns `{tier: 0–4, daysOverdue, item, txnId, returnDate}` based on the borrower's most overdue transaction:

- **Tier 0** — no overdue
- **Tier 1** — 1–2 days overdue (warning)
- **Tier 2** — 3–6 days (borrowing suspended)
- **Tier 3** — 7–13 days (account restricted, can't log in)
- **Tier 4** — 14+ days (account escalated)

`users.overdue_override` lets an admin grant a temporary exemption. When set, `getOverdueTier` returns tier 0 regardless of days.

---

## Where to look for…

| Need | Look in |
|------|---------|
| Add a new endpoint action | `api/<file>.php`, then add wrapper in `assets/js/api.js`, then expose on `window.API` |
| Change role required for an action | The `require_auth([...])` call at the top of the action handler in the relevant `api/*.php` |
| Add a new dashboard chart | `app.js` Section 1 → `renderCategoryChart` as template; add `<canvas>` to dashboard.html; call site in `initDashboardPage` |
| Add a new notification type | Any handler can insert into `notifications`; add icon to `getTypeIcon()` in app.js; add CSS class `notif-<type>` |
| Add a new column to a table | Edit `database/schema.sql` AND add `ALTER TABLE … ADD COLUMN IF NOT EXISTS` to migrations in `config.php` |
| Add a new role | `app.js` → `NAVIGATION`, `PAGE_PERMISSIONS`, `ROLE_META`; `users.role` enum in MySQL; `require_auth` arrays across endpoints |
| Change accountability thresholds | `auth.php → getOverdueTier()` if/elseif chain; `app.js → tierColors` |
| Tighten rate limits | `auth.php` — the `rate_limit_enforce($bucket, $limit, $windowSec)` calls at the top of login/register/forgot |
| Disable production error display | `config.local.php` → `APP_ENV` |
| Run smoke tests | `cd tests && npm install && npx playwright test` |
