import { buildBodyState } from "../lib/body-state/build";
import { guardrailsOf, makeCall } from "../lib/body-state/call";
import { loadBodySources } from "../lib/body-state/load";
import { todayLocalDate } from "../lib/dates";
import { getPool } from "../lib/supabase";

// Makes a day's call (Claude, inside the guardrails) and prints it with the
// guardrails, without saving anything. For tuning the call's prompt.
// Usage: npm run call -- [--date YYYY-MM-DD]
const args = process.argv.slice(2);
const dateFlag = args.indexOf("--date");
const date = dateFlag >= 0 ? args[dateFlag + 1] : todayLocalDate();
const db = getPool();
const userName = process.env.GOOGLE_HEALTH_USER;
if (!db || !userName) {
  console.error("Needs DATABASE_URL and GOOGLE_HEALTH_USER.");
  process.exit(1);
}

(async () => {
  const sources = await loadBodySources(db, userName, date);
  const state = buildBodyState(sources, date);
  const guardrails = guardrailsOf(state, sources);
  const call = await makeCall(db, userName, state, sources, guardrails);
  console.log(JSON.stringify({ guardrails: { ...guardrails, muscles: guardrails.muscles.filter((item) => item.max !== "hard") }, call }, null, 2));
  await db.end();
})().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await db.end();
  process.exit(1);
});
