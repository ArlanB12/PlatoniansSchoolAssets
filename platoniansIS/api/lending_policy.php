<?php
require_once 'config.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

// ── GET ALL POLICY SETTINGS ────────────────────────────────
if ($method === 'GET' && $action === 'get') {
    $db   = getDB();
    $rows = $db->query("SELECT policy_key, policy_value, label FROM lending_policy ORDER BY id ASC")->fetchAll();
    $policy = [];
    foreach ($rows as $r) $policy[$r['policy_key']] = ['value' => $r['policy_value'], 'label' => $r['label']];
    sendJson(['ok' => true, 'policy' => $policy]);
}

// ── UPDATE POLICY SETTINGS ─────────────────────────────────
if ($method === 'POST' && $action === 'update') {
    $body = getBody();
    $db   = getDB();
    $allowed = ['max_borrow_days', 'early_reminder_days', 'max_checkout_qty', 'late_fee_note', 'policy_note'];
    foreach ($allowed as $key) {
        if (isset($body[$key])) {
            $db->prepare("UPDATE lending_policy SET policy_value=? WHERE policy_key=?")
               ->execute([trim($body[$key]), $key]);
        }
    }
    sendJson(['ok' => true]);
}

sendJson(['ok' => false, 'error' => 'Invalid request.'], 400);
?>
