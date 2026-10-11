"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { clearSession, createSession, getSessionUser } from "@/lib/auth";
import { isValidLocalDate, todayLocalDate } from "@/lib/dates";
import { parseGoals } from "@/lib/goals";
import { parseMacroObject, type ParsedMacros } from "@/lib/macros";
import { HEALTH_DATA_TYPES } from "@/lib/health/google";
import { runHealthSync } from "@/lib/health/sync";
import type { Draft } from "@/lib/brain";
import { newConversation, withDraft } from "@/lib/chat";
import { deleteHabitLog, listHabits, saveHabit, saveHabitLogs } from "@/lib/habits";
import { deleteJournalEntry, saveJournalEntry } from "@/lib/journal";
import { deletePushSubscription, savePushSubscription, type PushSubscriptionInput } from "@/lib/reminders";
import { z } from "zod";
import {
  MUSCLE_GROUPS,
  deleteWorkoutSession,
  listFitbitWorkouts,
  saveWorkoutSession,
  updateWorkoutSession
} from "@/lib/workouts";
import {
  addWaterEntry,
  deleteMacroEntry,
  getPool,
  saveMacroEntry,
  saveUserGoals,
  updateMacroEntry
} from "@/lib/supabase";

function getFormDate(formData: FormData) {
  const entryDate = String(formData.get("entryDate") || formData.get("redirectDate") || "").trim();
  return isValidLocalDate(entryDate) ? entryDate : todayLocalDate();
}

// Today for that day, with an optional error shown above the timeline.
function todayPath(entryDate: string, error?: string) {
  const params = new URLSearchParams({ date: entryDate });
  if (error) {
    params.set("error", error);
  }
  return `/?${params.toString()}`;
}

export async function loginAction(formData: FormData) {
  const name = String(formData.get("name") || "");
  const password = String(formData.get("password") || "");
  const result = await createSession(name, password);

  if (!result.ok) {
    redirect(`/?error=${encodeURIComponent(result.error || "Login failed.")}`);
  }

  redirect("/");
}

export async function logoutAction() {
  await clearSession();
  redirect("/");
}

export async function updateMacroEntryAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user) {
    redirect("/");
  }

  const id = String(formData.get("id") || "").trim();
  const rawText = String(formData.get("rawText") || "").trim();
  const redirectDate = getFormDate(formData);
  if (!id) {
    redirect(todayPath(redirectDate, "Meal entry is missing."));
  }
  if (!rawText) {
    redirect(todayPath(redirectDate, "Meal description is required."));
  }

  let parsed: ParsedMacros;
  try {
    parsed = parseMacroObject({
      calories: formData.get("calories"),
      protein_g: formData.get("protein_g"),
      carbs_g: formData.get("carbs_g"),
      fat_g: formData.get("fat_g"),
      items: [],
      confidence: 1,
      notes: String(formData.get("notes") || "").trim(),
      accuracy_suggestion: ""
    });
  } catch {
    redirect(todayPath(redirectDate, "Meal macros must be valid non-negative numbers."));
  }

  try {
    await updateMacroEntry({
      id,
      userName: user.name,
      rawText,
      parsed
    });
  } catch (error) {
    redirect(todayPath(redirectDate, error instanceof Error ? error.message : "Meal update failed."));
  }

  revalidatePath("/");
  redirect(todayPath(redirectDate));
}

export async function deleteMacroEntryAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user) {
    redirect("/");
  }

  const id = String(formData.get("id") || "").trim();
  const redirectDate = getFormDate(formData);
  if (!id) {
    redirect(todayPath(redirectDate, "Meal entry is missing."));
  }

  try {
    await deleteMacroEntry(id, user.name);
  } catch (error) {
    redirect(todayPath(redirectDate, error instanceof Error ? error.message : "Meal delete failed."));
  }

  revalidatePath("/");
  redirect(todayPath(redirectDate));
}

export async function saveGoalsAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user) {
    redirect("/");
  }
  const redirectDate = getFormDate(formData);

  const goals = parseGoals({
    calories: Number(formData.get("calories")),
    proteinPct: Number(formData.get("proteinPct")),
    carbsPct: Number(formData.get("carbsPct")),
    fatPct: Number(formData.get("fatPct")),
    waterOz: Number(formData.get("waterOz"))
  });

  await saveUserGoals(user.name, goals);
  revalidatePath("/");
  redirect(todayPath(redirectDate));
}

const WATER_AMOUNTS = new Set([8, 16, 24]);

// Quick-add buttons on Today. The day comes from the page so past days can be filled in.
export async function addWaterAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user) {
    redirect("/");
  }
  const ounces = Number(formData.get("oz"));
  if (!WATER_AMOUNTS.has(ounces)) {
    return;
  }
  const entryDate = getFormDate(formData);
  await addWaterEntry(user.name, entryDate > todayLocalDate() ? todayLocalDate() : entryDate, ounces);
  revalidatePath("/");
}

// Manual "Refresh" on Today: the same light sync the scheduled jobs run.
export async function refreshHealthAction() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/");
  }
  const db = getPool();
  if (!db || user.name !== process.env.GOOGLE_HEALTH_USER) {
    return;
  }

  // Don't stack syncs from repeated taps.
  const { rows } = await db.query(
    `
    select 1 from public.health_sync_runs
    where user_name = $1 and status = 'running' and started_at > now() - interval '2 minutes'
    limit 1
    `,
    [user.name]
  );
  if (!rows.length) {
    try {
      await runHealthSync(db, { trigger: "manual", userName: user.name, types: HEALTH_DATA_TYPES, recentDays: 3 });
    } catch {
      // The failure is recorded in health_sync_runs and shown on Today.
    }
  }
  revalidatePath("/");
}

export type DraftActionResult = { ok: true; draft: Draft } | { ok: false; error: string };

// Saves a chat draft from the server's stored copy, never from client data.
// For workouts, fitbitWorkoutId overrides the match: an id picks that watch
// workout, null saves it unlinked (pending), undefined keeps the suggestion.
export async function saveDraftAction(
  messageId: string,
  draftId: string,
  fitbitWorkoutId?: string | null
): Promise<DraftActionResult> {
  const user = await getSessionUser();
  const db = getPool();
  if (!user) return { ok: false, error: "Log in again." };
  if (!db) return { ok: false, error: "DATABASE_URL is required." };

  try {
    const draft = await withDraft(db, user.name, messageId, draftId, async (stored, client) => {
      let savedId: string;
      let saved: Draft;
      if (stored.type === "meal" && stored.edits) {
        await updateMacroEntry({
          id: stored.edits.id,
          userName: user.name,
          rawText: stored.raw_text,
          parsed: stored.estimate,
          mealType: stored.meal_type,
          entryDate: stored.date,
          client
        });
        savedId = stored.edits.id;
        saved = { ...stored, saved_id: savedId };
      } else if (stored.type === "meal") {
        savedId = await saveMacroEntry({
          userName: user.name,
          entryDate: stored.date,
          rawText: stored.raw_text,
          parsed: stored.estimate,
          mealType: stored.meal_type,
          client
        });
        saved = { ...stored, saved_id: savedId };
      } else if (stored.type === "journal") {
        savedId = await saveJournalEntry(client, user.name, stored);
        saved = { ...stored, saved_id: savedId };
      } else if (stored.type === "habits") {
        const ids = await saveHabitLogs(client, user.name, stored.date, stored.logs);
        // Zeros already covered by a saved log are skipped, so this can be empty.
        savedId = ids.join(",") || "none";
        saved = { ...stored, saved_id: savedId };
      } else if (stored.type === "habit") {
        savedId = await saveHabit(client, user.name, stored.habit, stored.habit_id);
        saved = { ...stored, saved_id: savedId };
      } else {
        let healthRecordKey = stored.untracked ? null : (stored.match.match?.id ?? null);
        let linkedBy = stored.linked_by;
        if (fitbitWorkoutId !== undefined && !stored.untracked) {
          healthRecordKey = fitbitWorkoutId;
          linkedBy = fitbitWorkoutId ? "user" : null;
          if (fitbitWorkoutId) {
            const workouts = await listFitbitWorkouts(client, user.name, stored.date, stored.date);
            const chosen = workouts.find((w) => w.id === fitbitWorkoutId);
            if (!chosen || chosen.sessionId) throw new Error("That watch workout isn't available.");
          }
        }
        savedId = await saveWorkoutSession(client, user.name, {
          date: stored.date,
          rawText: stored.raw_text,
          name: stored.name,
          workoutType: stored.workout_type,
          muscleGroups: stored.muscle_groups,
          rpe: stored.rpe,
          durationMin: stored.duration_min,
          notes: stored.notes,
          timeHint: stored.time_hint,
          untracked: stored.untracked,
          healthRecordKey,
          linkedBy
        });
        saved = { ...stored, linked_by: linkedBy, saved_id: savedId };
      }
      return { draft: saved, result: saved };
    });
    revalidatePath("/");
    return { ok: true, draft };
  } catch (error) {
    // A unique-index violation means another session claimed that watch workout.
    const code = (error as { code?: string })?.code;
    const message =
      code === "23505"
        ? "That watch workout is already linked to another session."
        : error instanceof Error && !code
          ? error.message
          : "Couldn't save the draft.";
    return { ok: false, error: message };
  }
}

export async function discardDraftAction(messageId: string, draftId: string): Promise<DraftActionResult> {
  const user = await getSessionUser();
  const db = getPool();
  if (!user) return { ok: false, error: "Log in again." };
  if (!db) return { ok: false, error: "DATABASE_URL is required." };

  try {
    const draft = await withDraft(db, user.name, messageId, draftId, async (stored) => {
      const discarded = { ...stored, discarded: true };
      return { draft: discarded, result: discarded };
    });
    return { ok: true, draft };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Couldn't discard the draft." };
  }
}

// "New chat": later messages go to a fresh conversation, so Claude stops
// seeing the old one. The old conversation stays in the database.
export async function newChatAction(): Promise<{ ok: boolean }> {
  const user = await getSessionUser();
  const db = getPool();
  if (!user || !db) return { ok: false };
  await newConversation(db, user.name);
  return { ok: true };
}

const workoutEditSchema = z.object({
  name: z.string().trim().min(1).max(80),
  muscleGroups: z.array(z.enum(MUSCLE_GROUPS)).min(1),
  rpe: z.number().min(1).max(10).nullable()
});

// Training page: fix a logged workout's label or effort.
export async function updateWorkoutSessionAction(
  id: string,
  changes: { name: string; muscleGroups: string[]; rpe: number | null }
): Promise<{ ok: boolean; error?: string }> {
  const user = await getSessionUser();
  const db = getPool();
  if (!user || !db) return { ok: false, error: "Log in again." };

  const parsed = workoutEditSchema.safeParse(changes);
  if (!parsed.success) return { ok: false, error: "Pick at least one muscle group and an RPE from 1 to 10." };
  const updated = await updateWorkoutSession(db, user.name, id, parsed.data);
  if (!updated) return { ok: false, error: "That workout no longer exists." };
  revalidatePath("/training");
  return { ok: true };
}

// Reminders: store or forget this phone's push subscription.
export async function savePushSubscriptionAction(subscription: PushSubscriptionInput): Promise<{ ok: boolean }> {
  const user = await getSessionUser();
  const db = getPool();
  const valid =
    typeof subscription?.endpoint === "string" &&
    subscription.endpoint.startsWith("https://") &&
    typeof subscription.keys?.p256dh === "string" &&
    typeof subscription.keys?.auth === "string";
  if (!user || !db || !valid) return { ok: false };
  await savePushSubscription(db, user.name, subscription);
  return { ok: true };
}

export async function deletePushSubscriptionAction(endpoint: string): Promise<{ ok: boolean }> {
  const user = await getSessionUser();
  const db = getPool();
  if (!user || !db) return { ok: false };
  await deletePushSubscription(db, user.name, endpoint);
  return { ok: true };
}

const habitLogSchema = z.object({
  habitId: z.string().uuid(),
  date: z.string().refine(isValidLocalDate),
  amount: z.number().min(0).max(24 * 60),
  details: z.string().trim().max(300).nullable(),
  startedAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  endedAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable()
});

// Habits tab: log one use, or an explicit "none", without the chat.
export async function logHabitAction(input: z.input<typeof habitLogSchema>): Promise<{ ok: boolean; error?: string }> {
  const user = await getSessionUser();
  const db = getPool();
  if (!user || !db) return { ok: false, error: "Log in again." };

  const parsed = habitLogSchema.safeParse(input);
  if (!parsed.success || parsed.data.date > todayLocalDate()) return { ok: false, error: "That entry isn't valid." };
  const log = parsed.data;
  const habit = (await listHabits(db, user.name)).find((item) => item.id === log.habitId);
  if (!habit) return { ok: false, error: "That habit no longer exists." };
  if (habit.measure === "intensity" && (!Number.isInteger(log.amount) || log.amount > 3)) {
    return { ok: false, error: "Pick none, light, moderate or heavy." };
  }
  await saveHabitLogs(db, user.name, log.date, [{ ...log, details: log.details || null }]);
  revalidatePath("/");
  revalidatePath("/habits");
  return { ok: true };
}

export async function deleteHabitLogAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getSessionUser();
  const db = getPool();
  if (!user || !db) return { ok: false, error: "Log in again." };
  const deleted = await deleteHabitLog(db, user.name, id);
  revalidatePath("/");
  revalidatePath("/habits");
  return deleted ? { ok: true } : { ok: false, error: "That entry no longer exists." };
}

// Today: remove a journal entry or one habit log.
export async function deleteCheckinAction(formData: FormData) {
  const user = await getSessionUser();
  const db = getPool();
  if (!user || !db) {
    redirect("/");
  }
  const id = String(formData.get("id") || "");
  const redirectDate = getFormDate(formData);
  const deleted =
    formData.get("kind") === "journal" ? await deleteJournalEntry(db, user.name, id) : await deleteHabitLog(db, user.name, id);
  revalidatePath("/");
  redirect(todayPath(redirectDate, deleted ? undefined : "That entry no longer exists."));
}

// Training page: remove a logged workout. Its Fitbit workout becomes unlabeled again.
export async function deleteWorkoutSessionAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getSessionUser();
  const db = getPool();
  if (!user || !db) return { ok: false, error: "Log in again." };

  const deleted = await deleteWorkoutSession(db, user.name, id);
  if (!deleted) return { ok: false, error: "That workout no longer exists." };
  revalidatePath("/training");
  return { ok: true };
}
