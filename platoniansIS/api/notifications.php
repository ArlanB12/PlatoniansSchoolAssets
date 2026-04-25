<?php
require_once 'config.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

// ── LIST NOTIFICATIONS FOR A USER ──────────────────────────
if ($method === 'GET' && $action === 'list') {
    $email = strtolower(trim($_GET['email'] ?? ''));
    if (!$email) sendJson(['ok' => false, 'error' => 'Email required.']);
    $db   = getDB();
    $stmt = $db->prepare("SELECT * FROM notifications WHERE user_email = ? ORDER BY created_at DESC LIMIT 50");
    $stmt->execute([$email]);
    $rows = $stmt->fetchAll();
    $notifs = array_map(function($r) {
        return [
            'notifId'   => $r['notif_id'],
            'type'      => $r['type'],
            'title'     => $r['title'],
            'message'   => $r['message'],
            'link'      => $r['link'],
            'isRead'    => (bool)$r['is_read'],
            'createdAt' => $r['created_at'],
        ];
    }, $rows);
    $unread = count(array_filter($notifs, fn($n) => !$n['isRead']));
    sendJson(['ok' => true, 'notifications' => $notifs, 'unread' => $unread]);
}

// ── MARK AS READ ───────────────────────────────────────────
if ($method === 'POST' && $action === 'mark_read') {
    $body    = getBody();
    $email   = strtolower(trim($body['email'] ?? ''));
    $notifId = trim($body['notifId'] ?? '');
    $db      = getDB();
    if ($notifId === 'all') {
        $db->prepare("UPDATE notifications SET is_read=1 WHERE user_email=?")->execute([$email]);
    } else {
        $db->prepare("UPDATE notifications SET is_read=1 WHERE notif_id=? AND user_email=?")->execute([$notifId, $email]);
    }
    sendJson(['ok' => true]);
}

// ── SEND NOTIFICATION (internal helper, called by other PHP) ─
// Also exposed as endpoint for JS to trigger notifications
if ($method === 'POST' && $action === 'send') {
    $body = getBody();
    $db   = getDB();
    $num  = nextCounter('notif_counter') - 1;
    $notifId = 'NTF-' . str_pad($num, 5, '0', STR_PAD_LEFT);
    $stmt = $db->prepare("
        INSERT INTO notifications (notif_id, user_email, type, title, message, link)
        VALUES (?, ?, ?, ?, ?, ?)
    ");
    $stmt->execute([
        $notifId,
        strtolower(trim($body['userEmail'] ?? '')),
        trim($body['type'] ?? 'info'),
        trim($body['title'] ?? ''),
        trim($body['message'] ?? ''),
        trim($body['link'] ?? ''),
    ]);
    sendJson(['ok' => true, 'notifId' => $notifId]);
}

// ── SEND TO MULTIPLE USERS (bulk) ──────────────────────────
if ($method === 'POST' && $action === 'send_bulk') {
    $body   = getBody();
    $emails = $body['emails'] ?? [];
    if (!is_array($emails) || empty($emails)) sendJson(['ok' => false, 'error' => 'Emails array required.']);
    $db   = getDB();
    $stmt = $db->prepare("
        INSERT INTO notifications (notif_id, user_email, type, title, message, link)
        VALUES (?, ?, ?, ?, ?, ?)
    ");
    foreach ($emails as $email) {
        $num     = nextCounter('notif_counter') - 1;
        $notifId = 'NTF-' . str_pad($num, 5, '0', STR_PAD_LEFT);
        $stmt->execute([
            $notifId,
            strtolower(trim($email)),
            trim($body['type'] ?? 'info'),
            trim($body['title'] ?? ''),
            trim($body['message'] ?? ''),
            trim($body['link'] ?? ''),
        ]);
    }
    sendJson(['ok' => true]);
}

sendJson(['ok' => false, 'error' => 'Invalid request.'], 400);
?>
