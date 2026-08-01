-- =====================================================================
-- Migration 021: Tax percentage + tax-inclusive totals.
--
-- Both the New Purchase flow and Inventory's standalone New Asset
-- form now accept an optional Tax (%), computed into a real total
-- alongside the existing pre-tax figure.
--
-- Deliberately additive, not a redefinition of what the EXISTING
-- total_cost / cost columns mean:
--   - purchases.total_cost stays exactly what it always was (quantity
--     * unit_cost, pre-tax) -- ensureAssetFromPurchase divides this by
--     quantity to price each auto-created inventory unit, and nothing
--     about that per-unit cost basis changes here.
--   - assets.cost stays exactly what it always was (the depreciation/
--     book-value calculation in asset_summary is built on it).
--
-- Instead, each table gets a nullable tax_percent and a new GENERATED
-- column carrying the tax-inclusive total:
--   - purchases.total_cost_with_tax = total_cost * (1 + tax_percent/100)
--   - assets.cost_with_tax          = cost * (1 + tax_percent/100)
--
-- tax_percent defaults to NULL (treated as 0 via COALESCE), so for
-- every purchase/asset that already exists, total_cost_with_tax /
-- cost_with_tax come out IDENTICAL to the existing pre-tax figure --
-- nothing about historical data changes. Only a NEW purchase/asset
-- where someone actually fills in a tax percentage will see the two
-- figures diverge.
--
-- purchase_summary's amount_remaining / has_balance_due now compute
-- against total_cost_with_tax instead of total_cost -- what's actually
-- owed to a vendor includes tax, so this is a correctness fix for any
-- purchase that has one, and a complete no-op (COALESCE(...,0) = 0)
-- for every purchase that doesn't.
--
-- Run against your existing database:
--   psql asset_dashboard -f database/021_purchase_and_asset_tax.sql
-- =====================================================================

ALTER TABLE purchases ADD COLUMN IF NOT EXISTS tax_percent NUMERIC(5,2) CHECK (tax_percent IS NULL OR tax_percent >= 0);
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS total_cost_with_tax NUMERIC(12,2)
    GENERATED ALWAYS AS (ROUND(quantity * unit_cost * (1 + COALESCE(tax_percent, 0) / 100), 2)) STORED;

ALTER TABLE assets ADD COLUMN IF NOT EXISTS tax_percent NUMERIC(5,2) CHECK (tax_percent IS NULL OR tax_percent >= 0);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS cost_with_tax NUMERIC(12,2)
    GENERATED ALWAYS AS (ROUND(cost * (1 + COALESCE(tax_percent, 0) / 100), 2)) STORED;

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
    p.total_cost_with_tax - COALESCE(pay.amount_paid, 0)   AS amount_remaining,
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
    (p.total_cost_with_tax - COALESCE(pay.amount_paid, 0)) > 0 AS has_balance_due,
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
    p.purchase_order_id,
    p.approval_status,
    p.created_by,
    cu.name                             AS created_by_name,
    p.requested_by_name,
    p.requested_by_phone,
    p.approved_by,
    au.name                             AS approved_by_name,
    p.approved_at,
    p.rejection_reason,
    p.delivery_location_id,
    l.code                              AS delivery_location_code,
    p.tax_percent,
    p.total_cost_with_tax
FROM purchases p
JOIN vendors v ON v.id = p.vendor_id
LEFT JOIN locations l ON l.id = p.delivery_location_id
LEFT JOIN users cu ON cu.id = p.created_by
LEFT JOIN users au ON au.id = p.approved_by
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

-- asset_summary: append tax_percent / cost_with_tax at the end (same
-- CREATE OR REPLACE VIEW constraint as every prior migration that's
-- touched this view -- existing output columns must keep their exact
-- name and position, new ones can only be appended).
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
    CASE
        WHEN a.useful_life_years IS NULL OR a.purchase_date IS NULL OR a.cost IS NULL THEN NULL
        ELSE GREATEST(0, ROUND(a.cost - (a.cost / (a.useful_life_years * 365.25)) * (CURRENT_DATE - a.purchase_date), 2))
    END AS current_book_value,
    a.approval_status,
    a.created_by,
    cu.name                             AS created_by_name,
    a.requested_by_name,
    a.requested_by_phone,
    a.approved_by,
    au.name                             AS approved_by_name,
    a.approved_at,
    a.rejection_reason,
    a.location_id,
    loc.code                            AS location_code,
    a.po_number,
    a.model_number,
    h.department_snapshot                AS current_employee_department,
    h.location_id                        AS current_holding_location_id,
    h.location_name_snapshot             AS current_holding_location,
    a.tax_percent,
    a.cost_with_tax
FROM assets a
LEFT JOIN vendors v ON v.id = a.vendor_id
LEFT JOIN asset_holdings h ON h.asset_id = a.id AND h.returned_at IS NULL
LEFT JOIN users cu ON cu.id = a.created_by
LEFT JOIN users au ON au.id = a.approved_by
LEFT JOIN locations loc ON loc.id = a.location_id
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
