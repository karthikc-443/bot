# devrev-followup-bot

Slack bot: `@mention` it in a thread that has a DevRev ticket auto-posted in it, and it
tracks that ticket, nagging the assignee daily until the ticket is closed in DevRev
**and** Freshdesk shows an agent reply to the merchant. On close, it pings the ticket's
creator once with a resolved notice.

## 1. Create the Slack app

1. Go to https://api.slack.com/apps → **Create New App** → **From scratch**. Pick your workspace.
2. **Socket Mode** (left sidebar) → toggle on. This generates an app-level token
   (`xapp-...`) — copy it, needs the `connections:write` scope (default when you
   enable Socket Mode from this screen).
3. **OAuth & Permissions** → **Scopes** → **Bot Token Scopes** → add:
   - `app_mentions:read`
   - `channels:history`
   - `groups:history`
   - `chat:write`
   - `users:read`
   - `users:read.email`
4. **Event Subscriptions** (or under Socket Mode's "Subscribe to bot events") → add
   `app_mention`.
5. **OAuth & Permissions** → **Install to Workspace**. Copy the **Bot User OAuth Token**
   (`xoxb-...`).
6. **Basic Information** → copy the **Signing Secret**.
7. Invite the bot into whichever channels have DevRev ticket threads:
   `/invite @YourBotName`

## 2. Get the DevRev PAT

DevRev app → your profile/settings → **PATs** (Personal Access Tokens) → create one.

## 3. Get the Freshdesk API key

Freshdesk → your profile picture → Profile Settings → API key is shown below the
change-password section.

## 4. Configure

```bash
cp .env.example .env
# fill in SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_SIGNING_SECRET,
# DEVREV_API_TOKEN, FRESHDESK_DOMAIN, FRESHDESK_API_KEY
```

`DEVREV_FRESHDESK_FIELD_KEY` is unknown until you inspect a real ticket (next step) —
leave it blank for now if you don't know it yet; the bot will just skip Freshdesk
resolution and gate on DevRev status alone until it's set.

## 5. Install deps and find the Freshdesk field key

```bash
npm install
npm run devrev:inspect -- ISS-3654316   # use a real ticket ID you know has a Freshdesk link
```

Look through the printed JSON for the field holding the Freshdesk ticket id (likely
under `custom_fields`), then set `DEVREV_FRESHDESK_FIELD_KEY` in `.env` to that key.
While you're looking at the JSON, also check `stage.category` for an open vs. closed
ticket — if the values aren't `completed`/`closed`, update the set in
`src/integrations/devrev.ts` (`CLOSED_STAGE_CATEGORIES`).

## 6. Test the daily job without waiting for the cron

```bash
npm run followup:once
```

This runs the same logic the daily schedule runs, immediately, against whatever's
currently tracked (nothing, until you do step 7).

## 7. Run it

```bash
npm run dev       # ts-node, for local testing
# or
npm run build && npm start   # compiled, for anything longer-running
```

Once it's running and connected (you'll see "⚡️ devrev-followup-bot connected via
Socket Mode" in the logs), go to a Slack thread that has a DevRev ticket auto-posted
in it and reply `@YourBotName`. It should reply confirming what it's tracking.

## Moving this to another machine

Copy the project folder, `npm install` there, copy over the same `.env` **and** the
SQLite file at `DB_PATH` (default `./data/tracked_threads.db` — that's the only state).
Run only one instance at a time; running two simultaneously double-posts daily nags.
A laptop is fine for testing, but this wants an always-on host (small VM/container) for
real use — no daily nags happen while the process isn't running.
