-- ---------------------------------------------------------------------
-- 018: Asset / Purchase Approval Workflow
--
-- Nobody is auto-approved — every new purchase (New Asset Purchase on
-- the dashboard) and every new asset (New Asset in Inventory
-- Management) starts as 'pending' regardless of who created it,
-- including an admin's own entry. It still shows up immediately
-- everywhere it normally would (Order History / Inventory list, KPI
-- counts, etc.) so nothing silently disappears — the frontend just
-- renders a "Pending approval" badge plus who requested it until a
-- Senior or Admin approves or rejects it (see requireAdminOrSenior in
-- middleware/auth.js, PATCH /purchases/:id/approve and
-- PATCH /assets/:id/approve).
--
-- Two independent approval cycles, not one shared table, because the
-- two creation flows are independent (see purchaseController.
-- createPurchase/createPurchaseOrder and assetController.createAsset):
--   - purchases.approval_status: gates whether a delivered purchase's
--     units actually get auto-linked into Inventory (see
--     ensureAssetFromPurchase's new guard in assetController.js) —
--     the purchase record itself is visible right away either way.
--   - assets.approval_status: gates a directly-created Inventory asset
--     (the standalone "New Asset" form, no originating purchase). An
--     asset auto-created FROM an already-approved purchase inherits
--     'approved' directly (see purchaseController.js) — it doesn't
--     need its own separate review, since the purchase it came from
--     already passed one.
--
-- requested_by_name / requested_by_phone are captured from the
-- creation form itself (separate from created_by, which is always the
-- actual logged-in account) — on a shared/kiosk-style login this can
-- differ from whoever's technically logged in, and a phone number is
-- something no account currently has on file at all.
-- ---------------------------------------------------------------------

ALTER TABLE purchases ADD COLUMN IF NOT EXISTS approval_status VARCHAR(10) NOT NULL DEFAULT 'pending';
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS requested_by_name VARCHAR(150);
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS requested_by_phone VARCHAR(30);
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

ALTER TABLE assets ADD COLUMN IF NOT EXISTS approval_status VARCHAR(10) NOT NULL DEFAULT 'pending';
ALTER TABLE assets ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS requested_by_name VARCHAR(150);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS requested_by_phone VARCHAR(30);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchases_approval_status_check') THEN
        ALTER TABLE purchases ADD CONSTRAINT purchases_approval_status_check CHECK (approval_status IN ('pending', 'approved', 'rejected'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assets_approval_status_check') THEN
        ALTER TABLE assets ADD CONSTRAINT assets_approval_status_check CHECK (approval_status IN ('pending', 'approved', 'rejected'));
    END IF;
END $$;

-- Bootstrap: every row that already existed before this migration ran
-- went through the OLD (no-approval) flow and is treated as already
-- approved — nobody who already had a purchase/asset on record gets
-- it retroactively hidden or flagged pending.
UPDATE purchases SET approval_status = 'approved' WHERE approval_status = 'pending';
UPDATE assets SET approval_status = 'approved' WHERE approval_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_purchases_approval_status ON purchases(approval_status) WHERE approval_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_assets_approval_status ON assets(approval_status) WHERE approval_status = 'pending';

-- purchase_summary rebuilt with the new columns appended at the END
-- (never repositioned — see this file's sibling migrations for the
-- same convention), plus the requester/approver names joined in so
-- the frontend never has to make a second round trip just to show
-- "requested by X, approved by Y".
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
    p.rejection_reason
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

-- asset_summary rebuilt the same way — new columns appended at the
-- END, requester/approver names joined in.
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
    -- Straight-line depreciation: cost minus (cost / useful life in
    -- days) * days elapsed since purchase, floored at 0. NULL when
    -- useful_life_years, purchase_date, or cost isn't set — this is
    -- an opt-in figure, not something forced on every asset.
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
    a.rejection_reason
FROM assets a
LEFT JOIN vendors v ON v.id = a.vendor_id
LEFT JOIN asset_holdings h ON h.asset_id = a.id AND h.returned_at IS NULL
LEFT JOIN users cu ON cu.id = a.created_by
LEFT JOIN users au ON au.id = a.approved_by
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
