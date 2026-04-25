<?php
require_once 'config.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

// ── LIST USERS ─────────────────────────────────────────────
if ($method === 'GET' && $action === 'list') {
    $db   = getDB();
    $stmt = $db->query("SELECT email, role, name FROM users ORDER BY role, name ASC");
    $rows = $stmt->fetchAll();
    sendJson(['ok' => true, 'users' => $rows]);
}

// ── CREATE USER ────────────────────────────────────────────
if ($method === 'POST' && $action === 'create') {
    $body     = getBody();
    $name     = trim($body['name'] ?? '');
    $email    = strtolower(trim($body['email'] ?? ''));
    $role     = strtolower(trim($body['role'] ?? ''));
    $password = trim($body['password'] ?? '');
    if (!$name || !$email || !$role || !$password) sendJson(['ok' => false, 'error' => 'All fields are required.']);
    $allowed_roles = ['admin', 'custodian', 'teacher'];
    if (!in_array($role, $allowed_roles)) sendJson(['ok' => false, 'error' => 'Invalid role.']);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) sendJson(['ok' => false, 'error' => 'Invalid email address.']);
    if (strlen($password) < 6) sendJson(['ok' => false, 'error' => 'Password must be at least 6 characters.']);
    $db    = getDB();
    $check = $db->prepare("SELECT id FROM users WHERE email = ?");
    $check->execute([$email]);
    if ($check->fetch()) sendJson(['ok' => false, 'error' => 'A user with this email already exists.']);
    // original_password stored only on first creation
    $stmt = $db->prepare("INSERT INTO users (email, password, original_password, role, name) VALUES (?, ?, ?, ?, ?)");
    $stmt->execute([$email, $password, $password, $role, $name]);
    sendJson(['ok' => true]);
}

// ── UPDATE USER ────────────────────────────────────────────
if ($method === 'POST' && $action === 'update') {
    $body     = getBody();
    $oldEmail = strtolower(trim($body['oldEmail'] ?? ''));
    $email    = strtolower(trim($body['email'] ?? ''));
    $name     = trim($body['name'] ?? '');
    $role     = strtolower(trim($body['role'] ?? ''));
    $password = trim($body['password'] ?? '');
    if (!$oldEmail || !$email || !$name || !$role) sendJson(['ok' => false, 'error' => 'Required fields missing.']);
    $allowed_roles = ['admin', 'custodian', 'teacher'];
    if (!in_array($role, $allowed_roles)) sendJson(['ok' => false, 'error' => 'Invalid role.']);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) sendJson(['ok' => false, 'error' => 'Invalid email address.']);
    $db = getDB();
    if ($email !== $oldEmail) {
        $check = $db->prepare("SELECT id FROM users WHERE email = ? AND email != ?");
        $check->execute([$email, $oldEmail]);
        if ($check->fetch()) sendJson(['ok' => false, 'error' => 'Email already in use by another account.']);
    }
    // Protect last admin from role downgrade
    $currRole = $db->prepare("SELECT role FROM users WHERE email = ?");
    $currRole->execute([$oldEmail]);
    $currRoleRow = $currRole->fetch();
    if ($currRoleRow && $currRoleRow['role'] === 'admin' && $role !== 'admin') {
        $adminCount = $db->query("SELECT COUNT(*) FROM users WHERE role='admin'")->fetchColumn();
        if ($adminCount <= 1) sendJson(['ok' => false, 'error' => 'Cannot change role of the last admin account.']);
    }
    if ($password) {
        // Update password but do NOT change original_password
        $db->prepare("UPDATE users SET email=?, name=?, role=?, password=? WHERE email=?")
           ->execute([$email, $name, $role, $password, $oldEmail]);
    } else {
        $db->prepare("UPDATE users SET email=?, name=?, role=? WHERE email=?")
           ->execute([$email, $name, $role, $oldEmail]);
    }
    sendJson(['ok' => true]);
}

// ── DELETE USER ────────────────────────────────────────────
if ($method === 'POST' && $action === 'delete') {
    $body  = getBody();
    $email = strtolower(trim($body['email'] ?? ''));
    if (!$email) sendJson(['ok' => false, 'error' => 'Email required.']);
    $db = getDB();
    // Check last admin
    $stmt = $db->prepare("SELECT role FROM users WHERE email = ?");
    $stmt->execute([$email]);
    $user = $stmt->fetch();
    if ($user && $user['role'] === 'admin') {
        $count = $db->query("SELECT COUNT(*) FROM users WHERE role='admin'")->fetchColumn();
        if ($count <= 1) sendJson(['ok' => false, 'error' => 'Cannot delete the last admin account.']);
    }
    $db->prepare("DELETE FROM users WHERE email=?")->execute([$email]);
    sendJson(['ok' => true]);
}

sendJson(['ok' => false, 'error' => 'Invalid request.'], 400);
?>
