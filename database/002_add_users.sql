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

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every existing purchase/status-change/payment email now goes to every
-- user row here (see backend/services/notificationService.js) instead
-- of a single hardcoded address.
