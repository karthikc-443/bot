import axios from "axios";
import { config } from "../config";

// Run: npm run devrev:inspect -- ISS-3654316
// Prints the raw work item JSON so you can find the Freshdesk field key and
// confirm the real stage.category values, then update .env accordingly.
async function main() {
  const displayId = process.argv[2];
  if (!displayId) {
    console.error("Usage: npm run devrev:inspect -- <TICKET-ID>");
    process.exit(1);
  }

  const client = axios.create({
    baseURL: config.devrev.baseUrl,
    headers: { Authorization: config.devrev.apiToken },
  });

  const { data } = await client.post("/works.get", { id: displayId });
  console.log(JSON.stringify(data, null, 2));
}

main().catch((err) => {
  console.error(err.response?.data ?? err.message);
  process.exit(1);
});
