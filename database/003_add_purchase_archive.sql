-- =====================================================================
-- Migration 003: soft-delete / history support for purchases
-- Run against your existing database:
--   psql asset_dashboard -f database/003_add_purchase_archive.sql
-- =====================================================================

-- NULL = active (shows in the main table).
-- Non-NULL = "moved to history" at that timestamp — shows in the
-- History view for 3 months, then gets permanently purged by the
-- daily cron job (see backend/services/trackingService.js -> purgeOldHistory()).
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_purchases_archived_at ON purchases(archived_at);

-- Recreate the view to expose archived_at. IMPORTANT: Postgres only
-- allows CREATE OR REPLACE VIEW to ADD columns at the very END of the
-- column list — every existing column must keep its exact name and
-- position, or Postgres reads the shift as a rename and errors out.
-- That's why archived_at is appended AFTER updated_at below, instead
-- of sitting next to has_balance_due where it's logically grouped.
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
    p.archived_at                       -- appended at the end — see note above
FROM purchases p
JOIN vendors v ON v.id = p.vendor_id
LEFT JOIN locations l ON l.id = p.delivery_location_id
LEFT JOIN (
    SELECT purchase_id, SUM(amount) AS amount_paid
    FROM payments
    GROUP BY purchase_id
) pay ON pay.purchase_id = p.id;
