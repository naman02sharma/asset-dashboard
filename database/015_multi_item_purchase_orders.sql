-- =====================================================================
-- 015_multi_item_purchase_orders.sql
-- Adds purchase_order_id to group multiple purchase line items that
-- were created together under one vendor/order. Nullable — existing
-- single-item purchases are unaffected and simply have NULL here.
-- =====================================================================

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS purchase_order_id UUID NULL;

CREATE INDEX IF NOT EXISTS idx_purchases_purchase_order_id
  ON purchases (purchase_order_id);
