CREATE TABLE IF NOT EXISTS feedback_tickets (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('feedback', 'issue')),
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'answered', 'closed')),
  admin_reply TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  replied_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_feedback_owner_updated
  ON feedback_tickets(owner_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_status_updated
  ON feedback_tickets(status, updated_at DESC);
