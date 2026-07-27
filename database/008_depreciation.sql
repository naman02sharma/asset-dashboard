-- ---------------------------------------------------------------------
-- 008: Depreciation / Current Book Value
--
-- Adds an OPT-IN straight-line depreciation figure to assets:
--   - useful_life_years: how many years you expect to get out of this
--     asset before it's worth nothing. Nullable — leave it blank and
--     this asset is simply never depreciated (current_book_value
--     stays NULL rather than defaulting to some guessed lifespan).
--   - current_book_value: computed in asset_summary (not stored) —
--     cost minus (cost / useful-life-in-days) * days elapsed since
--     purchase, floored at 0.
--
-- Run this once against your EXISTING database (schema.sql already
-- has both built in for anyone installing fresh).
-- ---------------------------------------------------------------------

ALTER TABLE assets ADD COLUMN IF NOT EXISTS useful_life_years INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'assets_useful_life_years_check'
    ) THEN
        ALTER TABLE assets ADD CONSTRAINT assets_useful_life_years_check
            CHECK (useful_life_years IS NULL OR useful_life_years > 0);
    END IF;
END $$;

-- asset_summary rebuilt with useful_life_years + current_book_value
-- appended at the END of the column list (never repositioned) so
-- nothing that already reads this view by column order breaks.
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
