import { z } from "zod";
import { askClaude } from "./claude-brain";

// Muscle groups from docs/training-plan.md, matching the Training tab mockup.
export const MUSCLE_GROUPS = ["Chest", "Back", "Shoulders", "Biceps", "Triceps", "Legs", "Abs", "Cardio"] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

// Session-level only for now: what was trained and how hard. Maps onto
// workout_sessions (muscle_tags, rpe); per-exercise sets can come later.
const workoutSchema = z.object({
  name: z.string().describe('Short session name, e.g. "Chest + Triceps".'),
  workout_type: z.enum(["strength", "run", "walk", "ride", "class", "other"]),
  muscle_groups: z.array(z.enum(MUSCLE_GROUPS)).min(1),
  rpe: z
    .number()
    .min(1)
    .max(10)
    .nullable()
    .describe("Overall effort, 1-10. Null if the text gives no sense of intensity."),
  duration_min: z.number().int().positive().nullable().describe("Only if the text states it."),
  notes: z.string(),
  questions: z.array(z.string()).describe("Only asks about intensity when rpe is null. Otherwise empty.")
});

export type ParsedWorkout = z.infer<typeof workoutSchema>;

const SYSTEM = `You turn a short workout note into a structured training log entry.

Muscle groups are only: ${MUSCLE_GROUPS.join(", ")}. Map shorthand and specific muscles onto them: "tris" is Triceps, "bis" is Biceps, quads, hamstrings, glutes and calves are Legs, lats and traps are Back, "delts" is Shoulders, "core" is Abs. A named exercise counts for the groups it mainly trains (bench press: Chest, Triceps). "Push", "pull" and "legs" days mean Chest/Shoulders/Triceps, Back/Biceps and Legs.

Convert intensity words to RPE: easy or light 3-4, moderate or solid 6, hard 8, brutal or all-out 9-10. Use a number the user gives as is. If there is no sense of intensity, rpe is null and you ask how hard it was.

Never invent a duration; it comes from the Fitbit workout when there is one. Don't ask for exercises, sets or duration. The only question you may ask is how hard it was. Keep notes to one concrete sentence or leave them empty.`;

export async function parseWorkout(text: string) {
  return askClaude({ system: SYSTEM, prompt: text, schema: workoutSchema, effort: "low" });
}
