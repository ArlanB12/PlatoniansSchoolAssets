# Platonian's School Assets

A web-based school asset and inventory management system for **Don Servillano Platon Memorial National High School** (Sta. Cruz, Tinambac, Camarines Sur, Philippines).

> Capstone project — STI College Naga, BS Information Technology

---

## What it does

Platonian's IS manages the full lifecycle of school equipment — from registration and storage location, to lending, returning, room audits, and accountability. Four user roles each get a tailored experience:

| Role | Who | What they can do |
|------|-----|------------------|
| **ICT Coordinator** (Super Admin) | School ICT staff | Password resets, system maintenance (backup / restore), user management — the technical side |
| **School Principal** (Admin) | Principal | Analytics, the system Activity Log, and approve / reject borrow requests; view-only on inventory and users |
| **Property Custodian** | Custodian | Main operator: add / remove assets, approve / reject check-in / check-out, room audits, condition updates |
| **Teacher** | Faculty | Submit borrow requests, view their own borrowed items, return items |

Built around a four-tier overdue accountability system that auto-suspends, restricts, then escalates accounts whose borrowed items aren't returned on time. Real device push notifications (Web Push) deliver alerts to phones and desktops, not just an in-app bell.

## Tech stack

- **Frontend** — HTML5, CSS3, Vanilla JavaScript (ES2020+), Chart.js
- **Backend** — PHP 8 (procedural, PDO), real `$_SESSION` with CSRF tokens
- **Database** — MySQL 8
- **Server** — Apache (XAMPP for local dev, any LAMP stack for production)
- **Tests** — Playwright (smoke tests under `tests/`)

No build step, no npm in `public/`, no framework. Open `dashboard.html` and it runs.

## Quick start (local)

```bash
# 1. Drop into XAMPP htdocs
cd C:/xampp/htdocs
git clone <your-repo-url> platonians_school_assets

# 2. Import the database in phpMyAdmin (http://localhost/phpmyadmin)
#    Easiest: import database/install.sql  (schema + sample data, one file)
#    Or separately: database/schema.sql then database/seed_data.sql

# 3. (Optional) Configure local DB credentials
cd platonians_school_assets/public/api
cp config.local.example.php config.local.php
# edit config.local.php as needed

# 4. Access the app
#    http://localhost/platonians_school_assets/public/
```

**Default accounts** (change immediately after first login):

| Role | Email | Password |
|------|-------|----------|
| ICT Coordinator (Super Admin) | superadmin@test.com | 123 |
| School Principal (Admin) | admin@test.com | 123 |
| Property Custodian | custodian@test.com | 123 |
| Teacher | teacher@test.com | 123 |

> Upgrading an existing install instead of a fresh import? The migration
> promotes the old `admin@test.com` to the ICT Super Admin and converts
> the old `principal@test.com` to the School Principal automatically — no
> data loss. See `CHANGES_v10.16.md`.

Full setup walkthrough: **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** (including mobile testing on your phone).

## Sample data

`database/seed_data.sql` loads a realistic starting inventory for the school: 47 asset records (about 1,300 physical units) spanning Electronics, Audio, Office Equipment, Furniture, Laboratory, Books & Modules, Consumables, Sports Equipment, and Tools. It includes individually-spec'd laptops (DepEd DCP units, faculty and admin machines), a 20-unit computer lab, projectors, a PA system, classroom furniture, science lab equipment, learner modules, and consumable supplies. Asset IDs (`AST-0001`...) and bulk IDs (`BLK-2024-NNN`) follow the exact format the app generates, and the `counters` table is advanced so new entries you add continue cleanly from where the seed leaves off. The file is idempotent (`INSERT IGNORE`), so re-running it is safe.

## Documentation

- **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** — Local setup, mobile testing, production deployment
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — High-level walkthrough of the codebase
- **[docs/CHANGELOG.md](docs/CHANGELOG.md)** — Version history (v8.1 → v10)

## Project layout

```
platonians_school_assets/
├── public/              ← Apache DocumentRoot points here
│   ├── *.html           ← Pages (dashboard, inventory, etc.)
│   ├── api/             ← PHP endpoints + _session.php + _ratelimit.php + health.php
│   ├── assets/
│   │   ├── css/
│   │   ├── js/          ← api.js, app.js, entry.js, module scripts
│   │   └── img/
│   └── uploads/         ← User-uploaded files (gitignored, scripts blocked)
├── database/
│   ├── install.sql      ← One-shot: schema + sample data (recommended)
│   ├── schema.sql       ← Tables + seed accounts/categories/locations
│   ├── seed_data.sql    ← Realistic sample inventory (47 assets)
│   └── migration_*.sql  ← Historical migrations (for upgrading old installs)
├── docs/                ← Setup, architecture, changelog
├── tests/               ← Playwright smoke tests
├── .gitignore
├── LICENSE
└── README.md
```

## Security posture (v10)

- Real PHP `$_SESSION` (HttpOnly, SameSite=Lax, Secure on HTTPS)
- CSRF tokens on every write request (`X-CSRF-Token` header)
- Server-side role enforcement on every endpoint (clients can't bypass UI gating)
- Per-IP rate limiting on login/register/forgot (10/min, 5/min, 5/min)
- Per-account lockout after 5 failed logins
- bcrypt password hashes (legacy plain-text accounts auto-upgrade on first login)
- File uploads: MIME-type whitelist + `.htaccess` blocks script execution in `uploads/`
- Session ID regenerates on login to prevent fixation
- DB errors logged, not displayed (when `APP_ENV='production'`)

## Team

- **Arlan Bert M. Villaruel** (Programmer / Lead)
- **Micaella A. Nodado**
- **Jerecho R. Ojas**
- **Adviser:** Mr. Everild Gerd R. Pablo

## License

MIT — see [LICENSE](LICENSE).
