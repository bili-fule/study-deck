-- Study Deck initial schema.
-- Cloud stores accounts, invite quotas, sessions and append-only learning events.
-- Question banks stay build-time files (data/catalog.json); only learning
-- records are persisted here.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  username_lower TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  password_hash TEXT NOT NULL,
  password_changed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  -- Hashed invite used at registration (NULL for CLI-created admins). Kept for
  -- audit only; the trigger below consumes the quota in the same INSERT.
  invite_code_hash TEXT
);

-- Only the SHA-256 of the session token is stored. A session is valid only if it
-- was created at/after the user's last password change, so a password reset
-- revokes every existing session without a second write.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);

-- Invite codes are stored hashed. `used_count < max_uses` is the atomic quota
-- gate: multi-use codes stay valid until the quota is exhausted.
CREATE TABLE invites (
  code_hash TEXT PRIMARY KEY,
  label TEXT,
  max_uses INTEGER NOT NULL CHECK (max_uses >= 1),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  created_by TEXT,
  CHECK (used_count <= max_uses)
);

-- Append-only, per-user event log. (user_id, id) is the client-supplied
-- idempotency key; seq is the server cursor used for incremental pulls.
CREATE TABLE events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'attempt.record',
    'favorite.set',
    'exam.completed',
    'card.reviewed',
    'card.state'
  )),
  at INTEGER NOT NULL,
  bank_id TEXT,
  question_id TEXT,
  is_correct INTEGER,
  score_correct INTEGER,
  score_total INTEGER,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, id)
);
CREATE INDEX events_user_seq ON events(user_id, seq);
CREATE INDEX events_kind_question ON events(kind, bank_id, question_id);

-- Registration is a single INSERT ... SELECT guarded by an invite quota check;
-- this trigger consumes the use in the same statement. RAISE(ABORT) rolls the
-- insert back if the quota was taken concurrently, so a user INSERT and its
-- invite consumption are all-or-nothing. Admin CLI inserts have NULL here.
CREATE TRIGGER users_consume_invite
AFTER INSERT ON users
WHEN NEW.invite_code_hash IS NOT NULL
BEGIN
  UPDATE invites
  SET used_count = used_count + 1
  WHERE code_hash = NEW.invite_code_hash
    AND used_count < max_uses
    AND (
      expires_at IS NULL
      OR expires_at > CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
    );
  SELECT RAISE(ABORT, 'invite_exhausted') WHERE changes() = 0;
END;

-- Fixed-window abuse throttle for login/register/invite probing. Bounded rows:
-- one row per (scope, ip, identifier) key, refreshed in place.
CREATE TABLE auth_throttle (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);
CREATE INDEX auth_throttle_window ON auth_throttle(window_start);
