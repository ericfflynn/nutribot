import { z } from "zod";
import { askClaude } from "./claude-brain";

// Muscle groups from docs/training-plan.md, matching the Training tab mockup.
export const MUSCLE_GROUPS = ["Chest", "Back", "Shoulders", "Biceps", "Triceps", "Legs", "Abs", "Cardio"] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

const muscle = z.enum(MUSCLE_GROUPS);

const setSchema = z.object({
  reps: z.number().int().nonnegative().nullable(),
  weight_lb: z.number().nonnegative().nullable().describe("Total load; both dumbbells combined. Null for bodyweight."),
  duration_s: z.number().int().nonnegative().nullable().describe("For timed sets such as planks or carries."),
  rpe: z.number().min(1).max(10).nullable(),
  is_warmup: z.boolean()
});

const exerciseSchema = z.object({
  name: z.string().describe('Canonical movement name, e.g. "Romanian deadlift".'),
  as_written: z.string().describe("How the user wrote it."),
  primary_muscles: z.array(muscle).min(1),
  secondary_muscles: z.array(muscle),
  equipment: z.enum(["barbell", "dumbbell", "machine", "cable", "bodyweight", "other"]),
  sets: z.array(setSchema)
});

const workoutSchema = z.object({
  name: z.string().describe('Short session name, e.g. "Strength · Lower".'),
  kind: z.enum(["strength", "run", "walk", "ride", "class", "other"]),
  exercises: z.array(exerciseSchema),
  muscle_tags: z.array(muscle).describe("Only for workouts without sets (a class, a hike). Otherwise empty."),
  notes: z.string(),
  questions: z.array(z.string()).describe("Details that are missing and matter. Empty if none.")
});

export type ParsedWorkout = z.infer<typeof workoutSchema>;

export type MuscleVolume = { muscle: MuscleGroup; hard_sets: number };

const SYSTEM = `You turn a free-text workout log into structured data for a training tracker.

For each movement, give its canonical name, the muscle groups it works, the equipment, and every set as written. Expand shorthand: "4x6 @225" is four sets of 6 reps at 225 lb. If several sets share a weight, repeat it on each set. Mark warm-up sets when the text says so or when a set is clearly a ramp-up before the working weight.

Muscle groups are only: ${MUSCLE_GROUPS.join(", ")}. Primary muscles are the ones the movement mainly trains; secondary muscles assist. Use Legs for quads, hamstrings, glutes and calves.

Never invent numbers. A missing weight, rep count or duration stays null; add a short question when the gap matters. Keep notes to a concrete sentence or leave them empty.`;

export async function parseWorkout(text: string) {
  const result = await askClaude({ system: SYSTEM, prompt: text, schema: workoutSchema });
  return { ...result, volume: muscleVolume(result.data) };
}

// Working sets per muscle group: primary muscles count a full set, secondary half.
export function muscleVolume(workout: ParsedWorkout): MuscleVolume[] {
  const totals = new Map<MuscleGroup, number>();
  for (const exercise of workout.exercises) {
    const working = exercise.sets.filter((set) => !set.is_warmup).length;
    for (const m of exercise.primary_muscles) totals.set(m, (totals.get(m) || 0) + working);
    for (const m of exercise.secondary_muscles) totals.set(m, (totals.get(m) || 0) + working / 2);
  }
  return MUSCLE_GROUPS.filter((m) => totals.has(m)).map((m) => ({ muscle: m, hard_sets: totals.get(m)! }));
}
