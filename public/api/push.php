<?php
// ============================================================
// Platonian's School Assets — Push Subscription API (v10.16)
// ============================================================
// Endpoints (all same-origin, session-bound):
//   GET  ?action=public_key   → { ok, publicKey }   (no CSRF; read-only)
//   POST ?action=subscribe    → store this device's subscription
//   POST ?action=unsubscribe  → remove a subscription by endpoint
//   POST ?action=test         → send a test push to the current user
// ============================================================

require_once 'config.php';
require_once '_session.php';

guard_request_csrf();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

// ── PUBLIC VAPID KEY ───────────────────────────────────────
// The browser needs this to create a PushSubscription. It is the
// PUBLIC half only; safe to expose. Requires a logged-in session.
if ($method === 'GET' && $action === 'public_key') {
    require_auth();
    $keys = vapid_keys();
    if (!$keys) {
        sendJson(['ok' => false, 'error' => 'Push is unavailable on this server (OpenSSL EC support missing).']);
    }
    sendJson(['ok' => true, 'publicKey' => $keys['public']]);
}

// ── SUBSCRIBE (save this device) ───────────────────────────
if ($method === 'POST' && $action === 'subscribe') {
    $me   = require_auth();
    $body = getBody();
    $sub  = $body['subscription'] ?? null;

    $endpoint = trim($sub['endpoint'] ?? '');
    $p256dh   = trim($sub['keys']['p256dh'] ?? '');
    $auth     = trim($sub['keys']['auth'] ?? '');
    if (!$endpoint || !$p256dh || !$auth) {
        sendJson(['ok' => false, 'error' => 'Incomplete subscription payload.']);
    }

    $db = getDB();
    $ua = substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 255);

    // Upsert on endpoint so re-subscribing the same browser doesn't
    // create duplicates and re-binds it to the current user.
    $db->prepare("
        INSERT INTO push_subscriptions (user_email, endpoint, p256dh, auth, user_agent)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            user_email = VALUES(user_email),
            p256dh     = VALUES(p256dh),
            auth       = VALUES(auth),
            user_agent = VALUES(user_agent)
    ")->execute([$me['email'], $endpoint, $p256dh, $auth, $ua]);

    sendJson(['ok' => true]);
}

// ── UNSUBSCRIBE ────────────────────────────────────────────
if ($method === 'POST' && $action === 'unsubscribe') {
    $me   = require_auth();
    $body = getBody();
    $endpoint = trim($body['endpoint'] ?? '');
    if (!$endpoint) sendJson(['ok' => false, 'error' => 'Endpoint required.']);
    $db = getDB();
    $db->prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_email = ?")
       ->execute([$endpoint, $me['email']]);
    sendJson(['ok' => true]);
}

// ── TEST PUSH (sends to the current user's devices) ────────
if ($method === 'POST' && $action === 'test') {
    $me = require_auth();
    $db = getDB();
    notifyUser($db, $me['email'], 'info',
        '🔔 Push notifications enabled',
        'This is a test notification from Platonian\'s IS. You\'re all set.',
        'dashboard.html');
    sendJson(['ok' => true]);
}

sendJson(['ok' => false, 'error' => 'Invalid request.'], 400);
?>
