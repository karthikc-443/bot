import http from "http";
import crypto from "crypto";
import { config } from "../config";
import { bootstrapFromAuthorizationCode } from "./slackAuth";

// One-time setup: npm run slack:bootstrap:local
// Starts a local server to catch Slack's OAuth redirect directly — avoids
// copy-pasting long codes/tokens by hand, which kept getting transcribed
// wrong across our last several attempts. Slack requires PKCE for any
// non-web (e.g. localhost) redirect URI, so we generate that pair too.
const PORT = 4390;
const REDIRECT_URI = `http://localhost:${PORT}/slack/oauth_redirect`;
const SCOPES =
  "app_mentions:read,channels:history,chat:write,groups:history,im:history,im:read,im:write,reactions:write,reactions:read,users:read,assistant:write";

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function main() {
  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(crypto.createHash("sha256").update(codeVerifier).digest());

  const authorizeUrl =
    `https://slack.com/oauth/v2/authorize?client_id=${config.slack.clientId}` +
    `&scope=${SCOPES}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&code_challenge=${codeChallenge}&code_challenge_method=S256`;

  console.log("1. Add this exact redirect URL to your Slack app's OAuth & Permissions -> Redirect URLs:");
  console.log(`   ${REDIRECT_URI}\n`);
  console.log("2. Then open this URL and click Allow:");
  console.log(`   ${authorizeUrl}\n`);
  console.log("Waiting for the redirect...");

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "", `http://localhost:${PORT}`);
    if (url.pathname !== "/slack/oauth_redirect") {
      res.writeHead(404).end();
      return;
    }

    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    if (error || !code) {
      res.writeHead(400, { "Content-Type": "text/plain" }).end(`OAuth error: ${error ?? "no code"}`);
      console.error("OAuth error:", error);
      server.close();
      process.exit(1);
    }

    try {
      await bootstrapFromAuthorizationCode(code!, REDIRECT_URI, codeVerifier);
      res.writeHead(200, { "Content-Type": "text/plain" }).end("Success — tokens stored. You can close this tab.");
      console.log("Bootstrapped Slack tokens successfully.");
      server.close();
      process.exit(0);
    } catch (err: any) {
      res.writeHead(500, { "Content-Type": "text/plain" }).end("Exchange failed — check the terminal.");
      console.error("Exchange failed:", err.response?.data ?? err.message);
      server.close();
      process.exit(1);
    }
  });

  server.listen(PORT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
