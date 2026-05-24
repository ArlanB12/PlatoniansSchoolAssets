<?php
// ============================================================
// Platonian's School Assets — Activity Log API (v10.16)
// ============================================================
// System-wide event trail (who did what, when). Distinct from the
// physical room-audit logs in audit_logs.php.
//
// Per spec, ONLY the Admin (School Principal) can view it.
//
//   GET ?action=list&limit=&action_filter=&q=
//       → { ok, logs:[...], total }
// ============================================================

require_once 'config.php';
require_once '_session.php';

guard_request_csrf();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

if ($method === 'GET' && $action === 'list') {
    require_auth(['superadmin', 'admin']);  // ICT Coordinator + School Principal
    $db = getDB();

    $limit  = (int)($_GET['limit'] ?? 200);
    if ($limit < 1)   $limit = 1;
    if ($limit > 500) $limit = 500;

    $filter = trim($_GET['action_filter'] ?? '');
    $q      = trim($_GET['q'] ?? '');

    $where  = [];
    $params = [];
    if ($filter !== '' && $filter !== 'all') {
        $where[] = "action = ?";
        $params[] = $filter;
    }
    if ($q !== '') {
        $where[] = "(actor_name LIKE ? OR actor_email LIKE ? OR target LIKE ? OR details LIKE ?)";
        $like = '%' . $q . '%';
        array_push($params, $like, $like, $like, $like);
    }
    $whereSql = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

    $stmt = $db->prepare("SELECT * FROM activity_log $whereSql ORDER BY created_at DESC, id DESC LIMIT $limit");
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    $logs = array_map(function ($r) {
        return [
            'id'        => $r['log_id'],
            'actorName' => $r['actor_name'],
            'actorEmail'=> $r['actor_email'],
            'actorRole' => $r['actor_role'],
            'action'    => $r['action'],
            'target'    => $r['target'],
            'details'   => $r['details'],
            'ip'        => $r['ip_address'],
            'createdAt' => $r['created_at'],
        ];
    }, $rows);

    // BUG FIX v10.19: total must reflect the active filter, not the raw table count.
    // When action_filter or q are set the old query always returned the full table
    // count, making UI pagination show the wrong number of pages.
    $countStmt = $db->prepare("SELECT COUNT(*) FROM activity_log $whereSql");
    $countStmt->execute($params);
    $total = (int)$countStmt->fetchColumn();

    sendJson(['ok' => true, 'logs' => $logs, 'total' => $total]);
}

sendJson(['ok' => false, 'error' => 'Invalid request.'], 400);
?>
