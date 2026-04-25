<?php
require_once 'config.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

function notifyStaff($db, $type, $title, $message, $link = '') {
    $staff = $db->query("SELECT email FROM users WHERE role IN ('admin','custodian')")->fetchAll();
    foreach ($staff as $s) {
        $num     = nextCounter('notif_counter') - 1;
        $notifId = 'NTF-' . str_pad($num, 5, '0', STR_PAD_LEFT);
        $db->prepare("INSERT INTO notifications (notif_id, user_email, type, title, message, link) VALUES (?,?,?,?,?,?)")
           ->execute([$notifId, $s['email'], $type, $title, $message, $link]);
    }
}

// ── GET ALL ASSETS ─────────────────────────────────────────
if ($method === 'GET' && $action === 'list') {
    $db   = getDB();
    $stmt = $db->query("SELECT * FROM assets ORDER BY created_at ASC");
    $rows = $stmt->fetchAll();
    sendJson(['ok' => true, 'assets' => array_map(function($r) {
        return [
            'id'             => $r['id'],
            'name'           => $r['name'],
            'category'       => $r['category'],
            'quantity'       => (int)$r['quantity'],
            'unit'           => $r['unit'] ?? 'piece',
            'maxCheckoutQty' => (int)($r['max_checkout_qty'] ?? 0),
            'condition'      => $r['condition'] ?? 'Good',
            'unitCost'       => (float)$r['unit_cost'],
            'location'       => $r['location'],
            'status'         => $r['status'],
            'dateAdded'      => $r['date_added'],
            'receiptFile'    => $r['receipt_file'],
            'isBulk'         => (bool)$r['is_bulk'],
            'bulkId'         => $r['bulk_id'],
        ];
    }, $rows)]);
}

// ── SEARCH SUGGESTIONS ─────────────────────────────────────
if ($method === 'GET' && $action === 'search_suggest') {
    $q  = trim($_GET['q'] ?? '');
    $db = getDB();
    if (strlen($q) < 1) sendJson(['ok' => true, 'suggestions' => []]);
    $stmt = $db->prepare("SELECT id, name, category, quantity, unit FROM assets WHERE name LIKE ? OR id LIKE ? OR category LIKE ? LIMIT 8");
    $like = '%' . $q . '%';
    $stmt->execute([$like, $like, $like]);
    $rows = $stmt->fetchAll();
    sendJson(['ok' => true, 'suggestions' => array_map(fn($r) => [
        'id'       => $r['id'],
        'name'     => $r['name'],
        'category' => $r['category'],
        'qty'      => (int)$r['quantity'],
        'unit'     => $r['unit'],
    ], $rows)]);
}

// ── USER NAME SUGGESTIONS ──────────────────────────────────
if ($method === 'GET' && $action === 'user_suggest') {
    $q  = trim($_GET['q'] ?? '');
    $db = getDB();
    if (strlen($q) < 1) sendJson(['ok' => true, 'suggestions' => []]);
    $stmt = $db->prepare("SELECT name, email, role FROM users WHERE (name LIKE ? OR email LIKE ?) AND role != 'admin' LIMIT 8");
    $like = '%' . $q . '%';
    $stmt->execute([$like, $like]);
    $rows = $stmt->fetchAll();
    sendJson(['ok' => true, 'suggestions' => $rows]);
}

// ── ADD ASSET ──────────────────────────────────────────────
if ($method === 'POST' && $action === 'add') {
    $body = getBody();
    $db   = getDB();
    $counter = nextCounter('asset_counter') - 1;
    $id = toPaddedId('AST-', $counter);
    $check = $db->prepare("SELECT id FROM assets WHERE id = ?");
    $check->execute([$id]);
    if ($check->fetch()) {
        $max = $db->query("SELECT MAX(CAST(SUBSTRING(id,5) AS UNSIGNED)) FROM assets")->fetchColumn();
        $id  = toPaddedId('AST-', (int)$max + 1);
    }
    $unit      = trim($body['unit'] ?? 'piece') ?: 'piece';
    $maxQty    = max(0, (int)($body['maxCheckoutQty'] ?? 0));
    $condition = trim($body['condition'] ?? 'Good') ?: 'Good';
    $name      = trim($body['name'] ?? '');
    $qty       = (int)($body['quantity'] ?? 0);
    $location  = trim($body['location'] ?? '');

    $stmt = $db->prepare("
        INSERT INTO assets (id, name, category, quantity, unit, max_checkout_qty, `condition`, unit_cost, location, status, date_added, receipt_file, is_bulk, bulk_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ");
    $stmt->execute([$id, $name, trim($body['category']??''), $qty,
        $unit, $maxQty, $condition, (float)($body['unitCost']??0), $location,
        trim($body['status']??'Available'), $body['dateAdded']??date('Y-m-d'),
        trim($body['receiptFile']??''), !empty($body['isBulk'])?1:0, trim($body['bulkId']??'')]);
    $db->prepare("INSERT IGNORE INTO categories (name) VALUES (?)")->execute([trim($body['category']??'')]);
    $db->prepare("INSERT IGNORE INTO locations (name) VALUES (?)")->execute([$location]);

    $limitNote = $maxQty > 0 ? " Max borrow limit: {$maxQty} {$unit}(s)." : '';
    notifyStaff($db, 'added',
        "New Asset Added — {$name}",
        "{$qty} {$unit}(s) of {$name} ({$id}) added to {$location}.{$limitNote}",
        'inventory.html'
    );
    sendJson(['ok' => true, 'id' => $id]);
}

// ── UPDATE ASSET ───────────────────────────────────────────
if ($method === 'POST' && $action === 'update') {
    $body = getBody();
    $id   = trim($body['id'] ?? '');
    if (!$id) sendJson(['ok' => false, 'error' => 'Asset ID required.']);
    $db   = getDB();

    $old = $db->prepare("SELECT * FROM assets WHERE id = ?");
    $old->execute([$id]);
    $oldAsset = $old->fetch();

    $unit      = trim($body['unit'] ?? 'piece') ?: 'piece';
    $maxQty    = max(0, (int)($body['maxCheckoutQty'] ?? 0));
    $condition = trim($body['condition'] ?? 'Good') ?: 'Good';
    $newQty    = (int)($body['quantity'] ?? 0);
    $name      = trim($body['name'] ?? '');

    $stmt = $db->prepare("
        UPDATE assets SET name=?, category=?, quantity=?, unit=?, max_checkout_qty=?, `condition`=?,
            unit_cost=?, location=?, status=?, date_added=?, receipt_file=?, is_bulk=?, bulk_id=?
        WHERE id=?
    ");
    $stmt->execute([
        $name, trim($body['category']??''), $newQty,
        $unit, $maxQty, $condition, (float)($body['unitCost']??0),
        trim($body['location']??''), trim($body['status']??'Available'),
        $body['dateAdded']??date('Y-m-d'), trim($body['receiptFile']??''),
        !empty($body['isBulk'])?1:0, trim($body['bulkId']??''), $id
    ]);
    $db->prepare("INSERT IGNORE INTO categories (name) VALUES (?)")->execute([trim($body['category']??'')]);
    $db->prepare("INSERT IGNORE INTO locations (name) VALUES (?)")->execute([trim($body['location']??'')]);

    if ($oldAsset && $newQty > (int)$oldAsset['quantity']) {
        $added = $newQty - (int)$oldAsset['quantity'];
        notifyStaff($db, 'restocked', "Stock Updated — {$name}",
            "{$name} ({$id}) restocked by {$added} {$unit}(s). New total: {$newQty} {$unit}(s).", 'inventory.html');
    }
    if ($oldAsset && (int)$oldAsset['quantity'] > 0 && $newQty <= 0) {
        notifyStaff($db, 'out_of_stock', "Out of Stock — {$name}",
            "{$name} ({$id}) has been set to 0 stock.", 'inventory.html');
    }
    sendJson(['ok' => true]);
}

// ── DELETE ASSET ───────────────────────────────────────────
if ($method === 'POST' && $action === 'delete') {
    $body = getBody();
    $id   = trim($body['id'] ?? '');
    if (!$id) sendJson(['ok' => false, 'error' => 'Asset ID required.']);
    $db = getDB();
    $check = $db->prepare("SELECT id FROM transactions WHERE asset_id=? AND status='Borrowed'");
    $check->execute([$id]);
    if ($check->fetch()) sendJson(['ok' => false, 'error' => 'Cannot delete an asset that is currently borrowed.']);
    $db->prepare("DELETE FROM assets WHERE id=?")->execute([$id]);
    sendJson(['ok' => true]);
}

// ── CATEGORIES ─────────────────────────────────────────────
if ($method === 'GET' && $action === 'categories') {
    $rows = getDB()->query("SELECT name FROM categories ORDER BY name ASC")->fetchAll();
    sendJson(['ok' => true, 'categories' => array_column($rows, 'name')]);
}
if ($method === 'POST' && $action === 'add_category') {
    $name = trim(getBody()['name'] ?? '');
    if (!$name) sendJson(['ok' => false, 'error' => 'Category name required.']);
    getDB()->prepare("INSERT IGNORE INTO categories (name) VALUES (?)")->execute([$name]);
    sendJson(['ok' => true, 'category' => $name]);
}
// ── DELETE CATEGORY ────────────────────────────────────────
if ($method === 'POST' && $action === 'delete_category') {
    $name = trim(getBody()['name'] ?? '');
    if (!$name) sendJson(['ok' => false, 'error' => 'Category name required.']);
    $db = getDB();
    // Check if any assets still use this category
    $used = $db->prepare("SELECT COUNT(*) FROM assets WHERE category = ?");
    $used->execute([$name]);
    if ((int)$used->fetchColumn() > 0)
        sendJson(['ok' => false, 'error' => 'Cannot delete: category is still used by one or more assets.']);
    $db->prepare("DELETE FROM categories WHERE name = ?")->execute([$name]);
    sendJson(['ok' => true]);
}

// ── LOCATIONS ──────────────────────────────────────────────
if ($method === 'GET' && $action === 'locations') {
    $rows = getDB()->query("SELECT name FROM locations ORDER BY name ASC")->fetchAll();
    sendJson(['ok' => true, 'locations' => array_column($rows, 'name')]);
}
if ($method === 'POST' && $action === 'add_location') {
    $name = trim(getBody()['name'] ?? '');
    if (!$name) sendJson(['ok' => false, 'error' => 'Location name required.']);
    getDB()->prepare("INSERT IGNORE INTO locations (name) VALUES (?)")->execute([$name]);
    sendJson(['ok' => true, 'location' => $name]);
}

// ── NEXT BULK ID ───────────────────────────────────────────
if ($method === 'GET' && $action === 'next_bulk_id') {
    $num    = nextCounter('bulk_counter') - 1;
    $bulkId = 'BLK-' . date('Y') . '-' . str_pad($num, 3, '0', STR_PAD_LEFT);
    sendJson(['ok' => true, 'bulkId' => $bulkId]);
}

// ── GET ASSET CONDITION ────────────────────────────────────
if ($method === 'GET' && $action === 'get_condition') {
    $id = trim($_GET['id'] ?? '');
    if (!$id) sendJson(['ok' => false, 'error' => 'Asset ID required.']);
    $stmt = getDB()->prepare("SELECT `condition` FROM assets WHERE id=?");
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    sendJson(['ok' => true, 'condition' => $row ? ($row['condition']??'Good') : 'Good']);
}

// ── UPLOAD FILE / RECEIPT ──────────────────────────────────
if ($method === 'POST' && $action === 'upload_file') {
    $allowed_types = ['image/jpeg','image/png','image/gif','image/webp','application/pdf'];
    $max_size = 5 * 1024 * 1024; // 5MB

    if (empty($_FILES['file'])) sendJson(['ok' => false, 'error' => 'No file uploaded.']);
    $file = $_FILES['file'];
    if ($file['error'] !== UPLOAD_ERR_OK) sendJson(['ok' => false, 'error' => 'File upload error.']);
    if ($file['size'] > $max_size) sendJson(['ok' => false, 'error' => 'File too large. Max 5MB.']);

    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    $mime  = finfo_file($finfo, $file['tmp_name']);
    finfo_close($finfo);
    if (!in_array($mime, $allowed_types)) sendJson(['ok' => false, 'error' => 'Invalid file type. Allowed: JPG, PNG, GIF, WEBP, PDF.']);

    // Derive extension from verified MIME type — not from filename (prevents spoofing)
    $mime_to_ext = [
        'image/jpeg'      => 'jpg',
        'image/png'       => 'png',
        'image/gif'       => 'gif',
        'image/webp'      => 'webp',
        'application/pdf' => 'pdf',
    ];
    $ext      = $mime_to_ext[$mime] ?? 'bin';
    $safeName = 'file_' . uniqid() . '.' . $ext;
    $uploadDir = dirname(__DIR__) . '/uploads/';
    if (!is_dir($uploadDir)) mkdir($uploadDir, 0755, true);

    if (!move_uploaded_file($file['tmp_name'], $uploadDir . $safeName))
        sendJson(['ok' => false, 'error' => 'Failed to save file.']);

    sendJson(['ok' => true, 'filename' => $safeName, 'url' => 'uploads/' . $safeName]);
}

sendJson(['ok' => false, 'error' => 'Invalid request.'], 400);
?>
