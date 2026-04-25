# Platonian's School Assets

**Web-based asset and inventory management system** for Don Servillano Platon Memorial National High School (DSPMNHS), Sta. Cruz, Tinambac, Camarines Sur.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML5, CSS3, Vanilla JavaScript (ES2020+) |
| Backend | PHP 8 (procedural) |
| Database | MySQL 8 via PDO |
| Server | XAMPP (Apache + MySQL) or any PHP 8 + MySQL host |

---

## Features

### Core Modules
- **Inventory Management** — Add, edit, delete assets; file/photo attachments (IAR); DepEd / bulk item support
- **Check In / Check Out** — Full transaction lifecycle with server-side date enforcement
- **Borrow Requests** — Teacher self-service request flow with Approve / Reject
- **Reports & Analytics** — Charts (Chart.js), CSV export, audit logs
- **User Management** — Admin CRUD for all roles with last-admin safeguards
- **Lending Policy** — Configurable borrow duration, early reminders, and policy text

### Notification System (13 types)
Checkout confirmed, return confirmed, borrow request submitted, approved, rejected, low stock, out of stock, restocked, new asset, early return reminder, overdue alert, Tier 4 escalation, login lockout security alert.

### Accountability Tier System

| Tier | Days Overdue | Effect |
|------|-------------|--------|
| 0 | 0 | Clean — full access |
| 1 | 1–2 | Warning banner on login |
| 2 | 3–6 | Borrowing suspended |
| 3 | 7–13 | Login blocked |
| 4 | 14+ | Account escalated; admin alerted |

### Security
- Login lockout — 15 min lock after 5 failed attempts with admin notification
- Forgot password lockout — 30 min lock after 5 failed attempts
- Role validated server-side; self-registration cannot assign admin role
- File upload MIME validation — extension derived from MIME type, not filename
- Last-admin protection — cannot delete or downgrade the final admin account
- Role whitelist on create/update user — prevents invalid role injection

---

## Folder Structure

```
platoniansIS/
├── api/                          # PHP backend
│   ├── config.php                # DB config + auto-migrations + seeds
│   ├── auth.php                  # Login, lockout, forgot password, register, tiers
│   ├── assets.php                # Inventory CRUD, file upload, search suggest
│   ├── transactions.php          # Checkout, return, due/overdue check
│   ├── borrow_requests.php       # Teacher request flow (Approve/Reject)
│   ├── notifications.php         # Notification CRUD
│   ├── users.php                 # User management
│   ├── audit_logs.php            # Room audit logs
│   ├── lending_policy.php        # Configurable policy settings
│   ├── backup.php                # Manual backup/restore
│   ├── auto_backup.php           # Daily auto-backup (server-side)
│   ├── due_check.php             # Due date + overdue notification engine
│   └── .htaccess                 # Block direct API directory listing
├── assets/
│   ├── css/
│   │   └── styles.css            # All styles (responsive: 390px – 1400px+)
│   ├── img/
│   │   ├── logo.png
│   │   └── BG.jpg
│   └── js/
│       ├── api.js                # Frontend API layer (window.API)
│       ├── app.js                # Core IMS module: layout, nav, charts, notifications
│       ├── auth.js               # Login / register / forgot password logic
│       ├── inventory.js          # Inventory module
│       ├── transactions.js       # Check in/out, borrow, return
│       └── users.js              # User management module
├── uploads/                      # IAR file uploads (Apache needs write access)
│   └── .gitkeep
├── database/
│   └── schema.sql                # Full DB schema + seed data
├── docs/                         # Reserved for documentation assets
├── index.html                    # Login page
├── dashboard.html                # Dashboard
├── inventory.html                # Inventory management
├── transactions.html             # Check in / check out
├── borrow.html                   # Teacher borrow requests
├── return.html                   # Teacher return
├── reports.html                  # Reports & analytics
├── users.html                    # User management (Admin only)
├── policy.html                   # Lending policy settings
├── .htaccess                     # Security headers + gzip + static cache
└── .gitignore
```

---

## Local Setup (XAMPP)

### Requirements
- XAMPP with Apache + MySQL (PHP 8+)

### Steps

1. **Clone or copy** this folder into `htdocs`:
   ```
   C:\xampp\htdocs\platoniansIS\
   ```

2. **Import the database** — open phpMyAdmin and import:
   ```
   database/schema.sql
   ```

3. **Ensure the uploads folder is writable** by Apache:
   ```
   platoniansIS/uploads/
   ```

4. **Open in browser:**
   ```
   http://localhost/platoniansIS/
   ```

### Default Accounts

| Role | Email | Password |
|------|-------|----------|
| Administrator | admin@test.com | 123 |
| Property Custodian | custodian@test.com | 123 |
| Teacher | teacher@test.com | 123 |

> Change all default passwords immediately after setup.

---

## Production / GitHub Pages Hosting

This system requires a PHP + MySQL backend. It **cannot** run on GitHub Pages (static only).

For live hosting use:
- **InfinityFree**, **000WebHost**, or any shared host with PHP 8 + MySQL
- Or a VPS (Ubuntu + Apache/Nginx + PHP + MySQL)

Steps:
1. Upload all files via FTP/cPanel File Manager
2. Create a MySQL database in cPanel
3. Import `database/schema.sql`
4. Edit `api/config.php` with your host's DB credentials
5. Make sure `uploads/` is writable (`chmod 755` or via cPanel permissions)

---

## Capstone Project Info

| | |
|---|---|
| **System** | Platonian's School Assets (Platonian's IS v8) |
| **Client School** | Don Servillano Platon Memorial National High School |
| **Location** | Sta. Cruz, Tinambac, Camarines Sur |
| **Team** | Arlan, Micaella A. Nodado, Jerecho R. Ojas |
| **Adviser** | Mr. Everild Gerd R. Pablo |
| **Institution** | STI College Naga, BS Information Technology |
