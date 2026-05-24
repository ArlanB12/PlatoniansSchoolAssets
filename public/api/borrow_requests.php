<?php
require_once 'config.php';
require_once '_session.php';

guard_request_csrf();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

// These delegate to the shared push-enabled helpers in _push.php so
// every notification also fires a real device push to the recipient.
function sendNotif($db, $userEmail, $type, $title, $message, $link = '') {
    notifyUser($db, $userEmail, $type, $title, $message, $link);
}

function notifStaffBR($db, $type, $title, $message, $link = '', $staff = null) {
    if ($staff === null) {
        $staff = $db->query("SELECT email FROM users WHERE role IN ('superadmin','admin','custodian')")->fetchAll();
    }
    foreach ($staff as $s) notifyUser($db, $s['email'], $type, $title, $message, $link);
}

// ── LIST BORROW REQUESTS ───────────────────────────────────
if ($method === 'GET' && $action === 'list') {
    $me = require_auth();
    $db = getDB();
    // Teachers may only see their own requests (IDOR fix).
    if ($me['role'] === 'teacher') {
        $stmt = $db->prepare("SELECT * FROM borrow_requests WHERE LOWER(borrower_email) = LOWER(?) ORDER BY requested_at DESC");
        $stmt->execute([$me['email']]);
    } else {
        $stmt = $db->query("SELECT * FROM borrow_requests ORDER BY requested_at DESC");
    }
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
// Pre-fix, the borrower's name + email + role came from the request body,
// so a teacher could open dev tools and POST as another teacher (or even
// as the admin). All three identity fields now come from the session.
if ($method === 'POST' && $action === 'create') {
    $me            = require_auth(['teacher']);
    $body          = getBody();
    $db            = getDB();
    $assetId       = trim($body['assetId'] ?? '');
    $quantity      = (int)($body['quantity'] ?? 1);
    $borrower      = $me['name'];
    $borrowerEmail = $me['email'];
    $role          = $me['role'];

    // Accountability check: block Tier 2+ from requesting
    if ($borrowerEmail) {
        $u = $db->prepare("SELECT overdue_override FROM users WHERE email = ?");
        $u->execute([$borrowerEmail]);
        $uRow = $u->fetch();
        $overridden = $uRow && (int)$uRow['overdue_override'] === 1;
        if (!$overridden) {
            $today = date('Y-m-d');
            $ov    = $db->prepare("
                SELECT DATEDIFF(?,return_date) AS d, asset_name FROM transactions t
                JOIN users u ON LOWER(u.name)=LOWER(t.borrower)
                WHERE u.email=? AND t.status='Borrowed' AND t.return_date<? ORDER BY d DESC LIMIT 1
            ");
            $ov->execute([$today, $borrowerEmail, $today]);
            $ovRow = $ov->fetch();
            if ($ovRow && (int)$ovRow['d'] >= 3) {
                sendJson(['ok' => false,
                    'error' => "🚫 Your borrowing privilege is suspended. You have not returned \"{$ovRow['asset_name']}\" ({$ovRow['d']} day(s) overdue). Please return it first.",
                    'tier'  => (int)$ovRow['d'] >= 7 ? 3 : 2,
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
        sendJson(['ok' => false, 'error' => "Only {$asset['quantity']} " . ($asset['unit'] ?? 'unit(s)') . "(s) available."]);
    }
    $maxQty = (int)($asset['max_checkout_qty'] ?? 0);
    if ($maxQty > 0 && $quantity > $maxQty) {
        sendJson(['ok' => false, 'error' => "Request limit is {$maxQty} " . ($asset['unit'] ?? 'unit(s)') . "(s) per request."]);
    }

    // Validate dates server-side (frontend already does this but never trust the client)
    $today      = date('Y-m-d');
    $borrowDate = trim($body['borrowDate'] ?? $today);
    $returnDate = trim($body['returnDate'] ?? $today);
    if ($borrowDate < $today) sendJson(['ok' => false, 'error' => 'Borrow date cannot be in the past.']);
    if ($returnDate < $borrowDate) sendJson(['ok' => false, 'error' => 'Return date must be on or after the borrow date.']);

    $num       = nextCounter('request_counter');
    $requestId = toPaddedId('REQ-', $num);
    $unit      = $asset['unit'] ?? 'piece';

    $stmt = $db->prepare("
        INSERT INTO borrow_requests
            (request_id, asset_id, asset_name, asset_unit, borrower, borrower_email, role, quantity, borrow_date, return_date, condition_out, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending')
    ");
    $stmt->execute([
        $requestId, $assetId, $asset['name'], $unit,
        $borrower, $borrowerEmail, $role,
        $quantity,
        $borrowDate,
        $returnDate,
        $asset['condition'] ?? 'Good',
    ]);

    // Notify staff — fetch once
    $staff = $db->query("SELECT email FROM users WHERE role IN ('superadmin','admin','custodian')")->fetchAll();
    notifStaffBR($db, 'request',
        "New Borrow Request — {$requestId}",
        "{$borrower} requested {$quantity} {$unit}(s) of {$asset['name']}.",
        'transactions.html', $staff);

    logActivityAs($db, $me, 'borrow_requested', "{$requestId}",
        "{$borrower} requested {$quantity} {$unit}(s) of {$asset['name']} ({$assetId}). Due: {$returnDate}.");

    sendJson(['ok' => true, 'requestId' => $requestId]);
}

// ── APPROVE BORROW REQUEST ─────────────────────────────────
if ($method === 'POST' && $action === 'approve') {
    $me        = require_auth(['superadmin','admin','custodian']);
    $body      = getBody();
    $requestId = trim($body['requestId'] ?? '');
    $db        = getDB();

    $stmt = $db->prepare("SELECT * FROM borrow_requests WHERE request_id = ? AND status = 'Pending'");
    $stmt->execute([$requestId]);
    $req = $stmt->fetch();
    if (!$req) sendJson(['ok' => false, 'error' => 'Pending request not found.']);

    $db->beginTransaction();
    try {
        // Lock the asset row to prevent concurrent over-allocation
        $stmt = $db->prepare("SELECT * FROM assets WHERE id = ? FOR UPDATE");
        $stmt->execute([$req['asset_id']]);
        $asset = $stmt->fetch();
        if (!$asset) { $db->rollBack(); sendJson(['ok' => false, 'error' => 'Asset not found.']); }

        $qty = (int)$req['quantity'];
        if ($qty > (int)$asset['quantity']) {
            $db->rollBack();
            sendJson(['ok' => false, 'error' => 'Insufficient stock to approve.']);
        }

        $num   = nextCounter('transaction_counter');
        $txnId = toPaddedId('TRX-', $num);
        $unit  = $req['asset_unit'] ?? 'piece';

        $db->prepare("
            INSERT INTO transactions
                (id, asset_id, asset_name, asset_unit, quantity, borrower, borrower_email, role,
                 borrow_date, return_date, condition_out, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Borrowed')
        ")->execute([
            $txnId, $req['asset_id'], $req['asset_name'], $unit,
            $qty, $req['borrower'], $req['borrower_email'] ?? '',
            $req['role'],
            $req['borrow_date'], $req['return_date'],
            $asset['condition'] ?? 'Good',
        ]);

        $newQty    = (int)$asset['quantity'] - $qty;
        $newStatus = $newQty <= 0 ? 'Out of Stock' : $asset['status'];
        $db->prepare("UPDATE assets SET quantity=?, status=? WHERE id=?")->execute([$newQty, $newStatus, $req['asset_id']]);
        $db->prepare("UPDATE borrow_requests SET status='Approved', transaction_id=? WHERE request_id=?")->execute([$txnId, $requestId]);

        $db->commit();

        // Post-commit notifications (fetch staff once)
        $staff = $db->query("SELECT email FROM users WHERE role IN ('superadmin','admin','custodian')")->fetchAll();

        // Low / out-of-stock alert — ONCE (was duplicated before)
        if ($newQty <= 0) {
            notifStaffBR($db, 'out_of_stock',
                "Out of Stock — {$req['asset_name']}",
                "{$req['asset_name']} ({$req['asset_id']}) is now completely out of stock after approving {$requestId}.",
                'inventory.html', $staff);
        } elseif ($newQty <= 5 && (int)$asset['quantity'] > 5) {
            notifStaffBR($db, 'low_stock',
                "Low Stock Alert — {$req['asset_name']}",
                "Only {$newQty} {$unit}(s) of {$req['asset_name']} remaining after approving {$requestId}.",
                'inventory.html', $staff);
        }

        // Notify borrower
        $borrowerEmail = $req['borrower_email'] ?? '';
        if (!$borrowerEmail) {
            // Fallback: look up by name for old records that predate borrower_email column
            $bu = $db->prepare("SELECT email FROM users WHERE name=? AND role='teacher' LIMIT 1");
            $bu->execute([$req['borrower']]);
            $buRow = $bu->fetch();
            $borrowerEmail = $buRow['email'] ?? '';
        }
        if ($borrowerEmail) {
            sendNotif($db, $borrowerEmail, 'approved',
                "Borrow Request Approved — {$requestId}",
                "Your request for {$qty} {$unit}(s) of {$req['asset_name']} has been approved. Transaction {$txnId} created.",
                'borrow.html');
        }

        logActivityAs($db, $me, 'request_approved', "{$requestId} → {$txnId}",
            "Approved {$qty} {$unit}(s) of {$req['asset_name']} for {$req['borrower']}.");

        sendJson(['ok' => true, 'transactionId' => $txnId]);

    } catch (PDOException $e) {
        $db->rollBack();
        sendJson(['ok' => false, 'error' => 'Approval failed. Please try again.']);
    }
}

// ── REJECT BORROW REQUEST ──────────────────────────────────
if ($method === 'POST' && $action === 'reject') {
    $me        = require_auth(['superadmin','admin','custodian']);
    $body      = getBody();
    $requestId = trim($body['requestId'] ?? '');
    $reason    = trim($body['reason'] ?? '');
    $db        = getDB();

    $stmt = $db->prepare("SELECT * FROM borrow_requests WHERE request_id=? AND status='Pending'");
    $stmt->execute([$requestId]);
    $req = $stmt->fetch();
    if (!$req) sendJson(['ok' => false, 'error' => 'Pending request not found.']);

    $db->prepare("UPDATE borrow_requests SET status='Rejected', rejection_reason=? WHERE request_id=?")->execute([$reason, $requestId]);

    // Notify borrower
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
        sendNotif($db, $borrowerEmail, 'rejected',
            "Borrow Request Rejected — {$requestId}", $msg, 'borrow.html');
    }

    logActivityAs($db, $me, 'request_rejected', $requestId,
        "Rejected request from {$req['borrower']}." . ($reason ? " Reason: {$reason}" : ''));

    sendJson(['ok' => true]);
}

sendJson(['ok' => false, 'error' => 'Invalid request.'], 400);
?>
