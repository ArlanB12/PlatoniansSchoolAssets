<?php
require_once 'config.php';
require_once '_session.php';

guard_request_csrf();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

// ── GET ALL POLICY SETTINGS ────────────────────────────────
if ($method === 'GET' && $action === 'get') {
    require_auth();
    $db   = getDB();
    $rows = $db->query("SELECT policy_key, policy_value, label FROM lending_policy ORDER BY id ASC")->fetchAll();
    $policy = [];
    foreach ($rows as $r) $policy[$r['policy_key']] = ['value' => $r['policy_value'], 'label' => $r['label']];
    sendJson(['ok' => true, 'policy' => $policy]);
}

// ── UPDATE POLICY SETTINGS ─────────────────────────────────
if ($method === 'POST' && $action === 'update') {
    $me   = require_auth(['superadmin','admin','custodian']);
    $body = getBody();
    $db   = getDB();
    // v10.16: 'max_borrow_days' removed — teachers choose their own
    // return date, so a system-wide maximum is no longer enforced.
    $allowed = ['early_reminder_days', 'max_checkout_qty', 'late_fee_note', 'policy_note'];
    foreach ($allowed as $key) {
        if (isset($body[$key])) {
            $db->prepare("UPDATE lending_policy SET policy_value=? WHERE policy_key=?")
               ->execute([trim($body[$key]), $key]);
        }
    }
    logActivityAs($db, $me, 'policy_updated', 'Lending Policy', 'Updated lending policy settings.');
    sendJson(['ok' => true]);
}

sendJson(['ok' => false, 'error' => 'Invalid request.'], 400);
?>
