-- =====================================================================
-- Migration 022: Surface purchase-level insurance/invoice documents on
-- asset_summary, so the Inventory page can show + manage the SAME
-- insurance/invoice files as Order History, per asset (bulk, individual,
-- and partial-delivery units all get one since every inventory asset
-- traces back to the purchase it was delivered from via purchase_id).
--
-- This is purely additive — appends three new columns at the very end
-- of asset_summary, same convention as migration 021 (existing output
-- columns keep their exact name and position). No new tables, no data
-- migration, nothing dropped or rewritten.
--
-- Why this makes the two pages "just work" consistently: Inventory
-- reads/writes through the EXACT SAME purchase-level endpoints Order
-- History already uses (PATCH .../insurance, POST .../insurance-photos,
-- POST .../invoices, DELETE .../files/:fileId) — there is only one
-- underlying record (the purchase + its purchase_files rows) for a
-- whole batch, so a change made from either page is immediately true
-- for the other the next time it reads from the database.
--
-- Run against your existing database:
--   psql asset_dashboard -f database/022_inventory_purchase_documents.sql
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
    a.cost_with_tax,
    p.insurance_done                              AS purchase_insurance_done,
    COALESCE(pfiles.insurance_photos, '[]'::json) AS purchase_insurance_photos,
    COALESCE(pfiles.invoices, '[]'::json)         AS purchase_invoices
FROM assets a
LEFT JOIN vendors v ON v.id = a.vendor_id
LEFT JOIN asset_holdings h ON h.asset_id = a.id AND h.returned_at IS NULL
LEFT JOIN users cu ON cu.id = a.created_by
LEFT JOIN users au ON au.id = a.approved_by
LEFT JOIN locations loc ON loc.id = a.location_id
LEFT JOIN purchases p ON p.id = a.purchase_id
LEFT JOIN (
    SELECT
        asset_id,
        json_agg(json_build_object('id', id, 'url', file_path, 'name', original_name, 'uploaded_at', uploaded_at))
            FILTER (WHERE kind = 'amc_contract') AS amc_contracts,
        json_agg(json_build_object('id', id, 'url', file_path, 'name', original_name, 'uploaded_at', uploaded_at))
            FILTER (WHERE kind = 'amc_invoice') AS amc_invoices
    FROM asset_files
    GROUP BY asset_id
) files ON files.asset_id = a.id
LEFT JOIN (
    SELECT
        purchase_id,
        json_agg(json_build_object('id', id, 'url', file_path, 'name', original_name, 'uploaded_at', uploaded_at))
            FILTER (WHERE kind = 'insurance_photo') AS insurance_photos,
        json_agg(json_build_object('id', id, 'url', file_path, 'name', original_name, 'uploaded_at', uploaded_at))
            FILTER (WHERE kind = 'invoice') AS invoices
    FROM purchase_files
    GROUP BY purchase_id
) pfiles ON pfiles.purchase_id = a.purchase_id;
