-- ---------------------------------------------------------------------
-- 013: User Approval Gate
--
-- Signing up no longer grants access by itself. An admin must approve
-- a new account before it can log in and see the dashboard — this
-- adds an is_approved flag alongside the existing role column
-- (011_user_roles.sql) so the two stay orthogonal: role decides what
-- an approved user can DO, is_approved decides whether they can get
-- in at all.
--
-- Bootstrap / existing installs: DEFAULT TRUE means every account
-- that already existed before this migration keeps working exactly
-- as it did — nobody who already had access gets locked out by
-- running this. Going forward, authController.register explicitly
-- sets is_approved = true for the very first (bootstrap admin)
-- account and false for every signup after that, so the default only
-- matters for pre-existing rows.
-- ---------------------------------------------------------------------

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_users_is_approved ON users(is_approved) WHERE is_approved = FALSE;
