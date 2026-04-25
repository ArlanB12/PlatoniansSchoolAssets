-- ============================================================
-- Platonian's School Assets — MySQL Database (v8)
-- ============================================================

CREATE DATABASE IF NOT EXISTS `platonians_is`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;
USE `platonians_is`;

-- ── users ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `users` (
  `id`                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email`                VARCHAR(255) NOT NULL UNIQUE,
  `password`             VARCHAR(255) NOT NULL,
  `original_password`    VARCHAR(255) NOT NULL DEFAULT '',
  `role`                 ENUM('admin','custodian','teacher') NOT NULL DEFAULT 'teacher',
  `name`                 VARCHAR(255) NOT NULL,
  `reset_token`          VARCHAR(64)  DEFAULT NULL,
  `reset_token_expiry`   DATETIME     DEFAULT NULL,
  `overdue_override`     TINYINT(1)   NOT NULL DEFAULT 0,
  `overdue_override_note` VARCHAR(255) NOT NULL DEFAULT '',
  `overdue_override_by`  VARCHAR(255) NOT NULL DEFAULT '',
  `failed_logins`        TINYINT(1)   NOT NULL DEFAULT 0,
  `locked_until`         DATETIME     DEFAULT NULL,
  `forgot_attempts`      TINYINT(1)   NOT NULL DEFAULT 0,
  `forgot_locked_until`  DATETIME     DEFAULT NULL,
  `created_at`           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── categories ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `categories` (
  `id`   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL UNIQUE,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── locations ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `locations` (
  `id`   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL UNIQUE,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── assets ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `assets` (
  `id`               VARCHAR(20)   NOT NULL,
  `name`             VARCHAR(255)  NOT NULL,
  `category`         VARCHAR(100)  NOT NULL DEFAULT '',
  `quantity`         INT UNSIGNED  NOT NULL DEFAULT 0,
  `unit`             VARCHAR(50)   NOT NULL DEFAULT 'piece',
  `max_checkout_qty` INT UNSIGNED  NOT NULL DEFAULT 0,
  `condition`        VARCHAR(50)   NOT NULL DEFAULT 'Good',
  `unit_cost`        DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `location`         VARCHAR(100)  NOT NULL DEFAULT '',
  `status`           VARCHAR(50)   NOT NULL DEFAULT 'Available',
  `date_added`       DATE,
  `receipt_file`     VARCHAR(255)  NOT NULL DEFAULT '',
  `is_bulk`          TINYINT(1)    NOT NULL DEFAULT 0,
  `bulk_id`          VARCHAR(30)   NOT NULL DEFAULT '',
  `created_at`       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── transactions ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `transactions` (
  `id`                 VARCHAR(20)  NOT NULL,
  `asset_id`           VARCHAR(20)  NOT NULL,
  `asset_name`         VARCHAR(255) NOT NULL DEFAULT '',
  `asset_unit`         VARCHAR(50)  NOT NULL DEFAULT 'piece',
  `quantity`           INT UNSIGNED NOT NULL DEFAULT 1,
  `borrower`           VARCHAR(255) NOT NULL DEFAULT '',
  `borrower_email`     VARCHAR(255) NOT NULL DEFAULT '',
  `role`               VARCHAR(50)  NOT NULL DEFAULT 'teacher',
  `borrow_date`        DATE,
  `return_date`        DATE,
  `condition_out`      VARCHAR(50)  NOT NULL DEFAULT 'Good',
  `status`             VARCHAR(20)  NOT NULL DEFAULT 'Borrowed',
  `actual_return_date` DATE,
  `returned_condition` VARCHAR(50)  NOT NULL DEFAULT '',
  `created_at`         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── borrow_requests ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `borrow_requests` (
  `id`               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `request_id`       VARCHAR(20)  NOT NULL UNIQUE,
  `asset_id`         VARCHAR(20)  NOT NULL DEFAULT '',
  `asset_name`       VARCHAR(255) NOT NULL DEFAULT '',
  `asset_unit`       VARCHAR(50)  NOT NULL DEFAULT 'piece',
  `borrower`         VARCHAR(255) NOT NULL DEFAULT '',
  `borrower_email`   VARCHAR(255) NOT NULL DEFAULT '',
  `role`             VARCHAR(50)  NOT NULL DEFAULT 'teacher',
  `quantity`         INT UNSIGNED NOT NULL DEFAULT 1,
  `borrow_date`      DATE,
  `return_date`      DATE,
  `condition_out`    VARCHAR(50)  NOT NULL DEFAULT 'Good',
  `status`           ENUM('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
  `rejection_reason` TEXT,
  `transaction_id`   VARCHAR(20)  NOT NULL DEFAULT '',
  `requested_at`     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── audit_logs ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id`                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `log_id`             VARCHAR(30)  NOT NULL UNIQUE,
  `location`           VARCHAR(100) NOT NULL DEFAULT '',
  `audited_on`         DATE,
  `audited_by`         VARCHAR(255) NOT NULL DEFAULT '',
  `auditor_role`       VARCHAR(50)  NOT NULL DEFAULT '',
  `expected_units`     INT UNSIGNED NOT NULL DEFAULT 0,
  `found_units`        INT UNSIGNED NOT NULL DEFAULT 0,
  `missing_units`      INT UNSIGNED NOT NULL DEFAULT 0,
  `needs_repair_units` INT UNSIGNED NOT NULL DEFAULT 0,
  `variance`           INT          NOT NULL DEFAULT 0,
  `items_json`         TEXT,
  `created_at`         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── notifications ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `notifications` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `notif_id`   VARCHAR(30)  NOT NULL UNIQUE,
  `user_email` VARCHAR(255) NOT NULL,
  `type`       VARCHAR(50)  NOT NULL DEFAULT 'info',
  `title`      VARCHAR(255) NOT NULL DEFAULT '',
  `message`    TEXT,
  `link`       VARCHAR(255) NOT NULL DEFAULT '',
  `is_read`    TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_read` (`user_email`, `is_read`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── lending_policy ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `lending_policy` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `policy_key`   VARCHAR(100) NOT NULL UNIQUE,
  `policy_value` TEXT         NOT NULL,
  `label`        VARCHAR(255) NOT NULL DEFAULT '',
  `updated_at`   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── counters ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `counters` (
  `name`  VARCHAR(50) NOT NULL,
  `value` INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── SEED: Default accounts ─────────────────────────────────
INSERT IGNORE INTO `users` (`email`,`password`,`original_password`,`role`,`name`) VALUES
  ('admin@test.com',     '123','123','admin',     'Administrator'),
  ('custodian@test.com', '123','123','custodian', 'Property Custodian'),
  ('teacher@test.com',   '123','123','teacher',   'Teacher');

-- ── SEED: Default categories ──────────────────────────────
INSERT IGNORE INTO `categories` (`name`) VALUES
  ('Audio'),('Consumables'),('Electronics'),('Furniture'),('Office Equipment'),('Sports Equipment'),('Tools');

-- ── SEED: Default locations ───────────────────────────────
INSERT IGNORE INTO `locations` (`name`) VALUES
  ('Admin Office'),('Audio Room'),('AV Room'),('Faculty Room'),('ICT Room'),('Library'),('Supply Room');

-- ── SEED: Counters ────────────────────────────────────────
INSERT IGNORE INTO `counters` (`name`,`value`) VALUES
  ('asset_counter',1),('transaction_counter',1),('request_counter',1),
  ('bulk_counter',1),('notif_counter',1);

-- ── SEED: Lending Policy defaults ────────────────────────
INSERT IGNORE INTO `lending_policy` (`policy_key`,`policy_value`,`label`) VALUES
  ('max_borrow_days',    '7',    'Maximum Borrow Duration (days)'),
  ('early_reminder_days','2',    'Early Return Reminder (days before due)'),
  ('max_checkout_qty',   '5',    'Default Max Checkout Quantity'),
  ('late_fee_note',      'Borrower must replace damaged or lost items at cost.', 'Late / Damage Policy Note'),
  ('policy_note',        'All borrowed items must be returned in the same or better condition. Failure to return items on time will result in borrowing privileges being suspended and may be escalated to the school administration.', 'General Lending Policy');
