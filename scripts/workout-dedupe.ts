// Folds duplicate Fitbit workout recordings (docs/workout-dedupe.md).
//   npm run workouts:dedupe -- [--user NAME]          # dry run: counts only
//   npm run workouts:dedupe -- [--user NAME] --apply  # writes health_workout_merges
// The health sync runs the same step after every exercise sync.
import { planWorkoutDuplicates, reconcileWorkoutDuplicates } from "../lib/health/dedupe";
import { getPool } from "../lib/supabase";

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const userIndex = argv.indexOf("--user");
  const userName = userIndex >= 0 ? argv[userIndex + 1] : process.env.GOOGLE_HEALTH_USER;
  if (!userName) throw new Error("Pass --user NAME or set GOOGLE_HEALTH_USER.");
  const db = getPool();
  if (!db) throw new Error("DATABASE_URL is required.");
  try {
    if (apply) {
      const result = await reconcileWorkoutDuplicates(db, userName);
      console.log(
        `Folded ${result.duplicates} duplicate recordings into ${result.workouts} workouts; relinked ${result.relinked} logged sessions.`
      );
    } else {
      const plan = await planWorkoutDuplicates(db, userName);
      console.log(`Dry run: ${plan.duplicates} duplicate recordings would fold into ${plan.workouts} workouts. Pass --apply to write.`);
    }
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
