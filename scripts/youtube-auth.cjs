const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const CREDENTIALS_PATH = path.join(process.cwd(), "credentials/youtube-oauth.json");
const TOKEN_PATH = path.join(process.cwd(), "credentials/youtube-token.json");

async function main() {
  const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
  const installed = creds.installed || creds.web;

  const clientId = process.env.YOUTUBE_CLIENT_ID || installed.client_id;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET || installed.client_secret;
  const redirectUri =
    process.env.YOUTUBE_REDIRECT || (installed.redirect_uris && installed.redirect_uris[0]);

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Missing client_id/client_secret/redirect_uri in youtube-oauth.json (or env vars).");
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  // ✅ The permission we need for uploads
  const scopes = ["https://www.googleapis.com/auth/youtube.upload"];

  const authUrl = oauth2.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
    prompt: "consent",
  });

  console.log("\nOpen this URL in your browser:\n");
  console.log(authUrl);
  console.log("\nPaste the code here:\n");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const code = await new Promise((resolve) => rl.question("Code: ", resolve));
  rl.close();

  const { tokens } = await oauth2.getToken(String(code).trim());

  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  console.log(`\n✅ Saved token to ${TOKEN_PATH}\n`);
}

main().catch((e) => {
  console.error("\n❌ Auth failed:", e.message);
  process.exit(1);
});
