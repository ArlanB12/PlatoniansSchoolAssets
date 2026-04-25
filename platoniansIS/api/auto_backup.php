<?php
// ============================================================
// Platonian's IS — Auto Backup
// Called by the frontend every 24h (or on demand).
// Saves JSON backup files to: /backups/ folder.
// Keeps last 7 daily backups automatically.
// ============================================================
require_once 'config.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

define('BACKUP_DIR', __DIR__ . '/../backups/');

function ensureBackupDir() {
    if (!is_dir(BACKUP_DIR)) {
        mkdir(BACKUP_DIR, 0755, true);
        // Prevent direct web access to backup files
        file_put_contents(BACKUP_DIR . '.htaccess', "Order Allow,Deny\nDeny from all\n");
    }
}

function buildBackupData($db) {
    $assets = $db->query("SELECT * FROM assets ORDER BY id")->fetchAll();
    $transactions = $db->query("SELECT * FROM transactions ORDER BY created_at")->fetchAll();
    $users = $db->query("SELECT email, password, original_password, role, name FROM users ORDER BY id")->fetchAll();
    $requests = $db->query("SELECT * FROM borrow_requests ORDER BY requested_at")->fetchAll();
    $auditLogs = $db->query("SELECT * FROM audit_logs ORDER BY created_at")->fetchAll();
    $categories = $db->query("SELECT name FROM categories ORDER BY name")->fetchAll(PDO::FETCH_COLUMN);
    $locations  = $db->query("SELECT name FROM locations ORDER BY name")->fetchAll(PDO::FETCH_COLUMN);

    // Normalize to JS-friendly camelCase
    $normalizeAsset = fn($r) => [
        'id' => $r['id'], 'name' => $r['name'], 'category' => $r['category'],
        'quantity' => (int)$r['quantity'], 'unit' => $r['unit'] ?? 'piece',
        'maxCheckoutQty' => (int)($r['max_checkout_qty'] ?? 0),
        'condition' => $r['condition'] ?? 'Good',
        'unitCost' => (float)$r['unit_cost'], 'location' => $r['location'],
        'status' => $r['status'], 'dateAdded' => $r['date_added'],
        'receiptFile' => $r['receipt_file'], 'isBulk' => (bool)$r['is_bulk'],
        'bulkId' => $r['bulk_id'],
    ];
    $normalizeTxn = fn($r) => [
        'id' => $r['id'], 'assetId' => $r['asset_id'], 'assetName' => $r['asset_name'],
        'assetUnit' => $r['asset_unit'] ?? 'piece', 'quantity' => (int)$r['quantity'],
        'borrower' => $r['borrower'], 'role' => $r['role'],
        'borrowDate' => $r['borrow_date'], 'returnDate' => $r['return_date'],
        'condition' => $r['condition_out'], 'status' => $r['status'],
        'actualReturnDate' => $r['actual_return_date'] ?? '',
        'returnedCondition' => $r['returned_condition'],
    ];

    return [
        'assets'         => array_map($normalizeAsset, $assets),
        'transactions'   => array_map($normalizeTxn, $transactions),
        'users'          => $users,
        'borrowRequests' => $requests,
        'auditLogs'      => $auditLogs,
        'categories'     => $categories,
        'locations'      => $locations,
    ];
}

// ── TRIGGER AUTO BACKUP ────────────────────────────────────
if ($method === 'POST' && $action === 'run') {
    ensureBackupDir();
    $db = getDB();
    $data = buildBackupData($db);
    $backup = [
        'backupDate'  => date('Y-m-d'),
        'backupTime'  => date('H:i:s'),
        'backedUpBy'  => 'auto',
        'systemName'  => "Platonian's IS",
        'version'     => '5.0',
        'data'        => $data,
    ];
    $json     = json_encode($backup, JSON_PRETTY_PRINT);
    $filename = 'backup_' . date('Y-m-d') . '.json';
    $filepath = BACKUP_DIR . $filename;
    file_put_contents($filepath, $json);

    // Keep only last 7 backups
    $files = glob(BACKUP_DIR . 'backup_*.json');
    if ($files && count($files) > 7) {
        sort($files);
        $toDelete = array_slice($files, 0, count($files) - 7);
        foreach ($toDelete as $f) unlink($f);
    }

    sendJson(['ok' => true, 'file' => $filename, 'size' => strlen($json)]);
}

// ── LIST SAVED BACKUPS ─────────────────────────────────────
if ($method === 'GET' && $action === 'list') {
    ensureBackupDir();
    $files = glob(BACKUP_DIR . 'backup_*.json') ?: [];
    rsort($files);
    $list = array_map(fn($f) => [
        'filename' => basename($f),
        'size'     => filesize($f),
        'date'     => date('Y-m-d H:i:s', filemtime($f)),
    ], $files);
    sendJson(['ok' => true, 'backups' => $list]);
}

// ── DOWNLOAD A SAVED BACKUP ────────────────────────────────
if ($method === 'GET' && $action === 'download') {
    $filename = basename($_GET['file'] ?? '');
    if (!$filename || !preg_match('/^backup_\d{4}-\d{2}-\d{2}\.json$/', $filename))
        sendJson(['ok' => false, 'error' => 'Invalid filename.']);
    $filepath = BACKUP_DIR . $filename;
    if (!file_exists($filepath))
        sendJson(['ok' => false, 'error' => 'Backup file not found.']);
    header('Content-Type: application/json');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    header('Content-Length: ' . filesize($filepath));
    readfile($filepath);
    exit;
}

sendJson(['ok' => false, 'error' => 'Invalid request.'], 400);
?>
