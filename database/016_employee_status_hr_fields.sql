-- ---------------------------------------------------------------------
-- 016: Employee Status / HR Dashboard fields
--
-- Extends `users` (the app's login accounts — admins and employees)
-- with the fields the Employee Status page needs, on top of what
-- already exists (name, email, role [admin|employee], is_approved,
-- created_at):
--
--   - department:      free-text HR department tag (e.g. "IT",
--                       "Finance") — distinct from `role`, which only
--                       governs what the account can DO in this app.
--   - position:         free-text job title (e.g. "IT Manager",
--                       "Procurement Associate") — again distinct from
--                       the admin/employee system role.
--   - manager_id:        who this person reports to (another row in this
--                       same table) — powers the reporting-hierarchy
--                       tree on the Employee Status page. Nullable
--                       (top-level people report to no one here) and
--                       ON DELETE SET NULL so removing a manager
--                       account never cascades into deleting their
--                       reports, it just orphans them back to
--                       "no manager assigned".
--   - last_login_at / last_logout_at: populated by authController's
--     login()/logout() — logoff is only ever known for a token-based
--     session if the client actually calls the new POST
--     /api/auth/logout before discarding its token (see App.jsx's
--     onLogout), same "best-effort" caveat any client-side logout has.
--
-- "Active status" reuses the existing `is_approved` flag rather than
-- adding a duplicate column — an unapproved/revoked account already
-- means "can't log in", which IS what "inactive" means for HR
-- purposes here; a second, independent status flag would just be two
-- sources of truth that could disagree.
--
-- Run this once against your EXISTING database (schema.sql / this
-- project's database/002_add_users.sql already has this built in for
-- anyone installing fresh).
-- ---------------------------------------------------------------------

ALTER TABLE users ADD COLUMN IF NOT EXISTS department VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS position VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_logout_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_manager_id ON users(manager_id) WHERE manager_id IS NOT NULL;

-- Guard against a user being set as their own manager (a trivial
-- one-node cycle) — deeper cycles (A manages B manages A) are still
-- possible at the DB layer and are instead prevented in
-- authController.updateEmployeeDetails before the UPDATE runs, since
-- checking an arbitrary-depth cycle isn't expressible as a simple
-- CHECK constraint.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_manager_not_self_check'
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_manager_not_self_check CHECK (manager_id IS NULL OR manager_id <> id);
    END IF;
END $$;
