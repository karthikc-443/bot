import { App } from "@slack/bolt";
import { config } from "./config";
import { registerMentionHandler } from "./handlers/mention";
import { getCurrentToken } from "./integrations/slack";
import { ensureSlackToken, scheduleTokenRefresh } from "./integrations/slackAuth";

export async function createApp(): Promise<App> {
  await ensureSlackToken();

  const app = new App({
    // authorize (rather than a static token) so every event picks up
    // whatever token setSlackBotToken() most recently set, including after
    // a background refresh — no manual client re-sync needed.
    authorize: async () => ({ botToken: getCurrentToken()! }),
    appToken: config.slack.appToken,
    signingSecret: config.slack.signingSecret,
    socketMode: true,
  });

  registerMentionHandler(app);
  scheduleTokenRefresh();

  return app;
}
