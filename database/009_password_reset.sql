-- ---------------------------------------------------------------------
-- 009: Password Reset Tokens
--
-- Backs the new "Forgot password?" flow. Only the SHA-256 hash of the
-- raw reset token is stored — never the token itself — mirroring how
-- password_hash is never stored in plaintext (see authController.js
-- for where this is generated/verified).
--
-- Run this once against your EXISTING database (schema.sql already
-- has this built in for anyone installing fresh).
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  VARCHAR(64) NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id);
