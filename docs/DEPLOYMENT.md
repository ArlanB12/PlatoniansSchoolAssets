# Deployment & Operations Guide

Three scenarios:

1. **[Run it on your PC (XAMPP)](#1-run-it-on-your-pc-xampp)**
2. **[Test it on your phone over Wi-Fi](#2-test-it-on-your-phone-over-wi-fi)** ← the LAN setup
3. **[Production deployment on a Linux server](#3-production-deployment-linux-lamp)**

---

## 1. Run it on your PC (XAMPP)

### Prerequisites

- [XAMPP](https://www.apachefriends.org/) (PHP 8+, MySQL 8+, Apache)
- A modern browser (Chrome, Edge, Firefox)

### Steps

**1.1 — Drop the repo into htdocs**

```
C:\xampp\htdocs\platonians_school_assets\
```

**1.2 — Start Apache + MySQL** from the XAMPP control panel.

**1.3 — Import the database**

Open phpMyAdmin (`http://localhost/phpmyadmin`) → click `Import` → choose:

```
database/schema.sql
```

This creates the `platonians_is` database with all tables and three seed accounts.

**1.4 — Open the app**

```
http://localhost/platonians_school_assets/public/
```

Note the `/public/` at the end — that's the Apache web root (everything outside it like `database/`, `docs/`, `tests/` is intentionally NOT exposed to browsers).

**1.5 — Sign in**

| Role | Email | Password |
|------|-------|----------|
| Administrator | admin@test.com | 123 |
| Property Custodian | custodian@test.com | 123 |
| Teacher | teacher@test.com | 123 |

Change these passwords immediately after first login. (Edit user → set new password → save.)

### Verifying everything works

Open `http://localhost/platonians_school_assets/public/api/health.php` in your browser. You should see:

```json
{"ok":true,"version":"10","env":"development","db":"ok","dbLatency":3,"phpVersion":"8.x.x","ts":"2026-..."}
```

If `db` says `error`, MySQL isn't running or `config.local.php` has wrong credentials.

---

## 2. Test it on your phone over Wi-Fi

Goal: open the same system on your phone (same Wi-Fi network as your PC) so you can see how it looks and works on mobile.

### Step-by-step

**2.1 — Get your PC's LAN IP address**

Open a Command Prompt (Windows) or Terminal (macOS/Linux):

**Windows:**
```cmd
ipconfig
```
Look for a line like `IPv4 Address. . . . . . . . . . . : 192.168.1.42`. That's your PC's LAN IP.

**macOS / Linux:**
```bash
ifconfig | grep "inet "
```
Look for an entry like `inet 192.168.1.42` (NOT `127.0.0.1` — that's localhost).

**2.2 — Allow XAMPP through Windows Firewall (one-time)**

Windows might block incoming connections to Apache. First time you start Apache, Windows usually pops up a dialog — click **Allow access** for both Private and Public networks. If you missed it:

1. Open Windows Defender Firewall → `Allow an app through firewall`
2. Click `Change settings` → find `Apache HTTP Server` (or `httpd.exe`)
3. Check both `Private` and `Public`
4. OK

**2.3 — Make sure XAMPP Apache is listening on the LAN**

XAMPP's default config listens on all interfaces (`0.0.0.0:80`), so this usually just works. If your phone can't connect, edit `C:\xampp\apache\conf\httpd.conf` and check that:

```
Listen 80
```

(NOT `Listen 127.0.0.1:80` — that would be localhost-only.)

Restart Apache after any config change.

**2.4 — Make sure your phone is on the SAME Wi-Fi as your PC**

This is the most common gotcha. If your phone is on mobile data or a different network (guest Wi-Fi, 5GHz vs 2.4GHz on some routers with split SSIDs), it can't reach your PC. Both must be on the same network.

**2.5 — Open the app on your phone**

In your phone's browser, type:

```
http://192.168.1.42/platonians_school_assets/public/
```

(Replace `192.168.1.42` with YOUR PC's LAN IP from step 2.1.)

You should see the login screen. Sign in with `admin@test.com / 123`.

### What to look for on mobile

The interface is responsive — the sidebar collapses into a hamburger menu, tables become horizontally scrollable, and the dashboard charts shrink. Walk through:

- Login → dashboard (charts render)
- Sidebar hamburger → navigate between pages
- Inventory → add a new asset (test the file upload from your phone's camera)
- Notifications bell — pull-to-refresh works
- Sign out

### Troubleshooting mobile access

- **"Can't reach this site"** → wrong IP, wrong network, or Apache firewall block. Verify on your PC first: `http://localhost/...` should work. Then verify your IP with `ipconfig`. Then verify same network (phone Wi-Fi name should match the PC's).
- **"Connection refused"** → Apache isn't running or isn't listening on the LAN interface. Restart it from XAMPP control panel.
- **Login fails on phone but works on PC** → Cookies not being set. This happens if you're accessing via IP but localhost is forced somewhere. Verify the URL in your phone's browser exactly matches the IP form (no `localhost`).
- **Slow** → Normal for the first request after restarting Apache. Subsequent requests should be snappy.
- **Login succeeds then immediately bounces back to login** → CSRF token issue. Clear your phone browser's site data for the IP and try again. If it persists, check `public/api/health.php` from the phone — if THAT fails, you've got a connectivity problem, not an app problem.

### When you're done testing

Optional but recommended: stop the XAMPP Apache+MySQL services when not actively developing. Leaving your machine listening on `:80` on a public Wi-Fi (cafe, school) is not great.

---

## 2.5 Push notifications (real device alerts)

The system sends **real OS-level push notifications** to phones and
desktops, not just the in-app bell. No external service, no Composer
package, and no certificate are needed for the localhost demo — the
sender is built into PHP using OpenSSL + cURL (both already on in XAMPP).

### Turning it on

1. Sign in, open **Account Settings → Device Notifications**, and click
   **Enable on this device**. The browser asks for permission once; allow
   it.
2. Click **Send test** (on the Account card, or under Lending Policy →
   System Maintenance for the ICT Coordinator). A notification should
   appear in your tray within a second or two.

After that, the device receives every alert the system already raised:
new borrow requests, approvals, rejections, low / out-of-stock, due-soon,
overdue, and password-reset notices.

### Why it works on `localhost` with no HTTPS

The Web Push API only runs in a "secure context". The web platform spec
treats `http://localhost` (and `127.0.0.1`) as secure, so push works
under plain XAMPP for the laptop demo. Two things to know for the panel:

- On **desktop**, pushes arrive while the browser is running — an open or
  background tab is fine; a fully-quit browser is not. This is normal Web
  Push behaviour, not a bug.
- Reaching the system from a **phone over the LAN** (`http://192.168.x.x`)
  is *not* a secure context, so push would require HTTPS there. That is
  out of scope for the laptop-only demo; the in-app bell still works on
  the phone over the LAN regardless.

### If the test push doesn't arrive

- **"No subscribed device found"** → enable notifications on this device
  first (Account → Device Notifications), then test again.
- **Status shows "Blocked"** → notifications are denied for the site in
  the browser's site settings; re-allow them and reload.
- **OpenSSL EC missing** → `php_openssl` must be enabled in `php.ini`
  (it is by default in XAMPP). The server key is generated once and
  cached in `public/api/.vapid_keys.json` (gitignored).

---

## 3. Production deployment (Linux LAMP)

### Prerequisites

- A Linux server (Ubuntu 22.04+ or similar)
- Apache 2.4+ with `mod_rewrite` and `mod_headers` enabled
- PHP 8.1+ with `pdo_mysql`, `fileinfo`, `mbstring`, `session` extensions
- MySQL 8.0+
- A domain name and SSL certificate (Let's Encrypt is fine)

### 3.1 — Server packages

```bash
sudo apt update
sudo apt install apache2 mysql-server \
    php php-mysql php-mbstring php-fileinfo \
    libapache2-mod-php

sudo a2enmod rewrite headers
sudo systemctl restart apache2
```

### 3.2 — Pull the code

```bash
cd /var/www
sudo git clone <your-repo-url> platonians
sudo chown -R www-data:www-data /var/www/platonians
sudo chmod -R 755 /var/www/platonians
sudo chmod -R 775 /var/www/platonians/public/uploads
```

### 3.3 — Create the database

```bash
sudo mysql -u root -p
```

```sql
CREATE DATABASE platonians_is CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'platonians_app'@'localhost' IDENTIFIED BY 'CHANGE_ME_STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON platonians_is.* TO 'platonians_app'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

```bash
mysql -u platonians_app -p platonians_is < /var/www/platonians/database/schema.sql
```

### 3.4 — Configure credentials

```bash
cd /var/www/platonians/public/api
sudo cp config.local.example.php config.local.php
sudo nano config.local.php
```

Set:

```php
define('APP_ENV',  'production');
define('DB_HOST',  'localhost');
define('DB_USER',  'platonians_app');
define('DB_PASS',  'CHANGE_ME_STRONG_PASSWORD');
define('DB_NAME',  'platonians_is');
```

Lock it down so only Apache can read it:

```bash
sudo chmod 640 config.local.php
sudo chown root:www-data config.local.php
```

### 3.5 — Apache VirtualHost

Create `/etc/apache2/sites-available/platonians.conf`:

```apache
<VirtualHost *:80>
    ServerName platonians.example.edu.ph
    DocumentRoot /var/www/platonians/public

    <Directory /var/www/platonians/public>
        Options -Indexes +FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>

    ErrorLog ${APACHE_LOG_DIR}/platonians_error.log
    CustomLog ${APACHE_LOG_DIR}/platonians_access.log combined
</VirtualHost>
```

Enable and reload:

```bash
sudo a2ensite platonians
sudo systemctl reload apache2
```

### 3.6 — Add HTTPS (Let's Encrypt)

```bash
sudo apt install certbot python3-certbot-apache
sudo certbot --apache -d platonians.example.edu.ph
```

### 3.7 — Set up daily auto-backup cron

```bash
sudo crontab -e
```

```cron
# Pre-cron health check, then trigger backup if healthy
0 2 * * * curl -sf https://platonians.example.edu.ph/api/health.php >/dev/null && curl -X POST -H "Cookie: ..." https://platonians.example.edu.ph/api/auto_backup.php?action=run >/dev/null 2>&1
```

Note: auto_backup now requires an authenticated admin session. For unattended cron, either expose a separate cron-only endpoint protected by a server-side secret, or run the cron INSIDE the container/host via `php /var/www/platonians/public/api/auto_backup.php` directly. The simplest approach is a small shell script that calls `mysqldump` directly:

```bash
#!/bin/bash
TS=$(date +%Y-%m-%d)
mysqldump -u platonians_app -p'YOUR_PASS' platonians_is > /var/backups/platonians_$TS.sql
find /var/backups -name "platonians_*.sql" -mtime +7 -delete
```

Save as `/usr/local/bin/platonians-backup.sh`, `chmod +x`, then cron it.

### 3.8 — Smoke test

```bash
curl https://platonians.example.edu.ph/api/health.php
# Should return {"ok":true,"version":"10","db":"ok",...}
```

Open the app in a browser, sign in as `admin@test.com / 123`, **immediately change all three default passwords**.

### 3.9 — Hardening checklist

- [ ] Changed all three default passwords
- [ ] `config.local.php` has `APP_ENV='production'`
- [ ] HTTPS enforced
- [ ] Daily backup cron is running
- [ ] `public/uploads/.htaccess` deployed (script execution blocked)
- [ ] `public/api/config.local.php` is `chmod 640`, owned by `root:www-data`
- [ ] PHP error log is being rotated (logrotate config in `/etc/logrotate.d/`)
- [ ] DB user has ONLY `platonians_is` privileges, not global

---

## Troubleshooting

### "Database connection failed."

Real error is in the server's PHP error log, not the browser:

```bash
sudo tail -n 50 /var/log/apache2/error.log
```

Most common causes:
- `config.local.php` has wrong credentials
- MySQL isn't running: `sudo systemctl status mysql`
- DB user lacks access to `platonians_is`

### "Invalid or missing CSRF token."

The frontend's CSRF token has expired (server restarted, session storage cleared, or the user opened the app in two browsers). Fix: sign out and back in.

### Uploads fail silently

```bash
sudo chown -R www-data:www-data /var/www/platonians/public/uploads
sudo chmod 775 /var/www/platonians/public/uploads
```

### "Too many attempts from your network"

You hit the IP rate limit. Wait 60 seconds. If you're hitting this in development, run this in phpMyAdmin to clear:

```sql
DELETE FROM rate_limit WHERE ip = '127.0.0.1';
```
