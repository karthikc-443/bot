import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const config = {
  slack: {
    // Static token path (plain non-rotating app). Optional because the
    // token-rotation path below resolves the bot token at runtime instead.
    botToken: process.env.SLACK_BOT_TOKEN,
    appToken: required("SLACK_APP_TOKEN"),
    signingSecret: required("SLACK_SIGNING_SECRET"),
    // Token-rotation path: set these instead of SLACK_BOT_TOKEN when the
    // Slack app has token rotation enabled. SLACK_REFRESH_TOKEN only needs to
    // be the *initial* value — after first use it's persisted (and rotated)
    // at tokenStorePath, so the env var goes stale on purpose after run 1.
    clientId: process.env.SLACK_CLIENT_ID,
    clientSecret: process.env.SLACK_CLIENT_SECRET,
    initialRefreshToken: process.env.SLACK_REFRESH_TOKEN,
    tokenStorePath: process.env.SLACK_TOKEN_STORE_PATH ?? "./data/slack_token.json",
  },
  devrev: {
    apiToken: required("DEVREV_API_TOKEN"),
    baseUrl: process.env.DEVREV_API_BASE_URL ?? "https://api.devrev.ai",
    freshdeskFieldKey: process.env.DEVREV_FRESHDESK_FIELD_KEY ?? "",
  },
  freshdesk: {
    domain: required("FRESHDESK_DOMAIN"),
    apiKey: required("FRESHDESK_API_KEY"),
  },
  // Runs hourly by default — the job itself only actually nags a thread once
  // an 8h silence window has elapsed (see shouldNag in dailyFollowup.ts), so
  // this just needs to be frequent enough to catch that threshold promptly.
  followupCron: process.env.FOLLOWUP_CRON ?? "0 * * * *",
  dbPath: process.env.DB_PATH ?? "./data/tracked_threads.db",
  // Optional — analysis is skipped (falls back to the plain DevRev assignee)
  // when this isn't set, so the bot works with or without it.
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
  },
};
