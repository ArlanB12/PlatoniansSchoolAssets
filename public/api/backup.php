<?php
require_once 'config.php';
require_once '_session.php';

guard_request_csrf();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

if ($method === 'POST' && $action === 'restore') {
    require_auth(['superadmin']);
    $data = getBody();
    $db   = getDB();

    try {
        $db->beginTransaction();

        // ── Restore assets ──────────────────────────────────
        $assets = $data['assets'] ?? [];
        if (!empty($assets) && is_array($assets)) {
            $db->exec("DELETE FROM assets");
            $ins = $db->prepare("
                INSERT IGNORE INTO assets
                    (id, name, description, category, quantity, unit, max_checkout_qty, `condition`,
                     unit_cost, location, status, date_added, receipt_file, receipt_files, is_bulk, bulk_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ");
            foreach ($assets as $a) {
                // FIX: explicit null-coalesce before empty() to handle both key names
                $isBulkVal = $a['isBulk'] ?? $a['is_bulk'] ?? false;
                // v10.22 — normalize the attachment list. Accept either an
                // array (receiptFiles) or fall back to the single field.
                $rfList = $a['receiptFiles'] ?? $a['receipt_files'] ?? null;
                if (is_string($rfList)) { $decoded = json_decode($rfList, true); $rfList = is_array($decoded) ? $decoded : null; }
                if (!is_array($rfList)) {
                    $single = $a['receiptFile'] ?? $a['receipt_file'] ?? '';
                    $rfList = $single !== '' ? [$single] : [];
                }
                $rfList   = array_values(array_filter(array_map('strval', $rfList)));
                $firstRf  = $rfList[0] ?? ($a['receiptFile'] ?? $a['receipt_file'] ?? '');
                $ins->execute([
                    $a['id']        ?? '',
                    $a['name']      ?? '',
                    $a['description'] ?? '',
                    $a['category']  ?? '',
                    (int)($a['quantity'] ?? 0),
                    $a['unit']      ?? 'piece',
                    (int)($a['maxCheckoutQty'] ?? $a['max_checkout_qty'] ?? 0),
                    $a['condition'] ?? 'Good',
                    (float)($a['unitCost'] ?? $a['unit_cost'] ?? 0),
                    $a['location']  ?? '',
                    $a['status']    ?? 'Available',
                    $a['dateAdded'] ?? $a['date_added'] ?? date('Y-m-d'),
                    $firstRf,
                    json_encode($rfList),
                    !empty($isBulkVal) ? 1 : 0,
                    $a['bulkId']    ?? $a['bulk_id'] ?? '',
                ]);
            }
        }

        // ── Restore transactions ────────────────────────────
        $transactions = $data['transactions'] ?? [];
        if (!empty($transactions) && is_array($transactions)) {
            $db->exec("DELETE FROM transactions");
            // borrower_email was previously dropped on restore — every
            // restored transaction had an empty email, breaking borrower
            // notifications going forward.
            $ins = $db->prepare("
                INSERT INTO transactions
                    (id, asset_id, asset_name, asset_unit, quantity, borrower, borrower_email, role,
                     borrow_date, return_date, condition_out, status,
                     actual_return_date, returned_condition)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ");
            foreach ($transactions as $t) {
                $ins->execute([
                    $t['id']                ?? '',
                    $t['assetId']           ?? $t['asset_id']   ?? '',
                    $t['assetName']         ?? $t['asset_name'] ?? '',
                    $t['assetUnit']         ?? $t['asset_unit'] ?? 'piece',
                    (int)($t['quantity']    ?? 1),
                    $t['borrower']          ?? '',
                    $t['borrowerEmail']     ?? $t['borrower_email'] ?? '',
                    $t['role']              ?? 'teacher',
                    $t['borrowDate']        ?? $t['borrow_date'] ?? null,
                    $t['returnDate']        ?? $t['return_date'] ?? null,
                    $t['condition']         ?? $t['condition_out'] ?? 'Good',
                    $t['status']            ?? 'Borrowed',
                    ($t['actualReturnDate'] ?? $t['actual_return_date'] ?? '') ?: null,
                    $t['returnedCondition'] ?? $t['returned_condition'] ?? '',
                ]);
            }
        }

        // ── Restore users (no original_password) ────────────
        $users = $data['users'] ?? [];
        if (!empty($users) && is_array($users)) {
            $db->exec("DELETE FROM users");
            $ins = $db->prepare(
                "INSERT IGNORE INTO users (email, password, role, name) VALUES (?, ?, ?, ?)"
            );
            foreach ($users as $u) {
                $pw = $u['password'] ?? '123';
                // If restoring a legacy backup that stored plain text, hash it now
                if (strlen($pw) < 60 || $pw[0] !== '$') {
                    $pw = password_hash($pw, PASSWORD_BCRYPT);
                }
                $ins->execute([$u['email'] ?? '', $pw, $u['role'] ?? 'teacher', $u['name'] ?? '']);
            }
        }

        // ── Restore borrow requests ─────────────────────────
        $requests = $data['borrowRequests'] ?? $data['borrow_requests'] ?? [];
        if (!empty($requests) && is_array($requests)) {
            $db->exec("DELETE FROM borrow_requests");
            $ins = $db->prepare("
                INSERT INTO borrow_requests
                    (request_id, asset_id, asset_name, asset_unit, borrower, borrower_email, role,
                     quantity, borrow_date, return_date, condition_out, status,
                     rejection_reason, transaction_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ");
            foreach ($requests as $r) {
                $ins->execute([
                    $r['requestId']       ?? $r['request_id'] ?? '',
                    $r['assetId']         ?? $r['asset_id']   ?? '',
                    $r['assetName']       ?? $r['asset_name'] ?? '',
                    $r['assetUnit']       ?? $r['asset_unit'] ?? 'piece',
                    $r['borrower']        ?? '',
                    $r['borrowerEmail']   ?? $r['borrower_email'] ?? '',
                    $r['role']            ?? 'teacher',
                    (int)($r['quantity']  ?? 1),
                    $r['borrowDate']      ?? $r['borrow_date'] ?? null,
                    $r['returnDate']      ?? $r['return_date'] ?? null,
                    $r['condition']       ?? $r['condition_out'] ?? 'Good',
                    $r['status']          ?? 'Pending',
                    $r['rejectionReason'] ?? $r['rejection_reason'] ?? '',
                    $r['transactionId']   ?? $r['transaction_id'] ?? '',
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

        // ── Reset counters ──────────────────────────────────
        // GREATEST guards against accidentally rolling counters BACKWARDS
        // when restoring a small/old backup onto a larger active DB —
        // without it the next insert would collide on a still-existing ID.
        $assetMax = (int)$db->query("SELECT MAX(CAST(SUBSTRING(id,5) AS UNSIGNED)) FROM assets")->fetchColumn();
        $txnMax   = (int)$db->query("SELECT MAX(CAST(SUBSTRING(id,5) AS UNSIGNED)) FROM transactions")->fetchColumn();
        $reqMax   = (int)$db->query("SELECT MAX(CAST(SUBSTRING(request_id,5) AS UNSIGNED)) FROM borrow_requests")->fetchColumn();
        $db->prepare("INSERT INTO counters (name,value) VALUES ('asset_counter',?)       ON DUPLICATE KEY UPDATE value=GREATEST(value,?)")->execute([$assetMax+1, $assetMax+1]);
        $db->prepare("INSERT INTO counters (name,value) VALUES ('transaction_counter',?) ON DUPLICATE KEY UPDATE value=GREATEST(value,?)")->execute([$txnMax+1,   $txnMax+1]);
        $db->prepare("INSERT INTO counters (name,value) VALUES ('request_counter',?)     ON DUPLICATE KEY UPDATE value=GREATEST(value,?)")->execute([$reqMax+1,   $reqMax+1]);

        // ── Safety: must have at least one admin ────────────
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
        // Log the real exception for the admin, return a generic message
        // to the client so internal DB structure isn't leaked.
        error_log('[Platonian IS Restore] ' . $e->getMessage());
        sendJson(['ok' => false, 'error' => 'Restore failed. The backup file may be corrupt or incompatible. Check the server error log.']);
    }
}

sendJson(['ok' => false, 'error' => 'Invalid request.'], 400);
?>
