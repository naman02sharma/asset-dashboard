-- ---------------------------------------------------------------------
-- 015: Multi-Item Purchase Orders
--
-- Adds purchase_order_id: a shared, purely cosmetic grouping tag that
-- lets several `purchases` rows (e.g. a chair, a table, and a hat)
-- created together in ONE "New Asset Purchase" submission be recognized
-- as belonging to the same vendor transaction, WITHOUT changing how any
-- individual item is tracked afterward — each item still has its own
-- independent order_status, partial-delivery progress, edits, and
-- Inventory rows (grouped by purchase_id exactly as before). NULL for
-- every purchase created the old single-item way, and for every item
-- created before this migration ran.
--
-- Run this once against your EXISTING database (schema.sql already has
-- this built in for anyone installing fresh).
-- ---------------------------------------------------------------------

ALTER TABLE purchases ADD COLUMN IF NOT EXISTS purchase_order_id UUID;

CREATE INDEX IF NOT EXISTS idx_purchases_purchase_order
    ON purchases(purchase_order_id) WHERE purchase_order_id IS NOT NULL;

-- purchase_summary rebuilt with created_at + purchase_order_id appended
-- at the END of the column list (never repositioned) — created_at is
-- newly exposed here so a multi-item batch's line items can be sorted
-- back into the order they were entered in.
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
    p.delivered_quantity,
    p.created_at,
    p.purchase_order_id
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
