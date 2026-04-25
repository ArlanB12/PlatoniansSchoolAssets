<?php
// ============================================================
// Platonian's School Assets — Database Configuration (v8)
// ============================================================

define('DB_HOST', 'localhost');
define('DB_USER', 'root');
define('DB_PASS', '');
define('DB_NAME', 'platonians_is');

@ini_set('post_max_size',       '64M');
@ini_set('memory_limit',        '128M');
@ini_set('max_execution_time',  '120');

function getDB() {
    static $pdo = null;
    if ($pdo === null) {
        try {
            $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4';
            $pdo = new PDO($dsn, DB_USER, DB_PASS, [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
            ]);
            runMigrations($pdo);
        } catch (PDOException $e) {
            sendJson(['ok' => false, 'error' => 'Database connection failed. Make sure XAMPP MySQL is running.']);
        }
    }
    return $pdo;
}

function runMigrations($pdo) {
    $migrations = [
        // password reset tokens
        "ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `reset_token`            VARCHAR(64)  DEFAULT NULL          AFTER `name`",
        "ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `reset_token_expiry`     DATETIME     DEFAULT NULL          AFTER `reset_token`",
        "ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `original_password`      VARCHAR(255) NOT NULL DEFAULT ''   AFTER `password`",
        // accountability / overdue override
        "ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `overdue_override`       TINYINT(1)   NOT NULL DEFAULT 0    AFTER `reset_token_expiry`",
        "ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `overdue_override_note`  VARCHAR(255) NOT NULL DEFAULT ''   AFTER `overdue_override`",
        "ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `overdue_override_by`    VARCHAR(255) NOT NULL DEFAULT ''   AFTER `overdue_override_note`",
        // v8: login lockout after failed attempts
        "ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `failed_logins`          TINYINT(1)   NOT NULL DEFAULT 0    AFTER `overdue_override_by`",
        "ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `locked_until`           DATETIME     DEFAULT NULL          AFTER `failed_logins`",
        // v8: forgot password failed attempts
        "ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `forgot_attempts`        TINYINT(1)   NOT NULL DEFAULT 0    AFTER `locked_until`",
        "ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `forgot_locked_until`    DATETIME     DEFAULT NULL          AFTER `forgot_attempts`",
        // borrower email on requests/transactions
        "ALTER TABLE `borrow_requests` ADD COLUMN IF NOT EXISTS `borrower_email` VARCHAR(255) NOT NULL DEFAULT '' AFTER `borrower`",
        "ALTER TABLE `transactions`    ADD COLUMN IF NOT EXISTS `borrower_email` VARCHAR(255) NOT NULL DEFAULT '' AFTER `borrower`",
        // v8: lending policy table
        "CREATE TABLE IF NOT EXISTS `lending_policy` (
            `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
            `policy_key`    VARCHAR(100) NOT NULL UNIQUE,
            `policy_value`  TEXT NOT NULL,
            `label`         VARCHAR(255) NOT NULL DEFAULT '',
            `updated_at`    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        // v8: early reminder days setting
        "INSERT IGNORE INTO `lending_policy` (`policy_key`,`policy_value`,`label`) VALUES
            ('max_borrow_days',    '7',    'Maximum Borrow Duration (days)'),
            ('early_reminder_days','2',    'Early Return Reminder (days before due)'),
            ('max_checkout_qty',   '5',    'Default Max Checkout Quantity'),
            ('late_fee_note',      'Borrower must replace damaged/lost item at cost.', 'Late / Damage Policy Note'),
            ('policy_note',        'All borrowed items must be returned in the same or better condition. Failure to return items on time will result in borrowing privileges being suspended.', 'General Lending Policy')",
        // counters
        "INSERT IGNORE INTO `counters` (`name`,`value`) VALUES ('notif_counter',1)",
    ];
    foreach ($migrations as $sql) {
        try { $pdo->exec($sql); } catch (PDOException $e) { /* ignore */ }
    }

    // Self-healing seed
    try {
        $count = $pdo->query("SELECT COUNT(*) FROM `users`")->fetchColumn();
        if ((int)$count === 0) {
            $pdo->exec("INSERT IGNORE INTO `users` (email, password, original_password, role, name) VALUES
                ('admin@test.com',     '123','123','admin',     'Administrator'),
                ('custodian@test.com', '123','123','custodian', 'Property Custodian'),
                ('teacher@test.com',   '123','123','teacher',   'Teacher')");
        }
    } catch (PDOException $e) {}
}

function sendJson($data, $code = 200) {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    echo json_encode($data);
    exit;
}

function getBody() {
    $raw = file_get_contents('php://input');
    if (!$raw) return [];
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

function nextCounter($name) {
    $db = getDB();
    $db->prepare("INSERT IGNORE INTO counters (name, value) VALUES (?, 1)")->execute([$name]);
    $db->prepare("UPDATE counters SET value = value + 1 WHERE name = ?")->execute([$name]);
    $stmt = $db->prepare("SELECT value FROM counters WHERE name = ?");
    $stmt->execute([$name]);
    return (int)($stmt->fetchColumn() ?? 1);
}

function toPaddedId($prefix, $num) {
    return $prefix . str_pad($num, 4, '0', STR_PAD_LEFT);
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}
?>
