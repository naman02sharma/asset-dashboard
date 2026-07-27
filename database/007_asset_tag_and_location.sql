-- ---------------------------------------------------------------------
-- 007: Asset Tag + Location
--
-- Two fields that are standard in real inventory/asset-tracking
-- systems and were missing here:
--   - asset_tag: an internal tracking code for physical tagging/
--     scanning (e.g. "IT-2026-014"), distinct from serial_number
--     (which is the manufacturer's own serial, not something you
--     choose). Optional and unique when set — most existing rows will
--     start out NULL, which is fine (NULLs don't conflict under a
--     UNIQUE constraint in Postgres).
--   - location: WHERE the asset physically lives (site/floor/
--     department), independent of WHO it's assigned to (that's
--     already tracked via asset_holdings/current_employee_name).
--
-- Run this once against your EXISTING database (schema.sql already
-- has both built in for anyone installing fresh).
-- ---------------------------------------------------------------------

ALTER TABLE assets ADD COLUMN IF NOT EXISTS asset_tag VARCHAR(50);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS location VARCHAR(150);

-- Guard against re-running this file adding the constraint twice.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'assets_asset_tag_key'
    ) THEN
        ALTER TABLE assets ADD CONSTRAINT assets_asset_tag_key UNIQUE (asset_tag);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_assets_asset_tag ON assets(asset_tag) WHERE asset_tag IS NOT NULL;

-- asset_summary is rebuilt with the two new columns appended at the
-- END of the column list (never repositioned) so nothing that already
-- reads this view by column order breaks.
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
    a.location
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
