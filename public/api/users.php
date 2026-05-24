<?php
require_once 'config.php';
require_once '_session.php';

guard_request_csrf();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

// ── LIST USERS ─────────────────────────────────────────────
if ($method === 'GET' && $action === 'list') {
    // ICT superadmin manages users; Principal (admin) may view for oversight.
    require_auth(['superadmin', 'admin']);
    $db   = getDB();
    // Never expose password or reset_token to the frontend.
    // v10.4: include is_super_account so the admin UI can show
    // / toggle the super-recovery flag from the Users page.
    $stmt = $db->query("SELECT username, email, role, name, is_super_account FROM users ORDER BY role, name ASC");
    $rows = $stmt->fetchAll();
    // Normalise the flag to a real boolean for cleaner JS.
    foreach ($rows as &$r) { $r['is_super_account'] = ((int)($r['is_super_account'] ?? 0) === 1); }
    sendJson(['ok' => true, 'users' => $rows]);
}

// ── CREATE USER ────────────────────────────────────────────
if ($method === 'POST' && $action === 'create') {
    $me       = require_auth(['superadmin']);
    $body     = getBody();
    $name     = trim($body['name'] ?? '');
    $username = strtolower(trim($body['username'] ?? ''));
    $email    = strtolower(trim($body['email'] ?? ''));
    $role     = strtolower(trim($body['role'] ?? ''));
    $password = $body['password'] ?? '';

    if (!$name || !$email || !$role || !$password)
        sendJson(['ok' => false, 'error' => 'All fields are required.']);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL))
        sendJson(['ok' => false, 'error' => 'Please enter a valid email address.']);
    if (strlen($password) < 6)
        sendJson(['ok' => false, 'error' => 'Password must be at least 6 characters.']);
    // Whitelist role — v10.16 four-role model.
    if (!in_array($role, ['superadmin', 'admin', 'custodian', 'teacher'], true))
        sendJson(['ok' => false, 'error' => 'Invalid role.']);

    // If admin didn't supply a username, derive one from the email local-part.
    if ($username === '') $username = explode('@', $email)[0];
    // v10.8: frontend (users.js) allows uppercase + symbols (no spaces, no @).
    // The original /^[a-z0-9._-]+$/ regex rejected those silently after passing
    // the client-side check. Mirror the frontend rule here so what looks valid
    // in the UI is valid at the API.
    if (strlen($username) < 3 || strlen($username) > 32)
        sendJson(['ok' => false, 'error' => 'Username must be 3-32 characters.']);
    if (preg_match('/[\s@]/', $username))
        sendJson(['ok' => false, 'error' => 'Username cannot contain spaces or @ symbols.']);

    $db    = getDB();
    $check = $db->prepare("SELECT id FROM users WHERE email = ? OR LOWER(username) = ?");
    $check->execute([$email, $username]);
    if ($check->fetch()) sendJson(['ok' => false, 'error' => 'A user with this username or email already exists.']);

    $hash = password_hash($password, PASSWORD_BCRYPT);
    $stmt = $db->prepare("INSERT INTO users (username, email, password, role, name) VALUES (?, ?, ?, ?, ?)");
    $stmt->execute([$username, $email, $hash, $role, $name]);
    logActivityAs($db, $me, 'user_created', "{$name} ({$email})", "Created a new {$role} account.");
    sendJson(['ok' => true]);
}

// ── UPDATE USER ────────────────────────────────────────────
if ($method === 'POST' && $action === 'update') {
    $me       = require_auth(['superadmin']);
    $body     = getBody();
    $oldEmail = strtolower(trim($body['oldEmail'] ?? ''));
    $email    = strtolower(trim($body['email'] ?? ''));
    $username = strtolower(trim($body['username'] ?? ''));
    $name     = trim($body['name'] ?? '');
    $role     = strtolower(trim($body['role'] ?? ''));
    $password = $body['password'] ?? '';

    if (!$oldEmail || !$email || !$name || !$role)
        sendJson(['ok' => false, 'error' => 'Required fields missing.']);
    // v10.16 four-role model.
    if (!in_array($role, ['superadmin', 'admin', 'custodian', 'teacher'], true))
        sendJson(['ok' => false, 'error' => 'Invalid role.']);

    // Block the current superadmin from demoting themselves out of
    // superadmin mid-session — they'd lose technical access with no way back.
    if ($oldEmail === $me['email'] && $role !== 'superadmin') {
        sendJson(['ok' => false, 'error' => 'You cannot change your own role. Ask another ICT administrator to do it.']);
    }

    $db = getDB();

    // Derive a username if blank (preserves the rule: username defaults to
    // the email local-part).
    if ($username === '') $username = explode('@', $email)[0];
    // v10.8: mirror the relaxed frontend rule.
    if (strlen($username) < 3 || strlen($username) > 32)
        sendJson(['ok' => false, 'error' => 'Username must be 3-32 characters.']);
    if (preg_match('/[\s@]/', $username))
        sendJson(['ok' => false, 'error' => 'Username cannot contain spaces or @ symbols.']);

    if ($email !== $oldEmail) {
        $check = $db->prepare("SELECT id FROM users WHERE email = ? AND email != ?");
        $check->execute([$email, $oldEmail]);
        if ($check->fetch()) sendJson(['ok' => false, 'error' => 'Email already in use by another account.']);
    }
    // Username uniqueness check across other rows
    $check = $db->prepare("SELECT id FROM users WHERE LOWER(username) = ? AND email != ?");
    $check->execute([$username, $oldEmail]);
    if ($check->fetch()) sendJson(['ok' => false, 'error' => 'Username already in use by another account.']);

    // Never allow the last remaining superadmin to be demoted — that
    // would leave the system with no one able to reset passwords or
    // maintain it. (Self-demotion is already blocked above.)
    if ($role !== 'superadmin') {
        $tgt = $db->prepare("SELECT role FROM users WHERE email = ?");
        $tgt->execute([$oldEmail]);
        $wasRole = $tgt->fetchColumn();
        if ($wasRole === 'superadmin') {
            $saCount = (int)$db->query("SELECT COUNT(*) FROM users WHERE role='superadmin'")->fetchColumn();
            if ($saCount <= 1)
                sendJson(['ok' => false, 'error' => 'Cannot demote the last ICT (Super Admin) account.']);
        }
    }

    if ($password) {
        if (strlen($password) < 6)
            sendJson(['ok' => false, 'error' => 'Password must be at least 6 characters.']);
        $hash = password_hash($password, PASSWORD_BCRYPT);
        $db->prepare("UPDATE users SET username=?, email=?, name=?, role=?, password=? WHERE email=?")
           ->execute([$username, $email, $name, $role, $hash, $oldEmail]);
    } else {
        $db->prepare("UPDATE users SET username=?, email=?, name=?, role=? WHERE email=?")
           ->execute([$username, $email, $name, $role, $oldEmail]);
    }
    logActivityAs($db, $me, 'user_updated', "{$name} ({$email})",
        'Updated account details' . ($password ? ' and reset password.' : '.'));
    sendJson(['ok' => true]);
}

// ── DELETE USER ────────────────────────────────────────────
if ($method === 'POST' && $action === 'delete') {
    $me    = require_auth(['superadmin']);
    $body  = getBody();
    $email = strtolower(trim($body['email'] ?? ''));
    if (!$email) sendJson(['ok' => false, 'error' => 'Email required.']);
    // A superadmin deleting their own session mid-request lands the UI in
    // a broken state, so block it and let another ICT admin do it.
    if ($email === $me['email'])
        sendJson(['ok' => false, 'error' => 'You cannot delete your own account.']);
    $db = getDB();
    $stmt = $db->prepare("SELECT role, name FROM users WHERE email = ?");
    $stmt->execute([$email]);
    $user = $stmt->fetch();
    if ($user && $user['role'] === 'superadmin') {
        $count = $db->query("SELECT COUNT(*) FROM users WHERE role='superadmin'")->fetchColumn();
        if ($count <= 1) sendJson(['ok' => false, 'error' => 'Cannot delete the last ICT (Super Admin) account.']);
    }
    $db->prepare("DELETE FROM users WHERE email=?")->execute([$email]);
    logActivityAs($db, $me, 'user_deleted', ($user['name'] ?? $email) . " ({$email})", 'Account permanently deleted.');
    sendJson(['ok' => true]);
}

sendJson(['ok' => false, 'error' => 'Invalid request.'], 400);
?>
