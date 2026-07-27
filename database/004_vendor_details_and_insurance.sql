-- =====================================================================
-- Migration 004: vendor GST/address/phone, location GST, and
-- per-purchase insurance tracking (status + uploaded photo/invoice).
-- Run against your existing database:
--   psql asset_dashboard -f database/004_vendor_details_and_insurance.sql
-- =====================================================================

ALTER TABLE vendors   ADD COLUMN IF NOT EXISTS gst_number VARCHAR(20);
ALTER TABLE vendors   ADD COLUMN IF NOT EXISTS address    TEXT;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS gst_number VARCHAR(20);

ALTER TABLE purchases ADD COLUMN IF NOT EXISTS insurance_done        BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS insurance_photo_path  TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS invoice_path          TEXT;

-- Recreate the view to expose the new columns. IMPORTANT: same rule as
-- migration 003 — Postgres only allows CREATE OR REPLACE VIEW to ADD
-- columns at the very END of the column list. Every column from the
-- migration-003 version of this view (ending in ...updated_at,
-- archived_at) must keep its exact name and position, so all of this
-- migration's new columns are appended AFTER archived_at, not grouped
-- next to the vendor/location fields they logically belong with.
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
    -- --- everything below is new in this migration, appended at the end ---
    v.gst_number                        AS vendor_gst_number,
    v.address                           AS vendor_address,
    v.contact_phone                     AS vendor_phone,
    l.address                           AS delivery_location_address,
    l.gst_number                        AS delivery_location_gst_number,
    p.insurance_done,
    p.insurance_photo_path,
    p.invoice_path
FROM purchases p
JOIN vendors v ON v.id = p.vendor_id
LEFT JOIN locations l ON l.id = p.delivery_location_id
LEFT JOIN (
    SELECT purchase_id, SUM(amount) AS amount_paid
    FROM payments
    GROUP BY purchase_id
) pay ON pay.purchase_id = p.id;
