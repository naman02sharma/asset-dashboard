-- =====================================================================
-- Migration 002: user accounts + delivery-alert notification preference
-- Run this AGAINST YOUR EXISTING asset_dashboard DATABASE — it only
-- adds new objects, it does not touch purchases/vendors/payments.
--
--   psql asset_dashboard -f database/002_add_users.sql
-- (or paste into pgAdmin's Query Tool, same as schema.sql)
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                VARCHAR(150) NOT NULL,
    email               VARCHAR(255) UNIQUE NOT NULL,
    password_hash       VARCHAR(255) NOT NULL,

    -- Where delivery/payment alerts get sent for this user.
    notify_channel      VARCHAR(10) NOT NULL DEFAULT 'email'
                         CHECK (notify_channel IN ('email', 'sms')),
    notify_email        VARCHAR(255),   -- defaults to `email` above if left blank
    notify_phone        VARCHAR(20),    -- required if notify_channel = 'sms'

    -- Two-role model: 'admin' can delete/retire/edit/financially-modify
    -- anything and manage other users' roles; 'employee' can do
    -- routine operational work (create purchases/assets, update order
    -- status, assign/dispatch/return assets, upload files) but not
    -- delete, retire, edit an asset's fields, modify payments/cost, or
    -- bulk-import. See middleware/auth.js's requireAdmin and each
    -- route file for exactly which endpoints are gated.
    role                VARCHAR(10) NOT NULL DEFAULT 'employee'
                         CHECK (role IN ('admin', 'employee')),

    -- Approval gate (see 013_user_approval.sql): the very first
    -- account (bootstrap admin) is approved automatically; every
    -- signup after that starts unapproved and can't log in until an
    -- existing admin approves them via the "Manage Users" panel.
    is_approved         BOOLEAN NOT NULL DEFAULT TRUE,

    -- Employee Status / HR Dashboard fields (see
    -- 016_employee_status_hr_fields.sql for the full writeup). Kept
    -- separate from `role` above: role governs what the account can DO
    -- in this app (admin vs employee permissions); department/position
    -- are plain HR labels, and manager_id is who this person reports
    -- to for the reporting-hierarchy view — none of the three affect
    -- permissions.
    department          VARCHAR(100),
    position            VARCHAR(100),
    manager_id          UUID REFERENCES users(id) ON DELETE SET NULL
                         CHECK (manager_id IS NULL OR manager_id <> id),
    last_login_at       TIMESTAMPTZ,
    last_logout_at      TIMESTAMPTZ,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- BUGFIX: the CREATE TABLE above only runs on a database that has NO
-- `users` table yet (that's what IF NOT EXISTS means) — on a database
-- where `users` already existed (e.g. anyone who ran this file back
-- when it only had id/name/email/password_hash/notify_*), the whole
-- block above is silently skipped and role/is_approved/department/
-- position/manager_id/last_login_at/last_logout_at never get added,
-- which then made the CREATE INDEX below fail with "column manager_id
-- does not exist". These ALTER statements guarantee every column this
-- file expects actually exists before that index is created, whether
-- CREATE TABLE just ran, was skipped because the table pre-dates this
-- file, or was skipped because a previous partial run of this exact
-- file already added them — safe to re-run any number of times either
-- way. (Same columns as 011_user_roles.sql / 013_user_approval.sql /
-- 016_employee_status_hr_fields.sql — redundant with those on a
-- database that already ran them, which is exactly the point.)
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(10) NOT NULL DEFAULT 'employee';
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check') THEN
        ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'employee'));
    END IF;
END $$;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS department VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS position VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES users(id) ON DELETE SET NULL;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_manager_not_self_check') THEN
        ALTER TABLE users ADD CONSTRAINT users_manager_not_self_check CHECK (manager_id IS NULL OR manager_id <> id);
    END IF;
END $$;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_logout_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_manager_id ON users(manager_id) WHERE manager_id IS NOT NULL;

-- Every existing purchase/status-change/payment email now goes to every
-- user row here (see backend/services/notificationService.js) instead
-- of a single hardcoded address.
