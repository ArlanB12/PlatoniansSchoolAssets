-- ============================================================
-- Platonian's School Assets - COMPLETE INSTALL (schema + sample data)
-- ============================================================
-- One-shot installer for a fresh machine. Creates the database,
-- all tables, default accounts, AND a realistic starting
-- inventory in a single import.
--
-- Import via MySQL CLI:
--   mysql -u root -p < install.sql
--
-- Or in phpMyAdmin: Import this file (no database needs to exist
-- yet; it is created automatically).
--
-- Default login accounts (CHANGE AFTER FIRST LOGIN):
--   ICT Coordinator (Super Admin)  superadmin@test.com / 123
--   School Principal (Admin)       admin@test.com      / 123
--   Property Custodian             custodian@test.com  / 123
--   Teacher                        teacher@test.com    / 123
--
-- Idempotent: safe to re-run (uses CREATE ... IF NOT EXISTS and
-- INSERT IGNORE throughout). Re-running will not duplicate data.
-- ============================================================

CREATE DATABASE IF NOT EXISTS `platonians_is`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;
USE `platonians_is`;

-- ── users ────────────────────────────────────────────────────
-- v10.2 note:
--   * `username` is the new primary login identifier (shown on the
--     login screen). `email` is kept for internal references
--     (borrower_email, notifications, audit trails) and remains UNIQUE.
--   * For legacy rows, an idempotent migration in config.php
--     auto-populates username from the local-part of email.
CREATE TABLE IF NOT EXISTS `users` (
  `id`                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username`             VARCHAR(64)  NOT NULL UNIQUE,
  `email`                VARCHAR(255) NOT NULL UNIQUE,
  `password`             VARCHAR(255) NOT NULL,
  `role`                 ENUM('superadmin','admin','custodian','teacher','principal') NOT NULL DEFAULT 'teacher',
  `name`                 VARCHAR(255) NOT NULL,
  `reset_token`          VARCHAR(64)  DEFAULT NULL,
  `reset_token_expiry`   DATETIME     DEFAULT NULL,
  `overdue_override`     TINYINT(1)   NOT NULL DEFAULT 0,
  `overdue_override_note` VARCHAR(255) NOT NULL DEFAULT '',
  `overdue_override_by`  VARCHAR(255) NOT NULL DEFAULT '',
  `failed_logins`        TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `locked_until`         DATETIME     DEFAULT NULL,
  `forgot_attempts`      TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `forgot_locked_until`  DATETIME     DEFAULT NULL,
  `is_super_account`     TINYINT(1)   NOT NULL DEFAULT 0,   -- v10.4: admins/custodians flagged as super can self-recover
  `must_change_password` TINYINT(1)   NOT NULL DEFAULT 0,   -- v10.9: set when issued a temp password; cleared on first self-set
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
  `description`      TEXT          NULL,
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
  `receipt_files`    TEXT          NOT NULL DEFAULT ('[]'),
  `is_bulk`          TINYINT(1)    NOT NULL DEFAULT 0,
  `bulk_id`          VARCHAR(30)   NOT NULL DEFAULT '',
  `created_at`       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ast_category` (`category`),
  KEY `idx_ast_status`   (`status`)
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
  PRIMARY KEY (`id`),
  KEY `idx_txn_status`      (`status`),
  KEY `idx_txn_return_date` (`return_date`)
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
  PRIMARY KEY (`id`),
  KEY `idx_br_status` (`status`)
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
  KEY `idx_user_read`  (`user_email`, `is_read`),
  KEY `idx_notif_type` (`type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── push_subscriptions (v10.16) ──────────────────────────────
-- Web Push (VAPID) device subscriptions — one row per browser/device
-- per user. Drives real OS-level push notifications.
CREATE TABLE IF NOT EXISTS `push_subscriptions` (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── activity_log (v10.16) ────────────────────────────────────
-- System-wide event trail (who did what, when). Distinct from the
-- physical room-audit logs in `audit_logs`. Viewable by the Admin
-- (School Principal) for oversight.
CREATE TABLE IF NOT EXISTS `activity_log` (
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
  `name`  VARCHAR(50)  NOT NULL,
  `value` INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── password_reset_requests (v10.3) ──────────────────────────
-- Admin-mediated reset: users submit a request, admin approves
-- in person after verifying the requester's identity.
-- Replaces the v10.2 self-service "username + full name" flow.
CREATE TABLE IF NOT EXISTS `password_reset_requests` (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── password_changes (v10.4) ─────────────────────────────────
-- Records every password change (self, admin-reset, super-recovery).
-- Visible to admins for audit; used in the policy page log feed.
CREATE TABLE IF NOT EXISTS `password_changes` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_email`   VARCHAR(255) NOT NULL,
  `changed_by`   VARCHAR(255) NOT NULL,
  `change_type`  ENUM('self','admin_reset','super_recovery') NOT NULL DEFAULT 'self',
  `requester_ip` VARCHAR(45)  NOT NULL DEFAULT '',
  `created_at`   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_pc_user`    (`user_email`),
  INDEX `idx_pc_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── SEED: Default accounts (plain passwords for dev/demo) ─────
-- In production, change these immediately after first login.
-- v10.16 four-role model:
--   superadmin = ICT Coordinator (technical / maintenance / password resets)
--   admin      = School Principal (analytics, activity log, approve/reject)
--   custodian  = Property Custodian (main operator)
--   teacher    = Teacher (borrow / return / view)
-- The ICT superadmin is flagged as a super account so it can self-recover
-- via Forgot Password when no second technical admin is available.
INSERT IGNORE INTO `users` (`username`,`email`,`password`,`role`,`name`,`is_super_account`) VALUES
  ('superadmin', 'superadmin@test.com', '123','superadmin','ICT Coordinator',    1),
  ('admin',      'admin@test.com',      '123','admin',     'School Principal',   0),
  ('custodian',  'custodian@test.com',  '123','custodian', 'Property Custodian', 0),
  ('teacher',    'teacher@test.com',    '123','teacher',   'Teacher',            0),
  -- v10.20: spare test accounts (username / password):
  --   superadmin2 / admin123  (ICT Coordinator — full control)
  --   admin2      / admin123  (School Principal — approvals)
  ('superadmin2','superadmin2@test.com','admin123','superadmin','ICT Coordinator 2',  1),
  ('admin2',     'admin2@test.com',     'admin123','admin',     'School Principal 2', 0);

-- ── SEED: Default categories ──────────────────────────────
INSERT IGNORE INTO `categories` (`name`) VALUES
  ('Audio'),('Consumables'),('Electronics'),('Furniture'),('Office Equipment'),('Sports Equipment'),('Tools');

-- ── SEED: Default locations ───────────────────────────────
INSERT IGNORE INTO `locations` (`name`) VALUES
  ('Admin Office'),('Audio Room'),('AV Room'),('Faculty Room'),('ICT Room'),('Library'),('Supply Room');

-- ── SEED: Counters ────────────────────────────────────────
INSERT IGNORE INTO `counters` (`name`,`value`) VALUES
  ('asset_counter',1),('transaction_counter',1),('request_counter',1),
  ('bulk_counter',1),('notif_counter',1),('reset_request_counter',1),
  ('audit_counter',1),('activity_counter',0);

-- ── SEED: Lending Policy defaults ────────────────────────
-- v10.16: 'max_borrow_days' removed — teachers choose their own
-- return date, so a system-wide maximum is no longer enforced.
INSERT IGNORE INTO `lending_policy` (`policy_key`,`policy_value`,`label`) VALUES
  ('early_reminder_days','2',    'Early Return Reminder (days before due)'),
  ('max_checkout_qty',   '5',    'Default Max Checkout Quantity'),
  ('late_fee_note',      'Borrower must replace damaged or lost items at cost.', 'Late / Damage Policy Note'),
  ('policy_note',        'All borrowed items must be returned in the same or better condition. Failure to return items on time will result in borrowing privileges being suspended and may be escalated to the school administration.', 'General Lending Policy');


-- ============================================================
-- SAMPLE INVENTORY DATA
-- ============================================================

-- Extra categories used by the seed data ----------------------
INSERT IGNORE INTO `categories` (`name`) VALUES ('Laboratory'),('Books & Modules');

-- Extra storage locations (rooms) -----------------------------
INSERT IGNORE INTO `locations` (`name`) VALUES
  ('Computer Laboratory'),
  ('Science Laboratory'),
  ('Principal Office'),
  ('Stock Room'),
  ('Clinic'),
  ('Guidance Office'),
  ('Home Economics Room'),
  ('TLE Workshop'),
  ('Grade 7 - Mabini'),
  ('Grade 8 - Rizal'),
  ('Grade 9 - Bonifacio'),
  ('Grade 10 - Del Pilar'),
  ('Covered Court');

-- Assets ------------------------------------------------------
INSERT IGNORE INTO `assets`
  (`id`,`name`,`description`,`category`,`quantity`,`unit`,`max_checkout_qty`,`condition`,`unit_cost`,`location`,`status`,`date_added`,`receipt_files`,`is_bulk`,`bulk_id`)
VALUES
  ('AST-0001','Acer TravelMate B3 Laptop','DepEd Computerization Program unit. Intel Celeron N4500 dual-core, 4GB DDR4 RAM, 128GB eMMC storage, 11.6-inch HD display, Windows 11 Pro Education, rugged classroom chassis. Serial tag: DCP-TM-001.','Electronics',1,'unit',1,'Good',24999.00,'Computer Laboratory','Available','2024-06-15','[]',0,''),
  ('AST-0002','Acer Aspire 3 Laptop','Faculty workstation. AMD Ryzen 5 7520U quad-core, 8GB LPDDR5 RAM, 512GB NVMe SSD, 15.6-inch Full HD IPS display, Windows 11 Home. Assigned to faculty room for grade encoding and SF preparation.','Electronics',1,'unit',1,'Excellent',32995.00,'Faculty Room','In Use','2024-06-15','[]',0,''),
  ('AST-0003','Lenovo V14 G4 Laptop','Registrar / administrative unit. Intel Core i3-1315U, 8GB DDR4 RAM, 256GB SSD, 14-inch FHD display, Windows 11 Pro. Used for records management and reporting.','Electronics',1,'unit',1,'Good',28499.00,'Principal Office','In Use','2024-06-15','[]',0,''),
  ('AST-0004','ASUS Vivobook 15 Laptop','ICT coordinator unit for system maintenance and troubleshooting. Intel Core i5-1235U 10-core, 16GB DDR4 RAM, 512GB NVMe SSD, 15.6-inch FHD display, dedicated for backups and admin tasks, Windows 11 Pro.','Electronics',1,'unit',1,'Excellent',41995.00,'ICT Room','In Use','2024-06-15','[]',0,''),
  ('AST-0005','HP 245 G9 Laptop','Spare loaner laptop kept in stock for teacher checkout during examinations. AMD Athlon Silver 7120U, 8GB RAM, 256GB SSD, 14-inch HD display, Windows 11 Home.','Electronics',1,'unit',1,'Fair',22999.00,'Stock Room','Available','2024-06-15','[]',0,''),
  ('AST-0006','Acer TravelMate B3 Laptop','Second DCP unit, identical batch. Intel Celeron N4500, 4GB RAM, 128GB eMMC, 11.6-inch HD, Windows 11 Pro Education. Currently flagged for keyboard repair. Serial tag: DCP-TM-002.','Electronics',1,'unit',1,'Needs Repair',24999.00,'ICT Room','Under Repair','2024-06-15','[]',0,''),
  ('AST-0007','Dell OptiPlex 3000 Desktop','Computer laboratory workstation, bulk procurement of 20 units. Intel Core i3-12100, 8GB DDR4, 256GB SSD, paired with 19-inch LED monitor. Used for ICT and Empowerment Technologies classes.','Electronics',20,'unit',1,'Good',27500.00,'Computer Laboratory','Available','2024-06-15','[]',1,'BLK-2024-001'),
  ('AST-0008','Epson EB-X06 Projector','Classroom multimedia projector. 3LCD, 3600 ANSI lumens, XGA 1024x768 native resolution, HDMI and VGA inputs, ceiling-mountable. Lamp life approx 6000 hours eco mode.','Electronics',4,'unit',1,'Good',23995.00,'AV Room','Available','2024-06-15','[]',1,'BLK-2024-002'),
  ('AST-0009','Acer X1228i Projector','Short-throw classroom projector with wireless presentation. 4500 ANSI lumens, XGA resolution, built-in 10W speaker. Reserved for assemblies and seminars.','Electronics',1,'unit',1,'Excellent',28999.00,'AV Room','In Use','2024-06-15','[]',0,''),
  ('AST-0010','JBL EON715 Powered Speaker','15-inch active PA speaker, 650W peak, Bluetooth streaming, used for flag ceremonies and school programs at the covered court.','Audio',2,'unit',2,'Good',21500.00,'Audio Room','Available','2024-06-15','[]',1,'BLK-2024-003'),
  ('AST-0011','Shure SM58 Wireless Microphone Set','Dual handheld wireless microphone system with receiver, for programs and announcements. Includes rechargeable batteries.','Audio',3,'unit',2,'Good',4500.00,'Audio Room','Available','2024-06-15','[]',1,'BLK-2024-004'),
  ('AST-0012','Yamaha MG10XU Audio Mixer','10-channel analog mixing console with USB and built-in effects, drives the covered court PA during events.','Audio',1,'unit',2,'Fair',12999.00,'Audio Room','Under Repair','2024-06-15','[]',0,''),
  ('AST-0013','Epson L3210 All-in-One Printer','Ink tank print-scan-copy unit for the principal office. Used for memos, certificates, and official correspondence.','Office Equipment',1,'unit',2,'Good',8499.00,'Principal Office','In Use','2024-06-15','[]',0,''),
  ('AST-0014','Epson L120 Ink Tank Printer','Faculty room printer for school forms and lesson handouts. High-volume continuous ink supply.','Office Equipment',2,'unit',2,'Good',6299.00,'Faculty Room','Available','2024-06-15','[]',1,'BLK-2024-005'),
  ('AST-0015','Canon imageCLASS MF3010 Laser Printer','Monochrome multifunction laser printer for the registrar, optimized for bulk SF form printing.','Office Equipment',1,'unit',2,'Good',9999.00,'Admin Office','Available','2024-06-15','[]',0,''),
  ('AST-0016','Brother ADS-1200 Document Scanner','Compact duplex document scanner for digitizing learner records and Form 137.','Office Equipment',1,'unit',2,'Excellent',11500.00,'Admin Office','Available','2024-06-15','[]',0,''),
  ('AST-0017','Armchair (Tablet Chair)','Standard mono-bloc student armchair with writing tablet. Bulk procurement distributed across grade-level classrooms.','Furniture',120,'piece',2,'Good',850.00,'Stock Room','Available','2024-06-15','[]',1,'BLK-2024-006'),
  ('AST-0018','Teacher''s Table','Wooden teacher''s table with drawer and lock, one per classroom.','Furniture',16,'piece',2,'Good',3200.00,'Stock Room','Available','2024-06-15','[]',1,'BLK-2024-007'),
  ('AST-0019','Steel Filing Cabinet (4-Drawer)','Lockable vertical steel filing cabinet for storing learner permanent records (Form 137 / SF10).','Furniture',6,'piece',2,'Good',5800.00,'Admin Office','Available','2024-06-15','[]',1,'BLK-2024-008'),
  ('AST-0020','Folding Monobloc Table','Heavy-duty folding table used for examinations, registration, and school events.','Furniture',10,'piece',2,'Fair',1450.00,'Covered Court','Available','2024-06-15','[]',1,'BLK-2024-009'),
  ('AST-0021','Whiteboard (4x8 ft)','Wall-mounted magnetic whiteboard, one per classroom replacing the old blackboards.','Furniture',16,'piece',2,'Good',2400.00,'Stock Room','Available','2024-06-15','[]',1,'BLK-2024-010'),
  ('AST-0022','Compound Microscope','Binocular compound microscope, 40x-1000x magnification, LED illumination, for Grade 9 and 10 Science classes.','Laboratory',8,'piece',0,'Good',6500.00,'Science Laboratory','Available','2024-06-15','[]',1,'BLK-2024-011'),
  ('AST-0023','Digital Weighing Scale (Lab)','Electronic precision balance, 0.01g resolution, 200g capacity, for chemistry experiments.','Laboratory',2,'piece',0,'Good',3200.00,'Science Laboratory','Available','2024-06-15','[]',1,'BLK-2024-012'),
  ('AST-0024','Laboratory Glassware Set','Assorted borosilicate glassware: beakers, flasks, test tubes, and graduated cylinders. Counted as a complete set per cabinet.','Laboratory',4,'piece',0,'Fair',2800.00,'Science Laboratory','Available','2024-06-15','[]',1,'BLK-2024-013'),
  ('AST-0025','Human Skeleton Model (Half-size)','Half-size anatomical human skeleton model on stand for Science demonstrations.','Laboratory',1,'piece',0,'Good',4500.00,'Science Laboratory','Available','2024-06-15','[]',0,''),
  ('AST-0026','Mathematics Grade 10 Learner''s Module','DepEd K-12 learner''s module, Mathematics Grade 10. Counted per copy, issued to students each school year.','Books & Modules',250,'copy',0,'Good',185.00,'Library','Available','2024-06-15','[]',1,'BLK-2024-014'),
  ('AST-0027','Science Grade 9 Textbook','DepEd-issued Science textbook for Grade 9. Stored in the library for distribution.','Books & Modules',220,'copy',0,'Good',210.00,'Library','Available','2024-06-15','[]',1,'BLK-2024-015'),
  ('AST-0028','Filipino Grade 8 Module','Self-learning module set for Filipino Grade 8.','Books & Modules',200,'copy',0,'Fair',165.00,'Library','Available','2024-06-15','[]',1,'BLK-2024-016'),
  ('AST-0029','English Grade 7 Textbook','DepEd English learner textbook for Grade 7.','Books & Modules',240,'copy',0,'Good',195.00,'Library','Available','2024-06-15','[]',1,'BLK-2024-017'),
  ('AST-0030','Whiteboard Marker (Black)','Refillable whiteboard marker, black ink. Issued to classrooms per box of 12.','Consumables',30,'box',5,'Good',360.00,'Supply Room','Available','2024-06-15','[]',1,'BLK-2024-018'),
  ('AST-0031','A4 Bond Paper (Sub. 20)','A4 size 80gsm bond paper for printing school forms and handouts. Counted per ream.','Consumables',45,'rim',5,'Good',245.00,'Supply Room','Available','2024-06-15','[]',1,'BLK-2024-019'),
  ('AST-0032','Manila Paper','Manila paper for visual aids and classroom activities. Counted per bundle.','Consumables',20,'rim',5,'Good',120.00,'Supply Room','Available','2024-06-15','[]',1,'BLK-2024-020'),
  ('AST-0033','Long Folder (White)','Long white folder for filing learner records and reports. Per bundle of 50.','Consumables',15,'bundle',5,'Good',280.00,'Supply Room','Available','2024-06-15','[]',1,'BLK-2024-021'),
  ('AST-0034','Ballpen (Black)','Black ballpoint pen, box of 12, for general office and classroom use.','Consumables',25,'box',5,'Good',84.00,'Supply Room','Available','2024-06-15','[]',1,'BLK-2024-022'),
  ('AST-0035','Chalk (White)','White chalk, box of 100 pieces, remaining stock for chalkboard rooms.','Consumables',8,'box',5,'Fair',35.00,'Supply Room','Out of Stock','2024-06-15','[]',1,'BLK-2024-023'),
  ('AST-0036','Basketball (Molten GR7)','Official size 7 rubber basketball for MAPEH and intramurals.','Sports Equipment',6,'piece',0,'Good',950.00,'Covered Court','Available','2024-06-15','[]',1,'BLK-2024-024'),
  ('AST-0037','Volleyball (Mikasa MVA300)','Competition volleyball for MAPEH classes and palaro.','Sports Equipment',5,'piece',0,'Good',1200.00,'Covered Court','Available','2024-06-15','[]',1,'BLK-2024-025'),
  ('AST-0038','Volleyball Net','Standard volleyball net with steel cable, for the covered court.','Sports Equipment',2,'piece',0,'Fair',1800.00,'Covered Court','Available','2024-06-15','[]',1,'BLK-2024-026'),
  ('AST-0039','Table Tennis Set','Foldable table tennis table with net, paddles, and balls for indoor athletics.','Sports Equipment',1,'piece',0,'Good',8500.00,'Covered Court','Available','2024-06-15','[]',0,''),
  ('AST-0040','Cordless Drill (18V)','18V cordless drill with battery and charger, for maintenance and TLE workshop.','Tools',2,'piece',0,'Good',3200.00,'TLE Workshop','Available','2024-06-15','[]',1,'BLK-2024-027'),
  ('AST-0041','Tool Box Set (Mechanic)','100-piece mechanic tool set with sockets, wrenches, and screwdrivers for repairs.','Tools',1,'piece',0,'Good',4500.00,'TLE Workshop','Available','2024-06-15','[]',0,''),
  ('AST-0042','Extension Cord (10m, 4-gang)','Heavy-duty 10-meter 4-gang extension cord for events and classroom setups.','Tools',6,'piece',0,'Good',650.00,'Stock Room','Available','2024-06-15','[]',1,'BLK-2024-028'),
  ('AST-0043','Electric Fan (Stand, 18-inch)','Industrial stand fan, 18-inch, for classrooms and offices.','Office Equipment',18,'unit',2,'Good',1450.00,'Stock Room','Available','2024-06-15','[]',1,'BLK-2024-029'),
  ('AST-0044','Smart TV 55-inch (DepEd DCP)','55-inch Smart TV package from the DepEd Computerization Program, wall-mounted in classroom for digital lessons. Android TV, HDMI, USB, screen mirroring.','Electronics',3,'unit',1,'Excellent',23900.00,'AV Room','Available','2024-06-15','[]',1,'BLK-2024-030'),
  ('AST-0045','UPS (Uninterruptible Power Supply 650VA)','650VA / 360W line-interactive UPS protecting the lab server and key workstations from brownouts.','Electronics',4,'unit',1,'Good',2850.00,'Computer Laboratory','Available','2024-06-15','[]',1,'BLK-2024-031'),
  ('AST-0046','Network Switch (24-port Gigabit)','24-port unmanaged gigabit switch for the computer laboratory LAN.','Electronics',1,'unit',1,'Good',3500.00,'Computer Laboratory','In Use','2024-06-15','[]',0,''),
  ('AST-0047','Wi-Fi Router (Dual-band AC1200)','Dual-band wireless router providing internet access in the ICT and faculty rooms.','Electronics',2,'unit',1,'Good',1850.00,'ICT Room','In Use','2024-06-15','[]',0,'');

-- Advance counters so app-generated IDs continue cleanly ------
INSERT INTO `counters` (`name`,`value`) VALUES
  ('asset_counter',47),
  ('bulk_counter',31)
ON DUPLICATE KEY UPDATE `value` = GREATEST(`value`, VALUES(`value`));

-- End of seed data --------------------------------------------
