<?php
// ============================================================
// Platonian's IS — Due Date Checker
// Called by the frontend every 30s alongside the notification poll.
// Generates "due soon" (1 day warning) and overdue notifications.
// Each notification is only sent ONCE per transaction per type
// by checking if a matching unread notification already exists.
// ============================================================
require_once 'config.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

if ($method !== 'POST' || $action !== 'check') {
    sendJson(['ok' => false, 'error' => 'Invalid request.'], 400);
}

$db = getDB();

// Fetch all currently borrowed transactions
$stmt = $db->query("
    SELECT t.*, u.email AS borrower_email_lookup
    FROM transactions t
    LEFT JOIN users u ON LOWER(u.name) = LOWER(t.borrower) AND u.role = 'teacher'
    WHERE t.status = 'Borrowed' AND t.return_date IS NOT NULL
");
$rows = $stmt->fetchAll();

$today    = date('Y-m-d');
$tomorrow = date('Y-m-d', strtotime('+1 day'));

$sent = 0;

foreach ($rows as $txn) {
    $txnId     = $txn['id'];
    $returnDate = $txn['return_date'];
    $assetName  = $txn['asset_name'];
    $borrower   = $txn['borrower'];
    $qty        = (int)$txn['quantity'];
    $unit       = $txn['asset_unit'] ?? 'piece';

    // Resolve borrower email: stored field first, then join lookup
    $borrowerEmail = '';
    if (!empty($txn['borrower_email'])) {
        $borrowerEmail = $txn['borrower_email'];
    } elseif (!empty($txn['borrower_email_lookup'])) {
        $borrowerEmail = $txn['borrower_email_lookup'];
    }

    // ── Helper: check if we already sent this notif type for this txn ──
    $alreadySent = function($type) use ($db, $txnId) {
        $s = $db->prepare("SELECT id FROM notifications WHERE message LIKE ? AND type = ? LIMIT 1");
        $s->execute(["%{$txnId}%", $type]);
        return (bool)$s->fetch();
    };

    $sendNotif = function($email, $type, $title, $message, $link = '') use ($db, &$sent) {
        if (!$email) return;
        $num     = nextCounter('notif_counter') - 1;
        $notifId = 'NTF-' . str_pad($num, 5, '0', STR_PAD_LEFT);
        $db->prepare("INSERT INTO notifications (notif_id, user_email, type, title, message, link) VALUES (?,?,?,?,?,?)")
           ->execute([$notifId, strtolower(trim($email)), $type, $title, $message, $link]);
        $sent++;
    };

    $sendToStaff = function($type, $title, $message, $link = '') use ($db, $sendNotif) {
        $staff = $db->query("SELECT email FROM users WHERE role IN ('admin','custodian')")->fetchAll();
        foreach ($staff as $s) $sendNotif($s['email'], $type, $title, $message, $link);
    };

    // ── DUE TOMORROW — warn borrower once ──────────────────
    if ($returnDate === $tomorrow && !$alreadySent('due_soon')) {
        $sendNotif($borrowerEmail, 'due_soon',
            "⏰ Return Due Tomorrow — {$assetName}",
            "Reminder: {$qty} {$unit}(s) of {$assetName} (Transaction {$txnId}) must be returned tomorrow.",
            'transactions.html'
        );
        // Also notify staff
        $sendToStaff('due_soon',
            "⏰ Due Tomorrow — {$assetName}",
            "{$borrower} must return {$qty} {$unit}(s) of {$assetName} ({$txnId}) by tomorrow.",
            'transactions.html'
        );
    }

    // ── OVERDUE — notify borrower + staff once, then re-alert daily ──
    if ($returnDate < $today) {
        $daysLate = (int)((strtotime($today) - strtotime($returnDate)) / 86400);

        // First overdue notice (fire once when it first crosses the deadline)
        if (!$alreadySent('overdue')) {
            $sendNotif($borrowerEmail, 'overdue',
                "🚨 OVERDUE — {$assetName}",
                "URGENT: Your {$qty} {$unit}(s) of {$assetName} (Transaction {$txnId}) was due on {$returnDate}. Please return it immediately.",
                'transactions.html'
            );
            $sendToStaff('overdue',
                "🚨 OVERDUE — {$assetName}",
                "{$borrower} has NOT returned {$qty} {$unit}(s) of {$assetName} ({$txnId}). Due: {$returnDate} ({$daysLate} day(s) late).",
                'transactions.html'
            );
        }

        // Daily re-alert for multi-day overdue (check if already sent today)
        if ($daysLate > 1) {
            $todayKey = date('Y-m-d');
            $dailyCheck = $db->prepare("SELECT id FROM notifications WHERE message LIKE ? AND type = 'overdue_daily' AND DATE(created_at) = ? LIMIT 1");
            $dailyCheck->execute(["%{$txnId}%", $todayKey]);
            if (!$dailyCheck->fetch()) {
                $sendNotif($borrowerEmail, 'overdue_daily',
                    "🚨 STILL OVERDUE ({$daysLate} days) — {$assetName}",
                    "You are {$daysLate} days late returning {$qty} {$unit}(s) of {$assetName} (Transaction {$txnId}). Return immediately.",
                    'transactions.html'
                );
                $sendToStaff('overdue_daily',
                    "🚨 {$daysLate} Days Overdue — {$assetName}",
                    "{$borrower} is {$daysLate} days overdue on {$assetName} ({$txnId}, due {$returnDate}).",
                    'transactions.html'
                );
            }
        }
    }
}

sendJson(['ok' => true, 'checked' => count($rows), 'sent' => $sent]);
?>
