// The app feedback queue, for dev passes (lib/feedback.ts).
//   npm run feedback                          # open items, oldest first
//   npm run feedback -- --all                 # everything, with status
//   npm run feedback -- --done <id> [note]    # mark done (an id prefix is enough)
//   npm run feedback -- --drop <id> [note]    # won't do
//   npm run feedback -- --reopen <id>
import { listFeedback, resolveFeedback, type FeedbackStatus } from "../lib/feedback";
import { getPool } from "../lib/supabase";

const ACTIONS: Record<string, FeedbackStatus> = { "--done": "done", "--drop": "dropped", "--reopen": "open" };

async function main() {
  const [flag, id, ...note] = process.argv.slice(2);
  const db = getPool();
  if (!db) throw new Error("DATABASE_URL is required.");
  try {
    if (flag && ACTIONS[flag]) {
      if (!id) throw new Error(`${flag} needs an id.`);
      const count = await resolveFeedback(db, [id], ACTIONS[flag], note.join(" ") || null);
      console.log(count ? `Marked ${count} item(s) ${ACTIONS[flag]}.` : "No item with that id.");
      return;
    }
    const items = await listFeedback(db, null, flag === "--all" ? ["open", "done", "dropped"] : ["open"]);
    if (!items.length) return console.log("The feedback queue is empty.");
    for (const item of items) {
      console.log(`${item.id.slice(0, 8)}  ${item.createdAt.slice(0, 10)}  ${item.status.padEnd(7)} ${item.kind}/${item.area}  ${item.title}`);
      console.log(`          ${item.details.replace(/\n/g, "\n          ")}${item.note ? `\n          note: ${item.note}` : ""}`);
    }
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
