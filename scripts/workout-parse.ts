import { parseWorkout } from "../lib/workout-parser";

// Usage: npm run brain:workout -- "legs today: squat 4x6 at 225, ..."
const text = process.argv.slice(2).join(" ").trim();
if (!text) {
  console.error('Usage: npm run brain:workout -- "<workout text>"');
  process.exit(1);
}

parseWorkout(text).then(
  (result) => console.log(JSON.stringify(result, null, 2)),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
);
