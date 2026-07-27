-- =====================================================================
-- Migration 006: Inventory & Asset Assignment Management module.
-- New, independent subsystem — reuses `vendors` and `users` from the
-- existing schema but otherwise has its own tables. Run against your
-- existing database:
--   psql asset_dashboard -f database/006_inventory_assets.sql
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------
-- Employees who assets get assigned to. NEVER hard-deleted from the
-- app (no DELETE endpoint exists) — "removing" an employee sets
-- is_active = false, which just hides them from the assignment
-- dropdown. Combined with the name snapshot on asset_holdings below,
-- this means a historical "Assigned to Alice" entry survives even if
-- Alice is deactivated (or, as a defensive second layer, even if her
-- row were ever hard-deleted directly in the database).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employees (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(150) NOT NULL,
    department      VARCHAR(100),
    email           VARCHAR(255),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- The inventory item itself. Independent of `purchases` — an asset can
-- optionally reference the purchase order it came from (purchase_id)
-- for cross-reference, but carries its own vendor/cost/date fields so
-- the Inventory module works standalone even for assets entered
-- directly (e.g. donated equipment, or purchases made before this
-- module existed).
--
-- status is intentionally NOT settable to 'in_use' or 'under_repair'
-- via a plain update — those states are only ever reached through
-- POST /assets/:id/assign or /dispatch-repair, which atomically create
-- the matching asset_holdings row in the same transaction. This is an
-- application-enforced invariant (see purchaseController-style
-- assetController.js): "in_use"/"under_repair" always has exactly one
-- open holding row backing it; there is no code path that sets one
-- without the other.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assets (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_name          VARCHAR(200) NOT NULL,
    category            VARCHAR(100),
    serial_number       VARCHAR(150),
    purchase_id         UUID REFERENCES purchases(id) ON DELETE SET NULL,
    vendor_id           UUID REFERENCES vendors(id) ON DELETE RESTRICT,
    purchase_date       DATE,
    cost                NUMERIC(12,2) CHECK (cost IS NULL OR cost >= 0),
    warranty_expiry     DATE,

    status              VARCHAR(20) NOT NULL DEFAULT 'available'
                         CHECK (status IN ('available', 'in_use', 'under_repair', 'retired')),

    -- AMC (Annual Maintenance Contract)
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

CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
CREATE INDEX IF NOT EXISTS idx_assets_amc_end_date ON assets(amc_end_date) WHERE amc_end_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assets_warranty_expiry ON assets(warranty_expiry) WHERE warranty_expiry IS NOT NULL;

-- ---------------------------------------------------------------------
-- Assignment / repair-dispatch history — one row per "someone/somewhere
-- had this asset for a stretch of time". Covers BOTH employee
-- assignments and maintenance dispatches via holder_type, since both
-- are the same underlying concept ("who currently has this, since
-- when, expected/actual back when").
--
-- THE KEY INTEGRITY GUARANTEE: the partial unique index below allows
-- at most ONE open (returned_at IS NULL) holding per asset. This is
-- what makes "re-assigning never overwrites history" a database-level
-- fact rather than an application convention — a second concurrent
-- assign/dispatch attempt on an already-held asset fails outright
-- (23505 unique violation) instead of silently creating a conflicting
-- second "current holder".
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS asset_holdings (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id                UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    holder_type             VARCHAR(20) NOT NULL CHECK (holder_type IN ('employee', 'repair')),

    -- holder_type = 'employee'
    employee_id             UUID REFERENCES employees(id) ON DELETE SET NULL,
    employee_name_snapshot  VARCHAR(150), -- captured at assignment time; survives employee deactivation/deletion

    -- holder_type = 'repair'
    repair_vendor_name      VARCHAR(150),
    repair_contact_info     VARCHAR(255),

    started_at              DATE NOT NULL DEFAULT CURRENT_DATE,
    expected_return_date    DATE,
    returned_at              DATE,
    condition_note           TEXT,
    -- What status the asset was set to when this holding was closed —
    -- lets the History timeline show "returned, marked Under Repair"
    -- vs. "returned, marked Available" without re-deriving it later.
    resulting_status         VARCHAR(20) CHECK (resulting_status IN ('available', 'under_repair', 'retired') OR resulting_status IS NULL),

    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT return_after_start CHECK (returned_at IS NULL OR returned_at >= started_at)
);

CREATE INDEX IF NOT EXISTS idx_asset_holdings_asset ON asset_holdings(asset_id);

-- The core integrity guarantee described above.
CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_holdings_one_open_per_asset
    ON asset_holdings(asset_id) WHERE returned_at IS NULL;

-- ---------------------------------------------------------------------
-- Field-level change log — separate from asset_holdings because it
-- tracks EDITS (AMC renewed, cost corrected), not custody changes.
-- The History/Trail tab merges both via a UNION query (see
-- assetController.getAssetTimeline) into one chronological feed.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS asset_change_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id        UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    field_name      VARCHAR(50) NOT NULL,
    previous_value  TEXT,
    new_value       TEXT,
    changed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_change_log_asset ON asset_change_log(asset_id);

-- ---------------------------------------------------------------------
-- AMC contracts/invoices — multiple files per asset, same pattern as
-- purchase_files.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS asset_files (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id        UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    kind            VARCHAR(20) NOT NULL CHECK (kind IN ('amc_contract', 'amc_invoice')),
    file_path       TEXT NOT NULL,
    original_name   VARCHAR(255),
    mime_type       VARCHAR(100),
    size_bytes      INTEGER,
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_files_asset ON asset_files(asset_id);

-- Extend notification_log for AMC alerts: a new nullable asset_id
-- column (alongside the existing purchase_id) so one shared
-- notification_log/notification_service can log alerts for either
-- entity type, plus the trigger_type CHECK needs 'amc_expiring' added.
ALTER TABLE notification_log ADD COLUMN IF NOT EXISTS asset_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'notification_log_asset_id_fkey'
  ) THEN
    ALTER TABLE notification_log
      ADD CONSTRAINT notification_log_asset_id_fkey
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE notification_log DROP CONSTRAINT IF EXISTS notification_log_trigger_type_check;
ALTER TABLE notification_log ADD CONSTRAINT notification_log_trigger_type_check
    CHECK (trigger_type IN (
        'status_update', 'delivery_date_change',
        'payment_milestone', 'overdue_delivery',
        'payment_due_reminder', 'maintenance_due',
        'amc_expiring'
    ));

-- =====================================================================
-- View: asset_summary — one row per asset with the CURRENT open
-- holding (if any) and computed AMC/warranty alert flags. This is what
-- the Inventory dashboard, calendar, and detail view all query.
-- =====================================================================
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
    a.updated_at
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
