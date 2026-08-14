# Asset Purchase Dashboard

Internal asset management system for tracking purchases, inventory, vendors, employees, and asset lifecycle — including delivery tracking, warranty/AMC, depreciation, and HR-linked asset assignment.

- **Live site:** https://www.sangkajgroupams.com
- **Repo:** https://github.com/naman02sharma/asset-dashboard
- **Server:** DigitalOcean droplet — `206.189.133.134`

---

## 1. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React (Vite), Tailwind CSS, shadcn/ui, Recharts, Framer Motion |
| Backend | Node.js (Express) |
| Database | PostgreSQL |
| Process manager | PM2 (`asset-backend`) |
| Web server | Nginx (reverse proxy + static frontend host) |
| File storage | Local disk (`backend/uploads/`) — invoices, insurance photos |
| Invoice extraction | `pdf-parse` (digital PDFs) + `tesseract.js` (OCR for scans/photos) — runs entirely on-device, no external AI API |

---

## 2. Server Layout

/home/deployuser/asset-dashboard/
├── backend/
│ ├── config/ # DB connection config
│ ├── controllers/ # Route logic (assets, purchases, employees, vendors, auth, etc.)
│ ├── middleware/ # Auth, upload handling, error handling
│ ├── routes/ # Express route definitions
│ ├── services/ # Email, SMS, tracking, invoice extraction
│ ├── uploads/ # User-uploaded files (invoices/, insurance-photos/) - NEVER delete, not in git
│ ├── utils/
│ ├── .env # Real secrets - NEVER commit, NEVER overwrite on deploy
│ ├── .env.example # Template showing required variables
│ ├── run-migration.js
│ └── server.js
├── frontend/
│ ├── src/
│ │ ├── components/ # Pages + modals (PurchaseTable, VendorManagementPage, EmployeeStatusPage, etc.)
│ │ ├── api/ # API client
│ │ ├── context/ # Auth context
│ │ └── utils/
│ └── dist/ # Production build - served directly by Nginx
└── database/
├── schema.sql # Full schema (fresh-install baseline)
├── 002_.sql ... 021_.sql # Sequential, additive migrations (IF NOT EXISTS guards)
├── seed_sample_data.sql
└── clear_seed_data.sql


Two Linux users are involved on the server:
- **`deployuser`** — runs the app (PM2, Nginx serves its files), owns `~/asset-dashboard` and `~/backups`
- **`root`** — used for rclone/Google Drive backup automation (see §5)

---

## 3. Environment Variables (`backend/.env`)

Never committed to git, never overwritten during a deploy. Key variables:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `JWT_SECRET` | Auth token signing |
| `GMAIL_*` | Email notification credentials |
| `PENDING_USER_EXPIRY_DAYS` | Optional — days before an unapproved signup auto-expires (defaults to 14 if absent) |

Full reference: `backend/.env.example`.

> **Known issue:** email notifications (payment reminders, status updates, overdue alerts) are currently failing with `ENETUNREACH` / connection timeouts reaching Gmail's SMTP servers — likely an IPv6 routing or outbound port 465 issue on the droplet. Users are **not** currently receiving these automated emails. Needs investigation.

---

## 4. Database

- **Current schema version:** migration `021` (`021_purchase_and_asset_tax.sql`)
- Migrations are **strictly additive** — every migration uses `IF NOT EXISTS` guards and never drops/rewrites existing data
- Run manually and individually, in numeric order, via `psql -f`:
```bash
  cd ~/asset-dashboard/database
  psql -U asset_app -d asset_dashboard -h localhost -f 0XX_migration_name.sql
```
- **Never** re-run `schema.sql` or already-applied numbered migrations against a live database
- Sanity-check after any new migration:
```bash
  psql -U asset_app -d asset_dashboard -h localhost -c "\d users"
  psql -U asset_app -d asset_dashboard -h localhost -c "\d purchases"
```

---

## 5. Backup Structure

Data is protected in **three layers**: live DB -> local droplet backups -> offsite Google Drive. This protects against both small mistakes (bad migration, accidental delete) and catastrophic loss (droplet deleted — DigitalOcean permanently destroys resources on a long-unpaid account, no recovery after that point).

### 5.1 Layer 1 — Nightly local backups (`deployuser` crontab)

Location: `/home/deployuser/backups/`

| What | When | File pattern |
|---|---|---|
| Full DB dump | Nightly (~02:00 UTC) | `db_YYYY-MM-DD.sql` |
| Pre-deploy DB dump (manual) | On demand | `db_before_upgrade_YYYY-MM-DD_HHMM.sql` |
| Pre-deploy uploads archive (manual) | On demand | `uploads_before_upgrade_YYYY-MM-DD_HHMM.tar.gz` |

```bash
crontab -l   # as deployuser — check exact nightly DB dump schedule
```

### 5.2 Layer 2 — Nightly uploads snapshot + Google Drive sync (`root` crontab)

Google Drive credentials (via `rclone`) live under `/root/.config/rclone/rclone.conf`, so these jobs run as **root**:

```cron
# 02:05 UTC - dated local snapshot of live uploads folder
5 2 * * * cp -r /home/deployuser/asset-dashboard/backend/uploads/ /home/deployuser/backups/uploads_$(date +\%F)/

# 02:15 UTC - sync all DB dumps to Google Drive
15 2 * * * rclone copy /home/deployuser/backups/ gdrive:asset-dashboard-backups/ --min-age 1h --exclude "uploads_*/**" >> /home/deployuser/backups/rclone.log 2>&1

# 02:20 UTC - sync live uploads folder to Google Drive
20 2 * * * rclone sync /home/deployuser/asset-dashboard/backend/uploads/ gdrive:asset-dashboard-backups/uploads/ --min-age 1h >> /home/deployuser/backups/rclone.log 2>&1

# 02:30 UTC - delete local uploads snapshots older than 14 days
30 2 * * * find /home/deployuser/backups/ -maxdepth 1 -name "uploads_*" -mtime +14 -exec rm -rf {} \;
```

**Server timezone is UTC.** 02:00 UTC ≈ 7:30 AM IST.

### 5.3 Layer 3 — Google Drive

Remote name: `gdrive` (configured via `rclone config`, using rclone's shared client ID — **being retired sometime in 2026**, needs a custom client ID before then: https://rclone.org/drive/#making-your-own-client-id)

Google Drive/
└── asset-dashboard-backups/
├── db_*.sql # synced nightly DB dumps
└── uploads/ # live mirror of backend/uploads/


### 5.4 Checking backup health

```bash
cat /home/deployuser/backups/rclone.log     # as root — recent sync activity/errors
ls -lh /home/deployuser/backups/            # confirm local backups exist, non-empty
rclone lsd gdrive:asset-dashboard-backups/  # confirm Drive contents
```

Check roughly once a month — otherwise fully hands-off.

### 5.5 Restoring from backup

```bash
# Database
export PGPASSWORD='<db-password>'
psql -U asset_app -h localhost asset_dashboard < ~/backups/db_before_upgrade_<timestamp>.sql

# Uploads
tar -xzf ~/backups/uploads_before_upgrade_<timestamp>.tar.gz -C ~/asset-dashboard/

# Asset Purchase Dashboard

Internal asset management system for tracking purchases, inventory, vendors, employees, and asset lifecycle — including delivery tracking, warranty/AMC, depreciation, and HR-linked asset assignment.

- **Live site:** https://www.sangkajgroupams.com
- **Repo:** https://github.com/naman02sharma/asset-dashboard
- **Server:** DigitalOcean droplet — `206.189.133.134`

---

## 1. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React (Vite), Tailwind CSS, shadcn/ui, Recharts, Framer Motion |
| Backend | Node.js (Express) |
| Database | PostgreSQL |
| Process manager | PM2 (`asset-backend`) |
| Web server | Nginx (reverse proxy + static frontend host) |
| File storage | Local disk (`backend/uploads/`) — invoices, insurance photos |
| Invoice extraction | `pdf-parse` (digital PDFs) + `tesseract.js` (OCR for scans/photos) — runs entirely on-device, no external AI API |

---

## 2. Server Layout

/home/deployuser/asset-dashboard/
├── backend/
│ ├── config/ # DB connection config
│ ├── controllers/ # Route logic (assets, purchases, employees, vendors, auth, etc.)
│ ├── middleware/ # Auth, upload handling, error handling
│ ├── routes/ # Express route definitions
│ ├── services/ # Email, SMS, tracking, invoice extraction
│ ├── uploads/ # User-uploaded files (invoices/, insurance-photos/) - NEVER delete, not in git
│ ├── utils/
│ ├── .env # Real secrets - NEVER commit, NEVER overwrite on deploy
│ ├── .env.example # Template showing required variables
│ ├── run-migration.js
│ └── server.js
├── frontend/
│ ├── src/
│ │ ├── components/ # Pages + modals (PurchaseTable, VendorManagementPage, EmployeeStatusPage, etc.)
│ │ ├── api/ # API client
│ │ ├── context/ # Auth context
│ │ └── utils/
│ └── dist/ # Production build - served directly by Nginx
└── database/
├── schema.sql # Full schema (fresh-install baseline)
├── 002_.sql ... 021_.sql # Sequential, additive migrations (IF NOT EXISTS guards)
├── seed_sample_data.sql
└── clear_seed_data.sql


Two Linux users are involved on the server:
- **`deployuser`** — runs the app (PM2, Nginx serves its files), owns `~/asset-dashboard` and `~/backups`
- **`root`** — used for rclone/Google Drive backup automation (see §5)

---

## 3. Environment Variables (`backend/.env`)

Never committed to git, never overwritten during a deploy. Key variables:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `JWT_SECRET` | Auth token signing |
| `GMAIL_*` | Email notification credentials |
| `PENDING_USER_EXPIRY_DAYS` | Optional — days before an unapproved signup auto-expires (defaults to 14 if absent) |

Full reference: `backend/.env.example`.

> **Known issue:** email notifications (payment reminders, status updates, overdue alerts) are currently failing with `ENETUNREACH` / connection timeouts reaching Gmail's SMTP servers — likely an IPv6 routing or outbound port 465 issue on the droplet. Users are **not** currently receiving these automated emails. Needs investigation.

---

## 4. Database

- **Current schema version:** migration `021` (`021_purchase_and_asset_tax.sql`)
- Migrations are **strictly additive** — every migration uses `IF NOT EXISTS` guards and never drops/rewrites existing data
- Run manually and individually, in numeric order, via `psql -f`:
```bash
  cd ~/asset-dashboard/database
  psql -U asset_app -d asset_dashboard -h localhost -f 0XX_migration_name.sql
```
- **Never** re-run `schema.sql` or already-applied numbered migrations against a live database
- Sanity-check after any new migration:
```bash
  psql -U asset_app -d asset_dashboard -h localhost -c "\d users"
  psql -U asset_app -d asset_dashboard -h localhost -c "\d purchases"
```

---

## 5. Backup Structure

Data is protected in **three layers**: live DB -> local droplet backups -> offsite Google Drive. This protects against both small mistakes (bad migration, accidental delete) and catastrophic loss (droplet deleted — DigitalOcean permanently destroys resources on a long-unpaid account, no recovery after that point).

### 5.1 Layer 1 — Nightly local backups (`deployuser` crontab)

Location: `/home/deployuser/backups/`

| What | When | File pattern |
|---|---|---|
| Full DB dump | Nightly (~02:00 UTC) | `db_YYYY-MM-DD.sql` |
| Pre-deploy DB dump (manual) | On demand | `db_before_upgrade_YYYY-MM-DD_HHMM.sql` |
| Pre-deploy uploads archive (manual) | On demand | `uploads_before_upgrade_YYYY-MM-DD_HHMM.tar.gz` |

```bash
crontab -l   # as deployuser — check exact nightly DB dump schedule
```

### 5.2 Layer 2 — Nightly uploads snapshot + Google Drive sync (`root` crontab)

Google Drive credentials (via `rclone`) live under `/root/.config/rclone/rclone.conf`, so these jobs run as **root**:

```cron
# 02:05 UTC - dated local snapshot of live uploads folder
5 2 * * * cp -r /home/deployuser/asset-dashboard/backend/uploads/ /home/deployuser/backups/uploads_$(date +\%F)/

# 02:15 UTC - sync all DB dumps to Google Drive
15 2 * * * rclone copy /home/deployuser/backups/ gdrive:asset-dashboard-backups/ --min-age 1h --exclude "uploads_*/**" >> /home/deployuser/backups/rclone.log 2>&1

# 02:20 UTC - sync live uploads folder to Google Drive
20 2 * * * rclone sync /home/deployuser/asset-dashboard/backend/uploads/ gdrive:asset-dashboard-backups/uploads/ --min-age 1h >> /home/deployuser/backups/rclone.log 2>&1

# 02:30 UTC - delete local uploads snapshots older than 14 days
30 2 * * * find /home/deployuser/backups/ -maxdepth 1 -name "uploads_*" -mtime +14 -exec rm -rf {} \;
```

**Server timezone is UTC.** 02:00 UTC ≈ 7:30 AM IST.

### 5.3 Layer 3 — Google Drive

Remote name: `gdrive` (configured via `rclone config`, using rclone's shared client ID — **being retired sometime in 2026**, needs a custom client ID before then: https://rclone.org/drive/#making-your-own-client-id)

Google Drive/
└── asset-dashboard-backups/
├── db_*.sql # synced nightly DB dumps
└── uploads/ # live mirror of backend/uploads/


### 5.4 Checking backup health

```bash
cat /home/deployuser/backups/rclone.log     # as root — recent sync activity/errors
ls -lh /home/deployuser/backups/            # confirm local backups exist, non-empty
rclone lsd gdrive:asset-dashboard-backups/  # confirm Drive contents
```

Check roughly once a month — otherwise fully hands-off.

### 5.5 Restoring from backup

```bash
# Database
export PGPASSWORD='<db-password>'
psql -U asset_app -h localhost asset_dashboard < ~/backups/db_before_upgrade_<timestamp>.sql

# Uploads
tar -xzf ~/backups/uploads_before_upgrade_<timestamp>.tar.gz -C ~/asset-dashboard/

# From Google Drive (if the droplet itself is lost)
rclone copy gdrive:asset-dashboard-backups/ ~/restored-backups/ --progress
```

---

## 6. Deployment Procedure

```bash
ssh deployuser@206.189.133.134
cd ~/asset-dashboard

# 1. Back up first - always
mkdir -p ~/backups
export PGPASSWORD='<db-password>'
pg_dump -U asset_app -h localhost asset_dashboard > ~/backups/db_before_upgrade_$(date +%F_%H%M).sql
tar -czf ~/backups/uploads_before_upgrade_$(date +%F_%H%M).tar.gz backend/uploads/

# 2. Confirm clean working tree, then pull
git status
git pull

# 3. Install dependencies
cd backend && npm install --omit=dev
cd ../frontend && npm install

# 4. Run any NEW migrations only (see §4)

# 5. Restart backend
pm2 restart asset-backend
pm2 logs asset-backend --lines 50 --nostream

# 6. Rebuild frontend (Nginx serves dist/ directly - no restart needed)
cd ~/asset-dashboard/frontend
npm run build
```

**Rollback if needed:**
```bash
git log --oneline -5
git checkout <previous-commit-hash>
cd backend && npm install --omit=dev && pm2 restart asset-backend
cd ../frontend && npm install && npm run build

# Only if a migration actually corrupted data:
psql -U asset_app -h localhost asset_dashboard < ~/backups/db_before_upgrade_<timestamp>.sql
```

---

## 7. Health Checks

```bash
curl -i http://localhost:4000/api/health
curl -i http://localhost:4000/api/purchases   # 401 = working, just needs auth
curl -s --resolve www.sangkajgroupams.com:443:127.0.0.1 https://www.sangkajgroupams.com | grep -o '<title>.*</title>'
psql -U asset_app -h localhost asset_dashboard -c "SELECT 1;"
pm2 status
pm2 describe asset-backend
```

---

## 8. Feature Notes

- **Multi-item purchases** — one purchase order can hold several line items, grouped in Order History
- **Vendor Management** — admin-only; non-admins get 403 on direct edit attempts
- **Employee Status / HR dashboard** — admin-only view
- **Delivery tracking** — supports partial deliveries; asset-tag numbering bug fixed in migration `012`+
- **User approval gate** (migration `013`) — new signups require admin approval; bootstrap admin and pre-existing accounts auto-approved
- **Invoice extraction** — "Upload invoice to auto-fill" on New Purchase; `pdf-parse` for digital PDFs, `tesseract.js` OCR fallback for scans/photos, all on-device, no external AI API
- **Bulk AMC/Warranty modal** — bulk-update AMC and warranty info across multiple assets

---

## 9. Known Issues / Follow-ups

- [ ] Email notifications failing (`ENETUNREACH` to Gmail SMTP) — investigate droplet outbound networking on port 465
- [ ] `rclone`'s shared client ID retiring in 2026 — set up a dedicated Google Cloud client ID before then
- [ ] Frontend bundle is 775 KB (over Vite's 500 KB warning) — consider code-splitting
- [ ] `deployuser` sudo password unknown — sort out proper sudo access instead of relying on root login
