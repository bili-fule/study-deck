-- Anonymous event dimensions are kept separate from account sync. Event IDs
-- are global within this table so a retry with a new visitor cookie stays idempotent.
CREATE TABLE IF NOT EXISTS anonymous_events (
  event_id TEXT PRIMARY KEY,
  visitor_hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'attempt.record',
    'favorite.set',
    'exam.completed',
    'card.reviewed',
    'card.state'
  )),
  client_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  bank_id TEXT,
  question_id TEXT,
  is_correct INTEGER CHECK (is_correct IS NULL OR is_correct IN (0, 1))
);
CREATE INDEX IF NOT EXISTS anonymous_events_kind_question
  ON anonymous_events(kind, bank_id, question_id);
CREATE INDEX IF NOT EXISTS anonymous_events_visitor
  ON anonymous_events(visitor_hash);
