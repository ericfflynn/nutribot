import { runBrain } from "../lib/brain";
import { todayLocalDate } from "../lib/dates";
import { getPool } from "../lib/supabase";

// Runs one chat turn in the terminal without saving anything: no chat
// history is written and no health sync runs. Reads the database as usual.
// Usage: npm run brain -- [--date YYYY-MM-DD] "<message>"
const args = process.argv.slice(2);
const dateFlag = args.indexOf("--date");
const viewDate = dateFlag >= 0 ? args.splice(dateFlag, 2)[1] : todayLocalDate();
const message = args.join(" ").trim();
const db = getPool();
if (!message || !db) {
  console.error('Usage: npm run brain -- [--date YYYY-MM-DD] "<message>" (needs DATABASE_URL)');
  process.exit(1);
}

runBrain(message, {
  db,
  userName: process.env.GOOGLE_HEALTH_USER || "Eric",
  viewDate,
  history: [],
  openDrafts: [],
  syncIfMissing: false
}).then(
  async (reply) => {
    console.log(JSON.stringify(reply, null, 2));
    await db.end();
  },
  async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await db.end();
    process.exit(1);
  }
);
