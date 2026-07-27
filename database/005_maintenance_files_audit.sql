-- =====================================================================
-- Migration 005: multi-file uploads, financial audit trail, and
-- maintenance scheduling with 7-day dashboard alerts.
-- Run against your existing database:
--   psql asset_dashboard -f database/005_maintenance_files_audit.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- Multiple files per purchase (insurance photos AND invoices can now
-- each have many). Replaces the old single insurance_photo_path /
-- invoice_path columns going forward — those columns are left in place
-- (unused) rather than dropped, so this migration is non-destructive
-- and reversible; any file already referenced by them is copied into
-- this table below so nothing already uploaded is lost.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_files (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_id     UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    kind            VARCHAR(20) NOT NULL CHECK (kind IN ('insurance_photo', 'invoice')),
    file_path       TEXT NOT NULL,       -- public path, e.g. /uploads/invoices/xyz.pdf
    original_name   VARCHAR(255),
    mime_type       VARCHAR(100),
    size_bytes      INTEGER,
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_files_purchase ON purchase_files(purchase_id);

-- Carry over anything already uploaded under the old single-file columns.
INSERT INTO purchase_files (purchase_id, kind, file_path)
SELECT id, 'insurance_photo', insurance_photo_path FROM purchases
WHERE insurance_photo_path IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO purchase_files (purchase_id, kind, file_path)
SELECT id, 'invoice', invoice_path FROM purchases
WHERE invoice_path IS NOT NULL
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- Financial audit trail — a hidden log (no UI screen shows this by
-- design; it exists for accountability if a paid amount is questioned
-- later). Every "Modify" edit to Advance Money Paid writes one row here.
--
-- NOTE: this CREATE TABLE must run BEFORE the FK-check DO block below.
-- On a FRESH install, schema.sql creates financial_audit_log before the
-- users table exists (users is added later by 002_add_users.sql), so
-- schema.sql can't declare changed_by's foreign key inline. This
-- migration always runs after 002, so:
--   - if financial_audit_log doesn't exist at all yet (e.g. this is
--     effectively a fresh install path, or schema.sql wasn't run),
--     CREATE TABLE below makes it with the FK already inline, and
--   - if financial_audit_log already exists without the FK (the
--     schema.sql case this migration was designed for), CREATE TABLE
--     IF NOT EXISTS is a no-op and the DO block below adds the FK.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS financial_audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_id     UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    field_name      VARCHAR(50) NOT NULL,
    previous_value  NUMERIC(12,2),
    new_value       NUMERIC(12,2),
    changed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_financial_audit_purchase ON financial_audit_log(purchase_id);

-- Guarded so it's a no-op on a database that already has the FK
-- (e.g. one where the CREATE TABLE above just added it inline because
-- financial_audit_log didn't exist yet at all).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'financial_audit_log_changed_by_fkey'
  ) THEN
    ALTER TABLE financial_audit_log
      ADD CONSTRAINT financial_audit_log_changed_by_fkey
      FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Advance-payment corrections need to be able to go negative (e.g.
-- "actually only ₹5,000 was paid, not ₹8,000" -> a -3000 adjustment
-- row). The original CHECK (amount > 0) only allowed positive
-- payments; relax it to "not zero" so corrections are possible while
-- still rejecting no-op rows.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_amount_check;
ALTER TABLE payments ADD CONSTRAINT payments_amount_check CHECK (amount <> 0);

-- notification_log's trigger_type CHECK constraint doesn't yet know
-- about 'maintenance_due' — without this, the first maintenance alert
-- email would fail to even log (constraint violation), even though
-- the email itself would have sent fine.
ALTER TABLE notification_log DROP CONSTRAINT IF EXISTS notification_log_trigger_type_check;
ALTER TABLE notification_log ADD CONSTRAINT notification_log_trigger_type_check
    CHECK (trigger_type IN (
        'status_update', 'delivery_date_change',
        'payment_milestone', 'overdue_delivery',
        'payment_due_reminder', 'maintenance_due'
    ));

-- ---------------------------------------------------------------------
-- Maintenance scheduling. maintenance_status is NULL when no
-- maintenance is scheduled, 'scheduled' while a future date is
-- pending, and briefly 'completed' at the moment it's marked done
-- (immediately recalculated back to 'scheduled' with a new date if
-- recurring, or cleared to NULL if not — see
-- purchaseController.completeMaintenance).
-- ---------------------------------------------------------------------
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS maintenance_date            DATE;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS maintenance_period_months   INTEGER;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS maintenance_recurring       BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS maintenance_cost            NUMERIC(12,2);
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS maintenance_status          VARCHAR(20)
    CHECK (maintenance_status IN ('scheduled', 'completed') OR maintenance_status IS NULL);
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS maintenance_completed_at    TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_purchases_maintenance_date ON purchases(maintenance_date)
    WHERE maintenance_status = 'scheduled';

-- ---------------------------------------------------------------------
-- Recreate the view. Same append-only-at-the-end rule as migrations
-- 003/004 (see comments there) — every prior column keeps its exact
-- name and position; only new columns are added, all at the end.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW purchase_summary AS
SELECT
    p.id,
    p.item_name,
    p.description,
    v.name                              AS vendor_name,
    v.website                           AS vendor_website,
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
    p.courier_name,
    p.tracking_number,
    p.tracking_url,
    (p.expected_delivery_date IS NOT NULL
        AND p.expected_delivery_date < CURRENT_DATE
        AND p.order_status NOT IN ('delivered', 'cancelled'))  AS is_overdue,
    (p.total_cost - COALESCE(pay.amount_paid, 0)) > 0          AS has_balance_due,
    p.updated_at,
    p.archived_at,
    v.gst_number                        AS vendor_gst_number,
    v.address                           AS vendor_address,
    v.contact_phone                     AS vendor_phone,
    l.address                           AS delivery_location_address,
    l.gst_number                        AS delivery_location_gst_number,
    p.insurance_done,
    p.insurance_photo_path,
    p.invoice_path,
    -- --- everything below is new in migration 005 ---
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
    COALESCE(files.invoices, '[]'::json)          AS invoices
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