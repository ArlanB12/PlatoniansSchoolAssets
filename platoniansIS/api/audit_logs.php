<?php
require_once 'config.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

// ── GET ALL AUDIT LOGS ─────────────────────────────────────
if ($method === 'GET' && $action === 'list') {
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
if ($method === 'POST' && $action === 'save') {
    $body    = getBody();
    $db      = getDB();
    $logId   = 'ADT-' . time();
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
        trim($body['auditedBy'] ?? ''),
        trim($body['auditorRole'] ?? ''),
        (int)($summary['expectedUnits'] ?? 0),
        (int)($summary['foundUnits'] ?? 0),
        (int)($summary['missingUnits'] ?? 0),
        (int)($summary['needsRepairUnits'] ?? 0),
        (int)($summary['variance'] ?? 0),
        json_encode($body['items'] ?? []),
    ]);

    sendJson(['ok' => true, 'logId' => $logId]);
}

sendJson(['ok' => false, 'error' => 'Invalid request.'], 400);
?>
