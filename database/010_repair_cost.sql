-- ---------------------------------------------------------------------
-- 010: Repair Cost Tracking
--
-- Adds repair_cost to asset_holdings — what a specific repair actually
-- cost, entered when the asset is RETURNED from maintenance (that's
-- when the real invoice/bill is known, not when it's dispatched).
-- Only meaningful for holder_type = 'repair' rows; NULL everywhere
-- else, and NULL is fine here too (not every repair has a cost yet,
-- or it may have been free under warranty).
--
-- This is what backs Inventory's new "Maintenance & AMC Spend" stat —
-- SUM(asset_holdings.repair_cost) + SUM(assets.amc_cost) — see
-- assetController.getAssetSummaryCounts.
--
-- Run this once against your EXISTING database (schema.sql already
-- has this built in for anyone installing fresh).
-- ---------------------------------------------------------------------

ALTER TABLE asset_holdings ADD COLUMN IF NOT EXISTS repair_cost NUMERIC(12,2);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'asset_holdings_repair_cost_check'
    ) THEN
        ALTER TABLE asset_holdings ADD CONSTRAINT asset_holdings_repair_cost_check
            CHECK (repair_cost IS NULL OR repair_cost >= 0);
    END IF;
END $$;
