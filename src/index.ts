import cron from "node-cron";
import { createApp } from "./app";
import { config } from "./config";
import { runDailyFollowup } from "./jobs/dailyFollowup";

async function main() {
  const app = await createApp();
  await app.start();
  console.log("⚡️ devrev-followup-bot connected via Socket Mode");

  cron.schedule(config.followupCron, () => {
    console.log("Running daily followup job...");
    runDailyFollowup().catch((err) => console.error("Daily followup job failed", err));
  });
  console.log(`Daily followup job scheduled: ${config.followupCron}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
