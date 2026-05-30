"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { clearSession, createSession, getSessionUser } from "@/lib/auth";
import { todayLocalDate } from "@/lib/dates";
import { parseMacroGoals } from "@/lib/goals";
import { parseMacroObject, parseMacros, parseStoredMacros, type ParsedMacros } from "@/lib/macro-parser";
import { deleteMacroEntry, saveMacroEntry, saveUserMacroGoals, updateMacroEntry } from "@/lib/supabase";

export type MealReviewState = {
  rawText: string;
  parsed: ParsedMacros | null;
  feedback: string | null;
  error: string | null;
};

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

  if (!rawText) {
    return { rawText: "", parsed: null, feedback: null, error: "Original meal text is missing." };
  }
  if (!feedback) {
    return { rawText, parsed: null, feedback: null, error: "Add a correction first." };
  }

  try {
    const parsed = await parseMacros(rawText, feedback);
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
  if (!rawText) {
    redirect("/?error=Enter%20what%20you%20ate%20first.");
  }
  if (!parsedJson) {
    redirect("/?error=Review%20the%20AI%20estimate%20before%20saving.");
  }

  let parsed: ParsedMacros;
  try {
    parsed = parseStoredMacros(parsedJson);
  } catch {
    redirect(`/?error=${encodeURIComponent("Saved estimate was invalid. Please estimate the meal again.")}`);
  }

  await saveMacroEntry({
    userName: user.name,
    entryDate: todayLocalDate(),
    rawText,
    parsed
  });

  revalidatePath("/");
  redirect("/");
}

export async function updateMacroEntryAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user) {
    redirect("/");
  }

  const id = String(formData.get("id") || "").trim();
  const rawText = String(formData.get("rawText") || "").trim();
  if (!id) {
    redirect(`/?error=${encodeURIComponent("Meal entry is missing.")}`);
  }
  if (!rawText) {
    redirect(`/?error=${encodeURIComponent("Meal description is required.")}`);
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
    redirect(`/?error=${encodeURIComponent("Meal macros must be valid non-negative numbers.")}`);
  }

  try {
    await updateMacroEntry({
      id,
      userName: user.name,
      rawText,
      parsed
    });
  } catch (error) {
    redirect(
      `/?error=${encodeURIComponent(error instanceof Error ? error.message : "Meal update failed.")}`
    );
  }

  revalidatePath("/");
  redirect("/");
}

export async function deleteMacroEntryAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user) {
    redirect("/");
  }

  const id = String(formData.get("id") || "").trim();
  if (!id) {
    redirect(`/?error=${encodeURIComponent("Meal entry is missing.")}`);
  }

  try {
    await deleteMacroEntry(id, user.name);
  } catch (error) {
    redirect(
      `/?error=${encodeURIComponent(error instanceof Error ? error.message : "Meal delete failed.")}`
    );
  }

  revalidatePath("/");
  redirect("/");
}

export async function saveMacroGoalsAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user) {
    redirect("/");
  }

  const goals = parseMacroGoals({
    calories: Number(formData.get("calories")),
    proteinPct: Number(formData.get("proteinPct")),
    carbsPct: Number(formData.get("carbsPct")),
    fatPct: Number(formData.get("fatPct"))
  });

  await saveUserMacroGoals(user.name, goals);
  revalidatePath("/");
  redirect("/");
}
