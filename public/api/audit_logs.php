<?php
require_once 'config.php';
require_once '_session.php';

guard_request_csrf();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

// ── GET ALL AUDIT LOGS ─────────────────────────────────────
if ($method === 'GET' && $action === 'list') {
    // Viewable by ICT, Principal, and the Custodian who files them.
    require_auth(['superadmin','admin','custodian']);
    $db   = getDB();
    $rows = $db->query("SELECT * FROM audit_logs ORDER BY created_at DESC")->fetchAll();
    $logs = array_map(function($r) {
        return [
            'id'               => $r['log_id'],
            'location'         => $r['location'],
            'auditedOn'        => $r['audited_on'],
            'auditedBy'        => $r['audited_by'],
            'auditorRole'      => $r['auditor_role'],
            'summary'          => [
                'expectedUnits'    => (int)$r['expected_units'],
                'foundUnits'       => (int)$r['found_units'],
                'missingUnits'     => (int)$r['missing_units'],
                'needsRepairUnits' => (int)$r['needs_repair_units'],
                'variance'         => (int)$r['variance'],
            ],
            'items'            => json_decode($r['items_json'] ?? '[]', true),
        ];
    }, $rows);
    sendJson(['ok' => true, 'auditLogs' => $logs]);
}

// ── SAVE AUDIT LOG ─────────────────────────────────────────
// Pre-fix, log_id was 'ADT-' + time() — two audits saved within the same
// second collide on the UNIQUE constraint and the second one fails.
// Also: auditedBy/auditorRole came from the request body, meaning a custodian
// could file an audit log under the admin's name. Both come from the session now.
if ($method === 'POST' && $action === 'save') {
    $me      = require_auth(['superadmin','custodian']);
    $body    = getBody();
    $db      = getDB();
    $logId   = 'ADT-' . str_pad(nextCounter('audit_counter'), 6, '0', STR_PAD_LEFT);
    $summary = $body['summary'] ?? [];

    $stmt = $db->prepare("
        INSERT INTO audit_logs
            (log_id, location, audited_on, audited_by, auditor_role,
             expected_units, found_units, missing_units, needs_repair_units, variance, items_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ");
    $stmt->execute([
        $logId,
        trim($body['location'] ?? ''),
        $body['auditedOn'] ?? date('Y-m-d'),
        $me['name'],
        $me['role'],
        (int)($summary['expectedUnits'] ?? 0),
        (int)($summary['foundUnits'] ?? 0),
        (int)($summary['missingUnits'] ?? 0),
        (int)($summary['needsRepairUnits'] ?? 0),
        (int)($summary['variance'] ?? 0),
        json_encode($body['items'] ?? []),
    ]);

    // ── v10.23: PUSH AUDIT FINDINGS BACK INTO THE LIVE ASSET RECORDS ──
    // The dashboard "Needs Repair" stat + Condition Overview chart are derived
    // from each asset's status / condition. Previously a room audit only wrote
    // a log row, so flagging an item "Needs Repair" during an audit never
    // surfaced in analytics. Now, when an item's audited status changes, we
    // update the asset so the finding is reflected everywhere.
    $items = is_array($body['items'] ?? null) ? $body['items'] : [];
    $upRepair  = $db->prepare("UPDATE assets SET status = 'Needs Repair', `condition` = 'Needs Repair' WHERE id = ?");
    $upMissing = $db->prepare("UPDATE assets SET status = 'Missing' WHERE id = ?");
    // If a previously-flagged item is now fully found and in good order, clear
    // it back to Available so the audit can self-heal stale flags. We only
    // touch items that were flagged before (Needs Repair / Missing / Under
    // Repair) to avoid stomping on a status set elsewhere, e.g. Borrowed.
    $upClear   = $db->prepare("
        UPDATE assets
           SET status = 'Available', `condition` = 'Good'
         WHERE id = ?
           AND status IN ('Needs Repair','Missing','Under Repair')
    ");
    $repairCount = 0; $missingCount = 0; $clearedCount = 0;
    foreach ($items as $it) {
        $aid     = trim($it['assetId'] ?? '');
        $newSt   = trim($it['updatedStatus'] ?? '');
        $repair  = (int)($it['repairQuantity'] ?? 0);
        $found   = (int)($it['foundQuantity'] ?? 0);
        $expected= (int)($it['expectedQuantity'] ?? 0);
        if ($aid === '') continue;
        if ($repair > 0 || strcasecmp($newSt, 'Needs Repair') === 0) {
            $upRepair->execute([$aid]);
            $repairCount++;
        } elseif (strcasecmp($newSt, 'Missing') === 0) {
            $upMissing->execute([$aid]);
            $missingCount++;
        } elseif ($repair === 0 && $found >= $expected) {
            // Fully present, none for repair → clear any stale problem flag.
            $upClear->execute([$aid]);
            if ($upClear->rowCount() > 0) $clearedCount++;
        }
    }

    $extra = '';
    if ($repairCount > 0)  $extra .= " {$repairCount} item(s) flagged Needs Repair.";
    if ($missingCount > 0) $extra .= " {$missingCount} item(s) flagged Missing.";
    if ($clearedCount > 0) $extra .= " {$clearedCount} item(s) restored to Available.";

    logActivityAs($db, $me, 'room_audit', trim($body['location'] ?? ''),
        'Filed a room audit. Variance: ' . (int)($summary['variance'] ?? 0) . ' unit(s).' . $extra);

    sendJson(['ok' => true, 'logId' => $logId]);
}

// (activity log entry written above on save)

sendJson(['ok' => false, 'error' => 'Invalid request.'], 400);
?>
