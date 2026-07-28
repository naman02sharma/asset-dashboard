# Asset Purchase Tracking Dashboard

A full-stack dashboard for tracking company asset purchases: spend, vendors,
payments, delivery status, insurance documents, maintenance schedules, and
automated email/SMS alerts.

**Stack:** React + Tailwind CSS (frontend) · Node.js/Express (backend) ·
PostgreSQL (database) · Nodemailer/Gmail (notifications) · Multer + Sharp (file uploads)

```
asset-dashboard/
├── database/
│   ├── schema.sql                              # Full schema for a fresh install
│   ├── 002_add_users.sql                       # Migration: login + notification prefs
│   ├── 003_add_purchase_archive.sql            # Migration: delete-to-history support
│   ├── 004_vendor_details_and_insurance.sql    # Migration: vendor/location GST+address, insurance
│   ├── 005_maintenance_files_audit.sql         # Migration: multi-file uploads, audit log, maintenance
│   ├── 006_inventory_assets.sql                # Migration: Inventory & Asset Assignment module
│   ├── seed_sample_data.sql                    # Optional sample rows
│   └── clear_seed_data.sql                     # Removes the sample rows
├── backend/
│   ├── server.js                # Express entrypoint, serves /uploads statically
│   ├── config/db.js             # PostgreSQL pool (+ DATE type-parser fix — see section 9)
│   ├── routes/                  # /api/purchases, /api/vendors, /api/locations, /api/assets,
│   │                             # /api/employees, /api/auth, /api/webhooks
│   ├── controllers/
│   │   ├── purchaseController.js    # Asset Purchase Dashboard logic
│   │   ├── assetController.js       # Inventory module: lifecycle state machine, AMC, history
│   │   ├── employeeController.js    # Employees (soft-delete only — see section 8)
│   │   └── authController.js
│   ├── middleware/
│   │   ├── auth.js                  # JWT session check
│   │   ├── upload.js                # Multer + Sharp: multi-file upload with image compression
│   │   └── errorHandler.js          # Maps Multer/validation errors to clean 400s
│   ├── services/
│   │   ├── emailService.js          # Nodemailer + templated alerts
│   │   ├── smsService.js            # SMS alerts (mocked — swap in Twilio)
│   │   ├── notificationService.js   # Dispatches each alert to every user's chosen channel
│   │   └── trackingService.js       # Courier webhook + polling + overdue/maintenance/AMC alerts + purge
│   └── uploads/                 # Created automatically — insurance photos, invoices, AMC files land here
└── frontend/
    └── src/
        ├── App.jsx
        ├── api/api.js            # fetch() wrapper (JSON + multipart uploads) for the backend API
        ├── components/
        │   ├── PurchaseTable.jsx, AdvancePaymentEditor.jsx, FilesCell.jsx, CompletedOrdersPage.jsx
        │   ├── InventoryPage.jsx         # Inventory module: items grid + Calendar tab
        │   ├── AssetDetailDrawer.jsx     # History/Trail timeline + AMC files
        │   ├── AssignEmployeeModal.jsx, MaintenanceDispatchModal.jsx, ReturnAssetModal.jsx
        │   ├── AssetFormModal.jsx, MaintenanceCalendar.jsx
        │   └── AddPurchaseModal.jsx, HistoryModal.jsx, DeleteConfirmModal.jsx, Toast.jsx, ...
        └── mock/mockData.js      # lets the UI run standalone without the backend
```

## 1. Database setup

```bash
createdb asset_dashboard
psql asset_dashboard -f database/002_add_users.sql
psql asset_dashboard -f database/schema.sql
```

**Order matters here** — `002_add_users.sql` must run BEFORE `schema.sql`,
not after. `schema.sql` has foreign keys pointing at `users(id)`
(`purchase_change_log`, `asset_change_log`, `password_reset_tokens`), so
the `users` table has to exist first or `schema.sql` fails outright with
`relation "users" does not exist`. (If you're following an older copy of
this README that listed `schema.sql` first, that ordering was wrong —
flip it.)

Every other migration (003 through 016) is already merged into
`schema.sql`/`002_add_users.sql` for a brand new install — running any of
them again afterward is harmless (every statement uses `IF NOT
EXISTS`/`CREATE OR REPLACE`), but you only strictly need to run an
individual migration file if you're **updating an existing database**
that predates it:

```bash
psql asset_dashboard -f database/003_add_purchase_archive.sql
psql asset_dashboard -f database/004_vendor_details_and_insurance.sql
psql asset_dashboard -f database/005_maintenance_files_audit.sql
psql asset_dashboard -f database/006_inventory_assets.sql
psql asset_dashboard -f database/007_asset_tag_and_location.sql
psql asset_dashboard -f database/008_depreciation.sql
psql asset_dashboard -f database/009_password_reset.sql
psql asset_dashboard -f database/010_repair_cost.sql
psql asset_dashboard -f database/011_user_roles.sql
psql asset_dashboard -f database/012_po_number_and_partial_delivery.sql
psql asset_dashboard -f database/013_user_approval.sql
psql asset_dashboard -f database/014_purchase_change_log.sql
psql asset_dashboard -f database/015_multi_item_purchase_orders.sql
psql asset_dashboard -f database/016_employee_status_hr_fields.sql
```

**No sample data is loaded by default.** To add a few example rows:
```bash
psql asset_dashboard -f database/seed_sample_data.sql
```
Remove it later with `psql asset_dashboard -f database/clear_seed_data.sql`.

## 2. Backend setup

```bash
cd backend
npm install
cp .env.example .env      # fill in DATABASE_URL, JWT_SECRET, and Gmail credentials
npm run dev                # http://localhost:4000
```

**Uploads:** `backend/uploads/insurance-photos/` and `backend/uploads/invoices/`
are created automatically on first run and served at `/uploads/...`. Images
(JPEG/PNG) are automatically resized (max 1920px wide) and re-compressed
(quality 80) with [sharp](https://sharp.pixelplumbing.com) before being
saved — a meaningful size reduction for typical phone-camera photos with no
visible quality loss at the sizes this app displays them. PDFs pass through
unchanged. 10MB-per-file limit, up to 10 files per upload request.

## 3. Frontend setup

```bash
cd frontend
npm install
npm run dev                # http://localhost:5173
```

## 4. API reference

`/api/purchases`, `/api/vendors`, and `/api/locations` all require a
logged-in session. `/api/auth/*` and `/api/webhooks/*` are public.

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/purchases/summary` | KPI totals for the 4 top cards |
| GET | `/api/purchases?q=&status=&sortBy=&sortDir=` | Home Dashboard — active + maintenance-due purchases |
| GET | `/api/purchases/completed?q=&vendor=&dateFrom=&dateTo=&page=&pageSize=` | Successful Order History, paginated |
| GET | `/api/purchases/history` | Deleted Items (soft-deleted, last 3 months) |
| GET | `/api/purchases/export?q=&status=&sortBy=&sortDir=` | CSV of the Home Dashboard's current filtered view |
| GET | `/api/purchases/completed/export?q=&vendor=&dateFrom=&dateTo=` | CSV of ALL matching completed orders (ignores pagination) |
| POST | `/api/purchases` | Create a purchase — free-text vendor & location, optional initial payment |
| PATCH | `/api/purchases/:id/status` | Update order status (marking "delivered" moves it to Completed) |
| PATCH | `/api/purchases/:id/advance-payment` | The "Modify" toggle — sets Advance Money Paid to a new total |
| PATCH | `/api/purchases/:id/delivery-date` | Change expected delivery date |
| PATCH | `/api/purchases/:id/insurance` | Toggle insured / not insured (clears files if turned off) |
| POST | `/api/purchases/:id/insurance-photos` | Upload 1–10 photos (multipart, field `photos`) |
| POST | `/api/purchases/:id/invoices` | Upload 1–10 invoice files (multipart, field `invoices`) |
| DELETE | `/api/purchases/:id/files/:fileId` | Remove one uploaded file |
| PATCH | `/api/purchases/:id/maintenance` | Schedule/reschedule/clear a maintenance date |
| PATCH | `/api/purchases/:id/maintenance/complete` | Mark maintenance done (auto-reschedules if recurring) |
| POST | `/api/purchases/:id/payments` | Record a NEW (additional) payment |
| DELETE | `/api/purchases/:id?mode=history\|permanent` | Move to Deleted Items or delete permanently |
| PATCH | `/api/purchases/:id/restore` | Restore from Deleted Items |
| GET / POST | `/api/vendors`, `/api/locations` | Autocomplete lists / manual creation |
| POST | `/api/webhooks/courier` | Inbound courier tracking webhook |

## 5. How a purchase moves between views

There is **no copying** anywhere in this system — a purchase is always the
same single row in the `purchases` table. Which page shows it is purely a
filtered view over that one row, so a "move" can never duplicate data,
drop an attached file, or leave two conflicting copies:

- **Home Dashboard** — `archived_at IS NULL AND (order_status <> 'delivered' OR is_maintenance_due)`
- **Successful Order History** — `archived_at IS NULL AND order_status = 'delivered'`
- **Deleted Items** — `archived_at IS NOT NULL` (kept 3 months, then purged)

Marking a purchase "delivered" makes it vanish from the Dashboard and
appear in Completed Orders automatically — no explicit "move" action
needed anywhere in the code. Scheduling maintenance within 7 days makes a
Completed purchase reappear on the Dashboard, tagged "Maintenance", without
ever leaving Completed Orders' underlying query.

## 6. The "Modify" toggle & financial audit trail

Each row's Advance Money Paid has a pencil icon (visible on hover) that
opens an inline editor — type a new total, remaining balance recalculates
live as a preview. Saving does NOT rewrite payment history; it inserts one
**adjustment** payment row for the difference (which can be negative, e.g.
correcting an overstated amount), so `amount_remaining` — already a live
SUM over the payments table — stays correct automatically with nothing to
manually recompute or risk drifting out of sync.

Every edit is also written to `financial_audit_log` (previous value, new
value, who, when) in the **same database transaction** as the payment
adjustment, so the two can never end up out of sync if one write succeeds
and the other fails. This log has no UI screen by design — it's for
resolving a disputed number later, not day-to-day use. Query it directly
in psql if needed: `SELECT * FROM financial_audit_log WHERE purchase_id = '...';`

## 7. Multi-file uploads (insurance photos & invoices)

Each purchase can have **multiple** insurance photos and multiple invoice
files (JPEG/PNG/PDF, 10MB limit each). The small camera/document icon in
the table shows a count badge; clicking it opens a list of every uploaded
file with a delete ("x") on each, plus an "Add" button for a multi-select
picker. Each file uploads and saves independently — if 2 of 5 selected
files fail (wrong type, too large), the other 3 still land, and the
failures are reported without losing the successes.

Files live in `purchase_files` (one-to-many), not a single-path column, so
there's no artificial cap on how many a purchase can have.

## 8. Maintenance tracking & 7-day alerts

From **Successful Order History**, expand any completed purchase to
schedule maintenance: a date, an optional cost estimate, and a "Recurring"
toggle (repeats every N months, default 6).

Exactly 7 days before the scheduled date, that purchase automatically
reappears on the **Home Dashboard** — tagged "Maintenance", with all its
original info and photos still attached (nothing was duplicated to get it
there) — and the daily cron job emails/texts every registered user
(`maintenance_due` trigger, same notification system as delivery/payment
alerts).

Clicking **"Mark Completed"** on that dashboard alert:
- If recurring: computes the next date (current date + the period, using
  Postgres interval math so month-length differences are handled
  correctly) and reschedules — it'll alert again 7 days before that.
- If not recurring: clears the schedule entirely.
Either way the purchase drops off the Dashboard and settles back into
Successful Order History (or stays there with a future date, if recurring).

## 9. Inventory & Asset Assignment module

A second, independent subsystem (separate tables, separate controller)
for tracking hardware/equipment through purchase → AMC → assignment →
repair → retirement. Open it from the box icon in the header.

**Status state machine** (see the comment block at the top of
`assetController.js` for the full reasoning):
```
available  --assign-----------> in_use
available  --send for repair--> under_repair
in_use     --send for repair--> under_repair   (auto-closes the open employee holding)
in_use, under_repair --return-> available | under_repair  (admin picks, based on condition)
any (not retired) --retire----> retired        (auto-closes any open holding)
retired    --restore----------> available
```
"Assign" and "Send for Repair" are both blocked with a 400 when status
is `under_repair` or `retired`, per the spec.

**Nothing is ever overwritten.** Every assignment or repair dispatch is
a new row in `asset_holdings` (never an update to a previous one) —
re-assigning an asset appends a new holding rather than touching any
prior record, so the full chronological trail always survives. A
partial unique index (`one open holding per asset`) is the final
backstop against two concurrent requests both trying to open a holding
on the same asset — the loser gets a clean 409, not silently-overwritten
custody.

**Immutable History/Trail.** Each asset's detail drawer merges two
append-only logs into one timeline: `asset_holdings` (who's held it,
when) and `asset_change_log` (field-level edits — AMC changes, price
corrections, etc., each with previous/new value and a timestamp).
Both are pure inserts; the timeline is a read-only projection over them.

**Employees are soft-deleted only.** There is no hard-delete endpoint —
"removing" someone sets `is_active = false`, hiding them from the
assignment dropdown without breaking any historical holding record that
references them (satisfies "if an employee is deleted, their name
remains in the audit trail" without needing a name-snapshot workaround,
though `employee_name_snapshot` exists on each holding too, as a second
layer of resilience).

**AMC renewal alerts** fire 30 days before `amc_end_date` (same
notification system as delivery/payment/maintenance alerts — see
section 6), plus a visual purple highlight + "AMC expiring" tag directly
in the Inventory table. The **Calendar tab** (month/week view, custom-
built, no external library) plots every AMC end date, warranty expiry,
and open repair's expected return date at once.

**API reference** (all require a logged-in session, same as the rest):

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/assets/summary` | Stat strip counts (available/in use/under repair/AMC expiring) |
| GET | `/api/assets?q=&status=` | List/search/filter assets |
| GET | `/api/assets/export?q=&status=` | CSV of the current filtered view |
| GET | `/api/assets/calendar` | Every AMC end date, warranty expiry, and open repair's expected return date |
| GET | `/api/assets/:id` | Full detail: the asset + every holding + the change log (for the History/Trail) |
| POST | `/api/assets` | Create an asset |
| PATCH | `/api/assets/:id` | Edit core/AMC fields — diffed and logged automatically |
| POST | `/api/assets/:id/assign` | Assign/handover to an employee (blocked if under repair/retired) |
| POST | `/api/assets/:id/dispatch-repair` | Send for maintenance — technician/vendor + expected return date |
| PATCH | `/api/assets/:id/return` | Return from an employee or from repair — condition note + resulting status |
| PATCH | `/api/assets/:id/status` | Retire, or restore a retired asset to Available |
| POST | `/api/assets/:id/amc-contracts`, `/amc-invoices` | Upload 1–10 files each (multipart, field `files`) |
| DELETE | `/api/assets/:id/files/:fileId` | Remove one uploaded AMC file |
| GET | `/api/employees?activeOnly=` | List employees for the assignment dropdown |
| PATCH | `/api/employees/:id/deactivate` | Soft-delete (see note above) |

## 10. Error prevention & validation (what was fixed and why)

- **`inconsistent types deduced for parameter $1`** — this specifically
  happens when the same placeholder is reused across differently-shaped
  SQL expressions (e.g. a plain assignment AND a `CASE WHEN $1 = ...`
  comparison in the same query — exactly the bug that was in the old
  status-update query). Fixed by giving every usage its own placeholder
  and casting every single one explicitly (`::uuid`, `::text`, `::date`,
  `::numeric`, `::boolean`) throughout `purchaseController.js` and
  `trackingService.js`, not just the one place it had already surfaced.
- **Empty-string optional fields** (`expected_delivery_date: ''`,
  `delivery_location_id: ''`) throw `invalid input syntax for type
  date/uuid` if cast directly — `nullIfEmpty()` converts them to `null`
  before every query that touches an optional date/uuid/numeric field.
- **Status update payload contract** — `StatusSelect`'s onChange already
  extracts `e.target.value` before calling the handler, and the backend
  now explicitly validates `typeof status === 'string'`, rejecting
  anything else with a clear 400 instead of a confusing type error.
- **Multer/file-upload errors** (oversized file, wrong type, too many
  files) are caught in `errorHandler.js` and mapped to a clear 400
  message, instead of falling through to a generic 500 that looks like a
  server crash.
- **State management** — the "Modify" editor and file-upload cell keep
  their own local `useState`, seeded once when editing/uploading starts;
  there's no `useEffect` that watches a prop and also causes that prop to
  change (the classic infinite-loop shape). Every save is one API call,
  one response, one state replace — no watcher loop possible.
- **Concurrency** — `updateAdvancePayment` and every inventory
  assign/dispatch/return endpoint lock the relevant row
  (`SELECT ... FOR UPDATE`) *before* reading the value a decision is
  based on, not after, so two overlapping requests can't both act on
  the same stale read.
- **DATE columns silently becoming JS `Date` objects** —
  `node-postgres` parses Postgres `DATE` columns into `Date` objects by
  default. Two real bugs come from that: (1) serializing one to JSON
  via `.toISOString()` reports UTC, which shifts the date by a day on
  any server not running in the UTC timezone, and (2) comparing a `Date`
  object against a plain `'YYYY-MM-DD'` request-body string with `<`
  doesn't sort chronologically — JS stringifies the `Date` via its
  default `toString()` first, which does not sort the same way as the
  actual dates. This was fixed once, globally, in `config/db.js`
  (`types.setTypeParser(1082, ...)`) rather than patched at each of the
  many call sites across both modules that compare or return a date.
- **Data integrity across views** — see section 5 above: nothing is ever
  copied between Dashboard / Completed / Deleted, so there's no
  duplication or dropped-file risk by construction, not by convention.

## 11. Design notes

- Palette: neutral slate background/text with a single teal accent, plus
  green/amber/red status colors. Maintenance-due rows get a soft amber
  row tint in addition to their tag, so they're visible at a glance while
  scrolling.
- Financial figures use IBM Plex Mono with tabular numerals so columns
  stay visually aligned.
- Toasts confirm every mutating action; destructive actions (permanent
  delete) require a second click within 3 seconds rather than a modal,
  to keep the Completed Orders list fast to work through.
- CSV exports (`utils/csv.js`) respect whatever search/filter is
  currently active on that page — and for Successful Order History
  specifically, export ALL matching rows, not just the current
  pagination page, since a file export should contain everything the
  user asked for, not just what's currently on screen.

## 12. Extending this further

- Swap the mocked `fetchTrackingStatusFromCourier` (trackingService.js)
  for real courier API calls once you have credentials.
- Swap the mocked `sendSms` (smsService.js) for a real Twilio call.
- Swap Multer's disk storage for S3/GCS if deploying across multiple
  server instances — only `middleware/upload.js` would need to change.
- Add pagination to `GET /api/purchases` if the active-purchase count
  grows large (Completed Orders already has it; the Dashboard doesn't yet
  since it's expected to stay smaller — only non-delivered + maintenance-
  due items live there).
- The current auth is single-tier (any logged-in user can see/edit
  everything, including permanent deletes). Add role-based access (e.g.
  an `is_admin` column) if that needs restricting.
- Employees currently have no dedicated management page (just the
  free-text assign dropdown + soft-delete endpoint) — add one if you
  need to bulk-edit departments/emails.
- The Inventory Calendar fetches all events in one request and groups
  them client-side; add `?month=` windowing to `GET /api/assets/calendar`
  if the number of assets grows large enough for that to matter.
