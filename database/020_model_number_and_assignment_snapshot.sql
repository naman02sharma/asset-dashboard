-- =====================================================================
-- Migration 020: Model number + assignment-time snapshots.
--
-- Two independent additions, both requested together:
--
--   1. assets.model_number -- a second identifying field alongside
--      serial_number. Some assets are more reliably tracked by model
--      number than by serial number (or vice versa) -- both are now
--      optional/either-or, matching how serial_number already worked.
--
--   2. asset_holdings.department_snapshot / location_id /
--      location_name_snapshot -- when an asset is assigned to an
--      employee, the assignment form now also asks for the employee's
--      location and department AT THAT TIME. Mirrors the existing
--      employee_name_snapshot column: captured once, at assignment,
--      and never silently rewritten later even if the employee's own
--      profile (employees.department) changes afterward -- so the
--      History/Trail timeline stays an accurate record of what was
--      true when the assignment happened, not a reflection of
--      whatever the employee's current profile says today.
--
--      location_id is a real FK to `locations` (same table every
--      other location picker in this app already uses -- Asset
--      Purchase, Inventory's New Asset, Location POs), so this new
--      field is consistent with the rest of the app rather than a
--      free-floating text field. location_name_snapshot survives even
--      if a location is ever renamed or removed.
--
--      asset_holdings.started_at already existed (DATE NOT NULL
--      DEFAULT CURRENT_DATE) -- it silently defaulted to "today" with
--      no way to pick a different date from the UI. No schema change
--      needed there; the assign form now sends it explicitly instead
--      of relying on the silent default.
--
-- Run against your existing database:
--   psql asset_dashboard -f database/020_model_number_and_assignment_snapshot.sql
-- =====================================================================

ALTER TABLE assets ADD COLUMN IF NOT EXISTS model_number VARCHAR(150);

ALTER TABLE asset_holdings ADD COLUMN IF NOT EXISTS department_snapshot VARCHAR(100);
ALTER TABLE asset_holdings ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE asset_holdings ADD COLUMN IF NOT EXISTS location_name_snapshot VARCHAR(150);

-- asset_summary needs to expose the new assets column and the new
-- current-holding snapshot fields. CREATE OR REPLACE is safe here
-- (same pattern every prior view-touching migration in this project
-- uses) since it's a pure column addition, not a reordering/removal
-- of any existing output column.
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
    h.location_name_snapshot             AS current_holding_location
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
