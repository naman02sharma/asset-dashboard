-- ---------------------------------------------------------------------
-- 017: Editor role
--
-- Introduces a third role, sitting between 'employee' and 'admin':
-- 'editor' gets the same operational edit/delete rights as admin on
-- purchases, inventory assets, vendors, and inventory holder records
-- (see requireAdminOrEditor in middleware/auth.js and its usages in
-- routes/assets.js, purchases.js, vendors.js, employees.js) — but is
-- deliberately excluded from the Employee Status (HR) page and from
-- managing user roles/approvals/CSV export, which all stay gated by
-- requireAdmin (routes/auth.js is untouched by this migration on
-- purpose — an editor promoting themselves or anyone else to admin,
-- or seeing HR data, is exactly what this role is NOT supposed to do).
-- ---------------------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check') THEN
        ALTER TABLE users DROP CONSTRAINT users_role_check;
    END IF;
    ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'editor', 'employee'));
END $$;
