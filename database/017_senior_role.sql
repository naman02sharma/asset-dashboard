-- ---------------------------------------------------------------------
-- 017: Senior role
--
-- Introduces a third role, sitting between 'employee' and 'admin':
-- 'senior' can approve or reject pending purchases (see
-- 018_asset_approval_workflow.sql) alongside admins — the one thing
-- plain employees can't do. Editing itself (purchases, inventory
-- assets, vendors, inventory holder records) is open to ALL THREE
-- roles equally — see requireAdminOrSenior in middleware/auth.js,
-- used only for the approval endpoint, and the plain
-- authenticateToken-only gating on every edit route in routes/
-- purchases.js, assets.js, vendors.js, employees.js. What senior and
-- employee both do NOT get: deleting anything (stays admin-only via
-- requireAdmin) and the Employee Status (HR) page or user role/
-- approval management (routes/auth.js, also requireAdmin-only,
-- untouched by this migration on purpose).
-- ---------------------------------------------------------------------

-- Drop whatever role CHECK constraint currently exists FIRST (rather
-- than after the data fixup below) -- if a prior "Editor" round is
-- already live, the OLD constraint only allows 'admin'/'editor'/
-- 'employee' and would reject the UPDATE to 'senior' below before the
-- new constraint ever gets a chance to allow it.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check') THEN
        ALTER TABLE users DROP CONSTRAINT users_role_check;
    END IF;
END $$;

-- Safety net for anyone who deployed the earlier "Editor" round to
-- production before this rename: convert any existing role='editor'
-- accounts to 'senior'. A no-op if no such rows exist (fresh installs,
-- or anyone who never ran the editor-role migration in the first
-- place).
UPDATE users SET role = 'senior' WHERE role = 'editor';

ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'senior', 'employee'));
