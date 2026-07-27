-- ---------------------------------------------------------------------
-- 011: User Roles (Admin / Employee)
--
-- Two-role model:
--   - admin:    can delete/retire/edit/financially-modify anything,
--               bulk-import, and manage other users' roles.
--   - employee: routine operational work — create purchases/assets,
--               update order status, assign/dispatch/return assets,
--               upload files — but NOT delete, retire, edit an asset's
--               fields, modify payments/cost, or bulk-import.
-- See middleware/auth.js's requireAdmin and each route file for
-- exactly which endpoints are gated.
--
-- Bootstrap: since every existing account here predates roles, the
-- very first account ever created (earliest created_at) is promoted
-- to admin automatically — someone needs to start as admin, and
-- "whoever set this up first" is the least surprising choice. Every
-- other existing account becomes 'employee' (the column default).
-- New signups after this point: authController.register makes the
-- FIRST-ever signup an admin (covers a brand new install with no
-- users yet) and 'employee' for every signup after that — an admin
-- can then promote specific people via the new "Manage Users" panel.
--
-- Run this once against your EXISTING database (schema.sql already
-- has this built in for anyone installing fresh, via 002_add_users.sql).
-- ---------------------------------------------------------------------

ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(10) NOT NULL DEFAULT 'employee';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check'
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'employee'));
    END IF;
END $$;

-- Promote the earliest-created account to admin, but only if there
-- isn't an admin already (safe to re-run this file).
UPDATE users SET role = 'admin'
WHERE id = (SELECT id FROM users ORDER BY created_at ASC LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin');
