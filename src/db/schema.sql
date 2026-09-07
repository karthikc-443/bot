CREATE TABLE IF NOT EXISTS tracked_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slack_channel_id TEXT NOT NULL,
  slack_thread_ts TEXT NOT NULL,
  devrev_ticket_id TEXT NOT NULL,
  freshdesk_ticket_id TEXT,
  created_by_slack_user_id TEXT NOT NULL,
  creator_slack_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  last_followup_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (slack_channel_id, slack_thread_ts)
);
