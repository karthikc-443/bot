import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import path from "path";
import { config } from "../config";

// Inlined rather than read from schema.sql — tsc doesn't copy non-.ts assets
// into dist/, so a file-read here works in ts-node dev but 404s after `npm
// run build` (which is what actually runs in any deployed environment).
const SCHEMA = `
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
`;

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
const db = new DatabaseSync(config.dbPath);
db.exec(SCHEMA);

export type ThreadStatus = "active" | "stopped";

export interface TrackedThread {
  id: number;
  slackChannelId: string;
  slackThreadTs: string;
  devrevTicketId: string;
  freshdeskTicketId: string | null;
  createdBySlackUserId: string;
  creatorSlackUserId: string | null;
  status: ThreadStatus;
  lastFollowupAt: string | null;
  createdAt: string;
}

function toDomain(row: any): TrackedThread {
  return {
    id: row.id,
    slackChannelId: row.slack_channel_id,
    slackThreadTs: row.slack_thread_ts,
    devrevTicketId: row.devrev_ticket_id,
    freshdeskTicketId: row.freshdesk_ticket_id,
    createdBySlackUserId: row.created_by_slack_user_id,
    creatorSlackUserId: row.creator_slack_user_id,
    status: row.status,
    lastFollowupAt: row.last_followup_at,
    createdAt: row.created_at,
  };
}

export function upsertThread(input: {
  slackChannelId: string;
  slackThreadTs: string;
  devrevTicketId: string;
  freshdeskTicketId: string | null;
  createdBySlackUserId: string;
  creatorSlackUserId: string | null;
}): TrackedThread {
  db.prepare(
    `INSERT INTO tracked_threads
       (slack_channel_id, slack_thread_ts, devrev_ticket_id, freshdesk_ticket_id, created_by_slack_user_id, creator_slack_user_id, status)
     VALUES (@slackChannelId, @slackThreadTs, @devrevTicketId, @freshdeskTicketId, @createdBySlackUserId, @creatorSlackUserId, 'active')
     ON CONFLICT (slack_channel_id, slack_thread_ts) DO UPDATE SET
       devrev_ticket_id = excluded.devrev_ticket_id,
       freshdesk_ticket_id = excluded.freshdesk_ticket_id,
       creator_slack_user_id = excluded.creator_slack_user_id,
       status = 'active'`
  ).run(input);

  return getThread(input.slackChannelId, input.slackThreadTs)!;
}

export function getThread(slackChannelId: string, slackThreadTs: string): TrackedThread | null {
  const row = db
    .prepare(`SELECT * FROM tracked_threads WHERE slack_channel_id = ? AND slack_thread_ts = ?`)
    .get(slackChannelId, slackThreadTs);
  return row ? toDomain(row) : null;
}

export function listActive(): TrackedThread[] {
  const rows = db.prepare(`SELECT * FROM tracked_threads WHERE status = 'active'`).all();
  return rows.map(toDomain);
}

export function markStopped(id: number): void {
  db.prepare(`UPDATE tracked_threads SET status = 'stopped' WHERE id = ?`).run(id);
}

export function updateLastFollowupAt(id: number): void {
  db.prepare(`UPDATE tracked_threads SET last_followup_at = datetime('now') WHERE id = ?`).run(id);
}
