-- Public registration no longer requires an invite code.
-- Drop the quota trigger first: SQLite refuses to drop a column a trigger reads.
DROP TRIGGER IF EXISTS users_consume_invite;
DROP TABLE IF EXISTS invites;
ALTER TABLE users DROP COLUMN invite_code_hash;
