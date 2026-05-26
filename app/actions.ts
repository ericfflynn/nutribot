"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { clearSession, createSession, getSessionUser } from "@/lib/auth";
import { todayLocalDate } from "@/lib/dates";
import { parseMacroGoals } from "@/lib/goals";
import { parseMacros, type ParsedMacros } from "@/lib/macro-parser";
import { saveMacroEntry, saveUserMacroGoals } from "@/lib/supabase";

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

  const parsed = JSON.parse(parsedJson) as ParsedMacros;
  await saveMacroEntry({
    userName: user.name,
    entryDate: todayLocalDate(),
    rawText,
    parsed
  });

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
