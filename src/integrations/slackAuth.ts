import axios from "axios";
import fs from "fs";
import path from "path";
import { config } from "../config";
import { setSlackBotToken } from "./slack";

interface TokenStore {
  refreshToken: string;
  accessToken: string;
  expiresAt: number; // epoch ms
}

function readStore(): TokenStore | null {
  try {
    return JSON.parse(fs.readFileSync(config.slack.tokenStorePath, "utf8"));
  } catch {
    return null;
  }
}

function writeStore(store: TokenStore): void {
  fs.mkdirSync(path.dirname(config.slack.tokenStorePath), { recursive: true });
  fs.writeFileSync(config.slack.tokenStorePath, JSON.stringify(store, null, 2));
}

// One-time bootstrap: exchange a fresh "code" from the OAuth authorize
// redirect for the first real access/refresh token pair. Only needed once
// per app install — after this, refreshAndPersist() takes over.
export async function bootstrapFromAuthorizationCode(code: string, redirectUri: string): Promise<void> {
  const { data } = await axios.post(
    "https://slack.com/api/oauth.v2.access",
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: config.slack.clientId!,
      client_secret: config.slack.clientSecret!,
    })
  );
  if (!data.ok) {
    throw new Error(`Slack authorization code exchange failed: ${data.error}`);
  }
  writeStore({
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });
}

export function usesTokenRotation(): boolean {
  return Boolean(config.slack.clientId && config.slack.clientSecret);
}

async function exchangeRefreshToken(refreshToken: string): Promise<TokenStore> {
  const { data } = await axios.post(
    "https://slack.com/api/oauth.v2.access",
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: config.slack.clientId!,
      client_secret: config.slack.clientSecret!,
    })
  );
  if (!data.ok) {
    throw new Error(`Slack token refresh failed: ${data.error}`);
  }
  return {
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

async function refreshAndPersist(): Promise<TokenStore> {
  const refreshToken = readStore()?.refreshToken ?? config.slack.initialRefreshToken;
  if (!refreshToken) {
    throw new Error("No Slack refresh token available — set SLACK_REFRESH_TOKEN.");
  }
  const store = await exchangeRefreshToken(refreshToken);
  writeStore(store);
  return store;
}

// Resolves the current bot token (refreshing it if rotation is configured)
// and pushes it into the shared Slack client. Call once at startup, and
// again on a timer via scheduleTokenRefresh.
export async function ensureSlackToken(): Promise<string> {
  if (!usesTokenRotation()) {
    if (!config.slack.botToken) {
      throw new Error("Set SLACK_BOT_TOKEN, or SLACK_CLIENT_ID/SLACK_CLIENT_SECRET for rotation.");
    }
    setSlackBotToken(config.slack.botToken);
    return config.slack.botToken;
  }

  const store = await refreshAndPersist();
  setSlackBotToken(store.accessToken);
  return store.accessToken;
}

// Refresh an hour before expiry rather than waiting for it to actually lapse.
export function scheduleTokenRefresh(): void {
  if (!usesTokenRotation()) return;

  const scheduleNext = () => {
    const store = readStore();
    const delay = store ? Math.max(store.expiresAt - Date.now() - 60 * 60 * 1000, 60 * 1000) : 60 * 1000;

    setTimeout(async () => {
      try {
        const refreshed = await refreshAndPersist();
        setSlackBotToken(refreshed.accessToken);
        console.log("Refreshed Slack bot token");
      } catch (err) {
        console.error("Failed to refresh Slack bot token", err);
      } finally {
        scheduleNext();
      }
    }, delay);
  };

  scheduleNext();
}
