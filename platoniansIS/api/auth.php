<?php
require_once 'config.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

const MAX_FAILED_LOGINS   = 5;
const LOCKOUT_MINUTES     = 15;
const MAX_FORGOT_ATTEMPTS = 5;
const FORGOT_LOCK_MINUTES = 30;

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
    $body  = getBody();
    $email = strtolower(trim($body['email'] ?? ''));
    $pass  = trim($body['password'] ?? '');
    $role  = strtolower(trim($body['role'] ?? ''));

    if (!$email || !$pass || !$role)
        sendJson(['ok' => false, 'error' => 'Please complete all fields.']);

    $db   = getDB();
    $stmt = $db->prepare("SELECT * FROM users WHERE email = ?");
    $stmt->execute([$email]);
    $user = $stmt->fetch();

    if (!$user)
        sendJson(['ok' => false, 'error' => 'No account found with that email address.']);

    // Check lockout
    if ($user['locked_until'] && strtotime($user['locked_until']) > time()) {
        $mins = ceil((strtotime($user['locked_until']) - time()) / 60);
        sendJson(['ok' => false, 'error' => "🔒 Account temporarily locked due to too many failed login attempts. Try again in {$mins} minute(s).", 'locked' => true]);
    }

    // Wrong password
    if ($user['password'] !== $pass) {
        $fails = (int)$user['failed_logins'] + 1;
        if ($fails >= MAX_FAILED_LOGINS) {
            $lockUntil = date('Y-m-d H:i:s', time() + LOCKOUT_MINUTES * 60);
            $db->prepare("UPDATE users SET failed_logins = ?, locked_until = ? WHERE email = ?")
               ->execute([$fails, $lockUntil, $email]);
            // Notify admin about lockout
            try {
                $admins = $db->query("SELECT email FROM users WHERE role = 'admin'")->fetchAll();
                foreach ($admins as $a) {
                    $num = nextCounter('notif_counter') - 1;
                    $nid = 'NTF-' . str_pad($num, 5, '0', STR_PAD_LEFT);
                    $db->prepare("INSERT INTO notifications (notif_id,user_email,type,title,message,link) VALUES (?,?,?,?,?,'')")
                       ->execute([$nid, $a['email'], 'security', "🔒 Account Locked — {$user['name']}", "Account {$email} has been temporarily locked after {$fails} failed login attempts."]);
                }
            } catch (PDOException $e) {}
            sendJson(['ok' => false, 'error' => "🔒 Account locked for " . LOCKOUT_MINUTES . " minutes after " . MAX_FAILED_LOGINS . " failed attempts. Contact the Administrator if needed.", 'locked' => true]);
        } else {
            $db->prepare("UPDATE users SET failed_logins = ? WHERE email = ?")->execute([$fails, $email]);
            $remaining = MAX_FAILED_LOGINS - $fails;
            sendJson(['ok' => false, 'error' => "Incorrect password. {$remaining} attempt(s) remaining before lockout."]);
        }
    }

    // Correct password — reset fail counter and lockout
    $db->prepare("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE email = ?")->execute([$email]);

    // Role mismatch check — use stored role, not what user typed
    if ($user['role'] !== $role)
        sendJson(['ok' => false, 'error' => 'Selected role does not match this account. Your role is: ' . ucfirst($user['role']) . '.']);

    // Accountability check (teachers)
    if ($role === 'teacher') {
        $info = getOverdueTier($db, $email);
        if ($info['tier'] >= 3) {
            sendJson(['ok' => false, 'error' => tierMessage($info), 'tier' => $info['tier'], 'blocked' => true]);
        }
        if ($info['tier'] > 0) {
            sendJson(['ok' => true,
                'user'        => ['email' => $user['email'], 'role' => $user['role'], 'name' => $user['name']],
                'tier'        => $info['tier'],
                'warning'     => tierMessage($info),
                'overdueInfo' => $info,
            ]);
        }
    }

    sendJson(['ok' => true, 'user' => [
        'email' => $user['email'],
        'role'  => $user['role'],
        'name'  => $user['name'],
    ]]);
}

// ── GET OVERDUE TIER ───────────────────────────────────────
if ($method === 'GET' && $action === 'get_tier') {
    $email = strtolower(trim($_GET['email'] ?? ''));
    if (!$email) sendJson(['ok' => false, 'error' => 'Email required.']);
    $db   = getDB();
    $info = getOverdueTier($db, $email);
    sendJson(['ok' => true, 'tier' => $info['tier'], 'info' => $info, 'message' => tierMessage($info)]);
}

// ── OVERRIDE TIER ──────────────────────────────────────────
if ($method === 'POST' && $action === 'override_tier') {
    $body     = getBody();
    $email    = strtolower(trim($body['email'] ?? ''));
    $note     = trim($body['note'] ?? '');
    $override = !empty($body['override']) ? 1 : 0;
    $byEmail  = strtolower(trim($body['byEmail'] ?? ''));
    if (!$email) sendJson(['ok' => false, 'error' => 'Email required.']);
    $db = getDB();
    $db->prepare("UPDATE users SET overdue_override=?, overdue_override_note=?, overdue_override_by=? WHERE email=?")
       ->execute([$override, $note, $byEmail, $email]);
    sendJson(['ok' => true]);
}

// ── UNLOCK ACCOUNT (admin) ─────────────────────────────────
if ($method === 'POST' && $action === 'unlock_account') {
    $body  = getBody();
    $email = strtolower(trim($body['email'] ?? ''));
    if (!$email) sendJson(['ok' => false, 'error' => 'Email required.']);
    $db = getDB();
    $db->prepare("UPDATE users SET failed_logins=0, locked_until=NULL, forgot_attempts=0, forgot_locked_until=NULL WHERE email=?")
       ->execute([$email]);
    sendJson(['ok' => true]);
}

// ── FORGOT — STEP 1: Verify identity ──────────────────────
if ($method === 'POST' && $action === 'forgot_verify') {
    $body     = getBody();
    $email    = strtolower(trim($body['email'] ?? ''));
    $fullName = trim($body['fullName'] ?? '');

    if (!$email || !$fullName)
        sendJson(['ok' => false, 'error' => 'Please provide both your email and full name.']);

    $db   = getDB();
    $stmt = $db->prepare("SELECT * FROM users WHERE email = ?");
    $stmt->execute([$email]);
    $user = $stmt->fetch();

    if (!$user)
        sendJson(['ok' => false, 'error' => 'No account found with that email address.']);

    // Check forgot lockout
    if ($user['forgot_locked_until'] && strtotime($user['forgot_locked_until']) > time()) {
        $mins = ceil((strtotime($user['forgot_locked_until']) - time()) / 60);
        sendJson(['ok' => false, 'error' => "🔒 Too many failed attempts. Password reset is locked for {$mins} more minute(s). Contact the Administrator."]);
    }

    if (strtolower(trim($user['name'])) !== strtolower($fullName)) {
        $fails = (int)$user['forgot_attempts'] + 1;
        if ($fails >= MAX_FORGOT_ATTEMPTS) {
            $lockUntil = date('Y-m-d H:i:s', time() + FORGOT_LOCK_MINUTES * 60);
            $db->prepare("UPDATE users SET forgot_attempts=?, forgot_locked_until=? WHERE email=?")->execute([$fails, $lockUntil, $email]);
            sendJson(['ok' => false, 'error' => "🔒 Too many failed verification attempts. Password reset locked for " . FORGOT_LOCK_MINUTES . " minutes."]);
        }
        $db->prepare("UPDATE users SET forgot_attempts=? WHERE email=?")->execute([$fails, $email]);
        $remaining = MAX_FORGOT_ATTEMPTS - $fails;
        sendJson(['ok' => false, 'error' => "Name does not match our records. {$remaining} attempt(s) remaining."]);
    }

    // Reset fail counter
    $db->prepare("UPDATE users SET forgot_attempts=0, forgot_locked_until=NULL WHERE email=?")->execute([$email]);

    $token = bin2hex(random_bytes(16));
    $db->prepare("UPDATE users SET reset_token = ?, reset_token_expiry = NOW() + INTERVAL 10 MINUTE WHERE email = ?")
       ->execute([$token, $email]);
    sendJson(['ok' => true, 'token' => $token, 'email' => $email]);
}

// ── FORGOT — STEP 2: Reset password ──────────────────────
if ($method === 'POST' && $action === 'forgot_reset') {
    $body  = getBody();
    $email = strtolower(trim($body['email'] ?? ''));
    $token = trim($body['token'] ?? '');
    if (!$email || !$token) sendJson(['ok' => false, 'error' => 'Invalid request.']);
    $db   = getDB();
    $stmt = $db->prepare("SELECT * FROM users WHERE email = ? AND reset_token = ? AND reset_token_expiry > NOW()");
    $stmt->execute([$email, $token]);
    $user = $stmt->fetch();
    if (!$user) sendJson(['ok' => false, 'error' => 'Reset link has expired or is invalid. Please start over.']);
    $tempPw = ucfirst(substr(str_replace(['+', '/', '='], '', base64_encode(random_bytes(6))), 0, 5)) . rand(10, 99);
    $db->prepare("UPDATE users SET password=?, reset_token=NULL, reset_token_expiry=NULL WHERE email=?")
       ->execute([$tempPw, $email]);
    sendJson(['ok' => true, 'tempPassword' => $tempPw, 'role' => $user['role'], 'email' => $user['email']]);
}

// ── REGISTER ──────────────────────────────────────────────
if ($method === 'POST' && $action === 'register') {
    $body     = getBody();
    $name     = trim($body['name'] ?? '');
    $email    = strtolower(trim($body['email'] ?? ''));
    $role     = strtolower(trim($body['role'] ?? ''));
    $password = trim($body['password'] ?? '');

    if (!$name || !$email || !$role || !$password)
        sendJson(['ok' => false, 'error' => 'All fields are required.']);
    if ($role === 'admin')
        sendJson(['ok' => false, 'error' => 'Admin accounts cannot be self-registered.']);
    if (strlen($password) < 6)
        sendJson(['ok' => false, 'error' => 'Password must be at least 6 characters.']);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL))
        sendJson(['ok' => false, 'error' => 'Please enter a valid email address.']);

    $db    = getDB();
    $check = $db->prepare("SELECT id FROM users WHERE email = ?");
    $check->execute([$email]);
    if ($check->fetch())
        sendJson(['ok' => false, 'error' => 'An account with this email already exists.']);

    // FIX: explicitly bind role to prevent injection / wrong role
    $allowed = ['custodian', 'teacher'];
    if (!in_array($role, $allowed))
        sendJson(['ok' => false, 'error' => 'Invalid role selected.']);

    $db->prepare("INSERT INTO users (email, password, original_password, role, name) VALUES (?,?,?,?,?)")
       ->execute([$email, $password, $password, $role, $name]);
    sendJson(['ok' => true, 'message' => "Account created for {$name}."]);
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
    $locked = $row['locked_until'] && strtotime($row['locked_until']) > time();
    $minsLeft = $locked ? ceil((strtotime($row['locked_until']) - time()) / 60) : 0;
    sendJson(['ok' => true, 'locked' => $locked, 'minsLeft' => $minsLeft, 'failedLogins' => (int)$row['failed_logins']]);
}

// ── GET FLAGGED BORROWERS (overdue + tier info) ──────────
if ($method === 'GET' && $action === 'get_flagged') {
    $db    = getDB();
    $today = date('Y-m-d');

    // Find all teachers with at least 1 overdue borrowed item
    $stmt = $db->query("
        SELECT u.email, u.name, u.overdue_override, u.overdue_override_note, u.overdue_override_by,
               t.id AS txn_id, t.asset_name, t.return_date,
               DATEDIFF(CURDATE(), t.return_date) AS days_late
        FROM transactions t
        JOIN users u ON LOWER(u.name) = LOWER(t.borrower) AND u.role = 'teacher'
        WHERE t.status = 'Borrowed' AND t.return_date < ?
        ORDER BY days_late DESC
    ");
    $stmt->execute([$today]);
    $rows = $stmt->fetchAll();

    $seen = [];
    $result = [];
    foreach ($rows as $r) {
        if (isset($seen[$r['email']])) continue; // one row per user (worst item)
        $seen[$r['email']] = true;
        $days = (int)$r['days_late'];
        $tier = 0;
        if ($days >= 14)    $tier = 4;
        elseif ($days >= 7) $tier = 3;
        elseif ($days >= 3) $tier = 2;
        elseif ($days >= 1) $tier = 1;
        $result[] = [
            'email'        => $r['email'],
            'name'         => $r['name'],
            'assetName'    => $r['asset_name'],
            'txnId'        => $r['txn_id'],
            'returnDate'   => $r['return_date'],
            'daysLate'     => $days,
            'tier'         => $tier,
            'overridden'   => (bool)$r['overdue_override'],
            'overrideNote' => $r['overdue_override_note'] ?? '',
            'overrideBy'   => $r['overdue_override_by'] ?? '',
        ];
    }
    sendJson(['ok' => true, 'flagged' => $result]);
}

// ── UNLOCK ACCOUNT ─────────────────────────────────────────
if ($method === 'POST' && $action === 'unlock_account') {
    $body  = getBody();
    $email = strtolower(trim($body['email'] ?? ''));
    if (!$email) sendJson(['ok' => false, 'error' => 'Email required.']);
    $db = getDB();
    $db->prepare("UPDATE users SET failed_logins=0, locked_until=NULL WHERE email=?")->execute([$email]);
    sendJson(['ok' => true]);
}

sendJson(['ok' => false, 'error' => 'Invalid request.'], 400);
?>
