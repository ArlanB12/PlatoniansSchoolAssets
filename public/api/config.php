<?php
// ============================================================
// Platonian's School Assets — Bootstrap Config (v10)
// ============================================================
// Loaded by every endpoint. Sets up DB credentials, error
// reporting, session cookie params, CORS, and runs schema
// migrations.
//
// Override credentials in config.local.php (gitignored).
// Copy config.local.example.php to start.
// ============================================================

// ── Environment-aware defaults ──────────────────────────────
if (!defined('APP_ENV'))  define('APP_ENV',  'development'); // 'development' | 'production'
if (!defined('DB_HOST'))  define('DB_HOST',  'localhost');
if (!defined('DB_USER'))  define('DB_USER',  'root');
if (!defined('DB_PASS'))  define('DB_PASS',  '');
if (!defined('DB_NAME'))  define('DB_NAME',  'platonians_is');
if (!defined('APP_TZ'))   define('APP_TZ',   'Asia/Manila');

// Pin the timezone so date('Y-m-d') matches the user's local day.
// Without this, a fresh XAMPP on UTC reports "yesterday" at 4am Philippines time,
// which breaks borrow/return date comparisons against client-sent local dates.
date_default_timezone_set(APP_TZ);

$_localConfig = __DIR__ . '/config.local.php';
if (is_file($_localConfig)) {
    require_once $_localConfig;
}

// ── Error reporting ─────────────────────────────────────────
if (APP_ENV === 'production') {
    @ini_set('display_errors',         '0');
    @ini_set('display_startup_errors', '0');
    error_reporting(E_ALL & ~E_NOTICE & ~E_DEPRECATED & ~E_STRICT);
    @ini_set('log_errors', '1');
} else {
    @ini_set('display_errors',         '1');
    @ini_set('display_startup_errors', '1');
    error_reporting(E_ALL);
}

// ── Restrict CORS to same origin only (no wildcard) ─────────
define('ALLOWED_ORIGIN', isset($_SERVER['HTTP_HOST'])
    ? (isset($_SERVER['HTTPS']) ? 'https' : 'http') . '://' . $_SERVER['HTTP_HOST']
    : '');

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
            error_log('[Platonian IS DB] ' . $e->getMessage());
            // 503 Service Unavailable — accurate status so health checks and the
            // frontend's network-failure path both kick in correctly.
            sendJson(['ok' => false, 'error' => 'Database connection failed. Please contact the administrator.'], 503);
        }
    }
    return $pdo;
}

function runMigrations($pdo) {
    $migrations = [
        // password reset tokens
        "ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `reset_token`            VARCHAR(64)  DEFAULT NULL          AFTER `name`",
        "ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `reset_token_expiry`     DATETIME     DEFAULT NULL          AFTER `reset_token`",
        // accountability / overdue override
        "ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `overdue_override`       TINYINT(1)   NOT NULL DEFAULT 0    AFTER `reset_token_expiry`",
        "ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `overdue_override_note`  VARCHAR(255) NOT NULL DEFAULT ''   AFTER `overdue_override`",
        "ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `overdue_override_by`    VARCHAR(255) NOT NULL DEFAULT ''   AFTER `overdue_override_note`",
        // login lockout
        "ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `failed_logins`          TINYINT(1)   NOT NULL DEFAULT 0    AFTER `overdue_override_by`",
        "ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `locked_until`           DATETIME     DEFAULT NULL          AFTER `failed_logins`",
        // forgot password lockout
        "ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `forgot_attempts`        TINYINT(1)   NOT NULL DEFAULT 0    AFTER `locked_until`",
        "ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `forgot_locked_until`    DATETIME     DEFAULT NULL          AFTER `forgot_attempts`",
        // borrower email
        "ALTER TABLE `borrow_requests` ADD COLUMN IF NOT EXISTS `borrower_email` VARCHAR(255) NOT NULL DEFAULT '' AFTER `borrower`",
        "ALTER TABLE `transactions`    ADD COLUMN IF NOT EXISTS `borrower_email` VARCHAR(255) NOT NULL DEFAULT '' AFTER `borrower`",
        // lending policy table
        "CREATE TABLE IF NOT EXISTS `lending_policy` (
            `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
            `policy_key`    VARCHAR(100) NOT NULL UNIQUE,
            `policy_value`  TEXT NOT NULL,
            `label`         VARCHAR(255) NOT NULL DEFAULT '',
            `updated_at`    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "INSERT IGNORE INTO `lending_policy` (`policy_key`,`policy_value`,`label`) VALUES
            ('early_reminder_days','2',    'Early Return Reminder (days before due)'),
            ('max_checkout_qty',   '5',    'Default Max Checkout Quantity'),
            ('late_fee_note',      'Borrower must replace damaged/lost item at cost.', 'Late / Damage Policy Note'),
            ('policy_note',        'All borrowed items must be returned in the same or better condition. Failure to return items on time will result in borrowing privileges being suspended.', 'General Lending Policy')",
        "INSERT IGNORE INTO `counters` (`name`,`value`) VALUES ('notif_counter',1)",
        "INSERT IGNORE INTO `counters` (`name`,`value`) VALUES ('audit_counter',1)",

        // v8.1 Performance indexes
        "ALTER TABLE `transactions`    ADD INDEX IF NOT EXISTS `idx_txn_status`      (`status`)",
        "ALTER TABLE `transactions`    ADD INDEX IF NOT EXISTS `idx_txn_return_date` (`return_date`)",
        "ALTER TABLE `borrow_requests` ADD INDEX IF NOT EXISTS `idx_br_status`       (`status`)",
        "ALTER TABLE `assets`          ADD INDEX IF NOT EXISTS `idx_ast_category`    (`category`)",
        "ALTER TABLE `assets`          ADD INDEX IF NOT EXISTS `idx_ast_status`      (`status`)",
        "ALTER TABLE `notifications`   ADD INDEX IF NOT EXISTS `idx_notif_type`      (`type`)",

        // v10: rate limit table (used by _ratelimit.php for IP-based throttling)
        "CREATE TABLE IF NOT EXISTS `rate_limit` (
            `ip`           VARCHAR(45)   NOT NULL,
            `bucket`       VARCHAR(32)   NOT NULL,
            `count`        INT UNSIGNED  NOT NULL DEFAULT 0,
            `window_start` INT UNSIGNED  NOT NULL DEFAULT 0,
            PRIMARY KEY (`ip`, `bucket`),
            KEY `idx_rl_window` (`window_start`)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

        // v10.2: username column for the primary login identifier.
        // We add it nullable first, backfill below from the email local-part,
        // then promote to NOT NULL + UNIQUE in a follow-up migration block.
        "ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `username` VARCHAR(64) DEFAULT NULL AFTER `id`",

        // ── v10.4 ──────────────────────────────────────────────
        // Widen the role ENUM to accept 'principal'. Existing rows
        // keep their value; this just expands the accepted set.
        "ALTER TABLE `users` MODIFY COLUMN `role` ENUM('admin','custodian','teacher','principal') NOT NULL DEFAULT 'teacher'",
        // Super-account flag — admins/custodians flagged as super can
        // self-recover via the Forgot Password flow.
        "ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `is_super_account` TINYINT(1) NOT NULL DEFAULT 0 AFTER `forgot_locked_until`",

        // ── v10.9 ──────────────────────────────────────────────
        // Force-change-password gate. Set to 1 whenever a user is
        // issued a temporary password (admin reset, super-recovery).
        // Cleared by /auth.php?action=change_password on success.
        "ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `must_change_password` TINYINT(1) NOT NULL DEFAULT 0 AFTER `is_super_account`",
        // Password change log
        "CREATE TABLE IF NOT EXISTS `password_changes` (
            `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
            `user_email`   VARCHAR(255) NOT NULL,
            `changed_by`   VARCHAR(255) NOT NULL,
            `change_type`  ENUM('self','admin_reset','super_recovery') NOT NULL DEFAULT 'self',
            `requester_ip` VARCHAR(45)  NOT NULL DEFAULT '',
            `created_at`   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`),
            INDEX `idx_pc_user`    (`user_email`),
            INDEX `idx_pc_created` (`created_at`)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        // Auto-mark the seeded admin account as a super account, so
        // out-of-the-box recovery works for fresh + upgraded installs.
        "UPDATE `users` SET `is_super_account` = 1 WHERE `email` = 'admin@test.com' AND `is_super_account` = 0",

        // ── v10.3 ──────────────────────────────────────────────
        // Admin-mediated password reset queue. Previously only in
        // schema.sql / migration_v10.3_admin_reset.sql, which meant
        // installs that upgraded the codebase without re-running the
        // SQL hit "Table 'password_reset_requests' doesn't exist"
        // the moment a user submitted a Forgot Password request.
        "CREATE TABLE IF NOT EXISTS `password_reset_requests` (
            `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
            `request_code`   VARCHAR(16)  NOT NULL UNIQUE,
            `user_email`     VARCHAR(255) NOT NULL,
            `user_username`  VARCHAR(64)  NOT NULL,
            `user_name`      VARCHAR(255) NOT NULL,
            `reason`         TEXT         NOT NULL,
            `requester_ip`   VARCHAR(45)  NOT NULL DEFAULT '',
            `status`         ENUM('pending','approved','denied','expired','cancelled') NOT NULL DEFAULT 'pending',
            `created_at`     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
            `resolved_at`    DATETIME     DEFAULT NULL,
            `resolved_by`    VARCHAR(255) DEFAULT NULL,
            `admin_note`     VARCHAR(500) NOT NULL DEFAULT '',
            PRIMARY KEY (`id`),
            INDEX `idx_status_created` (`status`, `created_at`),
            INDEX `idx_user_email`     (`user_email`)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        // Counter for the PRR-##### request codes.
        "INSERT IGNORE INTO `counters` (`name`, `value`) VALUES ('reset_request_counter', 0)",
        // Auto-expire any pending request older than 7 days. Belt-and-
        // braces — auth.php also lazily expires on every list call.
        "UPDATE `password_reset_requests`
            SET `status` = 'expired',
                `resolved_at` = NOW(),
                `admin_note` = 'Auto-expired (>7 days pending)'
          WHERE `status` = 'pending'
            AND `created_at` < (NOW() - INTERVAL 7 DAY)",

        // ── v10.16 ─────────────────────────────────────────────
        // Widen the role ENUM to add 'superadmin' (ICT Coordinator).
        // The four live roles become: superadmin / admin / custodian /
        // teacher. The legacy read-only 'principal' is kept in the ENUM
        // for safe migration, then converted to 'admin' below.
        "ALTER TABLE `users`
            MODIFY COLUMN `role`
            ENUM('superadmin','admin','custodian','teacher','principal')
            NOT NULL DEFAULT 'teacher'",

        // Web Push subscriptions — one row per device/browser per user.
        "CREATE TABLE IF NOT EXISTS `push_subscriptions` (
            `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
            `user_email` VARCHAR(255) NOT NULL,
            `endpoint`   TEXT         NOT NULL,
            `p256dh`     VARCHAR(255) NOT NULL,
            `auth`       VARCHAR(255) NOT NULL,
            `user_agent` VARCHAR(255) NOT NULL DEFAULT '',
            `created_at` TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`),
            UNIQUE KEY `uq_push_endpoint` (`endpoint`(191)),
            KEY `idx_push_user` (`user_email`)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

        // System-wide Activity Log (event trail). Distinct from the
        // physical room-audit logs in `audit_logs`. Viewable by Admin.
        "CREATE TABLE IF NOT EXISTS `activity_log` (
            `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
            `log_id`      VARCHAR(30)  NOT NULL UNIQUE,
            `actor_email` VARCHAR(255) NOT NULL DEFAULT '',
            `actor_role`  VARCHAR(50)  NOT NULL DEFAULT '',
            `actor_name`  VARCHAR(255) NOT NULL DEFAULT '',
            `action`      VARCHAR(50)  NOT NULL DEFAULT '',
            `target`      VARCHAR(255) NOT NULL DEFAULT '',
            `details`     VARCHAR(500) NOT NULL DEFAULT '',
            `ip_address`  VARCHAR(45)  NOT NULL DEFAULT '',
            `created_at`  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`),
            KEY `idx_act_created` (`created_at`),
            KEY `idx_act_action`  (`action`),
            KEY `idx_act_actor`   (`actor_email`)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

        // Counter for ACT-####### activity-log IDs.
        "INSERT IGNORE INTO `counters` (`name`, `value`) VALUES ('activity_counter', 0)",

        // ── ROLE RE-SCOPE (idempotent) ─────────────────────────
        // Per the v10.16 spec:
        //   * The old god-mode 'admin' (ICT-style full control) becomes
        //     'superadmin'. We promote the seeded admin@test.com row.
        //   * The old read-only 'principal' becomes the new 'admin'
        //     (Principal) which gains approve/reject + activity log.
        // Run principal->admin FIRST so the promote-to-superadmin step
        // below only catches the genuine ICT account.
        "UPDATE `users` SET `role` = 'superadmin'
            WHERE `email` = 'admin@test.com' AND `role` = 'admin'",
        "UPDATE `users` SET `role` = 'admin', `is_super_account` = 0
            WHERE `role` = 'principal'",

        // Lending policy: drop the Maximum Borrow Duration setting.
        // Teachers choose their own return date, so this row is dead.
        "DELETE FROM `lending_policy` WHERE `policy_key` = 'max_borrow_days'",

        // Remove the obsolete super-account flag from teachers (never
        // applied) and from the new Principal-admins (read-oversight only).
        "UPDATE `users` SET `is_super_account` = 0 WHERE `role` IN ('teacher','admin')",
        // The ICT superadmin should always be able to self-recover.
        "UPDATE `users` SET `is_super_account` = 1 WHERE `role` = 'superadmin'",

        // ── v10.20: SELF-HEALING SUPERADMIN LOGIN FIX ──────────
        // Root cause of "log in as superadmin -> bounced back to the
        // login page": on databases first built before the role ENUM
        // knew about 'superadmin', MySQL stored an EMPTY STRING for
        // that account's role. An empty role fails every page-permission
        // check on the client, so the user is redirected to index.html.
        //
        // Previously the only fix lived in a hand-run SQL file
        // (migration_v10.17.sql). Folding it into the always-on
        // migration list means a fresh page load repairs the account
        // automatically — no manual SQL step required.
        //
        // 1. Make sure the canonical ICT username/email is a superadmin
        //    even if its role was blanked or downgraded.
        "UPDATE `users`
            SET `role` = 'superadmin'
          WHERE (`username` = 'superadmin' OR `email` = 'superadmin@test.com')
            AND `role` <> 'superadmin'",
        // 2. Any other row left with an empty / NULL role is demoted to
        //    teacher (safe default) so it is never silently locked out.
        "UPDATE `users`
            SET `role` = 'teacher'
          WHERE `role` = '' OR `role` IS NULL",
        // 3. Seed the default ICT Coordinator if it does not exist yet
        //    (covers installs that never ran schema.sql's seed block).
        "INSERT IGNORE INTO `users`
            (`username`, `email`, `password`, `role`, `name`, `is_super_account`)
          VALUES
            ('superadmin', 'superadmin@test.com', '123', 'superadmin', 'ICT Coordinator', 1)",
        // 4. v10.20: spare test accounts you asked for. Plain-text
        //    passwords (auto-upgraded to bcrypt on first login, same as
        //    the other seeds). Username / password:
        //      superadmin2 / admin123   (ICT Coordinator — full control)
        //      admin2      / admin123   (School Principal — approvals)
        "INSERT IGNORE INTO `users`
            (`username`, `email`, `password`, `role`, `name`, `is_super_account`)
          VALUES
            ('superadmin2', 'superadmin2@test.com', 'admin123', 'superadmin', 'ICT Coordinator 2', 1),
            ('admin2',      'admin2@test.com',      'admin123', 'admin',      'School Principal 2', 0)",
        // Make sure they always carry the right role even if a row with
        // that username already existed with a blanked / wrong role.
        "UPDATE `users` SET `role` = 'superadmin', `is_super_account` = 1
          WHERE `username` = 'superadmin2'",
        "UPDATE `users` SET `role` = 'admin'
          WHERE `username` = 'admin2'",
    ];
    foreach ($migrations as $sql) {
        try { $pdo->exec($sql); } catch (PDOException $e) { /* ignore */ }
    }

    // ── v10.2 USERNAME BACKFILL ──────────────────────────────
    // Populate any NULL/empty username rows from the email local-part
    // (the part before '@'). Then enforce UNIQUE + NOT NULL on the column.
    try {
        // 1. Backfill from email local-part for any row missing a username.
        $rows = $pdo->query("SELECT id, email FROM `users` WHERE username IS NULL OR username = ''")->fetchAll();
        $taken = [];
        $existing = $pdo->query("SELECT LOWER(username) AS u FROM `users` WHERE username IS NOT NULL AND username <> ''")->fetchAll();
        foreach ($existing as $r) $taken[$r['u']] = true;

        $upd = $pdo->prepare("UPDATE `users` SET `username` = ? WHERE `id` = ?");
        foreach ($rows as $r) {
            $base = strtolower(trim(explode('@', (string)$r['email'])[0]));
            if ($base === '') $base = 'user' . (int)$r['id'];
            $candidate = $base;
            $n = 1;
            while (isset($taken[$candidate])) {
                $n++;
                $candidate = $base . $n;
            }
            $taken[$candidate] = true;
            $upd->execute([$candidate, $r['id']]);
        }

        // 2. Promote to UNIQUE + NOT NULL once every row has a value.
        try { $pdo->exec("ALTER TABLE `users` MODIFY COLUMN `username` VARCHAR(64) NOT NULL"); } catch (PDOException $e) {}
        try { $pdo->exec("ALTER TABLE `users` ADD UNIQUE KEY `uq_users_username` (`username`)"); } catch (PDOException $e) {}
    } catch (PDOException $e) { /* non-critical */ }

    // Self-healing seed — plain passwords kept for dev/demo accounts
    try {
        $count = $pdo->query("SELECT COUNT(*) FROM `users`")->fetchColumn();
        if ((int)$count === 0) {
            // v10.16 four-role lineup:
            //   superadmin = ICT Coordinator (technical / maintenance / PW resets)
            //   admin      = School Principal (analytics, audit log, approve/reject)
            //   custodian  = Property Custodian (main operator)
            //   teacher    = Teacher (borrow / return / view)
            $pdo->exec("INSERT IGNORE INTO `users` (username, email, password, role, name, is_super_account) VALUES
                ('superadmin', 'superadmin@test.com', '123','superadmin','ICT Coordinator',    1),
                ('admin',      'admin@test.com',      '123','admin',     'School Principal',    0),
                ('custodian',  'custodian@test.com',  '123','custodian', 'Property Custodian',  0),
                ('teacher',    'teacher@test.com',    '123','teacher',   'Teacher',             0)");
        }
    } catch (PDOException $e) {}
}

function sendJson($data, $code = 200) {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');

    // Same-origin CORS only — no wildcard
    $origin = ALLOWED_ORIGIN;
    if ($origin) {
        header('Access-Control-Allow-Origin: ' . $origin);
    }
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-CSRF-Token');
    if ($origin) header('Access-Control-Allow-Credentials: true');

    echo json_encode($data);
    exit;
}

function getBody() {
    $raw = file_get_contents('php://input');
    if (!$raw) return [];
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

/**
 * Atomically increment a named counter and return the new value.
 * Uses MySQL LAST_INSERT_ID trick — no separate SELECT needed,
 * safe under concurrent requests.
 */
function nextCounter($name) {
    $db = getDB();
    $db->prepare(
        "INSERT INTO counters (name, value) VALUES (?, 1)
         ON DUPLICATE KEY UPDATE value = LAST_INSERT_ID(value) + 1"
    )->execute([$name]);
    return (int)$db->lastInsertId();
}

function toPaddedId($prefix, $num) {
    return $prefix . str_pad($num, 4, '0', STR_PAD_LEFT);
}

// v10.16: shared Web Push (VAPID) + Activity Log helpers.
// Provides notifyUser() / notifyStaff() / logActivity() to every endpoint.
require_once __DIR__ . '/_push.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}
?>
