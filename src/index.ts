import cron from "node-cron";
import { createApp } from "./app";
import { config } from "./config";
import { runDailyFollowup } from "./jobs/dailyFollowup";

// Human-readable cadence for common "*/N * * * *" patterns; falls back to
// the raw cron string for anything else (e.g. "0 10 * * 1-5").
function describeCron(pattern: string): string {
  const everyNMinutes = pattern.match(/^\*\/(\d+) \* \* \* \*$/);
  if (everyNMinutes) return `every ${everyNMinutes[1]} minutes`;
  return `on schedule "${pattern}"`;
}

async function main() {
  const app = await createApp();
  await app.start();
  console.log("⚡️ devrev-followup-bot connected via Socket Mode");

  const cadence = describeCron(config.followupCron);
  cron.schedule(config.followupCron, () => {
    console.log(`Monitoring for followups (${cadence})...`);
    runDailyFollowup().catch((err) => console.error("Followup check failed", err));
  });
  console.log(`Followup check scheduled: ${cadence}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
