CREATE UNIQUE INDEX account_roles_single_admin ON account_roles(role) WHERE role = 'admin';
-- statement-breakpoint
CREATE TABLE credentials (
    account_id TEXT PRIMARY KEY NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    school_number TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CONSTRAINT credentials_version CHECK (version > 0)
);
-- statement-breakpoint
CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    credential_version INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
-- statement-breakpoint
CREATE INDEX sessions_account ON sessions(account_id);
-- statement-breakpoint
CREATE INDEX sessions_expiry ON sessions(expires_at);
-- statement-breakpoint
CREATE TABLE login_attempts (
    key TEXT PRIMARY KEY NOT NULL,
    attempts INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
-- statement-breakpoint
CREATE INDEX login_attempts_expiry ON login_attempts(expires_at);