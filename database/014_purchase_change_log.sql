-- ---------------------------------------------------------------------
-- 014: Purchase Change Log
--
-- Backs the new admin-only "Edit" capability on Asset Purchase / Order
-- History records (PATCH /api/purchases/:id -> updatePurchase). Mirrors
-- asset_change_log exactly (006_inventory_assets.sql / schema.sql):
-- one row per changed FIELD, written in the same transaction as the
-- update itself, so the visible data and its audit trail can never
-- disagree about what changed.
--
-- This is separate from financial_audit_log (which only ever tracks
-- Advance Money Paid corrections via the "Modify" toggle) — this table
-- covers every OTHER editable field on a purchase (item name, vendor,
-- quantity, unit cost, dates, PO number, etc.).
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS purchase_change_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_id     UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    field_name      VARCHAR(50) NOT NULL,
    previous_value  TEXT,
    new_value       TEXT,
    changed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_change_log_purchase ON purchase_change_log(purchase_id);
