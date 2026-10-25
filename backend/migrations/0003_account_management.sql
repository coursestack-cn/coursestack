ALTER TABLE accounts ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0);
-- statement-breakpoint
ALTER TABLE accounts ADD COLUMN avatar_key TEXT;
-- statement-breakpoint
CREATE TABLE account_private (
    account_id TEXT PRIMARY KEY NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    real_name TEXT,
    email TEXT UNIQUE,
    email_verified_at INTEGER,
    email_version INTEGER NOT NULL DEFAULT 1 CHECK (email_version > 0)
);
-- statement-breakpoint
INSERT INTO account_private (account_id, real_name)
SELECT a.id, s.real_name FROM accounts a LEFT JOIN student_records s ON s.account_id = a.id;
-- statement-breakpoint
CREATE TABLE account_audit (
    id TEXT PRIMARY KEY NOT NULL,
    actor_id TEXT REFERENCES accounts(id) ON DELETE RESTRICT,
    target_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    action TEXT NOT NULL,
    fields TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
-- statement-breakpoint
CREATE INDEX account_audit_target_time ON account_audit(target_id, created_at, id);
-- statement-breakpoint
CREATE TABLE email_tokens (
    token_hash TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK (purpose IN ('verify-email', 'reset-password')),
    email_version INTEGER NOT NULL,
    credential_version INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
-- statement-breakpoint
CREATE INDEX email_tokens_account ON email_tokens(account_id);
-- statement-breakpoint
CREATE INDEX email_tokens_expiry ON email_tokens(expires_at);
-- statement-breakpoint
CREATE TABLE avatar_objects (
    object_key TEXT PRIMARY KEY NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
-- statement-breakpoint
INSERT INTO avatar_objects (object_key) SELECT avatar_key FROM accounts WHERE avatar_key IS NOT NULL;