# Platonian's IS — Changelog

## v10.25 (inventory polish + searchable forms + install bundle)

### Features
- **Searchable asset / transaction / location pickers.** The native `<select>` dropdowns that hold long, data-driven lists were hard to scan. They are now searchable inputs with live autosuggest: type any part of an ID, name, borrower, or room and the list filters instantly. Applied to the Check Out asset picker, Return transaction picker, Borrow asset picker, the teacher Return picker, the Room Audit location selector, and the Asset Registration location field. Short fixed-choice dropdowns (role, status, condition, month/sort filters) are intentionally left as plain dropdowns. The underlying `<select>` is kept as the source of truth (hidden) and a `change` event still fires on pick, so quantity auto-update, condition auto-fill, edit-prefill, and submit validation all keep working unchanged. A MutationObserver re-syncs the input whenever the option list is rebuilt. (`v10.25.js`, `styles.css`, `v10.25.css`)

### Fixes
- **Dark mode: Item Condition field was a glaring white box.** The read-only condition field used an inline light-green style that couldn't be themed. Moved to a `condition-readonly` class with proper light + dark variants (mint-green on a teal-tinted dark surface). (`transactions.html`, `borrow.html`, `styles.css`)
- **Dark mode: borrower-name dropdown unreadable.** On the Check Out Asset form, the borrower autocomplete dropdown was hardcoded to a white box with dark text, so in dark mode the suggested names were nearly invisible. Added `html.dark` overrides mapping it to the dark surface + light ink tokens (applies on both the Transactions and Borrow pages). (`styles.css`)
- **Inventory table row alignment.** The Actions column cell used `display:flex` directly on the `<td>`, which pulled it out of normal table layout and broke vertical alignment with the other columns. On rows where any column wrapped, the row separator lines stopped lining up. The buttons now live in an inner `.action-cell-inner` flex wrapper while the `<td>` stays a normal, vertically-centred table cell, so every cell in a row shares the same height and the lines are level. (`v10.25.css`, `inventory.js`)
- **DepEd filter scope.** The DepEd filter previously matched every bulk item (chairs, markers, printers). It now shows only learning materials lent to students that carry a Bulk ID — i.e. books and self-learning modules. An item qualifies when it is bulk, has a Bulk ID, and is in the books / learning-materials category (or its name reads like a book/module). (`inventory.js`)

### Tooling
- **`database/install.sql`** — one-shot installer combining schema + realistic sample inventory in a single import, for setting the system up on a fresh PC.

## v10 (auth hardening + production-ready release)

### Security

**Real PHP session + CSRF tokens on every write.**
Pre-v10, the "session" lived in `sessionStorage` on the client. The server didn't know who was calling. A malicious site could trick a logged-in browser into POSTing to any endpoint via cross-origin attack (mitigated only by the existing same-origin CORS check, which isn't bulletproof). Now:
- New `_session.php` starts a real PHP session (`HttpOnly`, `SameSite=Lax`, `Secure` on HTTPS).
- On successful login, `login_user()` regenerates the session ID (prevents fixation) and mints a CSRF token returned in the response.
- `api.js` caches the token and sends it as `X-CSRF-Token` on every non-GET request.
- Every endpoint file calls `guard_request_csrf()` which rejects non-safe requests without a valid token. Pre-auth endpoints (login, register, forgot) are exempt — they have rate limiting instead.
- New `?action=me` endpoint lets the frontend hydrate the session + token on page load. New `?action=logout` destroys the server session.

**Server-side role enforcement on every write endpoint.**
Pre-v10, the UI gated by role but the PHP didn't re-verify. Anyone who knew an endpoint URL could hit `users.php?action=delete` directly. Now every endpoint declares its required role via `require_auth(['admin'])` etc. The policy is in the source: admins for `users.php` / `lending_policy.php update` / `backup restore`; admins+custodians for inventory mutations / borrow approval / audit logs; teachers for `borrow_requests.php create` only; any-auth for reads. Also: `auth.php override_tier` no longer trusts the `byEmail` body field — it's read from the session, so clients can't spoof who performed the override.

**IP-based rate limiting on login, register, and forgot-password.**
New `_ratelimit.php` + `rate_limit` table track per-IP request counts in sliding windows. Login: 10/min/IP. Register: 5/min/IP. Forgot-verify: 5/min/IP. Successful login resets the IP's login counter so users who fumbled their password a few times before getting it right aren't punished. Combines with the existing per-account lockout (5 fails = 15min) to make both single-account brute-force AND multi-account enumeration impractical from one IP.

### New endpoints

**`/api/health.php`** — returns `{ok, version, env, db, dbLatency, phpVersion, ts}` for monitoring and pre-cron checks. No auth required. Returns 503 if DB is down.

**`/api/auth.php?action=me`** — returns the current session's user + CSRF token. Used by `apiBootstrap()` on every page load to hydrate the frontend state. 401 if no session.

**`/api/auth.php?action=logout`** — destroys the PHP session.

### Frontend refactor

**`entry.js` — single bootstrap script.**
Each HTML page now ends with `<script src="assets/js/entry.js"></script>` instead of inline init code. `entry.js` calls `window.API.bootstrap()` to hydrate the session, then dispatches the page initializer based on `body[data-page]`. The login page opts out via `data-public="true"`. Module scripts (inventory, transactions, users, policy inline) also call `apiBootstrap()` at the top of their DOMContentLoaded — the function is idempotent (returns the same in-flight promise), so multiple call sites are safe.

**`app.js` — three IIFEs merged into one.**
Pre-v10, `app.js` was structured as three sequential `(function(){...})()` blocks: the original window.IMS module, the API-session patching layer, and the auto-backup module. The middle one re-patched `requireAuth` and `clearSession` to use the API session. Merged into a single IIFE with comment markers for each section. Same behavior, single scope, one `"use strict"`, easier to navigate.

**Dead exports removed.**
`saveAssets`, `saveTransactions`, `saveBorrowRequests`, `saveUsers` were exposed on `window.IMS` but unused anywhere outside the IIFE — they're the legacy localStorage write path that's been bypassed since v8.x. The internal helpers stay (still called by some now-unused IMS methods) but the public surface is smaller.

**Logout button calls server-side logout.**
The sidebar logout handler now `await`s `window.API.logout()` (destroys the PHP session, clears the CSRF token) before redirecting. If the network call fails, client state still clears and redirect still happens.

### Tests

**`tests/smoke.spec.js`** — Playwright end-to-end smoke tests.
Asserts every page renders without console errors or 5xx API responses when signed in as the seed admin account. Includes a test that calls `/api/health.php` directly, and a CSRF test that verifies write requests without a token are rejected. Run via `cd tests && npm install && npx playwright test`. Designed to catch the kind of regressions you'd hit on day one after a refactor — broken endpoints, missing variables, busted import paths. See `tests/README.md`.

### Dashboard sync (carried from v9)

The dashboard's `getAssets()` / `getTransactions()` / `getBorrowRequests()` read from MySQL via the new `syncFromServer()` helper instead of stale localStorage. `initDashboardPage` awaits the sync before rendering. A "Syncing…" pulse appears next to the date pill while in flight.

### Other production hardening (carried from v9)

- `config.local.php` for credentials (gitignored, with `config.local.example.php` template)
- `APP_ENV` flag controls `display_errors` — production mode logs errors instead of displaying them
- `uploads/.htaccess` blocks `.php` execution as belt-and-suspenders against MIME bypass
- Upload extension derived from validated MIME, not user-supplied filename
- `uniqid()` swapped for `random_bytes(8)` in upload naming
- DB connection error message no longer mentions XAMPP

### Folder layout (carried from v9)

```
platonians_school_assets/
├── public/              ← Apache DocumentRoot
│   ├── *.html
│   ├── api/             ← PHP endpoints
│   ├── assets/{css,js,img}/
│   └── uploads/         ← gitignored
├── database/schema.sql
├── docs/                ← README/DEPLOYMENT/ARCHITECTURE/CHANGELOG
├── tests/               ← Playwright smoke tests
├── .gitignore, LICENSE, README.md
```

---

## v9 (production-ready release)

(See v10 above — v9 introduced the dashboard sync, the `/public` web root layout, and the initial production hardening. v10 builds on it with CSRF, server-side roles, rate limiting, health endpoint, entry.js, IIFE merge, and Playwright tests.)

---

## v8.3 (post-defense polish, round 2)

### Bug Fixes

**users.js / api.js / auth.php — Flagged Borrowers panel was completely dead**
`users.js` called `window.API.getFlaggedBorrowers()` whenever an admin or custodian opened the Users page, but that method was never defined on the API layer and no backend endpoint existed either. Every visit to the Users page silently threw `TypeError: window.API.getFlaggedBorrowers is not a function`, leaving the panel stuck on "Loading…" forever. Added:
- New backend endpoint `auth.php?action=list_flagged` — one row per teacher with overdue items OR an active override, with each teacher's most overdue item as the representative row, plus their derived tier (0–4).
- `apiGetFlaggedBorrowers()` in `api.js` and exposed as `window.API.getFlaggedBorrowers`.

**users.js — flagged-table click handler bound on every re-render**
`renderFlaggedTable()` ran `tbody.addEventListener("click", handleFlaggedClick)` every time it executed. A `_flaggedBound` flag was already declared but never used. After overriding a single tier, the next click fired the override modal handler N+1 times, producing duplicate `overrideTier` API calls. Wired the existing `_flaggedBound` guard so the listener attaches exactly once. Also moved the `let _flaggedBound = false` declaration to the top of the module to make the temporal ordering obvious.

**app.js — notification badge cleared overdue color too eagerly**
When the user clicked any single notification, `updateBadge(count)` was called without the `hasOverdue` argument. The function signature is `(count, hasOverdue)` and the second arg controls whether the badge stays red and the bell keeps shaking. Result: clicking a low-stock notification, for example, would make the badge revert to its normal color even if there were still unread overdue items. Now the click handler recomputes `stillUnread` AND `stillHasOverdue` from the local notifications array and passes both, so the urgent styling only clears when no overdue items remain unread.

**transactions.js — wrong error message on empty date fields**
Checkout and Borrow forms both ran the date range check (`borrowDate < today`) BEFORE the empty-field check. An empty string compares as less than any non-empty date, so leaving the borrow-date field blank surfaced `"Borrow date cannot be in the past."` instead of the intended `"Please complete all check-out fields."` Swapped the order in both forms so the empty-field guard runs first.

### Housekeeping

**app.js — replaced raw fetch in due/overdue check with `window.API.runDueCheck()`**
The fire-and-forget call to `api/transactions.php?action=check_due` used a hand-written `fetch` instead of the API wrapper that was already defined and exported. Switched to `window.API.runDueCheck()` for consistency with the rest of the codebase (same error handling path, one less code path to maintain).

---

## v8.2 (post-defense polish)

### Bug Fixes

**auto_backup.php — broken SELECT after v8.1 schema cleanup**
v8.1 removed the `original_password` column from the schema, but `auto_backup.php` was still doing `SELECT email, password, original_password, role, name FROM users` in `buildBackupData()`. Every daily auto-backup since v8.1 was failing with a fatal `Column not found: 1054` error — silently, because the failure happens inside a PHP fatal that just returned no JSON. Removed the dead column from the SELECT. Auto-backup now runs cleanly again.

**notifications.php — `nextCounter() - 1` produced colliding notif IDs**
`nextCounter()` already returns the new incremented value (it uses `LAST_INSERT_ID(value) + 1` under the hood). The `send` and `send_bulk` endpoints both did `nextCounter('notif_counter') - 1`, which reused the previous notification's number. On the `notif_id UNIQUE` constraint this triggered duplicate-key errors when other endpoints had just created a notification. Removed the stray `- 1` in both spots.

**Removed dead duplicate `due_check.php`**
Two implementations of overdue/due-soon notifications existed: `transactions.php?action=check_due` (the one the frontend actually calls) and `due_check.php` (never invoked). They had drifted apart — different `type` strings, different dedup logic. Deleted `due_check.php` to remove the maintenance trap.

**Stray `{api,uploads}` folder**
A literal folder named `{api,uploads}` existed in the project root — leftover from a `mkdir {api,uploads}` that ran without brace expansion (cmd.exe vs bash). Harmless but messy. Removed.

### Performance

**transactions.php check_due — prepared statements lifted out of loops**
The early-reminder and overdue loops were calling `$db->prepare("SELECT id FROM notifications WHERE title=? LIMIT 1")` once per iteration. PDO has to re-prepare the same SQL each time. Now prepared once before the loops as `$existsByTitle` and `execute()`d inside. The borrowed-transactions query in the early-reminder block was also being re-prepared every iteration of the outer `for $d` loop — same fix.

**transactions.php check_due — lazy-load admin list**
The Tier 4 escalation block was running `SELECT email FROM users WHERE role='admin'` inside every overdue iteration, even though most days have no 14+ day overdue transactions. The query now runs at most once per request, only when an escalation actually fires.

### Housekeeping

**auto_backup.php — version stamp**
Backup metadata still said `'version' => '5.0'`. Bumped to `'8.2'` to match the codebase.

---

## v8.1 (fixes & optimizations)

### Bug Fixes

**borrow_requests.php — duplicate low-stock notifications**
The `approve` action ran the out-of-stock / low-stock notification block twice back-to-back. Staff received two identical notifications every time a borrow request was approved. The duplicate block was removed; the single remaining block is correct.

**borrow_requests.php — ALTER TABLE in hot path**
`create` ran `ALTER TABLE borrow_requests ADD COLUMN borrower_email …` on every borrow request, which is a schema migration and has no business being in a user-triggered endpoint. The column is already added by `config.php` migrations. Removed.

**config.php — nextCounter() race condition**
The old implementation did `INSERT IGNORE … SELECT … UPDATE … SELECT` — three round trips with a window for concurrent requests to read the same value and generate duplicate notification IDs. Replaced with a single atomic `INSERT … ON DUPLICATE KEY UPDATE value = LAST_INSERT_ID(value) + 1` so `lastInsertId()` returns the new value in one operation with no race.

**backup.php / assets.php — isBulk operator-precedence bug**
`!empty($a['isBulk'] ?? $a['is_bulk'])` evaluates as `!empty($a['isBulk']) ?? $a['is_bulk']` because `??` binds tighter than `!empty(…)`. The fallback `is_bulk` key was never reached during restore. Fixed by assigning the coalesced value to a variable first.

**due_check.php — N+1 staff queries**
`$sendToStaff` fetched all staff rows inside every iteration of the transaction loop. With N borrowed transactions, this issued N identical `SELECT email FROM users …` queries. Staff list is now fetched once before the loop and reused.

**transactions.php check_due — N+1 staff queries**
Same N+1 pattern. Staff array fetched once before both the early-reminder and overdue loops.

### Security Fixes

**auth.php / users.php — plain-text password storage**
Passwords were stored and compared as plain text. Any SQL injection or DB dump would expose every user's credentials immediately. Replaced with bcrypt (`PASSWORD_BCRYPT`) throughout. The change is backwards-compatible: on login, if the stored value doesn't look like a bcrypt hash (legacy `123` dev accounts), it falls back to plain comparison and immediately upgrades the stored value to bcrypt on success. No user needs to reset their password.

**users.php — original_password column**
The schema stored every password a second time in `original_password`, defeating the purpose of hashing. Column removed from schema, all INSERT/UPDATE statements, and the backup restore path. Legacy backups that include it will have the field silently ignored on restore.

**auth.php — role leak on wrong-role login**
The error message on a role mismatch was `"Your role is: admin."` — broadcasting the stored role to anyone who knows the email and password. Changed to a generic message that does not reveal the stored role.

**config.php — CORS wildcard**
`Access-Control-Allow-Origin: *` allowed any origin to call the API with cookies. Changed to same-origin only (dynamic header matching `HTTP_HOST`).

**transactions.php / borrow_requests.php — stock race conditions**
Checkout and approve both did a "do we have enough stock?" check followed by a separate `UPDATE assets SET quantity = quantity - N`. Between those two statements another concurrent request could see the same quantity and both approvals would succeed, resulting in negative stock. Both endpoints now use `BEGIN TRANSACTION` + `SELECT … FOR UPDATE` to lock the asset row, validate, and update atomically before committing.

### Performance

**New indexes added (via migration + schema)**
- `transactions(status)` — queries filter by `status = 'Borrowed'` on every due/overdue check
- `transactions(return_date)` — range query on return_date for overdue detection
- `borrow_requests(status)` — list/approve/reject all filter on status
- `assets(category)` — category filter for search_suggest
- `assets(status)` — status filter for dashboard counts
- `notifications(type)` — type-based dedup checks in due_check
