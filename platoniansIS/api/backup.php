<?php
require_once 'config.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

if ($method === 'POST' && $action === 'restore') {
    $data = getBody();
    $db   = getDB();

    // Support both old format (camelCase from localStorage) and new format
    function getField($obj, ...$keys) {
        foreach ($keys as $k) {
            if (isset($obj[$k])) return $obj[$k];
        }
        return null;
    }

    try {
        $db->beginTransaction();

        // ── Restore assets ──────────────────────────────────
        $assets = $data['assets'] ?? [];
        if (!empty($assets) && is_array($assets)) {
            $db->exec("DELETE FROM assets");
            $ins = $db->prepare("
                INSERT IGNORE INTO assets
                    (id, name, category, quantity, unit, max_checkout_qty, `condition`,
                     unit_cost, location, status, date_added, receipt_file, is_bulk, bulk_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ");
            foreach ($assets as $a) {
                $ins->execute([
                    $a['id']           ?? '',
                    $a['name']         ?? '',
                    $a['category']     ?? '',
                    (int)($a['quantity'] ?? 0),
                    $a['unit']         ?? 'piece',
                    (int)($a['maxCheckoutQty'] ?? $a['max_checkout_qty'] ?? 0),
                    $a['condition']    ?? 'Good',
                    (float)($a['unitCost'] ?? $a['unit_cost'] ?? 0),
                    $a['location']     ?? '',
                    $a['status']       ?? 'Available',
                    $a['dateAdded']    ?? $a['date_added'] ?? date('Y-m-d'),
                    $a['receiptFile']  ?? $a['receipt_file'] ?? '',
                    !empty($a['isBulk'] ?? $a['is_bulk']) ? 1 : 0,
                    $a['bulkId']       ?? $a['bulk_id'] ?? '',
                ]);
            }
        }

        // ── Restore transactions ────────────────────────────
        $transactions = $data['transactions'] ?? [];
        if (!empty($transactions) && is_array($transactions)) {
            $db->exec("DELETE FROM transactions");
            $ins = $db->prepare("
                INSERT IGNORE INTO transactions
                    (id, asset_id, asset_name, asset_unit, quantity, borrower, role,
                     borrow_date, return_date, condition_out, status,
                     actual_return_date, returned_condition)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ");
            foreach ($transactions as $t) {
                $ins->execute([
                    $t['id']               ?? '',
                    $t['assetId']          ?? $t['asset_id']  ?? '',
                    $t['assetName']        ?? $t['asset_name'] ?? '',
                    $t['assetUnit']        ?? $t['asset_unit'] ?? 'piece',
                    (int)($t['quantity']   ?? 1),
                    $t['borrower']         ?? '',
                    $t['role']             ?? 'teacher',
                    $t['borrowDate']       ?? $t['borrow_date'] ?? null,
                    $t['returnDate']       ?? $t['return_date'] ?? null,
                    $t['condition']        ?? $t['condition_out'] ?? 'Good',
                    $t['status']           ?? 'Borrowed',
                    ($t['actualReturnDate'] ?? $t['actual_return_date'] ?? '') ?: null,
                    $t['returnedCondition'] ?? $t['returned_condition'] ?? '',
                ]);
            }
        }

        // ── Restore users ───────────────────────────────────
        $users = $data['users'] ?? [];
        if (!empty($users) && is_array($users)) {
            $db->exec("DELETE FROM users");
            $ins = $db->prepare("
                INSERT IGNORE INTO users (email, password, original_password, role, name)
                VALUES (?, ?, ?, ?, ?)
            ");
            foreach ($users as $u) {
                $pw   = $u['password'] ?? '123';
                $orig = $u['original_password'] ?? $pw;
                $ins->execute([$u['email'], $pw, $orig, $u['role'] ?? 'teacher', $u['name'] ?? '']);
            }
        }

        // ── Restore borrow requests ─────────────────────────
        $requests = $data['borrowRequests'] ?? $data['borrow_requests'] ?? [];
        if (!empty($requests) && is_array($requests)) {
            $db->exec("DELETE FROM borrow_requests");
            $ins = $db->prepare("
                INSERT IGNORE INTO borrow_requests
                    (request_id, asset_id, asset_name, asset_unit, borrower, role,
                     quantity, borrow_date, return_date, condition_out, status,
                     rejection_reason, transaction_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ");
            foreach ($requests as $r) {
                $ins->execute([
                    $r['requestId']      ?? $r['request_id'] ?? '',
                    $r['assetId']        ?? $r['asset_id']   ?? '',
                    $r['assetName']      ?? $r['asset_name'] ?? '',
                    $r['assetUnit']      ?? $r['asset_unit'] ?? 'piece',
                    $r['borrower']       ?? '',
                    $r['role']           ?? 'teacher',
                    (int)($r['quantity'] ?? 1),
                    $r['borrowDate']     ?? $r['borrow_date'] ?? null,
                    $r['returnDate']     ?? $r['return_date'] ?? null,
                    $r['condition']      ?? $r['condition_out'] ?? 'Good',
                    $r['status']         ?? 'Pending',
                    $r['rejectionReason'] ?? $r['rejection_reason'] ?? '',
                    $r['transactionId']  ?? $r['transaction_id'] ?? '',
                ]);
            }
        }

        // ── Restore categories ──────────────────────────────
        $categories = $data['categories'] ?? [];
        if (!empty($categories) && is_array($categories)) {
            $db->exec("DELETE FROM categories");
            $ins = $db->prepare("INSERT IGNORE INTO categories (name) VALUES (?)");
            foreach ($categories as $c) {
                $name = is_string($c) ? $c : ($c['name'] ?? '');
                if ($name) $ins->execute([$name]);
            }
        }

        // ── Restore locations ───────────────────────────────
        $locations = $data['locations'] ?? [];
        if (!empty($locations) && is_array($locations)) {
            $db->exec("DELETE FROM locations");
            $ins = $db->prepare("INSERT IGNORE INTO locations (name) VALUES (?)");
            foreach ($locations as $l) {
                $name = is_string($l) ? $l : ($l['name'] ?? '');
                if ($name) $ins->execute([$name]);
            }
        }

        // ── Reset counters to safe values ───────────────────
        $assetMax = $db->query("SELECT MAX(CAST(SUBSTRING(id,5) AS UNSIGNED)) FROM assets")->fetchColumn();
        $txnMax   = $db->query("SELECT MAX(CAST(SUBSTRING(id,5) AS UNSIGNED)) FROM transactions")->fetchColumn();
        $reqMax   = $db->query("SELECT MAX(CAST(SUBSTRING(request_id,5) AS UNSIGNED)) FROM borrow_requests")->fetchColumn();
        $db->prepare("INSERT INTO counters (name,value) VALUES ('asset_counter',?) ON DUPLICATE KEY UPDATE value=?")->execute([(int)$assetMax+1,(int)$assetMax+1]);
        $db->prepare("INSERT INTO counters (name,value) VALUES ('transaction_counter',?) ON DUPLICATE KEY UPDATE value=?")->execute([(int)$txnMax+1,(int)$txnMax+1]);
        $db->prepare("INSERT INTO counters (name,value) VALUES ('request_counter',?) ON DUPLICATE KEY UPDATE value=?")->execute([(int)$reqMax+1,(int)$reqMax+1]);

        // ── Safety check: ensure at least one admin exists after restore ──
        $adminCount = $db->query("SELECT COUNT(*) FROM users WHERE role='admin'")->fetchColumn();
        if ((int)$adminCount === 0) {
            $db->rollBack();
            sendJson(['ok' => false, 'error' => 'Restore aborted: the backup contains no admin accounts. The system would be locked out.']);
        }

        $db->commit();
        sendJson([
            'ok'      => true,
            'summary' => [
                'assets'       => count($assets),
                'transactions' => count($transactions),
                'users'        => count($users),
            ]
        ]);
    } catch (Exception $e) {
        $db->rollBack();
        sendJson(['ok' => false, 'error' => 'Restore failed: ' . $e->getMessage()]);
    }
}

sendJson(['ok' => false, 'error' => 'Invalid request.'], 400);
?>
