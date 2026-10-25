DROP TABLE email_tokens;
-- statement-breakpoint
ALTER TABLE account_private DROP COLUMN email_verified_at;
-- statement-breakpoint
ALTER TABLE account_private DROP COLUMN email_version;