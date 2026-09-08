import cron from "node-cron";
import { createApp } from "./app";
import { config } from "./config";
import { runDailyFollowup } from "./jobs/dailyFollowup";

async function main() {
  const app = await createApp();
  await app.start();
  console.log("⚡️ devrev-followup-bot connected via Socket Mode");

  cron.schedule(config.followupCron, () => {
    console.log("Running followup check...");
    runDailyFollowup().catch((err) => console.error("Followup check failed", err));
  });
  console.log(`Followup check scheduled: ${config.followupCron} (nags after 8h of silence)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
