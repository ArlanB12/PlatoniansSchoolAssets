<?php
require_once 'config.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

function notif($db, $email, $type, $title, $message, $link = '') {
    $id = 'NTF-' . str_pad(nextCounter('notif_counter') - 1, 5, '0', STR_PAD_LEFT);
    $db->prepare("INSERT INTO notifications (notif_id, user_email, type, title, message, link) VALUES (?,?,?,?,?,?)")
       ->execute([$id, strtolower(trim($email)), $type, $title, $message, $link]);
}

function notifStaff($db, $type, $title, $message, $link = '') {
    $staff = $db->query("SELECT email FROM users WHERE role IN ('admin','custodian')")->fetchAll();
    foreach ($staff as $s) notif($db, $s['email'], $type, $title, $message, $link);
}

function postCheckoutNotifs($db, $assetId, $assetName, $newQty, $unit) {
    if ($newQty <= 0) {
        notifStaff($db, 'out_of_stock', "Out of Stock — {$assetName}",
            "{$assetName} ({$assetId}) is now completely out of stock.", 'inventory.html');
    } elseif ($newQty <= 5) {
        notifStaff($db, 'low_stock', "Low Stock Alert — {$assetName}",
            "Only {$newQty} {$unit}(s) of {$assetName} ({$assetId}) remaining.", 'inventory.html');
    }
}

// ── GET ALL TRANSACTIONS ───────────────────────────────────
if ($method === 'GET' && $action === 'list') {
    $db   = getDB();
    $stmt = $db->query("SELECT * FROM transactions ORDER BY created_at DESC");
    $rows = $stmt->fetchAll();
    sendJson(['ok' => true, 'transactions' => array_map(function($r) {
        return [
            'id'                => $r['id'],
            'assetId'           => $r['asset_id'],
            'assetName'         => $r['asset_name'],
            'assetUnit'         => $r['asset_unit'] ?? 'piece',
            'quantity'          => (int)$r['quantity'],
            'borrower'          => $r['borrower'],
            'borrowerEmail'     => $r['borrower_email'] ?? '',
            'role'              => $r['role'],
            'borrowDate'        => $r['borrow_date'],
            'returnDate'        => $r['return_date'],
            'condition'         => $r['condition_out'],
            'status'            => $r['status'],
            'actualReturnDate'  => $r['actual_return_date'] ?? '',
            'returnedCondition' => $r['returned_condition'],
        ];
    }, $rows)]);
}

// ── CHECKOUT ASSET ─────────────────────────────────────────
if ($method === 'POST' && $action === 'checkout') {
    $body          = getBody();
    $assetId       = trim($body['assetId'] ?? '');
    $quantity      = (int)($body['quantity'] ?? 1);
    $borrower      = trim($body['borrower'] ?? '');
    $borrowerEmail = strtolower(trim($body['borrowerEmail'] ?? ''));
    $borrowDate    = trim($body['borrowDate'] ?? date('Y-m-d'));
    $returnDate    = trim($body['returnDate'] ?? '');
    $db            = getDB();

    // Validate dates — no past dates allowed
    $today = date('Y-m-d');
    if ($borrowDate < $today)
        sendJson(['ok' => false, 'error' => 'Borrow date cannot be in the past.']);
    if ($returnDate && $returnDate < $today)
        sendJson(['ok' => false, 'error' => 'Return date cannot be in the past.']);
    if ($returnDate && $returnDate < $borrowDate)
        sendJson(['ok' => false, 'error' => 'Return date must be on or after the borrow date.']);
    if (!$returnDate) $returnDate = date('Y-m-d', strtotime($borrowDate . ' +7 days'));

    $stmt = $db->prepare("SELECT * FROM assets WHERE id = ?");
    $stmt->execute([$assetId]);
    $asset = $stmt->fetch();

    if (!$asset) sendJson(['ok' => false, 'error' => 'Asset not found.']);
    if ((int)$asset['quantity'] <= 0) sendJson(['ok' => false, 'error' => 'Asset is out of stock.']);
    if ($quantity <= 0) sendJson(['ok' => false, 'error' => 'Quantity must be at least 1.']);
    if ($quantity > (int)$asset['quantity'])
        sendJson(['ok' => false, 'error' => 'Only ' . $asset['quantity'] . ' ' . ($asset['unit'] ?? 'unit(s)') . ' available.']);

    $maxQty = (int)($asset['max_checkout_qty'] ?? 0);
    if ($maxQty > 0 && $quantity > $maxQty)
        sendJson(['ok' => false, 'error' => "Checkout limit is {$maxQty} " . ($asset['unit'] ?? 'unit(s)') . "(s) per request."]);

    $num   = nextCounter('transaction_counter') - 1;
    $txnId = toPaddedId('TRX-', $num);
    $unit  = $asset['unit'] ?? 'piece';

    $db->prepare("
        INSERT INTO transactions
            (id, asset_id, asset_name, asset_unit, quantity, borrower, borrower_email, role, borrow_date, return_date, condition_out, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Borrowed')
    ")->execute([
        $txnId, $assetId, $asset['name'], $unit,
        $quantity, $borrower, $borrowerEmail,
        trim($body['role'] ?? 'teacher'),
        $borrowDate, $returnDate,
        trim($body['condition'] ?? 'Good'),
    ]);

    $newQty    = (int)$asset['quantity'] - $quantity;
    $newStatus = $newQty <= 0 ? 'Out of Stock' : $asset['status'];
    $db->prepare("UPDATE assets SET quantity = ?, status = ? WHERE id = ?")
       ->execute([$newQty, $newStatus, $assetId]);

    notifStaff($db, 'checkout',
        "Item Checked Out — {$asset['name']}",
        "{$borrower} borrowed {$quantity} {$unit}(s) of {$asset['name']} ({$assetId}). Due: {$returnDate}.",
        'transactions.html'
    );

    if ($borrowerEmail) {
        notif($db, $borrowerEmail, 'checkout',
            "Checkout Confirmed — {$asset['name']}",
            "You borrowed {$quantity} {$unit}(s) of {$asset['name']}. Please return by {$returnDate}.",
            'transactions.html'
        );
    }

    postCheckoutNotifs($db, $assetId, $asset['name'], $newQty, $unit);
    sendJson(['ok' => true, 'transactionId' => $txnId]);
}

// ── RETURN ASSET ───────────────────────────────────────────
if ($method === 'POST' && $action === 'return') {
    $body          = getBody();
    $transactionId = trim($body['transactionId'] ?? '');
    $condition     = trim($body['condition'] ?? 'Good');
    $returnDate    = $body['returnDate'] ?? date('Y-m-d');
    $db            = getDB();

    // Return date validation
    $today = date('Y-m-d');
    if ($returnDate > $today) {
        // Allow future return dates (scheduled), but warn
        // Actually just clamp to today for actual return
        $returnDate = $today;
    }

    $stmt = $db->prepare("SELECT * FROM transactions WHERE id = ? AND status = 'Borrowed'");
    $stmt->execute([$transactionId]);
    $txn = $stmt->fetch();
    if (!$txn) sendJson(['ok' => false, 'error' => 'Borrowed transaction not found.']);

    $db->prepare("
        UPDATE transactions
        SET status = 'Returned', returned_condition = ?, actual_return_date = ?
        WHERE id = ?
    ")->execute([$condition, $returnDate, $transactionId]);

    $db->prepare("
        UPDATE assets
        SET quantity = quantity + ?,
            status   = CASE WHEN status = 'Out of Stock' THEN 'Available' ELSE status END
        WHERE id = ?
    ")->execute([(int)$txn['quantity'], $txn['asset_id']]);

    $unit      = $txn['asset_unit'] ?? 'piece';
    $borrower  = $txn['borrower'];
    $qty       = (int)$txn['quantity'];
    $assetName = $txn['asset_name'];

    notifStaff($db, 'returned',
        "Item Returned — {$assetName}",
        "{$borrower} returned {$qty} {$unit}(s) of {$assetName}. Condition: {$condition}.",
        'transactions.html'
    );

    $borrowerEmail = $txn['borrower_email'] ?? '';
    if ($borrowerEmail) {
        notif($db, $borrowerEmail, 'returned',
            "Return Confirmed — {$assetName}",
            "Your return of {$qty} {$unit}(s) of {$assetName} has been recorded. Condition: {$condition}.",
            'transactions.html'
        );
    }
    sendJson(['ok' => true]);
}

// ── CHECK DUE / OVERDUE / EARLY REMINDER ──────────────────
if ($method === 'POST' && $action === 'check_due') {
    $db   = getDB();
    $today = date('Y-m-d');

    // Get early reminder setting from lending policy
    $pStmt = $db->prepare("SELECT policy_value FROM lending_policy WHERE policy_key = 'early_reminder_days'");
    $pStmt->execute();
    $pRow = $pStmt->fetch();
    $reminderDays = max(1, (int)($pRow['policy_value'] ?? 2));

    // ── Early reminder (X days before due) ─────────────────
    for ($d = $reminderDays; $d >= 1; $d--) {
        $targetDate = date('Y-m-d', strtotime("+{$d} days"));
        $dueRows = $db->prepare("SELECT * FROM transactions WHERE status='Borrowed' AND return_date=?");
        $dueRows->execute([$targetDate]);
        foreach ($dueRows->fetchAll() as $t) {
            $key = "Early Reminder — {$t['id']} — due-{$targetDate}";
            $exists = $db->prepare("SELECT id FROM notifications WHERE title=? LIMIT 1");
            $exists->execute([$key]);
            if ($exists->fetch()) continue;

            $unit = $t['asset_unit'] ?? 'piece';
            $daysWord = $d === 1 ? 'TOMORROW' : "in {$d} days";
            notifStaff($db, 'due_soon', $key,
                "{$t['borrower']} has {$t['asset_name']} due {$daysWord} ({$targetDate}).",
                'transactions.html');
            $bEmail = $t['borrower_email'] ?? '';
            if ($bEmail) notif($db, $bEmail, 'due_soon',
                "Return Reminder — {$t['asset_name']}",
                "Please return {$t['asset_name']} ({$t['id']}) by {$targetDate} ({$daysWord}). Return it on time to avoid penalties.",
                'transactions.html');
        }
    }

    // ── Overdue: daily notification per transaction ─────────
    $overdue = $db->prepare("SELECT * FROM transactions WHERE status='Borrowed' AND return_date < ?");
    $overdue->execute([$today]);
    foreach ($overdue->fetchAll() as $t) {
        $daysLate = (int)round((strtotime($today) - strtotime($t['return_date'])) / 86400);
        $key = "OVERDUE — {$t['id']} — {$today}";
        $exists = $db->prepare("SELECT id FROM notifications WHERE title=? LIMIT 1");
        $exists->execute([$key]);
        if ($exists->fetch()) continue;

        $unit = $t['asset_unit'] ?? 'piece';
        notifStaff($db, 'overdue', $key,
            "⚠️ {$t['borrower']} has NOT returned {$t['asset_name']} — {$daysLate} day(s) overdue! Was due: {$t['return_date']}.",
            'transactions.html');

        $bEmail = $t['borrower_email'] ?? '';
        if ($bEmail) notif($db, $bEmail, 'overdue',
            "OVERDUE — Return {$t['asset_name']} NOW",
            "You have NOT returned {$t['asset_name']} — it is {$daysLate} day(s) overdue (was due {$t['return_date']}). Please return it immediately to avoid account restrictions.",
            'transactions.html');

        // Tier 4 escalation (14+ days)
        if ($daysLate >= 14) {
            $escKey = "ESCALATED — {$t['id']} — {$today}";
            $escExists = $db->prepare("SELECT id FROM notifications WHERE title=? LIMIT 1");
            $escExists->execute([$escKey]);
            if (!$escExists->fetch()) {
                $admins = $db->query("SELECT email FROM users WHERE role='admin'")->fetchAll();
                foreach ($admins as $a) {
                    notif($db, $a['email'], 'overdue',
                        "🚨 ESCALATED — {$t['borrower']} ({$t['id']})",
                        "ESCALATION ALERT: {$t['borrower']} has not returned {$t['asset_name']} for {$daysLate} DAYS (due {$t['return_date']}). Manual intervention required.",
                        'transactions.html');
                }
                if ($bEmail) notif($db, $bEmail, 'overdue',
                    "🚨 FINAL NOTICE — Account Locked",
                    "Your account has been ESCALATED due to non-return of {$t['asset_name']} ({$daysLate} days overdue). Contact the Administrator immediately.",
                    'transactions.html');
            }
        }
    }
    sendJson(['ok' => true]);
}

sendJson(['ok' => false, 'error' => 'Invalid request.'], 400);
?>
