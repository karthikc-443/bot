import { bootstrapFromAuthorizationCode } from "./slackAuth";

// One-time setup: npm run slack:bootstrap -- "<full redirected URL, or just the code>"
async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error('Usage: npm run slack:bootstrap -- "<redirected URL or code>"');
    process.exit(1);
  }

  const codeMatch = input.match(/[?&]code=([^&]+)/);
  const code = codeMatch ? decodeURIComponent(codeMatch[1]) : input;
  const redirectUri = "https://example.com/slack/oauth_redirect";

  await bootstrapFromAuthorizationCode(code, redirectUri);
  console.log("Bootstrapped Slack tokens successfully — stored at DB_PATH's sibling token store.");
}

main().catch((err) => {
  console.error(err.response?.data ?? err.message);
  process.exit(1);
});
