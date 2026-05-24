<?php
require_once 'config.php';
require_once '_session.php';
require_once '_ratelimit.php';

guard_request_csrf();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

const MAX_FAILED_LOGINS   = 5;
const LOCKOUT_MINUTES     = 15;
const MAX_FORGOT_ATTEMPTS = 5;
const FORGOT_LOCK_MINUTES = 30;

/**
 * Verify a password against stored hash.
 * Backwards-compatible: if stored value is not a bcrypt hash (e.g. legacy
 * plain-text "123" dev accounts) it falls back to plain comparison, then
 * upgrades the stored value to bcrypt on success.
 */
function verifyPassword($plain, $stored, $db, $email) {
    // Detect bcrypt hash (starts with $2y$)
    if (strlen($stored) >= 60 && $stored[0] === '$') {
        return password_verify($plain, $stored);
    }
    // Legacy plain-text path — verify then upgrade in place
    if ($plain === $stored) {
        $hash = password_hash($plain, PASSWORD_BCRYPT);
        $db->prepare("UPDATE users SET password = ? WHERE email = ?")->execute([$hash, $email]);
        return true;
    }
    return false;
}

function hashPassword($plain) {
    return password_hash($plain, PASSWORD_BCRYPT);
}

function getOverdueTier($db, $email) {
    $u = $db->prepare("SELECT overdue_override FROM users WHERE email = ?");
    $u->execute([$email]);
    $row = $u->fetch();
    if ($row && (int)$row['overdue_override'] === 1) return ['tier' => 0, 'overridden' => true];

    $today = date('Y-m-d');
    $stmt  = $db->prepare("
        SELECT t.id, t.asset_name, t.return_date,
               DATEDIFF(?, t.return_date) AS days_late
        FROM transactions t
        JOIN users u ON LOWER(u.name) = LOWER(t.borrower)
        WHERE u.email = ?
          AND t.status = 'Borrowed'
          AND t.return_date < ?
        ORDER BY days_late DESC
        LIMIT 1
    ");
    $stmt->execute([$today, $email, $today]);
    $row = $stmt->fetch();
    if (!$row) return ['tier' => 0];

    $days = (int)$row['days_late'];
    $tier = 0;
    if ($days >= 14)     $tier = 4;
    elseif ($days >= 7)  $tier = 3;
    elseif ($days >= 3)  $tier = 2;
    elseif ($days >= 1)  $tier = 1;

    return [
        'tier'        => $tier,
        'daysOverdue' => $days,
        'item'        => $row['asset_name'],
        'txnId'       => $row['id'],
        'returnDate'  => $row['return_date'],
    ];
}

function tierMessage($info) {
    $item = $info['item'] ?? 'an item';
    $days = $info['daysOverdue'] ?? 0;
    $due  = $info['returnDate']  ?? '';
    switch ($info['tier']) {
        case 1: return "⚠️ Warning: You have an overdue item — {$item} (due {$due}, {$days} day(s) late). Please return it as soon as possible.";
        case 2: return "🚫 Borrowing Suspended: You cannot borrow items until you return — {$item} (due {$due}, {$days} day(s) late). Return the item to restore your borrowing privileges.";
        case 3: return "🔒 Account Restricted: Your account has been restricted due to — {$item} (due {$due}, {$days} day(s) overdue). Please return the item and contact the Property Custodian or Administrator.";
        case 4: return "🚨 Account Escalated: Your account has been locked. You have not returned — {$item} — for {$days} days (due {$due}). Contact the Administrator immediately.";
    }
    return '';
}

// ── LOGIN ──────────────────────────────────────────────────
if ($method === 'POST' && $action === 'login') {
    // v10: IP-based throttle (per-account lockout still applies below).
    // 10 attempts per minute per IP — generous enough that normal users
    // hitting "wrong password" a few times aren't blocked, tight enough
    // that scripted email enumeration is impractical.
    rate_limit_enforce('login', 10, 60);

    $body = getBody();
    // v10.2: login now accepts a `username` field. We still accept `email`
    // for backwards compatibility (e.g. older auto-fill flows after a
    // password reset).
    $identifier = strtolower(trim($body['username'] ?? $body['email'] ?? ''));
    $pass       = $body['password'] ?? '';

    if (!$identifier || !$pass)
        sendJson(['ok' => false, 'error' => 'Please enter your username and password.']);

    $db = getDB();
    // Lookup by username OR email (one query, two predicates) so the
    // user can paste either — but the field on the login screen is now
    // labelled "Username" by default.
    $stmt = $db->prepare("SELECT * FROM users WHERE LOWER(username) = ? OR LOWER(email) = ? LIMIT 1");
    $stmt->execute([$identifier, $identifier]);
    $user = $stmt->fetch();

    if (!$user)
        sendJson(['ok' => false, 'error' => 'No account found with that username.']);

    // Email is still the canonical key everywhere else in the system.
    $email = $user['email'];

    // Check lockout
    if ($user['locked_until'] && strtotime($user['locked_until']) > time()) {
        $mins = ceil((strtotime($user['locked_until']) - time()) / 60);
        sendJson(['ok' => false, 'error' => "🔒 Account temporarily locked due to too many failed login attempts. Try again in {$mins} minute(s).", 'locked' => true]);
    }

    // Verify password (bcrypt-aware, auto-upgrades legacy plain-text)
    if (!verifyPassword($pass, $user['password'], $db, $email)) {
        $fails = (int)$user['failed_logins'] + 1;
        if ($fails >= MAX_FAILED_LOGINS) {
            $lockUntil = date('Y-m-d H:i:s', time() + LOCKOUT_MINUTES * 60);
            $db->prepare("UPDATE users SET failed_logins = ?, locked_until = ? WHERE email = ?")
               ->execute([$fails, $lockUntil, $email]);
            // Notify admins — fetch staff once, insert in one loop
            try {
                $admins = $db->query("SELECT email FROM users WHERE role IN ('superadmin','admin')")->fetchAll();
                foreach ($admins as $a) {
                    $nid = 'NTF-' . str_pad(nextCounter('notif_counter'), 5, '0', STR_PAD_LEFT);
                    $db->prepare("INSERT INTO notifications (notif_id,user_email,type,title,message,link) VALUES (?,?,?,?,?,'')")
                       ->execute([$nid, $a['email'], 'security', "🔒 Account Locked — {$user['name']}", "Account {$user['username']} ({$email}) was temporarily locked after {$fails} failed login attempts."]);
                }
            } catch (PDOException $e) {}
            sendJson(['ok' => false, 'error' => "🔒 Account locked for " . LOCKOUT_MINUTES . " minutes after " . MAX_FAILED_LOGINS . " failed attempts. Contact the Administrator if needed.", 'locked' => true]);
        } else {
            $db->prepare("UPDATE users SET failed_logins = ? WHERE email = ?")->execute([$fails, $email]);
            $remaining = MAX_FAILED_LOGINS - $fails;
            sendJson(['ok' => false, 'error' => "Incorrect password. {$remaining} attempt(s) remaining before lockout."]);
        }
    }

    // Correct password — reset fail counter + IP throttle
    $db->prepare("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE email = ?")->execute([$email]);
    rate_limit_reset('login');

    // v10.2: role is now auto-detected from the user record — no role
    // dropdown on the login screen. The role field still exists for
    // permission checks downstream.
    $role = $user['role'];

    // v10.20: self-heal a blanked role at login time as a final safety
    // net (the migrations also repair it). A blank role would make the
    // client treat the session as invalid and bounce the user straight
    // back to this login screen — the exact "superadmin can't log in"
    // bug. Repair the canonical ICT account to 'superadmin'; any other
    // blank role falls back to 'teacher' so nobody is ever locked out.
    if ($role === '' || $role === null) {
        $isIct = ($user['username'] === 'superadmin' || $email === 'superadmin@test.com');
        $role  = $isIct ? 'superadmin' : 'teacher';
        try {
            $db->prepare("UPDATE users SET role = ? WHERE email = ?")->execute([$role, $email]);
            $user['role'] = $role;
        } catch (PDOException $e) { /* non-fatal */ }
    }

    // Accountability check (teachers)
    if ($role === 'teacher') {
        $info = getOverdueTier($db, $email);
        if ($info['tier'] >= 3) {
            sendJson(['ok' => false, 'error' => tierMessage($info), 'tier' => $info['tier'], 'blocked' => true]);
        }
        if ($info['tier'] > 0) {
            // Tier 1/2 teachers still log in (with a warning banner) so create the session
            login_user($user);
            logActivity($db, $user['email'], $user['role'], $user['name'], 'login', '', 'Signed in (overdue tier ' . $info['tier'] . ').');
            sendJson(['ok' => true,
                'user'        => ['email' => $user['email'], 'username' => $user['username'], 'role' => $user['role'], 'name' => $user['name']],
                'csrfToken'   => csrf_token(),
                'tier'        => $info['tier'],
                'warning'     => tierMessage($info),
                'overdueInfo' => $info,
                // v10.9: tell the client to force a password change if this
                // user was just issued a temp password via the admin-reset /
                // super-recovery flow. The flag is cleared by change_password.
                'mustChangePassword' => ((int)($user['must_change_password'] ?? 0) === 1),
            ]);
        }
    }

    // v10: create the server-side session. CSRF token returned in
    // the response is what the frontend will send back on every
    // subsequent write request via the X-CSRF-Token header.
    login_user($user);
    logActivity($db, $user['email'], $user['role'], $user['name'], 'login', '', 'Signed in.');
    sendJson(['ok' => true,
        'user' => [
            'email'    => $user['email'],
            'username' => $user['username'],
            'role'     => $user['role'],
            'name'     => $user['name'],
        ],
        'csrfToken' => csrf_token(),
        // v10.9: server-driven force-change-password gate. Set to true when
        // the user is signed in with a temporary password issued by an admin
        // (or via the super-account self-recovery flow). The frontend
        // intercepts this in v10.9.js and redirects to account.html?force=1.
        'mustChangePassword' => ((int)($user['must_change_password'] ?? 0) === 1),
    ]);
}

// ── ME — return current session + CSRF token ───────────────
// Called by the frontend on every page load. If 401, the user
// is redirected to the login page.
//
// v10.4: also returns the is_super_account flag so Account Settings
// can show the super-account banner without needing to call the
// admin-only users list endpoint.
if ($method === 'GET' && $action === 'me') {
    $u = current_user();
    if (!$u) sendJson(['ok' => false, 'error' => 'Not authenticated.', 'authRequired' => true], 401);

    // Pull the latest is_super_account flag from the DB. It's not in
    // the session because it can be flipped while the user is signed
    // in, and we want every page load to reflect the current value.
    $isSuper = false;
    try {
        $db = getDB();
        $stmt = $db->prepare("SELECT is_super_account FROM users WHERE email = ? LIMIT 1");
        $stmt->execute([$u['email']]);
        $row = $stmt->fetch();
        if ($row) $isSuper = ((int)$row['is_super_account'] === 1);
    } catch (PDOException $e) { /* non-fatal */ }

    $u['is_super_account'] = $isSuper;
    sendJson(['ok' => true, 'user' => $u, 'csrfToken' => csrf_token()]);
}

// ── LOGOUT ──────────────────────────────────────────────────
if ($method === 'POST' && $action === 'logout') {
    logout_user();
    sendJson(['ok' => true]);
}

// ── GET OVERDUE TIER ───────────────────────────────────────
// Used by Users page (staff) and login page (lookup by email).
// Allowed for any authenticated user — readonly.
if ($method === 'GET' && $action === 'get_tier') {
    require_auth();
    $email = strtolower(trim($_GET['email'] ?? ''));
    if (!$email) sendJson(['ok' => false, 'error' => 'Email required.']);
    $db   = getDB();
    $info = getOverdueTier($db, $email);
    sendJson(['ok' => true, 'tier' => $info['tier'], 'info' => $info, 'message' => tierMessage($info)]);
}

// ── OVERRIDE TIER ──────────────────────────────────────────
// Admin-only: lift or revoke a teacher's accountability override.
if ($method === 'POST' && $action === 'override_tier') {
    $me = require_auth(['superadmin','admin']);
    $body     = getBody();
    $email    = strtolower(trim($body['email'] ?? ''));
    $note     = trim($body['note'] ?? '');
    $override = !empty($body['override']) ? 1 : 0;
    // byEmail is now derived from the session — clients no longer
    // get to spoof who performed the override.
    $byEmail  = $me['email'];
    if (!$email) sendJson(['ok' => false, 'error' => 'Email required.']);
    $db = getDB();
    $db->prepare("UPDATE users SET overdue_override=?, overdue_override_note=?, overdue_override_by=? WHERE email=?")
       ->execute([$override, $note, $byEmail, $email]);
    sendJson(['ok' => true]);
}

// ── UNLOCK ACCOUNT (admin) ─────────────────────────────────
if ($method === 'POST' && $action === 'unlock_account') {
    require_auth(['superadmin']);
    $body  = getBody();
    // v10.2: accept either username or email under the same field name
    $identifier = strtolower(trim($body['email'] ?? $body['username'] ?? ''));
    if (!$identifier) sendJson(['ok' => false, 'error' => 'Username or email required.']);
    $db = getDB();
    $stmt = $db->prepare("UPDATE users SET failed_logins=0, locked_until=NULL, forgot_attempts=0, forgot_locked_until=NULL WHERE LOWER(username)=? OR LOWER(email)=?");
    $stmt->execute([$identifier, $identifier]);
    sendJson(['ok' => true, 'affected' => $stmt->rowCount()]);
}

// ============================================================
// v10.3 — ADMIN-MEDIATED PASSWORD RESET
// ------------------------------------------------------------
// Replaces the v10.2 self-service "username + full name" flow.
// Old flow was vulnerable: anyone who knew a co-worker's full
// name could reset their account.
//
// New model:
//   1. User submits a RESET REQUEST (no password change yet).
//   2. Request appears in the Admin's queue (policy.html).
//   3. Admin verifies the requester in person / by phone, then
//      Approves. ONLY then is a temp password generated, and it
//      is shown ONLY on the Admin's screen.
//   4. Admin hands the temp password to the user offline.
//
// Endpoints:
//   POST forgot_request          (public)       — submit a request
//   GET  list_reset_requests     (admin)        — read the queue
//   POST approve_reset_request   (admin)        — approve + reveal temp pw
//   POST deny_reset_request      (admin)        — deny with note
// ============================================================

const RESET_REQUEST_RATE_LIMIT  = 3;     // max submissions
const RESET_REQUEST_WINDOW_SECS = 600;   // …per 10 minutes (per IP)
const RESET_REQUEST_EXPIRY_DAYS = 7;     // auto-expire pending after N days
const RESET_REASON_MIN          = 10;
const RESET_REASON_MAX          = 500;

/**
 * Generate a sequential request code: PRR-00001, PRR-00002, …
 * Uses the existing `counters` infrastructure (see nextCounter()).
 */
function nextResetRequestCode() {
    return 'PRR-' . str_pad(nextCounter('reset_request_counter'), 5, '0', STR_PAD_LEFT);
}

/**
 * Mark stale pending requests as expired. Called lazily before any
 * read of the queue so the Admin's view stays clean without a cron.
 */
function expireStaleResetRequests($db) {
    // BUG FIX v10.19: admin_note was a string literal inside the SQL — any future
    // change to the message could silently break the query. Parameterize the note.
    // The INTERVAL value is cast to int from a PHP const (never user input) so it
    // is safe to interpolate, but we document the intent explicitly.
    $days = (int)RESET_REQUEST_EXPIRY_DAYS;
    $db->prepare("
        UPDATE password_reset_requests
           SET status = 'expired',
               resolved_at = NOW(),
               admin_note  = ?
         WHERE status = 'pending'
           AND created_at < (NOW() - INTERVAL {$days} DAY)
    ")->execute(['Auto-expired (>' . $days . ' days pending)']);
}

/**
 * Notify all admins that a new reset request needs their attention.
 * Wrapped in try/catch — a notification failure must not block the
 * request itself.
 */
function notifyAdminsOfResetRequest($db, $code, $user) {
    try {
        $admins = $db->query("SELECT email FROM users WHERE role IN ('superadmin','admin')")->fetchAll();
        foreach ($admins as $a) {
            $nid = 'NTF-' . str_pad(nextCounter('notif_counter'), 5, '0', STR_PAD_LEFT);
            $title = "🔑 Password reset request — {$user['name']}";
            $msg   = "{$user['name']} ({$user['username']}) submitted password reset request {$code}. Open the Users page to review.";
            $db->prepare("INSERT INTO notifications (notif_id,user_email,type,title,message,link) VALUES (?,?,?,?,?,?)")
               ->execute([$nid, $a['email'], 'security', $title, $msg, 'users.html']);
        }
    } catch (PDOException $e) { /* swallow */ }
}

// ── FORGOT — Submit a reset REQUEST ───────────────────────
// Public endpoint. Two paths:
//   1. NORMAL accounts → creates a pending ticket for the
//      Administrator to review. No password change here.
//   2. SUPER accounts (admins/custodians flagged is_super_account=1)
//      → bypasses the admin-approval queue and issues a temporary
//      password directly. The temp password is shown ONCE on the
//      response and is also recorded in password_changes so the
//      event is auditable.
//
// The "super account" exists so the only Administrator at the
// school can recover from a self-lockout when no second admin is
// available to approve the request through the normal flow. By
// design only accounts that an existing admin has explicitly
// flagged is_super_account=1 can use this path.
if ($method === 'POST' && $action === 'forgot_request') {
    rate_limit_enforce('forgot_request', RESET_REQUEST_RATE_LIMIT, RESET_REQUEST_WINDOW_SECS);

    $body       = getBody();
    $identifier = strtolower(trim($body['identifier'] ?? $body['username'] ?? $body['email'] ?? ''));
    $reason     = trim($body['reason'] ?? '');

    if (!$identifier)
        sendJson(['ok' => false, 'error' => 'Please enter your username or email.']);
    if (strlen($reason) < RESET_REASON_MIN)
        sendJson(['ok' => false, 'error' => 'Please describe why you need a reset (at least ' . RESET_REASON_MIN . ' characters).']);
    if (strlen($reason) > RESET_REASON_MAX)
        sendJson(['ok' => false, 'error' => 'Reason is too long (max ' . RESET_REASON_MAX . ' characters).']);

    $db   = getDB();
    $stmt = $db->prepare("SELECT email, username, name, role, is_super_account FROM users WHERE LOWER(username) = ? OR LOWER(email) = ? LIMIT 1");
    $stmt->execute([$identifier, $identifier]);
    $user = $stmt->fetch();

    // ⚠ Security: respond identically whether the account exists or not.
    // This prevents account enumeration via the reset form. The Admin
    // will see only real requests in the queue; fake submissions for
    // non-existent accounts are silently dropped.
    $genericOk = function($code) {
        sendJson([
            'ok'           => true,
            'request_code' => $code,
            'isSuper'      => false,
            'message'      => 'Your request has been submitted. The Administrator will verify your identity in person and provide your new password.',
        ]);
    };

    if (!$user) {
        // Generate a fake-looking code so the response shape is identical,
        // but DO NOT insert anything into the database.
        $fakeCode = 'PRR-' . str_pad(rand(10000, 99999), 5, '0', STR_PAD_LEFT);
        $genericOk($fakeCode);
    }

    // ── SUPER ACCOUNT PATH ─────────────────────────────────
    // Only admin/custodian rows with is_super_account=1 qualify.
    // Teachers and principals never can; even if someone flips the
    // flag manually in the DB for them, the role check below catches it.
    // v10.17 fix: include 'superadmin' — the ICT Coordinator's role
    // was renamed from 'admin' in v10.16 but this check was not updated.
    $isSuper = ((int)($user['is_super_account'] ?? 0) === 1)
            && in_array($user['role'], ['superadmin', 'admin', 'custodian'], true);

    if ($isSuper) {
        // Generate a fresh temporary password, hash it, store it.
        $tempPw   = ucfirst(substr(str_replace(['+', '/', '='], '', base64_encode(random_bytes(6))), 0, 5)) . rand(10, 99);
        $tempHash = hashPassword($tempPw);
        $ip       = $_SERVER['REMOTE_ADDR'] ?? '';

        $db->prepare("
            UPDATE users
               SET password = ?,
                   reset_token = NULL, reset_token_expiry = NULL,
                   failed_logins = 0, locked_until = NULL,
                   forgot_attempts = 0, forgot_locked_until = NULL,
                   must_change_password = 1
             WHERE email = ?
        ")->execute([$tempHash, $user['email']]);

        // Also create a request row marked 'approved' so the trail is
        // visible in the admin queue. Using the same counter keeps the
        // PRR-##### sequence continuous.
        $code = nextResetRequestCode();
        $db->prepare("
            INSERT INTO password_reset_requests
                (request_code, user_email, user_username, user_name,
                 reason, requester_ip, status, resolved_at, resolved_by, admin_note)
            VALUES (?, ?, ?, ?, ?, ?, 'approved', NOW(), ?, ?)
        ")->execute([
            $code, $user['email'], $user['username'], $user['name'],
            $reason, $ip, '[super-account self-recovery]',
            'Auto-approved via super-account flag.',
        ]);

        // Audit trail
        try {
            $db->prepare("INSERT INTO password_changes (user_email, changed_by, change_type, requester_ip) VALUES (?, ?, 'super_recovery', ?)")
               ->execute([$user['email'], $user['email'], $ip]);
        } catch (PDOException $e) { /* non-fatal */ }

        // Notify any OTHER admins so the event is visible to peers.
        try {
            $admins = $db->prepare("SELECT email FROM users WHERE role IN ('superadmin','admin') AND email <> ?");
            $admins->execute([$user['email']]);
            foreach ($admins->fetchAll() as $a) {
                $nid = 'NTF-' . str_pad(nextCounter('notif_counter'), 5, '0', STR_PAD_LEFT);
                $db->prepare("INSERT INTO notifications (notif_id,user_email,type,title,message,link) VALUES (?,?,?,?,?,?)")
                   ->execute([
                       $nid, $a['email'], 'security',
                       '🔐 Super-account self-recovery — ' . $user['name'],
                       "{$user['name']} ({$user['username']}) used the super-account recovery path. Reference: {$code}. Review the request log in Lending Policy.",
                       'policy.html'
                   ]);
            }
        } catch (PDOException $e) { /* swallow */ }

        sendJson([
            'ok'           => true,
            'isSuper'      => true,
            'request_code' => $code,
            'username'     => $user['username'],
            'email'        => $user['email'],
            'tempPassword' => $tempPw,
            'message'      => 'Super-account recovery complete. Use the temporary password below to sign in, then change your password from Account Settings.',
        ]);
    }

    // ── NORMAL ACCOUNT PATH (queue + admin approval) ────────
    // Prevent spam: if this user already has a pending request, return that one.
    $existing = $db->prepare("SELECT request_code FROM password_reset_requests WHERE user_email = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1");
    $existing->execute([$user['email']]);
    $pending = $existing->fetch();
    if ($pending) {
        $genericOk($pending['request_code']);
    }

    $code = nextResetRequestCode();
    $ip   = $_SERVER['REMOTE_ADDR'] ?? '';
    $db->prepare("
        INSERT INTO password_reset_requests
            (request_code, user_email, user_username, user_name, reason, requester_ip, status)
        VALUES (?, ?, ?, ?, ?, ?, 'pending')
    ")->execute([$code, $user['email'], $user['username'], $user['name'], $reason, $ip]);

    notifyAdminsOfResetRequest($db, $code, $user);

    $genericOk($code);
}

// ── CHANGE PASSWORD (self-service, any authenticated user) ──
// v10.4: teachers (and everyone else) can now change their own
// password from Account Settings. Requires the user to type their
// current password to confirm session ownership.
if ($method === 'POST' && $action === 'change_password') {
    $me   = require_auth();
    $body = getBody();
    $current = $body['current_password'] ?? '';
    $next    = $body['new_password']     ?? '';
    $confirm = $body['confirm_password'] ?? '';

    if (!$current || !$next)
        sendJson(['ok' => false, 'error' => 'Please fill in both your current and new passwords.']);
    if (strlen($next) < 6)
        sendJson(['ok' => false, 'error' => 'New password must be at least 6 characters.']);
    if ($next !== $confirm)
        sendJson(['ok' => false, 'error' => 'New password and confirmation do not match.']);
    if ($next === $current)
        sendJson(['ok' => false, 'error' => 'New password must be different from your current password.']);

    $db   = getDB();
    $stmt = $db->prepare("SELECT password FROM users WHERE email = ? LIMIT 1");
    $stmt->execute([$me['email']]);
    $row  = $stmt->fetch();
    if (!$row)
        sendJson(['ok' => false, 'error' => 'Account not found.']);

    if (!verifyPassword($current, $row['password'], $db, $me['email']))
        sendJson(['ok' => false, 'error' => 'Your current password is incorrect.']);

    $hash = hashPassword($next);
    // v10.9: clear must_change_password — the user has now set their own
    // password, so the force-change gate at next login should be lifted.
    $db->prepare("UPDATE users SET password = ?, failed_logins = 0, locked_until = NULL, must_change_password = 0 WHERE email = ?")
       ->execute([$hash, $me['email']]);

    try {
        $db->prepare("INSERT INTO password_changes (user_email, changed_by, change_type, requester_ip) VALUES (?, ?, 'self', ?)")
           ->execute([$me['email'], $me['email'], $_SERVER['REMOTE_ADDR'] ?? '']);
    } catch (PDOException $e) { /* non-fatal */ }

    sendJson(['ok' => true, 'message' => 'Your password has been updated.']);
}

// ── LIST RECENT PASSWORD CHANGES (admin) ──────────────────
// Used by policy.html to show a small audit feed.
if ($method === 'GET' && $action === 'list_password_changes') {
    require_auth(['superadmin']);
    $db   = getDB();
    $stmt = $db->query("
        SELECT pc.user_email, pc.changed_by, pc.change_type, pc.requester_ip, pc.created_at,
               u.name AS user_name, u.username AS user_username, u.role AS user_role
          FROM password_changes pc
          LEFT JOIN users u ON u.email = pc.user_email
         ORDER BY pc.created_at DESC
         LIMIT 50
    ");
    $rows = $stmt->fetchAll();
    sendJson(['ok' => true, 'changes' => $rows]);
}

// ── SET SUPER ACCOUNT FLAG (admin) ────────────────────────
// Admin can promote/demote admin or custodian rows. Teachers and
// principals are never eligible.
if ($method === 'POST' && $action === 'set_super_account') {
    $me   = require_auth(['superadmin']);
    $body = getBody();
    $email = strtolower(trim($body['email'] ?? ''));
    $flag  = !empty($body['is_super']) ? 1 : 0;
    if (!$email)
        sendJson(['ok' => false, 'error' => 'Email required.']);

    $db   = getDB();
    $stmt = $db->prepare("SELECT role FROM users WHERE email = ? LIMIT 1");
    $stmt->execute([$email]);
    $row  = $stmt->fetch();
    if (!$row)
        sendJson(['ok' => false, 'error' => 'User not found.']);
    if (!in_array($row['role'], ['superadmin', 'admin', 'custodian'], true))
        sendJson(['ok' => false, 'error' => 'Only superadmin, admin, or custodian accounts can be flagged as a super account.']);

    // Never let the last super-admin row drop its own flag in a way
    // that leaves zero admins with super privileges.
    if ($flag === 0) {
        $remaining = (int)$db->query("SELECT COUNT(*) FROM users WHERE role IN ('superadmin','admin') AND is_super_account = 1")->fetchColumn();
        if ($remaining <= 1 && in_array($row['role'], ['superadmin', 'admin'], true)) {
            sendJson(['ok' => false, 'error' => 'At least one Administrator must remain a super account for emergency recovery.']);
        }
    }

    $db->prepare("UPDATE users SET is_super_account = ? WHERE email = ?")->execute([$flag, $email]);
    sendJson(['ok' => true, 'isSuper' => $flag === 1]);
}

// ── LIST reset requests (admin queue) ─────────────────────
if ($method === 'GET' && $action === 'list_reset_requests') {
    require_auth(['superadmin']);
    $db = getDB();
    expireStaleResetRequests($db);

    $statusFilter = $_GET['status'] ?? 'pending';
    $allowed = ['pending', 'approved', 'denied', 'expired', 'cancelled', 'all'];
    if (!in_array($statusFilter, $allowed)) $statusFilter = 'pending';

    if ($statusFilter === 'all') {
        $stmt = $db->query("
            SELECT request_code, user_email, user_username, user_name, reason,
                   requester_ip, status, created_at, resolved_at, resolved_by, admin_note
              FROM password_reset_requests
             ORDER BY (status='pending') DESC, created_at DESC
             LIMIT 100
        ");
    } else {
        $stmt = $db->prepare("
            SELECT request_code, user_email, user_username, user_name, reason,
                   requester_ip, status, created_at, resolved_at, resolved_by, admin_note
              FROM password_reset_requests
             WHERE status = ?
             ORDER BY created_at DESC
             LIMIT 100
        ");
        $stmt->execute([$statusFilter]);
    }

    $rows = $stmt->fetchAll();
    $out  = [];
    foreach ($rows as $r) {
        $createdTs = strtotime($r['created_at']);
        $ageMins   = max(0, (int)((time() - $createdTs) / 60));
        $out[] = [
            'requestCode' => $r['request_code'],
            'userEmail'   => $r['user_email'],
            'username'    => $r['user_username'],
            'name'        => $r['user_name'],
            'reason'      => $r['reason'],
            'requesterIp' => $r['requester_ip'],
            'status'      => $r['status'],
            'createdAt'   => $r['created_at'],
            'ageMinutes'  => $ageMins,
            'resolvedAt'  => $r['resolved_at'],
            'resolvedBy'  => $r['resolved_by'],
            'adminNote'   => $r['admin_note'],
        ];
    }

    // Count pending for the badge
    $pendingCount = (int)$db->query("SELECT COUNT(*) FROM password_reset_requests WHERE status = 'pending'")->fetchColumn();

    sendJson(['ok' => true, 'requests' => $out, 'pendingCount' => $pendingCount]);
}

// ── APPROVE reset request (admin) ─────────────────────────
// This is where the actual password change happens. Generates a
// temp password and returns it to the Admin's browser ONCE.
if ($method === 'POST' && $action === 'approve_reset_request') {
    $me = require_auth(['superadmin']);
    $body = getBody();
    $code = trim($body['request_code'] ?? '');
    $note = substr(trim($body['note'] ?? ''), 0, 500);

    if (!$code) sendJson(['ok' => false, 'error' => 'Request code is required.']);

    $db = getDB();
    $db->beginTransaction();
    try {
        $stmt = $db->prepare("SELECT * FROM password_reset_requests WHERE request_code = ? AND status = 'pending' FOR UPDATE");
        $stmt->execute([$code]);
        $req = $stmt->fetch();
        if (!$req) {
            $db->rollBack();
            sendJson(['ok' => false, 'error' => 'Request not found or already resolved.']);
        }

        // Confirm the target user still exists
        $u = $db->prepare("SELECT id, email, username, role FROM users WHERE email = ? LIMIT 1");
        $u->execute([$req['user_email']]);
        $user = $u->fetch();
        if (!$user) {
            $db->rollBack();
            sendJson(['ok' => false, 'error' => 'The target user account no longer exists.']);
        }

        // Generate temp password (same generator as before)
        $tempPw   = ucfirst(substr(str_replace(['+', '/', '='], '', base64_encode(random_bytes(6))), 0, 5)) . rand(10, 99);
        $tempHash = hashPassword($tempPw);

        // Reset the password AND clear any login/forgot lockouts.
        // v10.9: also set must_change_password = 1 so the next login
        // forces the user to set their own password before they can
        // reach any other page.
        $db->prepare("
            UPDATE users
               SET password = ?,
                   reset_token = NULL, reset_token_expiry = NULL,
                   failed_logins = 0, locked_until = NULL,
                   forgot_attempts = 0, forgot_locked_until = NULL,
                   must_change_password = 1
             WHERE email = ?
        ")->execute([$tempHash, $user['email']]);

        // Mark the request approved
        $db->prepare("
            UPDATE password_reset_requests
               SET status = 'approved',
                   resolved_at = NOW(),
                   resolved_by = ?,
                   admin_note  = ?
             WHERE request_code = ?
        ")->execute([$me['email'], $note, $code]);

        // v10.4: also write to password_changes so the audit feed sees it.
        try {
            $db->prepare("INSERT INTO password_changes (user_email, changed_by, change_type, requester_ip) VALUES (?, ?, 'admin_reset', ?)")
               ->execute([$user['email'], $me['email'], $_SERVER['REMOTE_ADDR'] ?? '']);
        } catch (PDOException $e) { /* non-fatal */ }

        // v10.16: record in the system activity log (Principal oversight).
        logActivityAs($db, $me, 'password_reset', $user['email'],
            "Approved reset request {$code} and issued a temporary password.");

        // Notify the affected user (so they see in their notif tray that something happened)
        try {
            $nid = 'NTF-' . str_pad(nextCounter('notif_counter'), 5, '0', STR_PAD_LEFT);
            $db->prepare("INSERT INTO notifications (notif_id,user_email,type,title,message,link) VALUES (?,?,?,?,?,'')")
               ->execute([$nid, $user['email'], 'security',
                   '🔑 Your password was reset',
                   "Your password reset request {$code} was approved by an Administrator. The new temporary password was handed to you in person — please change it after signing in."
               ]);
        } catch (PDOException $e) { /* non-fatal */ }

        $db->commit();

        sendJson([
            'ok'            => true,
            'requestCode'   => $code,
            'username'      => $user['username'],
            'email'         => $user['email'],
            'tempPassword'  => $tempPw,
            'message'       => 'Approved. Hand this temporary password to the user in person.',
        ]);
    } catch (PDOException $e) {
        $db->rollBack();
        sendJson(['ok' => false, 'error' => 'Database error. Please try again.']);
    }
}

// ── DENY reset request (admin) ────────────────────────────
if ($method === 'POST' && $action === 'deny_reset_request') {
    $me = require_auth(['superadmin']);
    $body = getBody();
    $code = trim($body['request_code'] ?? '');
    $note = substr(trim($body['note'] ?? ''), 0, 500);

    if (!$code) sendJson(['ok' => false, 'error' => 'Request code is required.']);
    if (!$note) sendJson(['ok' => false, 'error' => 'Please provide a short reason for denying this request.']);

    $db   = getDB();
    $stmt = $db->prepare("
        UPDATE password_reset_requests
           SET status = 'denied',
               resolved_at = NOW(),
               resolved_by = ?,
               admin_note  = ?
         WHERE request_code = ? AND status = 'pending'
    ");
    $stmt->execute([$me['email'], $note, $code]);

    if ($stmt->rowCount() === 0)
        sendJson(['ok' => false, 'error' => 'Request not found or already resolved.']);

    // Let the affected user know (look up email from the request)
    try {
        $r = $db->prepare("SELECT user_email FROM password_reset_requests WHERE request_code = ?");
        $r->execute([$code]);
        $row = $r->fetch();
        if ($row) {
            $nid = 'NTF-' . str_pad(nextCounter('notif_counter'), 5, '0', STR_PAD_LEFT);
            $db->prepare("INSERT INTO notifications (notif_id,user_email,type,title,message,link) VALUES (?,?,?,?,?,'')")
               ->execute([$nid, $row['user_email'], 'security',
                   '🔑 Password reset request denied',
                   "Your password reset request {$code} was denied by the Administrator. Reason: {$note}"
               ]);
        }
    } catch (PDOException $e) {}

    sendJson(['ok' => true, 'requestCode' => $code]);
}

// ── REGISTER ──────────────────────────────────────────────
if ($method === 'POST' && $action === 'register') {
    rate_limit_enforce('register', 5, 60);
    $body     = getBody();
    $name     = trim($body['name'] ?? '');
    $username = strtolower(trim($body['username'] ?? ''));
    $email    = strtolower(trim($body['email'] ?? ''));
    $role     = strtolower(trim($body['role'] ?? ''));
    $password = $body['password'] ?? '';

    if (!$name || !$username || !$email || !$role || !$password)
        sendJson(['ok' => false, 'error' => 'All fields are required.']);
    if ($role === 'superadmin' || $role === 'admin')
        sendJson(['ok' => false, 'error' => 'Privileged accounts cannot be self-registered.']);
    if ($role === 'principal')
        sendJson(['ok' => false, 'error' => 'This role is no longer self-registerable.']);
    if (strlen($password) < 6)
        sendJson(['ok' => false, 'error' => 'Password must be at least 6 characters.']);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL))
        sendJson(['ok' => false, 'error' => 'Please enter a valid email address.']);
    if (!preg_match('/^[a-z0-9._-]{3,32}$/', $username))
        sendJson(['ok' => false, 'error' => 'Username must be 3–32 characters: lowercase letters, numbers, dot, underscore, or hyphen.']);

    $allowed = ['custodian', 'teacher'];
    if (!in_array($role, $allowed))
        sendJson(['ok' => false, 'error' => 'Invalid role selected.']);

    $db    = getDB();
    $check = $db->prepare("SELECT id FROM users WHERE email = ? OR LOWER(username) = ?");
    $check->execute([$email, $username]);
    if ($check->fetch())
        sendJson(['ok' => false, 'error' => 'An account with this username or email already exists.']);

    $db->prepare("INSERT INTO users (username, email, password, role, name) VALUES (?,?,?,?,?)")
       ->execute([$username, $email, hashPassword($password), $role, $name]);
    sendJson(['ok' => true, 'message' => "Account created for {$name}."]);
}

// ── LIST FLAGGED BORROWERS (admin/custodian panel) ─────────
// Returns one row per teacher with overdue items OR with an active override.
// Picks each teacher's MOST overdue item as the representative item.
if ($method === 'GET' && $action === 'list_flagged') {
    // Principal + ICT view; custodian operator views their borrowers.
    require_auth(['superadmin', 'admin', 'custodian']);
    $db    = getDB();
    $today = date('Y-m-d');

    // Most overdue borrowed transaction per teacher (joined by name → email)
    $stmt = $db->prepare("
        SELECT
            u.email,
            u.name,
            u.overdue_override,
            u.overdue_override_note,
            u.overdue_override_by,
            t.id           AS txn_id,
            t.asset_name,
            t.return_date,
            DATEDIFF(?, t.return_date) AS days_late
        FROM users u
        LEFT JOIN transactions t
               ON LOWER(t.borrower) = LOWER(u.name)
              AND t.status = 'Borrowed'
              AND t.return_date < ?
        WHERE u.role = 'teacher'
          AND (t.id IS NOT NULL OR u.overdue_override = 1)
        ORDER BY u.email ASC, days_late DESC
    ");
    $stmt->execute([$today, $today]);
    $rows = $stmt->fetchAll();

    // Collapse to one row per email (keeps the most overdue, since query is sorted by days_late DESC per email)
    $byEmail = [];
    foreach ($rows as $r) {
        if (isset($byEmail[$r['email']])) continue;
        $days = $r['days_late'] !== null ? (int)$r['days_late'] : 0;
        $tier = 0;
        if ($days >= 14)     $tier = 4;
        elseif ($days >= 7)  $tier = 3;
        elseif ($days >= 3)  $tier = 2;
        elseif ($days >= 1)  $tier = 1;

        $byEmail[$r['email']] = [
            'email'        => $r['email'],
            'name'         => $r['name'],
            'assetName'    => $r['asset_name'] ?? '—',
            'txnId'        => $r['txn_id']     ?? '—',
            'returnDate'   => $r['return_date'] ?? '—',
            'daysLate'     => $days,
            'tier'         => $tier,
            'overridden'   => (int)$r['overdue_override'] === 1,
            'overrideNote' => $r['overdue_override_note'] ?? '',
            'overrideBy'   => $r['overdue_override_by']   ?? '',
        ];
    }

    sendJson(['ok' => true, 'flagged' => array_values($byEmail)]);
}

// ── CHECK LOCK STATUS ──────────────────────────────────────
if ($method === 'GET' && $action === 'check_lock') {
    $email = strtolower(trim($_GET['email'] ?? ''));
    if (!$email) sendJson(['ok' => false, 'error' => 'Email required.']);
    $db   = getDB();
    $stmt = $db->prepare("SELECT locked_until, failed_logins FROM users WHERE email = ?");
    $stmt->execute([$email]);
    $row = $stmt->fetch();
    if (!$row) sendJson(['ok' => true, 'locked' => false]);
    $locked   = $row['locked_until'] && strtotime($row['locked_until']) > time();
    $minsLeft = $locked ? ceil((strtotime($row['locked_until']) - time()) / 60) : 0;
    sendJson(['ok' => true, 'locked' => $locked, 'minsLeft' => $minsLeft, 'failedLogins' => (int)$row['failed_logins']]);
}

// ── PUBLIC STATS (login page) ─────────────────────────────
// No auth required — the login page needs to display the system's
// asset/unit totals BEFORE the user signs in. Returns aggregates only,
// never any individual asset details.
if ($method === 'GET' && $action === 'public_stats') {
    try {
        $db = getDB();
        $totalTypes = (int)$db->query("SELECT COUNT(*) FROM assets")->fetchColumn();
        $totalUnits = (int)$db->query("SELECT COALESCE(SUM(quantity), 0) FROM assets")->fetchColumn();
        sendJson(['ok' => true, 'totalAssets' => $totalTypes, 'totalUnits' => $totalUnits]);
    } catch (PDOException $e) {
        sendJson(['ok' => false, 'totalAssets' => 0, 'totalUnits' => 0]);
    }
}

// ── LIST LOCKED ACCOUNTS (admin) ──────────────────────────
// Returns ONLY users who are actually locked or have failed-login
// attempts on record. Used by policy.html to render the "Locked
// Accounts" panel correctly — without this, the old query returned
// every user (including admin & custodian) and showed them as locked.
if ($method === 'GET' && $action === 'list_locked') {
    require_auth(['superadmin']);
    $db   = getDB();
    $stmt = $db->query("
        SELECT username, email, role, name, failed_logins, locked_until,
               forgot_attempts, forgot_locked_until
        FROM users
        WHERE (failed_logins IS NOT NULL AND failed_logins > 0)
           OR (locked_until IS NOT NULL AND locked_until > NOW())
           OR (forgot_attempts IS NOT NULL AND forgot_attempts > 0)
           OR (forgot_locked_until IS NOT NULL AND forgot_locked_until > NOW())
        ORDER BY locked_until DESC, failed_logins DESC, role ASC, name ASC
    ");
    $rows = $stmt->fetchAll();
    $out  = [];
    foreach ($rows as $r) {
        $isLocked  = $r['locked_until'] && strtotime($r['locked_until']) > time();
        $isFLocked = $r['forgot_locked_until'] && strtotime($r['forgot_locked_until']) > time();
        $minsLeft  = $isLocked ? (int)ceil((strtotime($r['locked_until']) - time()) / 60) : 0;
        $out[] = [
            'username'      => $r['username'],
            'email'         => $r['email'],
            'role'          => $r['role'],
            'name'          => $r['name'],
            'failedLogins'  => (int)$r['failed_logins'],
            'lockedUntil'   => $r['locked_until'],
            'isLocked'      => $isLocked,
            'minsLeft'      => $minsLeft,
            'forgotAttempts'=> (int)$r['forgot_attempts'],
            'forgotLocked'  => $isFLocked,
        ];
    }
    sendJson(['ok' => true, 'locked' => $out]);
}

sendJson(['ok' => false, 'error' => 'Invalid request.'], 400);
?>
