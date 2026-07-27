-- =====================================================================
-- Asset Purchase Tracking Dashboard — Database Schema (PostgreSQL)
-- =====================================================================
-- Design notes:
--   * vendors, purchases, payments, and delivery_events are split into
--     separate tables so that a purchase can have MULTIPLE partial
--     payments and MULTIPLE tracking/status updates over its lifetime,
--     while still being cheap to query as one row per purchase via the
--     `purchase_summary` view (used directly by the dashboard table).
--   * All monetary columns use NUMERIC(12,2) — never FLOAT — to avoid
--     rounding errors in financial totals.
--   * Status values are constrained with CHECK instead of a Postgres
--     ENUM so new statuses can be added later without an ALTER TYPE.
--   * "Successful Order History" and "Maintenance due" are NOT separate
--     tables — they're just filtered views of the same `purchases` row
--     (order_status = 'delivered', and maintenance_status/date flags).
--     This is deliberate: moving a purchase between the dashboard and
--     history views never copies or duplicates a row, so vendor/
--     location/file relationships can never be dropped in the move.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- for gen_random_uuid()

-- ---------------------------------------------------------------------
-- Vendors: suppliers / websites purchases are made from
-- ---------------------------------------------------------------------
CREATE TABLE vendors (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(150) NOT NULL,
    website         VARCHAR(255),
    contact_email   VARCHAR(255),
    contact_phone   VARCHAR(50),
    gst_number      VARCHAR(20),
    address         TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Branches / delivery locations (kept normalized so reporting by
-- location is possible later, e.g. "all assets delivered to Mumbai HQ")
-- ---------------------------------------------------------------------
CREATE TABLE locations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(150) NOT NULL,        -- e.g. "Mumbai HQ", "Warehouse B"
    address         TEXT,
    gst_number      VARCHAR(20)
);

-- ---------------------------------------------------------------------
-- Purchases: one row per asset order (the core entity)
-- ---------------------------------------------------------------------
CREATE TABLE purchases (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_name               VARCHAR(200) NOT NULL,
    po_number               VARCHAR(50),  -- Purchase Order number — the vendor/procurement-side reference, distinct from this row's own internal id
    description             TEXT,
    vendor_id               UUID NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
    quantity                INTEGER NOT NULL CHECK (quantity > 0),
    delivered_quantity      INTEGER NOT NULL DEFAULT 0 CHECK (delivered_quantity >= 0 AND delivered_quantity <= quantity),
                             -- for split/partial deliveries — e.g. 40 ordered, 10 arrive now, 30 later. Each
                             -- delivery increments this (see purchaseController.recordPartialDelivery), and
                             -- creates that many new linked assets rather than waiting for the whole order.
    unit_cost               NUMERIC(12,2) NOT NULL CHECK (unit_cost >= 0),
    total_cost              NUMERIC(12,2) GENERATED ALWAYS AS (quantity * unit_cost) STORED,

    order_status            VARCHAR(30) NOT NULL DEFAULT 'ordered'
                             CHECK (order_status IN (
                                 'ordered', 'shipped', 'out_for_delivery',
                                 'partially_delivered', 'delivered', 'delayed', 'cancelled'
                             )),

    order_date              DATE NOT NULL DEFAULT CURRENT_DATE,
    expected_delivery_date  DATE,
    actual_delivery_date    DATE,
    delivery_location_id    UUID REFERENCES locations(id) ON DELETE SET NULL,

    -- courier/tracking integration fields (see services/trackingService.js)
    courier_name            VARCHAR(100),
    tracking_number         VARCHAR(150),
    tracking_url            VARCHAR(500),

    -- Insurance: whether this asset is insured. Uploaded proof lives in
    -- purchase_files (many files per purchase) — see that table below.
    -- insurance_photo_path/invoice_path are legacy single-file columns,
    -- kept only so old data isn't orphaned; new uploads always go to
    -- purchase_files.
    insurance_done          BOOLEAN NOT NULL DEFAULT false,
    insurance_photo_path    TEXT,
    invoice_path            TEXT,

    -- Maintenance scheduling. maintenance_status is NULL when nothing
    -- is scheduled, 'scheduled' while a future date is pending. It
    -- surfaces as a dashboard alert 7 days before maintenance_date
    -- (see is_maintenance_due in the view below).
    maintenance_date            DATE,
    maintenance_period_months   INTEGER,
    maintenance_recurring       BOOLEAN NOT NULL DEFAULT false,
    maintenance_cost            NUMERIC(12,2),
    maintenance_status          VARCHAR(20)
                                 CHECK (maintenance_status IN ('scheduled', 'completed') OR maintenance_status IS NULL),
    maintenance_completed_at    TIMESTAMPTZ,

    -- NULL = active. Non-NULL = "moved to history" (soft-deleted) at
    -- that timestamp — shown in the Deleted Items view for 3 months,
    -- then permanently purged by the daily cron job. This is separate
    -- from order_status = 'delivered', which is what routes a purchase
    -- to the Successful Order History page instead.
    archived_at             TIMESTAMPTZ,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_purchases_archived_at ON purchases(archived_at);
CREATE INDEX idx_purchases_status ON purchases(order_status);
CREATE INDEX idx_purchases_vendor ON purchases(vendor_id);
CREATE INDEX idx_purchases_expected_delivery ON purchases(expected_delivery_date);
CREATE INDEX idx_purchases_maintenance_date ON purchases(maintenance_date)
    WHERE maintenance_status = 'scheduled';
-- Speeds up the Successful Order History page's default sort/filter.
CREATE INDEX idx_purchases_delivered ON purchases(actual_delivery_date)
    WHERE order_status = 'delivered';

-- ---------------------------------------------------------------------
-- Payments: supports partial/installment payments per purchase.
-- amount can be negative — that represents a correction/adjustment
-- (e.g. "Modify" editing Advance Money Paid down) rather than a real
-- new payment; it can never be exactly zero (CHECK amount <> 0), since
-- a zero-amount row wouldn't mean anything and is rejected up front by
-- the API instead of ever reaching this table.
-- ---------------------------------------------------------------------
CREATE TABLE payments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_id     UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    amount          NUMERIC(12,2) NOT NULL CHECK (amount <> 0),
    paid_on         DATE NOT NULL DEFAULT CURRENT_DATE,
    method          VARCHAR(50),        -- e.g. "Bank Transfer", "Credit Card", "Adjustment (Modify)"
    reference       VARCHAR(150),       -- transaction / invoice reference
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_purchase ON payments(purchase_id);

-- ---------------------------------------------------------------------
-- Financial audit trail — a hidden log (no UI screen surfaces this by
-- design). Every "Modify" edit to Advance Money Paid writes one row,
-- so a disputed number can always be traced back to who changed it,
-- what it was, and when.
-- ---------------------------------------------------------------------
CREATE TABLE financial_audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_id     UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    field_name      VARCHAR(50) NOT NULL,
    previous_value  NUMERIC(12,2),
    new_value       NUMERIC(12,2),
    changed_by      UUID,               -- references users(id); FK added after users table exists (002_add_users.sql)
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_financial_audit_purchase ON financial_audit_log(purchase_id);

-- ---------------------------------------------------------------------
-- Multiple uploaded files per purchase — an asset can have several
-- insurance photos and several invoice pages, so this is a proper
-- one-to-many table rather than a single-path column.
-- ---------------------------------------------------------------------
CREATE TABLE purchase_files (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_id     UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    kind            VARCHAR(20) NOT NULL CHECK (kind IN ('insurance_photo', 'invoice')),
    file_path       TEXT NOT NULL,
    original_name   VARCHAR(255),
    mime_type       VARCHAR(100),
    size_bytes      INTEGER,
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_purchase_files_purchase ON purchase_files(purchase_id);

-- ---------------------------------------------------------------------
-- Delivery / status events: append-only audit trail, populated either
-- manually or automatically by the courier webhook (trackingService.js)
-- ---------------------------------------------------------------------
CREATE TABLE delivery_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_id     UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    status          VARCHAR(30) NOT NULL,
    note            TEXT,
    source          VARCHAR(20) NOT NULL DEFAULT 'manual'  -- 'manual' | 'courier_webhook'
                     CHECK (source IN ('manual', 'courier_webhook')),
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_delivery_events_purchase ON delivery_events(purchase_id);

-- ---------------------------------------------------------------------
-- Notification log: every email/SMS sent, so we never double-send for
-- the same trigger (e.g. the same maintenance alert every cron tick).
-- ---------------------------------------------------------------------
CREATE TABLE notification_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_id     UUID REFERENCES purchases(id) ON DELETE CASCADE,
    asset_id        UUID, -- FK added after `assets` is created further down this file
    trigger_type    VARCHAR(40) NOT NULL
                     CHECK (trigger_type IN (
                         'status_update', 'delivery_date_change',
                         'payment_milestone', 'overdue_delivery',
                         'payment_due_reminder', 'maintenance_due',
                         'amc_expiring'
                     )),
    recipient       VARCHAR(255) NOT NULL,
    subject         VARCHAR(255) NOT NULL,
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    success         BOOLEAN NOT NULL DEFAULT true
);

-- =====================================================================
-- View: purchase_summary
-- One row per purchase with computed financials + convenience fields.
-- This is what the dashboard table, Successful Order History page,
-- and KPI cards all query directly.
-- =====================================================================
CREATE OR REPLACE VIEW purchase_summary AS
SELECT
    p.id,
    p.item_name,
    p.description,
    v.name                              AS vendor_name,
    v.website                           AS vendor_website,
    v.gst_number                        AS vendor_gst_number,
    v.address                           AS vendor_address,
    v.contact_phone                     AS vendor_phone,
    p.quantity,
    p.unit_cost,
    p.total_cost,
    COALESCE(pay.amount_paid, 0)                          AS amount_paid,
    p.total_cost - COALESCE(pay.amount_paid, 0)            AS amount_remaining,
    p.order_status,
    p.order_date,
    p.expected_delivery_date,
    p.actual_delivery_date,
    l.name                              AS delivery_location,
    l.address                           AS delivery_location_address,
    l.gst_number                        AS delivery_location_gst_number,
    p.courier_name,
    p.tracking_number,
    p.tracking_url,
    p.insurance_done,
    p.insurance_photo_path,
    p.invoice_path,
    (p.expected_delivery_date IS NOT NULL
        AND p.expected_delivery_date < CURRENT_DATE
        AND p.order_status NOT IN ('delivered', 'cancelled'))  AS is_overdue,
    (p.total_cost - COALESCE(pay.amount_paid, 0)) > 0          AS has_balance_due,
    p.archived_at,
    p.updated_at,
    p.maintenance_date,
    p.maintenance_period_months,
    p.maintenance_recurring,
    p.maintenance_cost,
    p.maintenance_status,
    p.maintenance_completed_at,
    (p.maintenance_status = 'scheduled'
        AND p.maintenance_date IS NOT NULL
        AND p.maintenance_date <= CURRENT_DATE + INTERVAL '7 days')   AS is_maintenance_due,
    COALESCE(files.insurance_photos, '[]'::json)  AS insurance_photos,
    COALESCE(files.invoices, '[]'::json)          AS invoices,
    p.po_number,
    p.delivered_quantity
FROM purchases p
JOIN vendors v ON v.id = p.vendor_id
LEFT JOIN locations l ON l.id = p.delivery_location_id
LEFT JOIN (
    SELECT purchase_id, SUM(amount) AS amount_paid
    FROM payments
    GROUP BY purchase_id
) pay ON pay.purchase_id = p.id
LEFT JOIN (
    SELECT
        purchase_id,
        json_agg(json_build_object('id', id, 'url', file_path, 'name', original_name, 'uploaded_at', uploaded_at))
            FILTER (WHERE kind = 'insurance_photo') AS insurance_photos,
        json_agg(json_build_object('id', id, 'url', file_path, 'name', original_name, 'uploaded_at', uploaded_at))
            FILTER (WHERE kind = 'invoice') AS invoices
    FROM purchase_files
    GROUP BY purchase_id
) files ON files.purchase_id = p.id;

-- =====================================================================
-- Inventory & Asset Assignment Management module
-- =====================================================================

CREATE TABLE employees (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(150) NOT NULL,
    department      VARCHAR(100),
    email           VARCHAR(255),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE assets (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_name          VARCHAR(200) NOT NULL,
    category            VARCHAR(100),
    serial_number       VARCHAR(150),
    asset_tag           VARCHAR(50) UNIQUE,  -- internal tracking code for physical tagging/scanning — separate from the manufacturer's serial_number
    location            VARCHAR(150),        -- where it physically lives (site/floor/department) — distinct from the employee it might be assigned to
    purchase_id         UUID REFERENCES purchases(id) ON DELETE SET NULL,
    vendor_id           UUID REFERENCES vendors(id) ON DELETE RESTRICT,
    purchase_date       DATE,
    cost                NUMERIC(12,2) CHECK (cost IS NULL OR cost >= 0),
    warranty_expiry     DATE,
    useful_life_years   INTEGER CHECK (useful_life_years IS NULL OR useful_life_years > 0),
                         -- straight-line depreciation assumption; NULL = "not depreciated/tracked" (current_book_value stays NULL in asset_summary)
    status              VARCHAR(20) NOT NULL DEFAULT 'available'
                         CHECK (status IN ('available', 'in_use', 'under_repair', 'retired')),
    amc_provider        VARCHAR(150),
    amc_start_date      DATE,
    amc_end_date        DATE,
    amc_cost            NUMERIC(12,2) CHECK (amc_cost IS NULL OR amc_cost >= 0),
    CONSTRAINT amc_date_order CHECK (
        amc_start_date IS NULL OR amc_end_date IS NULL OR amc_end_date >= amc_start_date
    ),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_assets_status ON assets(status);
CREATE INDEX idx_assets_amc_end_date ON assets(amc_end_date) WHERE amc_end_date IS NOT NULL;
CREATE INDEX idx_assets_warranty_expiry ON assets(warranty_expiry) WHERE warranty_expiry IS NOT NULL;
CREATE INDEX idx_assets_asset_tag ON assets(asset_tag) WHERE asset_tag IS NOT NULL;

ALTER TABLE notification_log ADD CONSTRAINT notification_log_asset_id_fkey
    FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE;

-- Assignment / repair-dispatch history. The partial unique index below
-- is the key integrity guarantee: at most ONE open (returned_at IS
-- NULL) holding per asset, enforced by Postgres itself — a second
-- concurrent assign/dispatch on an already-held asset fails outright
-- rather than silently overwriting who has it. See assetController.js.
CREATE TABLE asset_holdings (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id                UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    holder_type             VARCHAR(20) NOT NULL CHECK (holder_type IN ('employee', 'repair')),
    employee_id             UUID REFERENCES employees(id) ON DELETE SET NULL,
    employee_name_snapshot  VARCHAR(150),
    repair_vendor_name      VARCHAR(150),
    repair_contact_info     VARCHAR(255),
    started_at              DATE NOT NULL DEFAULT CURRENT_DATE,
    expected_return_date    DATE,
    returned_at             DATE,
    condition_note          TEXT,
    resulting_status        VARCHAR(20) CHECK (resulting_status IN ('available', 'under_repair', 'retired') OR resulting_status IS NULL),
    repair_cost             NUMERIC(12,2) CHECK (repair_cost IS NULL OR repair_cost >= 0),
                             -- what this specific repair actually cost, entered at return time (when the real invoice/bill is known) — only meaningful for holder_type = 'repair'
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT return_after_start CHECK (returned_at IS NULL OR returned_at >= started_at)
);

CREATE INDEX idx_asset_holdings_asset ON asset_holdings(asset_id);
CREATE UNIQUE INDEX idx_asset_holdings_one_open_per_asset
    ON asset_holdings(asset_id) WHERE returned_at IS NULL;

CREATE TABLE asset_change_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id        UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    field_name      VARCHAR(50) NOT NULL,
    previous_value  TEXT,
    new_value       TEXT,
    changed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_asset_change_log_asset ON asset_change_log(asset_id);

CREATE TABLE asset_files (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id        UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    kind            VARCHAR(20) NOT NULL CHECK (kind IN ('amc_contract', 'amc_invoice')),
    file_path       TEXT NOT NULL,
    original_name   VARCHAR(255),
    mime_type       VARCHAR(100),
    size_bytes      INTEGER,
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_asset_files_asset ON asset_files(asset_id);

-- One row per asset with its CURRENT open holding (if any) and
-- computed AMC/warranty alert flags — queried directly by the
-- Inventory dashboard, calendar, and detail view.
CREATE OR REPLACE VIEW asset_summary AS
SELECT
    a.id,
    a.asset_name,
    a.category,
    a.serial_number,
    a.purchase_id,
    v.name                              AS vendor_name,
    a.purchase_date,
    a.cost,
    a.warranty_expiry,
    a.status,
    a.amc_provider,
    a.amc_start_date,
    a.amc_end_date,
    a.amc_cost,
    (a.amc_end_date IS NOT NULL AND a.amc_end_date <= CURRENT_DATE + INTERVAL '30 days')
                                         AS is_amc_expiring_soon,
    (a.warranty_expiry IS NOT NULL AND a.warranty_expiry <= CURRENT_DATE + INTERVAL '30 days')
                                         AS is_warranty_expiring_soon,
    h.id                                 AS current_holding_id,
    h.holder_type                        AS current_holder_type,
    h.employee_id                        AS current_employee_id,
    h.employee_name_snapshot             AS current_employee_name,
    h.repair_vendor_name                 AS current_repair_vendor,
    h.repair_contact_info                AS current_repair_contact,
    h.started_at                         AS current_holding_started_at,
    h.expected_return_date               AS current_holding_expected_return,
    COALESCE(files.amc_contracts, '[]'::json)  AS amc_contracts,
    COALESCE(files.amc_invoices, '[]'::json)   AS amc_invoices,
    a.created_at,
    a.updated_at,
    a.asset_tag,
    a.location,
    a.useful_life_years,
    -- Straight-line depreciation: cost minus (cost / useful life in
    -- days) * days elapsed since purchase, floored at 0. NULL when
    -- useful_life_years, purchase_date, or cost isn't set — this is
    -- an opt-in figure, not something forced on every asset.
    CASE
        WHEN a.useful_life_years IS NULL OR a.purchase_date IS NULL OR a.cost IS NULL THEN NULL
        ELSE GREATEST(0, ROUND(a.cost - (a.cost / (a.useful_life_years * 365.25)) * (CURRENT_DATE - a.purchase_date), 2))
    END AS current_book_value
FROM assets a
LEFT JOIN vendors v ON v.id = a.vendor_id
LEFT JOIN asset_holdings h ON h.asset_id = a.id AND h.returned_at IS NULL
LEFT JOIN (
    SELECT
        asset_id,
        json_agg(json_build_object('id', id, 'url', file_path, 'name', original_name, 'uploaded_at', uploaded_at))
            FILTER (WHERE kind = 'amc_contract') AS amc_contracts,
        json_agg(json_build_object('id', id, 'url', file_path, 'name', original_name, 'uploaded_at', uploaded_at))
            FILTER (WHERE kind = 'amc_invoice') AS amc_invoices
    FROM asset_files
    GROUP BY asset_id
) files ON files.asset_id = a.id;

-- =====================================================================
-- Password reset tokens
-- References users(id) — safe here because fresh installs run
-- 002_add_users.sql BEFORE this file (see README/setup instructions).
-- Only the SHA-256 hash of the raw token is stored, mirroring how
-- password_hash itself is never stored in plaintext; the raw token
-- only ever exists in the emailed link and briefly in memory server-
-- side while verifying it (see authController.js).
-- =====================================================================
CREATE TABLE password_reset_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  VARCHAR(64) NOT NULL UNIQUE,  -- sha256 hex digest
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_password_reset_tokens_user ON password_reset_tokens(user_id);

-- =====================================================================
-- No seed data here on purpose — a fresh install of this schema starts
-- completely empty. If you want a few sample rows to click around
-- before entering real purchases, run database/seed_sample_data.sql
-- separately (and database/clear_seed_data.sql to remove them later).
-- =====================================================================
