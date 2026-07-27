-- ---------------------------------------------------------------------
-- 012: PO Number + Partial/Split Delivery Tracking
--
-- Two additions to purchases:
--   - po_number: the vendor/procurement-side Purchase Order reference
--     (free text, optional) — distinct from this row's own internal id.
--   - delivered_quantity: how many units have actually arrived so far.
--     Covers "40 ordered, vendor delivers 10 now and 30 later" — each
--     delivery call increments this and creates that many new linked
--     assets (see purchaseController.recordPartialDelivery and
--     assetController.ensureAssetFromPurchase, now incremental rather
--     than all-or-nothing).
--
-- order_status gains a new value, 'partially_delivered', sitting
-- between 'out_for_delivery' and 'delivered' — set automatically once
-- delivered_quantity is more than 0 but less than quantity.
--
-- Run this once against your EXISTING database (schema.sql already
-- has this built in for anyone installing fresh).
-- ---------------------------------------------------------------------

ALTER TABLE purchases ADD COLUMN IF NOT EXISTS po_number VARCHAR(50);
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS delivered_quantity INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'purchases_delivered_quantity_check'
    ) THEN
        ALTER TABLE purchases ADD CONSTRAINT purchases_delivered_quantity_check
            CHECK (delivered_quantity >= 0 AND delivered_quantity <= quantity);
    END IF;
END $$;

-- Existing fully-delivered rows should read as "fully delivered" under
-- the new column too, not "0 of N delivered" — backfill once.
UPDATE purchases SET delivered_quantity = quantity
WHERE order_status = 'delivered' AND delivered_quantity = 0;

-- order_status's CHECK constraint needs 'partially_delivered' added —
-- constraints can't be altered in place, so drop and recreate it.
-- Uses the same auto-generated name Postgres gives an inline CHECK
-- (<table>_<column>_check); if you ever customized this constraint's
-- name, adjust the DROP line below accordingly.
ALTER TABLE purchases DROP CONSTRAINT IF EXISTS purchases_order_status_check;
ALTER TABLE purchases ADD CONSTRAINT purchases_order_status_check
    CHECK (order_status IN (
        'ordered', 'shipped', 'out_for_delivery',
        'partially_delivered', 'delivered', 'delayed', 'cancelled'
    ));

-- purchase_summary rebuilt with po_number + delivered_quantity appended
-- at the END of the column list (never repositioned).
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
