-- ---------------------------------------------------------------------
-- 019: Location-based PO Number Generator
--
-- PO numbers now follow the pattern po_<3-letter-location-code>_<NN>,
-- e.g. "po_kol_01" for the first PO ever generated (say, in Kolkata),
-- then "po_del_02" for the next one (in Delhi) -- the numeric suffix is
-- ONE GLOBAL counter shared across every location and both creation
-- flows (New Asset Purchase AND Inventory's New Asset), not a
-- per-location counter. See purchaseController.js's getNextPoNumber
-- for how the number is actually computed (same defensive
-- "number off the highest ever issued" pattern as asset_tag in
-- ensureAssetFromPurchase, immune to rows being deleted later).
--
-- Three schema changes:
--
--   1. locations.code -- a stable, admin-visible 3-letter PO prefix
--      per location (e.g. Kolkata -> KOL). Stored rather than
--      re-derived on the fly so it never silently changes if the
--      derivation logic changes later, and so collisions (two
--      locations that would both reduce to the same 3 letters) get
--      resolved ONCE, permanently, at creation time -- see
--      generateUniqueLocationCode in purchaseController.js for new
--      locations going forward, and the backfill DO block below for
--      every location that already existed before this migration.
--
--   2. assets.location_id -- NOTE: this is a pre-existing bug fix, not
--      new functionality. assetController.js's createAsset has
--      referenced an assets.location_id column since location support
--      was added to the standalone "New Asset" form, but no migration
--      ever actually created that column (only the free-text
--      `location` VARCHAR exists in schema.sql/007). That means every
--      POST /api/assets call has been throwing "column location_id
--      does not exist" against a fresh install. Fixing it here because
--      Task 3/4's location-based PO code lookup for directly-created
--      assets depends on a real FK to locations, not just free text.
--      Best-effort backfilled by name match for any assets that
--      already exist with a `location` string but no `location_id`.
--
--   3. assets.po_number -- assets created directly via Inventory's "New
--      Asset" form didn't have a PO number field at all before now.
--      For assets auto-linked FROM a purchase (ensureAssetFromPurchase),
--      this is backfilled/kept in sync with that purchase's po_number
--      instead of getting its own independently-generated one, since
--      it's the same purchase order, just represented as inventory
--      units.
-- ---------------------------------------------------------------------

ALTER TABLE locations ADD COLUMN IF NOT EXISTS code VARCHAR(3);

-- Backfill: assign every location that doesn't have a code yet a
-- unique 3-letter code, oldest location first. Tries the location's
-- own first 3 letters; on a collision with a code already assigned in
-- this same loop, falls back to "first two letters + digit".
DO $$
DECLARE
    loc RECORD;
    base_code VARCHAR(3);
    candidate VARCHAR(3);
    suffix INT;
BEGIN
    FOR loc IN SELECT id, name FROM locations WHERE code IS NULL ORDER BY id LOOP
        base_code := UPPER(LEFT(regexp_replace(loc.name, '[^a-zA-Z]', '', 'g'), 3));
        IF base_code = '' THEN
            base_code := 'GEN';
        ELSIF LENGTH(base_code) < 3 THEN
            base_code := RPAD(base_code, 3, 'X');
        END IF;

        candidate := base_code;
        suffix := 1;
        WHILE EXISTS (SELECT 1 FROM locations WHERE code = candidate AND id <> loc.id) LOOP
            candidate := LEFT(base_code, 2) || suffix::text;
            suffix := suffix + 1;
        END LOOP;

        UPDATE locations SET code = candidate WHERE id = loc.id;
    END LOOP;
END $$;

ALTER TABLE locations ALTER COLUMN code SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'locations_code_key') THEN
        ALTER TABLE locations ADD CONSTRAINT locations_code_key UNIQUE (code);
    END IF;
END $$;

-- Bug fix (see header note 2): assets.location_id never existed.
ALTER TABLE assets ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES locations(id) ON DELETE SET NULL;

UPDATE assets a
SET location_id = l.id
FROM locations l
WHERE a.location_id IS NULL AND a.location IS NOT NULL AND LOWER(TRIM(a.location)) = LOWER(TRIM(l.name));

ALTER TABLE assets ADD COLUMN IF NOT EXISTS po_number VARCHAR(50);

-- Backfill: an asset already linked to a purchase inherits that
-- purchase's po_number for consistency across the new location/PO
-- browsing page and the PO search feature.
UPDATE assets a
SET po_number = p.po_number
FROM purchases p
WHERE a.purchase_id = p.id AND a.po_number IS NULL AND p.po_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_locations_code ON locations(code);
CREATE INDEX IF NOT EXISTS idx_assets_po_number ON assets(po_number) WHERE po_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchases_po_number_lookup ON purchases(po_number) WHERE po_number IS NOT NULL;

-- purchase_summary rebuilt with delivery_location_id and
-- delivery_location_code appended at the END (never repositioned --
-- same convention as every prior migration in this file's lineage).
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
    l.code                              AS delivery_location_code
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

-- asset_summary rebuilt the same way -- location_id, location_code,
-- and po_number appended at the END, plus a new join to locations.
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
    a.po_number
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
