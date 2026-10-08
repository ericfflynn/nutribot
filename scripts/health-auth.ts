// Google Health authorization: npm run health:auth
// Opens the consent page, takes the redirected URL pasted back, and writes
// GOOGLE_REFRESH_TOKEN into .env.local. The token is never printed.
import { randomBytes } from "crypto";
import { execFile } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { createInterface } from "readline/promises";

const ENV_FILE = ".env.local";
const SCOPES = [
  "health_metrics_and_measurements",
  "sleep",
  "activity_and_fitness",
  "profile",
  "nutrition",
  "location",
  "ecg",
  "irn",
  "settings"
].map((scope) => `https://www.googleapis.com/auth/googlehealth.${scope}.readonly`);

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name} in ${ENV_FILE}`);
  }
  return value;
}

function saveRefreshToken(token: string) {
  const line = `GOOGLE_REFRESH_TOKEN=${token}`;
  const current = readFileSync(ENV_FILE, "utf8");
  const updated = /^GOOGLE_REFRESH_TOKEN=.*$/m.test(current)
    ? current.replace(/^GOOGLE_REFRESH_TOKEN=.*$/m, line)
    : `${current.trimEnd()}\n${line}\n`;
  writeFileSync(ENV_FILE, updated);
}

async function main() {
  const clientId = requireEnv("GOOGLE_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_CLIENT_SECRET");
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || "https://www.google.com";
  const state = randomBytes(24).toString("base64url");

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    state,
    scope: SCOPES.join(" ")
  })}`;

  console.log("Opening Google sign-in in your browser. Permissions are read-only.");
  console.log(`If it doesn't open, visit:\n${authUrl}\n`);
  execFile("open", [authUrl], () => undefined);

  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const pasted = (await prompt.question("After approving, paste the full URL you were redirected to: ")).trim();
  prompt.close();

  const query = new URL(pasted).searchParams;
  if (query.get("state") !== state || !query.get("code")) {
    throw new Error("Missing code or mismatched state; start again");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: query.get("code") as string,
      grant_type: "authorization_code",
      redirect_uri: redirectUri
    })
  });
  const payload = (await response.json()) as { refresh_token?: string; refresh_token_expires_in?: number; error?: string };
  if (!response.ok || !payload.refresh_token) {
    throw new Error(`Token exchange failed (HTTP ${response.status} ${payload.error ?? "no refresh token"})`);
  }

  saveRefreshToken(payload.refresh_token);
  const lifetime = payload.refresh_token_expires_in
    ? `expires in ${Math.round(payload.refresh_token_expires_in / 86400)} days`
    : "no expiry reported";
  console.log(`Saved GOOGLE_REFRESH_TOKEN to ${ENV_FILE} (${lifetime}).`);
}

main().catch((error) => {
  console.error(`Authorization failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
