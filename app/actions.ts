"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { clearSession, createSession, getSessionUser } from "@/lib/auth";
import { isValidLocalDate, todayLocalDate } from "@/lib/dates";
import { parseMacroGoals } from "@/lib/goals";
import { parseMacroObject, parseMacros, parseStoredMacros, type ParsedMacros } from "@/lib/macro-parser";
import { HEALTH_DATA_TYPES } from "@/lib/health/google";
import { runHealthSync } from "@/lib/health/sync";
import type { Draft } from "@/lib/brain";
import { withDraft } from "@/lib/chat";
import { listFitbitWorkouts, saveWorkoutSession } from "@/lib/workouts";
import {
  addWaterEntry,
  deleteMacroEntry,
  getPool,
  saveMacroEntry,
  saveUserMacroGoals,
  updateMacroEntry
} from "@/lib/supabase";

export type MealReviewState = {
  rawText: string;
  parsed: ParsedMacros | null;
  feedback: string | null;
  error: string | null;
};

function getFormDate(formData: FormData) {
  const entryDate = String(formData.get("entryDate") || formData.get("redirectDate") || "").trim();
  return isValidLocalDate(entryDate) ? entryDate : todayLocalDate();
}

function profilePath(entryDate: string, error?: string) {
  const params = new URLSearchParams({ date: entryDate });
  if (error) {
    params.set("error", error);
  }
  return `/profile?${params.toString()}`;
}

export async function parseMealForReviewAction(
  _state: MealReviewState,
  formData: FormData
): Promise<MealReviewState> {
  const user = await getSessionUser();
  if (!user) {
    redirect("/");
  }

  const rawText = String(formData.get("rawText") || "").trim();
  if (!rawText) {
    return { rawText: "", parsed: null, feedback: null, error: "Enter what you ate first." };
  }

  try {
    const parsed = await parseMacros(rawText);
    return { rawText, parsed, feedback: null, error: null };
  } catch (error) {
    return {
      rawText,
      parsed: null,
      feedback: null,
      error: error instanceof Error ? error.message : "Macro estimate failed."
    };
  }
}

export async function reviseMealForReviewAction(
  _state: MealReviewState,
  formData: FormData
): Promise<MealReviewState> {
  const user = await getSessionUser();
  if (!user) {
    redirect("/");
  }

  const rawText = String(formData.get("rawText") || "").trim();
  const feedback = String(formData.get("feedback") || "").trim();
  const previousParsedJson = String(formData.get("previousParsed") || "");

  if (!rawText) {
    return { rawText: "", parsed: null, feedback: null, error: "Original meal text is missing." };
  }
  if (!feedback) {
    return { rawText, parsed: null, feedback: null, error: "Add a correction first." };
  }

  try {
    const previousParsed = previousParsedJson ? parseStoredMacros(previousParsedJson) : undefined;
    const parsed = await parseMacros(rawText, feedback, previousParsed);
    return { rawText, parsed, feedback, error: null };
  } catch (error) {
    return {
      rawText,
      parsed: null,
      feedback,
      error: error instanceof Error ? error.message : "Macro revision failed."
    };
  }
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

export async function addMacroEntryAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user) {
    redirect("/");
  }

  const rawText = String(formData.get("rawText") || "").trim();
  const parsedJson = String(formData.get("parsed") || "");
  const entryDate = getFormDate(formData);
  if (!rawText) {
    redirect(profilePath(entryDate, "Enter what you ate first."));
  }
  if (!parsedJson) {
    redirect(profilePath(entryDate, "Review the AI estimate before saving."));
  }

  let parsed: ParsedMacros;
  try {
    parsed = parseStoredMacros(parsedJson);
  } catch {
    redirect(profilePath(entryDate, "Saved estimate was invalid. Please estimate the meal again."));
  }

  await saveMacroEntry({
    userName: user.name,
    entryDate,
    rawText,
    parsed
  });

  revalidatePath("/");
  revalidatePath("/profile");
  redirect(profilePath(entryDate));
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
    redirect(profilePath(redirectDate, "Meal entry is missing."));
  }
  if (!rawText) {
    redirect(profilePath(redirectDate, "Meal description is required."));
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
    redirect(profilePath(redirectDate, "Meal macros must be valid non-negative numbers."));
  }

  try {
    await updateMacroEntry({
      id,
      userName: user.name,
      rawText,
      parsed
    });
  } catch (error) {
    redirect(profilePath(redirectDate, error instanceof Error ? error.message : "Meal update failed."));
  }

  revalidatePath("/");
  revalidatePath("/profile");
  redirect(profilePath(redirectDate));
}

export async function deleteMacroEntryAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user) {
    redirect("/");
  }

  const id = String(formData.get("id") || "").trim();
  const redirectDate = getFormDate(formData);
  if (!id) {
    redirect(profilePath(redirectDate, "Meal entry is missing."));
  }

  try {
    await deleteMacroEntry(id, user.name);
  } catch (error) {
    redirect(profilePath(redirectDate, error instanceof Error ? error.message : "Meal delete failed."));
  }

  revalidatePath("/");
  revalidatePath("/profile");
  redirect(profilePath(redirectDate));
}

export async function saveMacroGoalsAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user) {
    redirect("/");
  }
  const redirectDate = getFormDate(formData);

  const goals = parseMacroGoals({
    calories: Number(formData.get("calories")),
    proteinPct: Number(formData.get("proteinPct")),
    carbsPct: Number(formData.get("carbsPct")),
    fatPct: Number(formData.get("fatPct"))
  });

  await saveUserMacroGoals(user.name, goals);
  revalidatePath("/");
  revalidatePath("/profile");
  redirect(profilePath(redirectDate));
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
      if (stored.type === "meal") {
        savedId = await saveMacroEntry({
          userName: user.name,
          entryDate: stored.date,
          rawText: stored.raw_text,
          parsed: stored.estimate,
          mealType: stored.meal_type,
          client
        });
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
    revalidatePath("/profile");
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
