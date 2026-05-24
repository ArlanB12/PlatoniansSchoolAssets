<?php
require_once 'config.php';
require_once '_session.php';

guard_request_csrf();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

// notifyStaff() / notifyUser() are provided by _push.php (loaded via
// config.php). They write the in-app notification AND fire a device push.

// ── GET ALL ASSETS ─────────────────────────────────────────
if ($method === 'GET' && $action === 'list') {
    require_auth();
    $db   = getDB();
    $stmt = $db->query("SELECT * FROM assets ORDER BY created_at ASC");
    $rows = $stmt->fetchAll();
    sendJson(['ok' => true, 'assets' => array_map(function($r) {
        // receipt_files is a JSON array of filenames (v10.22). Fall back
        // to the legacy single receipt_file when the array is empty so
        // older records still show their attachment.
        $files = [];
        if (!empty($r['receipt_files'])) {
            $decoded = json_decode($r['receipt_files'], true);
            if (is_array($decoded)) $files = array_values(array_filter(array_map('strval', $decoded)));
        }
        if (!$files && !empty($r['receipt_file'])) $files = [$r['receipt_file']];
        return [
            'id'             => $r['id'],
            'name'           => $r['name'],
            'description'    => $r['description'] ?? '',
            'category'       => $r['category'],
            'quantity'       => (int)$r['quantity'],
            'unit'           => $r['unit'] ?? 'piece',
            'maxCheckoutQty' => (int)($r['max_checkout_qty'] ?? 0),
            'condition'      => $r['condition'] ?? 'Good',
            'unitCost'       => (float)$r['unit_cost'],
            'location'       => $r['location'],
            'status'         => $r['status'],
            'dateAdded'      => $r['date_added'],
            'receiptFile'    => $files[0] ?? ($r['receipt_file'] ?? ''),
            'receiptFiles'   => $files,
            'isBulk'         => (bool)$r['is_bulk'],
            'bulkId'         => $r['bulk_id'],
        ];
    }, $rows)]);
}

// ── SEARCH SUGGESTIONS ─────────────────────────────────────
if ($method === 'GET' && $action === 'search_suggest') {
    require_auth();
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
    require_auth();
    $q  = trim($_GET['q'] ?? '');
    $db = getDB();
    if (strlen($q) < 1) sendJson(['ok' => true, 'suggestions' => []]);
    // BUG FIX v10.19: exclude custodian as well — they are staff, not borrowers.
    // Previously only 'superadmin','admin' were excluded; custodian accounts
    // appeared in the borrower name autocomplete on the checkout form.
    $stmt = $db->prepare("SELECT name, email, role FROM users WHERE (name LIKE ? OR email LIKE ?) AND role NOT IN ('superadmin','admin','custodian') LIMIT 8");
    $like = '%' . $q . '%';
    $stmt->execute([$like, $like]);
    $rows = $stmt->fetchAll();
    sendJson(['ok' => true, 'suggestions' => $rows]);
}

// ── ADD ASSET ──────────────────────────────────────────────
if ($method === 'POST' && $action === 'add') {
    $me      = require_auth(['superadmin','custodian']);
    $body    = getBody();
    $db      = getDB();

    $unit      = trim($body['unit'] ?? 'piece') ?: 'piece';
    $maxQty    = max(0, (int)($body['maxCheckoutQty'] ?? 0));
    $condition = trim($body['condition'] ?? 'Good') ?: 'Good';
    $name      = trim($body['name'] ?? '');
    $desc      = trim($body['description'] ?? '');
    $qty       = (int)($body['quantity'] ?? 0);
    $location  = trim($body['location'] ?? '');
    $category  = trim($body['category'] ?? '');

    // v10.22 — collect the list of attached files. New clients send
    // receiptFiles[] (array); keep backward compat with receiptFile.
    $files = [];
    if (isset($body['receiptFiles']) && is_array($body['receiptFiles'])) {
        foreach ($body['receiptFiles'] as $f) { $f = trim((string)$f); if ($f !== '') $files[] = $f; }
    }
    if (!$files && trim($body['receiptFile'] ?? '') !== '') $files[] = trim($body['receiptFile']);
    $filesJson  = json_encode(array_values($files));
    $firstFile  = $files[0] ?? '';

    // Server-side validation — UI already checks this but never trust the client.
    if ($name === '')     sendJson(['ok' => false, 'error' => 'Asset name is required.']);
    if ($category === '') sendJson(['ok' => false, 'error' => 'Category is required.']);
    if ($location === '') sendJson(['ok' => false, 'error' => 'Location is required.']);
    if ($qty < 0)         sendJson(['ok' => false, 'error' => 'Quantity cannot be negative.']);

    $counter = nextCounter('asset_counter');
    $id      = toPaddedId('AST-', $counter);

    // Collision guard (extremely rare but possible after a restore)
    $check = $db->prepare("SELECT id FROM assets WHERE id = ?");
    $check->execute([$id]);
    if ($check->fetch()) {
        $max = $db->query("SELECT MAX(CAST(SUBSTRING(id,5) AS UNSIGNED)) FROM assets")->fetchColumn();
        $id  = toPaddedId('AST-', (int)$max + 1);
    }

    $stmt = $db->prepare("
        INSERT INTO assets (id, name, description, category, quantity, unit, max_checkout_qty, `condition`, unit_cost, location, status, date_added, receipt_file, receipt_files, is_bulk, bulk_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ");
    $stmt->execute([$id, $name, $desc, $category, $qty,
        $unit, $maxQty, $condition, (float)($body['unitCost']??0), $location,
        trim($body['status']??'Available'), $body['dateAdded']??date('Y-m-d'),
        $firstFile, $filesJson, !empty($body['isBulk'])?1:0, trim($body['bulkId']??'')]);
    $db->prepare("INSERT IGNORE INTO categories (name) VALUES (?)")->execute([$category]);
    $db->prepare("INSERT IGNORE INTO locations (name) VALUES (?)")->execute([$location]);

    $limitNote = $maxQty > 0 ? " Max borrow limit: {$maxQty} {$unit}(s)." : '';
    notifyStaff($db, 'added', "New Asset Added — {$name}",
        "{$qty} {$unit}(s) of {$name} ({$id}) added to {$location}.{$limitNote}", 'inventory.html');
    logActivityAs($db, $me, 'asset_added', "{$name} ({$id})",
        "Added {$qty} {$unit}(s) to {$location}, category {$category}.");
    sendJson(['ok' => true, 'id' => $id]);
}

// ── UPDATE ASSET ───────────────────────────────────────────
if ($method === 'POST' && $action === 'update') {
    $me   = require_auth(['superadmin','custodian']);
    $body = getBody();
    $id   = trim($body['id'] ?? '');
    if (!$id) sendJson(['ok' => false, 'error' => 'Asset ID required.']);
    $db   = getDB();

    $old = $db->prepare("SELECT * FROM assets WHERE id = ?");
    $old->execute([$id]);
    $oldAsset = $old->fetch();
    if (!$oldAsset) sendJson(['ok' => false, 'error' => 'Asset not found.']);

    $unit      = trim($body['unit'] ?? 'piece') ?: 'piece';
    $maxQty    = max(0, (int)($body['maxCheckoutQty'] ?? 0));
    $condition = trim($body['condition'] ?? 'Good') ?: 'Good';
    $newQty    = (int)($body['quantity'] ?? 0);
    $name      = trim($body['name'] ?? '');
    $desc      = trim($body['description'] ?? '');
    $category  = trim($body['category'] ?? '');
    $location  = trim($body['location'] ?? '');

    // v10.22 — normalize attached files (array preferred, single legacy ok).
    $files = [];
    if (isset($body['receiptFiles']) && is_array($body['receiptFiles'])) {
        foreach ($body['receiptFiles'] as $f) { $f = trim((string)$f); if ($f !== '') $files[] = $f; }
    }
    if (!$files && trim($body['receiptFile'] ?? '') !== '') $files[] = trim($body['receiptFile']);
    $filesJson  = json_encode(array_values($files));
    $firstFile  = $files[0] ?? '';

    if ($name === '')     sendJson(['ok' => false, 'error' => 'Asset name is required.']);
    if ($category === '') sendJson(['ok' => false, 'error' => 'Category is required.']);
    if ($location === '') sendJson(['ok' => false, 'error' => 'Location is required.']);
    if ($newQty < 0)      sendJson(['ok' => false, 'error' => 'Quantity cannot be negative.']);

    $stmt = $db->prepare("
        UPDATE assets SET name=?, description=?, category=?, quantity=?, unit=?, max_checkout_qty=?, `condition`=?,
            unit_cost=?, location=?, status=?, date_added=?, receipt_file=?, receipt_files=?, is_bulk=?, bulk_id=?
        WHERE id=?
    ");
    $stmt->execute([
        $name, $desc, $category, $newQty,
        $unit, $maxQty, $condition, (float)($body['unitCost']??0),
        $location, trim($body['status']??'Available'),
        $body['dateAdded']??date('Y-m-d'), $firstFile, $filesJson,
        !empty($body['isBulk'])?1:0, trim($body['bulkId']??''), $id
    ]);
    $db->prepare("INSERT IGNORE INTO categories (name) VALUES (?)")->execute([$category]);
    $db->prepare("INSERT IGNORE INTO locations (name) VALUES (?)")->execute([$location]);

    if ($oldAsset && $newQty > (int)$oldAsset['quantity']) {
        $added = $newQty - (int)$oldAsset['quantity'];
        notifyStaff($db, 'restocked', "Stock Updated — {$name}",
            "{$name} ({$id}) restocked by {$added} {$unit}(s). New total: {$newQty} {$unit}(s).", 'inventory.html');
    }
    if ($oldAsset && (int)$oldAsset['quantity'] > 0 && $newQty <= 0) {
        notifyStaff($db, 'out_of_stock', "Out of Stock — {$name}",
            "{$name} ({$id}) has been set to 0 stock.", 'inventory.html');
    }
    // Activity log — note condition changes explicitly (custodian duty).
    $oldCond = $oldAsset['condition'] ?? 'Good';
    if ($oldCond !== $condition) {
        logActivityAs($db, $me, 'condition_updated', "{$name} ({$id})",
            "Condition changed from {$oldCond} to {$condition}.");
    } else {
        logActivityAs($db, $me, 'asset_updated', "{$name} ({$id})",
            "Updated details. Qty now {$newQty} {$unit}(s) in {$location}.");
    }
    sendJson(['ok' => true]);
}

// ── DELETE ASSET ───────────────────────────────────────────
if ($method === 'POST' && $action === 'delete') {
    $me   = require_auth(['superadmin','custodian']);
    $body = getBody();
    $id   = trim($body['id'] ?? '');
    if (!$id) sendJson(['ok' => false, 'error' => 'Asset ID required.']);
    $db = getDB();
    $check = $db->prepare("SELECT id FROM transactions WHERE asset_id=? AND status='Borrowed'");
    $check->execute([$id]);
    if ($check->fetch()) sendJson(['ok' => false, 'error' => 'Cannot delete an asset that is currently borrowed.']);
    $nameRow = $db->prepare("SELECT name FROM assets WHERE id=?");
    $nameRow->execute([$id]);
    $assetName = $nameRow->fetchColumn() ?: $id;
    $db->prepare("DELETE FROM assets WHERE id=?")->execute([$id]);
    logActivityAs($db, $me, 'asset_removed', "{$assetName} ({$id})", 'Asset deleted from inventory.');
    sendJson(['ok' => true]);
}

// ── CATEGORIES ─────────────────────────────────────────────
if ($method === 'GET' && $action === 'categories') {
    require_auth();
    $rows = getDB()->query("SELECT name FROM categories ORDER BY name ASC")->fetchAll();
    sendJson(['ok' => true, 'categories' => array_column($rows, 'name')]);
}
if ($method === 'POST' && $action === 'add_category') {
    require_auth(['superadmin','custodian']);
    $name = trim(getBody()['name'] ?? '');
    if (!$name) sendJson(['ok' => false, 'error' => 'Category name required.']);
    getDB()->prepare("INSERT IGNORE INTO categories (name) VALUES (?)")->execute([$name]);
    sendJson(['ok' => true, 'category' => $name]);
}
if ($method === 'POST' && $action === 'delete_category') {
    require_auth(['superadmin','custodian']);
    $name = trim(getBody()['name'] ?? '');
    if (!$name) sendJson(['ok' => false, 'error' => 'Category name required.']);
    $db   = getDB();
    $used = $db->prepare("SELECT COUNT(*) FROM assets WHERE category = ?");
    $used->execute([$name]);
    if ((int)$used->fetchColumn() > 0)
        sendJson(['ok' => false, 'error' => 'Cannot delete: category is still used by one or more assets.']);
    $db->prepare("DELETE FROM categories WHERE name = ?")->execute([$name]);
    sendJson(['ok' => true]);
}

// ── LOCATIONS ──────────────────────────────────────────────
if ($method === 'GET' && $action === 'locations') {
    require_auth();
    $rows = getDB()->query("SELECT name FROM locations ORDER BY name ASC")->fetchAll();
    sendJson(['ok' => true, 'locations' => array_column($rows, 'name')]);
}
if ($method === 'POST' && $action === 'add_location') {
    require_auth(['superadmin','custodian']);
    $name = trim(getBody()['name'] ?? '');
    if (!$name) sendJson(['ok' => false, 'error' => 'Location name required.']);
    getDB()->prepare("INSERT IGNORE INTO locations (name) VALUES (?)")->execute([$name]);
    sendJson(['ok' => true, 'location' => $name]);
}
if ($method === 'POST' && $action === 'delete_location') {
    $me   = require_auth(['superadmin','custodian']);
    $name = trim(getBody()['name'] ?? '');
    if (!$name) sendJson(['ok' => false, 'error' => 'Location name required.']);
    $db   = getDB();
    // Block deletion while any asset still sits in this room — deleting
    // it would orphan those records.
    $used = $db->prepare("SELECT COUNT(*) FROM assets WHERE location = ?");
    $used->execute([$name]);
    $count = (int)$used->fetchColumn();
    if ($count > 0)
        sendJson(['ok' => false, 'error' => "Cannot delete: {$count} item(s) are still stored in \"{$name}\". Move or remove them first."]);
    $db->prepare("DELETE FROM locations WHERE name = ?")->execute([$name]);
    logActivityAs($db, $me, 'location_removed', $name, 'Location / room deleted from inventory.');
    sendJson(['ok' => true]);
}

// ── NEXT BULK ID ───────────────────────────────────────────
if ($method === 'GET' && $action === 'next_bulk_id') {
    require_auth();
    $num    = nextCounter('bulk_counter');
    $bulkId = 'BLK-' . date('Y') . '-' . str_pad($num, 3, '0', STR_PAD_LEFT);
    sendJson(['ok' => true, 'bulkId' => $bulkId]);
}

// ── GET ASSET CONDITION ────────────────────────────────────
if ($method === 'GET' && $action === 'get_condition') {
    require_auth();
    $id = trim($_GET['id'] ?? '');
    if (!$id) sendJson(['ok' => false, 'error' => 'Asset ID required.']);
    $stmt = getDB()->prepare("SELECT `condition` FROM assets WHERE id=?");
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    sendJson(['ok' => true, 'condition' => $row ? ($row['condition']??'Good') : 'Good']);
}

// ── UPLOAD FILE / RECEIPT ──────────────────────────────────
if ($method === 'POST' && $action === 'upload_file') {
    require_auth(['superadmin','custodian']);
    $allowed_types = ['image/jpeg','image/png','image/gif','image/webp','application/pdf'];
    $max_size = 5 * 1024 * 1024; // 5MB
    $extByMime = [
        'image/jpeg'      => 'jpg',
        'image/png'       => 'png',
        'image/gif'       => 'gif',
        'image/webp'      => 'webp',
        'application/pdf' => 'pdf',
    ];
    $uploadDir = dirname(__DIR__) . '/uploads/';
    if (!is_dir($uploadDir)) mkdir($uploadDir, 0755, true);

    // Save one PHP file entry → returns ['ok'=>..,'filename'=>..] | error string
    $saveOne = function ($name, $type, $tmp, $err, $size) use ($allowed_types, $max_size, $extByMime, $uploadDir) {
        if ($err !== UPLOAD_ERR_OK) return ['ok' => false, 'error' => 'File upload error.'];
        if ($size > $max_size)     return ['ok' => false, 'error' => 'File too large. Max 5MB.'];
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $mime  = finfo_file($finfo, $tmp);
        finfo_close($finfo);
        if (!in_array($mime, $allowed_types, true))
            return ['ok' => false, 'error' => 'Invalid file type. Allowed: JPG, PNG, GIF, WEBP, PDF.'];
        // Derive extension from validated MIME, NEVER from the user-supplied
        // filename — users can upload a real PNG named "evil.php".
        $safeExt  = $extByMime[$mime];
        $safeName = 'file_' . bin2hex(random_bytes(8)) . '.' . $safeExt;
        if (!move_uploaded_file($tmp, $uploadDir . $safeName))
            return ['ok' => false, 'error' => 'Failed to save file.'];
        return ['ok' => true, 'filename' => $safeName];
    };

    // v10.22 — multiple files via files[] (preferred). Falls back to the
    // single `file` field used by earlier clients.
    if (!empty($_FILES['files']) && is_array($_FILES['files']['name'])) {
        $names = $_FILES['files']['name'];
        $saved = [];
        for ($i = 0; $i < count($names); $i++) {
            $r = $saveOne(
                $_FILES['files']['name'][$i],
                $_FILES['files']['type'][$i],
                $_FILES['files']['tmp_name'][$i],
                $_FILES['files']['error'][$i],
                $_FILES['files']['size'][$i]
            );
            if (!$r['ok']) sendJson(['ok' => false, 'error' => $r['error']]);
            $saved[] = $r['filename'];
        }
        if (!$saved) sendJson(['ok' => false, 'error' => 'No files uploaded.']);
        sendJson(['ok' => true, 'filenames' => $saved, 'filename' => $saved[0], 'url' => 'uploads/' . $saved[0]]);
    }

    if (empty($_FILES['file'])) sendJson(['ok' => false, 'error' => 'No file uploaded.']);
    $f = $_FILES['file'];
    $r = $saveOne($f['name'], $f['type'], $f['tmp_name'], $f['error'], $f['size']);
    if (!$r['ok']) sendJson(['ok' => false, 'error' => $r['error']]);
    sendJson(['ok' => true, 'filename' => $r['filename'], 'filenames' => [$r['filename']], 'url' => 'uploads/' . $r['filename']]);
}

sendJson(['ok' => false, 'error' => 'Invalid request.'], 400);
?>
