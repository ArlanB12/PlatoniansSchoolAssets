<?php
require_once 'config.php';
require_once '_session.php';

guard_request_csrf();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

// These delegate to the shared push-enabled helpers in _push.php so
// every notification also fires a real device push. The pre-fetched
// $staff optimization is preserved.
function notif($db, $email, $type, $title, $message, $link = '') {
    notifyUser($db, $email, $type, $title, $message, $link);
}

/**
 * Send a notification to all staff who handle lending operations
 * (superadmin + admin/Principal + custodian). Accepts a pre-fetched
 * $staff array to avoid re-querying inside loops.
 */
function notifStaff($db, $type, $title, $message, $link = '', $staff = null) {
    if ($staff === null) {
        $staff = $db->query("SELECT email FROM users WHERE role IN ('superadmin','admin','custodian')")->fetchAll();
    }
    foreach ($staff as $s) notifyUser($db, $s['email'], $type, $title, $message, $link);
}

function postCheckoutNotifs($db, $assetId, $assetName, $newQty, $unit, $staff) {
    if ($newQty <= 0) {
        notifStaff($db, 'out_of_stock', "Out of Stock — {$assetName}",
            "{$assetName} ({$assetId}) is now completely out of stock.", 'inventory.html', $staff);
    } elseif ($newQty <= 5) {
        notifStaff($db, 'low_stock', "Low Stock Alert — {$assetName}",
            "Only {$newQty} {$unit}(s) of {$assetName} ({$assetId}) remaining.", 'inventory.html', $staff);
    }
}

// ── GET ALL TRANSACTIONS ───────────────────────────────────
if ($method === 'GET' && $action === 'list') {
    $me = require_auth();
    $db = getDB();

    // BUG FIX v10.19: teachers could previously fetch every transaction in the
    // system (IDOR). Scope their view to their own records only. Staff roles
    // (superadmin/admin/custodian) still see everything.
    $teacherRoles = ['teacher'];
    if (in_array($me['role'], $teacherRoles, true)) {
        $stmt = $db->prepare("SELECT * FROM transactions WHERE LOWER(borrower_email) = LOWER(?) ORDER BY created_at DESC");
        $stmt->execute([$me['email']]);
    } else {
        $stmt = $db->query("SELECT * FROM transactions ORDER BY created_at DESC");
    }

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
    require_auth(['superadmin','custodian']);
    $body          = getBody();
    $assetId       = trim($body['assetId'] ?? '');
    $quantity      = (int)($body['quantity'] ?? 1);
    $borrower      = trim($body['borrower'] ?? '');
    $borrowerEmail = strtolower(trim($body['borrowerEmail'] ?? ''));
    $borrowDate    = trim($body['borrowDate'] ?? date('Y-m-d'));
    $returnDate    = trim($body['returnDate'] ?? '');
    $db            = getDB();

    // Validate dates
    $today = date('Y-m-d');
    if ($borrowDate < $today)
        sendJson(['ok' => false, 'error' => 'Borrow date cannot be in the past.']);
    if ($returnDate && $returnDate < $today)
        sendJson(['ok' => false, 'error' => 'Return date cannot be in the past.']);
    if ($returnDate && $returnDate < $borrowDate)
        sendJson(['ok' => false, 'error' => 'Return date must be on or after the borrow date.']);
    if (!$returnDate) $returnDate = date('Y-m-d', strtotime($borrowDate . ' +7 days'));

    // Wrap in a transaction to prevent stock race conditions
    $db->beginTransaction();
    try {
        // Lock the asset row for the duration of this transaction
        $stmt = $db->prepare("SELECT * FROM assets WHERE id = ? FOR UPDATE");
        $stmt->execute([$assetId]);
        $asset = $stmt->fetch();

        if (!$asset)            { $db->rollBack(); sendJson(['ok' => false, 'error' => 'Asset not found.']); }
        if ((int)$asset['quantity'] <= 0) { $db->rollBack(); sendJson(['ok' => false, 'error' => 'Asset is out of stock.']); }
        if ($quantity <= 0)     { $db->rollBack(); sendJson(['ok' => false, 'error' => 'Quantity must be at least 1.']); }
        if ($quantity > (int)$asset['quantity']) {
            $db->rollBack();
            sendJson(['ok' => false, 'error' => 'Only ' . $asset['quantity'] . ' ' . ($asset['unit'] ?? 'unit(s)') . ' available.']);
        }
        $maxQty = (int)($asset['max_checkout_qty'] ?? 0);
        if ($maxQty > 0 && $quantity > $maxQty) {
            $db->rollBack();
            sendJson(['ok' => false, 'error' => "Checkout limit is {$maxQty} " . ($asset['unit'] ?? 'unit(s)') . " per request."]);
        }

        $num   = nextCounter('transaction_counter');
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

        $db->commit();

        // Notifications after commit
        $staff = $db->query("SELECT email FROM users WHERE role IN ('superadmin','admin','custodian')")->fetchAll();
        notifStaff($db, 'checkout',
            "Item Checked Out — {$asset['name']}",
            "{$borrower} borrowed {$quantity} {$unit}(s) of {$asset['name']} ({$assetId}). Due: {$returnDate}.",
            'transactions.html', $staff
        );
        if ($borrowerEmail) {
            notif($db, $borrowerEmail, 'checkout',
                "Checkout Confirmed — {$asset['name']}",
                "You borrowed {$quantity} {$unit}(s) of {$asset['name']}. Please return by {$returnDate}.",
                'transactions.html'
            );
        }
        postCheckoutNotifs($db, $assetId, $asset['name'], $newQty, $unit, $staff);
        sendJson(['ok' => true, 'transactionId' => $txnId]);

    } catch (PDOException $e) {
        $db->rollBack();
        sendJson(['ok' => false, 'error' => 'Checkout failed. Please try again.']);
    }
}

// ── RETURN ASSET ───────────────────────────────────────────
if ($method === 'POST' && $action === 'return') {
    $me            = require_auth(['superadmin','custodian','teacher']);
    $body          = getBody();
    $transactionId = trim($body['transactionId'] ?? '');
    $condition     = trim($body['condition'] ?? 'Good');
    $returnDate    = $body['returnDate'] ?? date('Y-m-d');
    $db            = getDB();

    // Clamp actual return date to today (no future actuals)
    $today = date('Y-m-d');
    if ($returnDate > $today) $returnDate = $today;

    $db->beginTransaction();
    try {
        $stmt = $db->prepare("SELECT * FROM transactions WHERE id = ? AND status = 'Borrowed' FOR UPDATE");
        $stmt->execute([$transactionId]);
        $txn = $stmt->fetch();
        if (!$txn) { $db->rollBack(); sendJson(['ok' => false, 'error' => 'Borrowed transaction not found.']); }

        $db->prepare("
            UPDATE transactions
            SET status = 'Returned', returned_condition = ?, actual_return_date = ?
            WHERE id = ?
        ")->execute([$condition, $returnDate, $transactionId]);

        // Conditions that mean the returned unit is damaged / not usable as-is.
        // When an item comes back in any of these states we flag the underlying
        // asset as "Under Repair" and persist the returned condition so the
        // dashboard analytics ("Needs Repair", Condition Overview) reflect it.
        $damagedConditions = ['needs repair', 'damaged', 'for repair', 'broken', 'defective'];
        $isDamaged = in_array(strtolower(trim($condition)), $damagedConditions, true);

        if ($isDamaged) {
            // Restore quantity, mark the asset as Under Repair, and record the
            // condition reported on return so it carries through to analytics.
            $db->prepare("
                UPDATE assets
                SET quantity    = quantity + ?,
                    `condition` = ?,
                    status      = 'Under Repair'
                WHERE id = ?
            ")->execute([(int)$txn['quantity'], $condition, $txn['asset_id']]);
        } else {
            // Healthy return: restore quantity, store the reported condition,
            // and only flip an Out of Stock asset back to Available.
            $db->prepare("
                UPDATE assets
                SET quantity    = quantity + ?,
                    `condition` = ?,
                    status      = CASE WHEN status = 'Out of Stock' THEN 'Available' ELSE status END
                WHERE id = ?
            ")->execute([(int)$txn['quantity'], $condition, $txn['asset_id']]);
        }

        $db->commit();

        $unit      = $txn['asset_unit'] ?? 'piece';
        $borrower  = $txn['borrower'];
        $qty       = (int)$txn['quantity'];
        $assetName = $txn['asset_name'];
        $staff     = $db->query("SELECT email FROM users WHERE role IN ('superadmin','admin','custodian')")->fetchAll();

        notifStaff($db, 'returned',
            "Item Returned — {$assetName}",
            "{$borrower} returned {$qty} {$unit}(s) of {$assetName}. Condition: {$condition}.",
            'transactions.html', $staff
        );
        $borrowerEmail = $txn['borrower_email'] ?? '';
        if ($borrowerEmail) {
            notif($db, $borrowerEmail, 'returned',
                "Return Confirmed — {$assetName}",
                "Your return of {$qty} {$unit}(s) of {$assetName} has been recorded. Condition: {$condition}.",
                'transactions.html'
            );
        }
        logActivityAs($db, $me, 'item_returned', "{$assetName} ({$txn['asset_id']})",
            "{$borrower} returned {$qty} {$unit}(s). Condition: {$condition}.");
        sendJson(['ok' => true]);

    } catch (PDOException $e) {
        $db->rollBack();
        sendJson(['ok' => false, 'error' => 'Return failed. Please try again.']);
    }
}

// ── CHECK DUE / OVERDUE / EARLY REMINDER ──────────────────
if ($method === 'POST' && $action === 'check_due') {
    require_auth(['superadmin', 'admin', 'custodian']);
    $db    = getDB();
    $today = date('Y-m-d');

    // Fetch early reminder setting once
    $pRow = $db->prepare("SELECT policy_value FROM lending_policy WHERE policy_key = 'early_reminder_days'");
    $pRow->execute();
    $reminderDays = max(1, (int)(($pRow->fetch())['policy_value'] ?? 2));

    // Fetch staff once — reused across all loops below
    $staff = $db->query("SELECT email FROM users WHERE role IN ('superadmin','admin','custodian')")->fetchAll();

    // ── OPTIMIZATION: prefetch today's notification titles into a PHP set ──
    // This replaces N individual "SELECT id FROM notifications WHERE title=?" queries
    // (one per transaction per day) with a single bulk fetch.
    // Titles follow predictable patterns: "Early Reminder — TRX-... — due-YYYY-MM-DD",
    // "OVERDUE — TRX-... — YYYY-MM-DD", "ESCALATED — TRX-... — YYYY-MM-DD".
    // We only need today's titles, so we scope to the last 30 days to be safe.
    $todayTitles = [];
    try {
        $tStmt = $db->prepare("SELECT DISTINCT title FROM notifications WHERE created_at >= ?");
        $tStmt->execute([date('Y-m-d', strtotime('-30 days'))]);
        foreach ($tStmt->fetchAll() as $row) {
            $todayTitles[$row['title']] = true;
        }
    } catch (PDOException $e) { /* non-fatal — fall through; notifications may duplicate */ }

    $alreadySent = function(string $key) use (&$todayTitles): bool {
        return isset($todayTitles[$key]);
    };
    $markSent = function(string $key) use (&$todayTitles): void {
        $todayTitles[$key] = true;
    };

    // Prepare reusable statements ONCE outside the loops
    $dueByDate = $db->prepare("SELECT * FROM transactions WHERE status='Borrowed' AND return_date=?");

    // ── Early reminder (X days before due) ─────────────────
    for ($d = $reminderDays; $d >= 1; $d--) {
        $targetDate = date('Y-m-d', strtotime("+{$d} days"));
        $dueByDate->execute([$targetDate]);
        foreach ($dueByDate->fetchAll() as $t) {
            $key = "Early Reminder — {$t['id']} — due-{$targetDate}";
            if ($alreadySent($key)) continue;
            $markSent($key);

            $unit     = $t['asset_unit'] ?? 'piece';
            $daysWord = $d === 1 ? 'TOMORROW' : "in {$d} days";
            notifStaff($db, 'due_soon', $key,
                "{$t['borrower']} has {$t['asset_name']} due {$daysWord} ({$targetDate}).",
                'transactions.html', $staff);
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
    $overdueRows = $overdue->fetchAll();

    // Fetch admins ONCE (only used if any 14+ day escalation triggers)
    $admins = null;

    foreach ($overdueRows as $t) {
        $daysLate = (int)round((strtotime($today) - strtotime($t['return_date'])) / 86400);
        $key      = "OVERDUE — {$t['id']} — {$today}";
        if ($alreadySent($key)) continue;
        $markSent($key);

        notifStaff($db, 'overdue', $key,
            "⚠️ {$t['borrower']} has NOT returned {$t['asset_name']} — {$daysLate} day(s) overdue! Was due: {$t['return_date']}.",
            'transactions.html', $staff);

        $bEmail = $t['borrower_email'] ?? '';
        if ($bEmail) notif($db, $bEmail, 'overdue',
            "OVERDUE — Return {$t['asset_name']} NOW",
            "You have NOT returned {$t['asset_name']} — it is {$daysLate} day(s) overdue (was due {$t['return_date']}). Please return it immediately to avoid account restrictions.",
            'transactions.html');

        // Tier 4 escalation (14+ days)
        if ($daysLate >= 14) {
            $escKey = "ESCALATED — {$t['id']} — {$today}";
            if (!$alreadySent($escKey)) {
                $markSent($escKey);
                // Lazy-load escalation recipients on first escalation
                // (Principal + ICT superadmin handle administrative escalation).
                if ($admins === null) {
                    $admins = $db->query("SELECT email FROM users WHERE role IN ('superadmin','admin')")->fetchAll();
                }
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
