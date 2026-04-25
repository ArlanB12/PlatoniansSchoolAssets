<?php
require_once 'config.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

function sendNotification($db, $userEmail, $type, $title, $message, $link = '') {
    $num     = nextCounter('notif_counter') - 1;
    $notifId = 'NTF-' . str_pad($num, 5, '0', STR_PAD_LEFT);
    $stmt = $db->prepare("INSERT INTO notifications (notif_id, user_email, type, title, message, link) VALUES (?,?,?,?,?,?)");
    $stmt->execute([$notifId, strtolower(trim($userEmail)), $type, $title, $message, $link]);
}

// ── LIST BORROW REQUESTS ───────────────────────────────────
if ($method === 'GET' && $action === 'list') {
    $db   = getDB();
    $stmt = $db->query("SELECT * FROM borrow_requests ORDER BY requested_at DESC");
    $rows = $stmt->fetchAll();
    sendJson(['ok' => true, 'requests' => array_map(function($r) {
        return [
            'requestId'       => $r['request_id'],
            'assetId'         => $r['asset_id'],
            'assetName'       => $r['asset_name'],
            'assetUnit'       => $r['asset_unit'] ?? 'piece',
            'borrower'        => $r['borrower'],
            'borrowerEmail'   => $r['borrower_email'] ?? '',
            'role'            => $r['role'],
            'quantity'        => (int)$r['quantity'],
            'borrowDate'      => $r['borrow_date'],
            'returnDate'      => $r['return_date'],
            'condition'       => $r['condition_out'],
            'status'          => $r['status'],
            'rejectionReason' => $r['rejection_reason'] ?? '',
            'transactionId'   => $r['transaction_id'] ?? '',
            'requestedAt'     => $r['requested_at'],
        ];
    }, $rows)]);
}

// ── CREATE BORROW REQUEST ──────────────────────────────────
if ($method === 'POST' && $action === 'create') {
    $body = getBody();
    $db   = getDB();
    $assetId       = trim($body['assetId'] ?? '');
    $quantity      = (int)($body['quantity'] ?? 1);
    $borrowerEmail = strtolower(trim($body['borrowerEmail'] ?? ''));

    // ── Accountability check: block Tier 2+ from requesting ─
    if ($borrowerEmail) {
        $u = $db->prepare("SELECT overdue_override FROM users WHERE email = ?");
        $u->execute([$borrowerEmail]);
        $uRow = $u->fetch();
        $overridden = $uRow && (int)$uRow['overdue_override'] === 1;
        if (!$overridden) {
            $today = date('Y-m-d');
            $ov = $db->prepare("SELECT DATEDIFF(?,return_date) AS d, asset_name FROM transactions t
                JOIN users u ON LOWER(u.name)=LOWER(t.borrower)
                WHERE u.email=? AND t.status='Borrowed' AND t.return_date<? ORDER BY d DESC LIMIT 1");
            $ov->execute([$today, $borrowerEmail, $today]);
            $ovRow = $ov->fetch();
            if ($ovRow && (int)$ovRow['d'] >= 3) {
                $item = $ovRow['asset_name'];
                $days = (int)$ovRow['d'];
                sendJson(['ok' => false,
                    'error' => "🚫 Your borrowing privilege is suspended. You have not returned \"{$item}\" ({$days} day(s) overdue). Please return it first.",
                    'tier'  => $days >= 7 ? 3 : 2,
                ]);
            }
        }
    }

    $stmt = $db->prepare("SELECT * FROM assets WHERE id = ?");
    $stmt->execute([$assetId]);
    $asset = $stmt->fetch();
    if (!$asset) sendJson(['ok' => false, 'error' => 'Asset not found.']);
    if ((int)$asset['quantity'] <= 0) sendJson(['ok' => false, 'error' => 'This item is currently out of stock.']);
    if ($quantity <= 0) sendJson(['ok' => false, 'error' => 'Quantity must be at least 1.']);
    if ($quantity > (int)$asset['quantity']) {
        $unit = $asset['unit'] ?? 'unit(s)';
        sendJson(['ok' => false, 'error' => "Only {$asset['quantity']} {$unit}(s) available."]);
    }
    $maxQty = (int)($asset['max_checkout_qty'] ?? 0);
    if ($maxQty > 0 && $quantity > $maxQty) {
        $unit = $asset['unit'] ?? 'unit(s)';
        sendJson(['ok' => false, 'error' => "Request limit is {$maxQty} {$unit}(s) per request."]);
    }

    $num           = nextCounter('request_counter') - 1;
    $requestId     = toPaddedId('REQ-', $num);
    $borrower      = trim($body['borrower'] ?? '');
    $borrowerEmail = strtolower(trim($body['borrowerEmail'] ?? ''));
    $unit          = $asset['unit'] ?? 'piece';
    $conditionOut  = $asset['condition'] ?? 'Good';

    // Safe migration: add borrower_email column if not yet present
    try {
        $db->exec("ALTER TABLE borrow_requests ADD COLUMN borrower_email VARCHAR(255) NOT NULL DEFAULT ''");
    } catch (PDOException $e) { /* already exists — ignore */ }

    $stmt = $db->prepare("
        INSERT INTO borrow_requests
            (request_id, asset_id, asset_name, asset_unit, borrower, borrower_email, role, quantity, borrow_date, return_date, condition_out, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending')
    ");
    $stmt->execute([
        $requestId, $assetId, $asset['name'], $unit,
        $borrower, $borrowerEmail, trim($body['role'] ?? 'teacher'),
        $quantity,
        $body['borrowDate'] ?? date('Y-m-d'),
        $body['returnDate'] ?? date('Y-m-d'),
        $conditionOut,
    ]);

    // Notify all admins and custodians
    $staff = $db->query("SELECT email FROM users WHERE role IN ('admin','custodian')")->fetchAll();
    foreach ($staff as $s) {
        sendNotification($db, $s['email'], 'request',
            "New Borrow Request — {$requestId}",
            "{$borrower} requested {$quantity} {$unit}(s) of {$asset['name']}.",
            'transactions.html'
        );
    }

    sendJson(['ok' => true, 'requestId' => $requestId]);
}

// ── APPROVE BORROW REQUEST ─────────────────────────────────
if ($method === 'POST' && $action === 'approve') {
    $body      = getBody();
    $requestId = trim($body['requestId'] ?? '');
    $db        = getDB();

    $stmt = $db->prepare("SELECT * FROM borrow_requests WHERE request_id = ? AND status = 'Pending'");
    $stmt->execute([$requestId]);
    $req = $stmt->fetch();
    if (!$req) sendJson(['ok' => false, 'error' => 'Pending request not found.']);

    $stmt = $db->prepare("SELECT * FROM assets WHERE id = ?");
    $stmt->execute([$req['asset_id']]);
    $asset = $stmt->fetch();
    if (!$asset) sendJson(['ok' => false, 'error' => 'Asset not found.']);

    $qty = (int)$req['quantity'];
    if ($qty > (int)$asset['quantity']) sendJson(['ok' => false, 'error' => 'Insufficient stock to approve.']);

    $num   = nextCounter('transaction_counter') - 1;
    $txnId = toPaddedId('TRX-', $num);
    $conditionOut = $asset['condition'] ?? 'Good';

    $borrowerEmail = $req['borrower_email'] ?? '';
    $stmt = $db->prepare("
        INSERT INTO transactions
            (id, asset_id, asset_name, asset_unit, quantity, borrower, borrower_email, role, borrow_date, return_date, condition_out, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Borrowed')
    ");
    $stmt->execute([
        $txnId, $req['asset_id'], $req['asset_name'], $req['asset_unit'] ?? 'piece',
        $qty, $req['borrower'], $borrowerEmail, $req['role'],
        $req['borrow_date'], $req['return_date'], $conditionOut,
    ]);

    $newQty    = (int)$asset['quantity'] - $qty;
    $newStatus = $newQty <= 0 ? 'Out of Stock' : $asset['status'];
    $db->prepare("UPDATE assets SET quantity=?, status=? WHERE id=?")->execute([$newQty, $newStatus, $req['asset_id']]);
    $db->prepare("UPDATE borrow_requests SET status='Approved', transaction_id=? WHERE request_id=?")->execute([$txnId, $requestId]);

    // ── Low stock / out of stock check after approval ───────
    $unit = $req['asset_unit'] ?? 'piece';
    if ($newQty <= 0) {
        $staffRows = $db->query("SELECT email FROM users WHERE role IN ('admin','custodian')")->fetchAll();
        foreach ($staffRows as $s) {
            sendNotification($db, $s['email'], 'out_of_stock',
                "Out of Stock — {$req['asset_name']}",
                "{$req['asset_name']} ({$req['asset_id']}) is now completely out of stock after approving {$req['request_id']}.",
                'inventory.html'
            );
        }
    } elseif ($newQty <= 5) {
        $staffRows = $db->query("SELECT email FROM users WHERE role IN ('admin','custodian')")->fetchAll();
        foreach ($staffRows as $s) {
            sendNotification($db, $s['email'], 'low_stock',
                "Low Stock Alert — {$req['asset_name']}",
                "Only {$newQty} {$unit}(s) of {$req['asset_name']} remaining after approving {$req['request_id']}.",
                'inventory.html'
            );
        }
    }

    // ── Low stock / out of stock check ──────────────────────
    $LOW_STOCK = 5;
    $unit = $req['asset_unit'] ?? 'piece';
    if ($newQty <= 0) {
        $staff = $db->query("SELECT email FROM users WHERE role IN ('admin','custodian')")->fetchAll();
        foreach ($staff as $s) {
            $num = nextCounter('notif_counter') - 1;
            $nid = 'NTF-' . str_pad($num, 5, '0', STR_PAD_LEFT);
            $db->prepare("INSERT INTO notifications (notif_id, user_email, type, title, message, link) VALUES (?,?,?,?,?,?)")
               ->execute([$nid, $s['email'], 'out_of_stock',
                   "⚠️ Out of Stock — {$req['asset_name']}",
                   "{$req['asset_name']} ({$req['asset_id']}) is now completely out of stock.",
                   'inventory.html']);
        }
    } elseif ($newQty <= $LOW_STOCK && (int)$asset['quantity'] > $LOW_STOCK) {
        $staff = $db->query("SELECT email FROM users WHERE role IN ('admin','custodian')")->fetchAll();
        foreach ($staff as $s) {
            $num = nextCounter('notif_counter') - 1;
            $nid = 'NTF-' . str_pad($num, 5, '0', STR_PAD_LEFT);
            $db->prepare("INSERT INTO notifications (notif_id, user_email, type, title, message, link) VALUES (?,?,?,?,?,?)")
               ->execute([$nid, $s['email'], 'low_stock',
                   "📦 Low Stock — {$req['asset_name']}",
                   "Only {$newQty} {$unit}(s) of {$req['asset_name']} ({$req['asset_id']}) remaining.",
                   'inventory.html']);
        }
    }

    // Notify borrower — use stored email first, fall back to name lookup for old records
    $borrowerEmail = $req['borrower_email'] ?? '';
    if (!$borrowerEmail) {
        $bu = $db->prepare("SELECT email FROM users WHERE name=? AND role='teacher' LIMIT 1");
        $bu->execute([$req['borrower']]);
        $buRow = $bu->fetch();
        $borrowerEmail = $buRow['email'] ?? '';
    }
    if ($borrowerEmail) {
        $unit = $req['asset_unit'] ?? 'piece';
        sendNotification($db, $borrowerEmail, 'approved',
            "Borrow Request Approved — {$requestId}",
            "Your request for {$qty} {$unit}(s) of {$req['asset_name']} has been approved. Transaction {$txnId} created.",
            'borrow.html'
        );
    }

    sendJson(['ok' => true, 'transactionId' => $txnId]);
}

// ── REJECT BORROW REQUEST ──────────────────────────────────
if ($method === 'POST' && $action === 'reject') {
    $body      = getBody();
    $requestId = trim($body['requestId'] ?? '');
    $reason    = trim($body['reason'] ?? '');
    $db        = getDB();

    $stmt = $db->prepare("SELECT * FROM borrow_requests WHERE request_id=? AND status='Pending'");
    $stmt->execute([$requestId]);
    $req = $stmt->fetch();
    if (!$req) sendJson(['ok' => false, 'error' => 'Pending request not found.']);

    $db->prepare("UPDATE borrow_requests SET status='Rejected', rejection_reason=? WHERE request_id=?")->execute([$reason, $requestId]);

    // Notify borrower — use stored email first, fall back to name lookup for old records
    $borrowerEmail = $req['borrower_email'] ?? '';
    if (!$borrowerEmail) {
        $bu = $db->prepare("SELECT email FROM users WHERE name=? AND role='teacher' LIMIT 1");
        $bu->execute([$req['borrower']]);
        $buRow = $bu->fetch();
        $borrowerEmail = $buRow['email'] ?? '';
    }
    if ($borrowerEmail) {
        $unit = $req['asset_unit'] ?? 'piece';
        $msg  = "Your request for {$req['quantity']} {$unit}(s) of {$req['asset_name']} was not approved.";
        if ($reason) $msg .= " Reason: {$reason}";
        sendNotification($db, $borrowerEmail, 'rejected',
            "Borrow Request Rejected — {$requestId}", $msg, 'borrow.html'
        );
    }

    sendJson(['ok' => true]);
}

sendJson(['ok' => false, 'error' => 'Invalid request.'], 400);
?>
