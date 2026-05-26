export type MacroGoals = {
  calories: number;
  proteinPct: number;
  carbsPct: number;
  fatPct: number;
};

export const fallbackGoals: MacroGoals = {
  calories: 2200,
  proteinPct: 30,
  carbsPct: 40,
  fatPct: 30
};

export function normalizePercentGoals(goals: MacroGoals): MacroGoals {
  const total = goals.proteinPct + goals.carbsPct + goals.fatPct;
  if (total <= 0) {
    return fallbackGoals;
  }

  return {
    calories: goals.calories,
    proteinPct: Math.round((goals.proteinPct / total) * 100),
    carbsPct: Math.round((goals.carbsPct / total) * 100),
    fatPct: Math.max(0, 100 - Math.round((goals.proteinPct / total) * 100) - Math.round((goals.carbsPct / total) * 100))
  };
}

export function getFallbackMacroGoals(userName: string): MacroGoals {
  const raw = process.env.APP_USER_MACRO_GOALS || "";
  const target = raw
    .split(",")
    .map((entry) => entry.trim())
    .find((entry) => entry.toLowerCase().startsWith(`${userName.toLowerCase()}:`));

  if (!target) {
    return fallbackGoals;
  }

  const [, calories, proteinPct, carbsPct, fatPct] = target.split(":");
  const parsed = {
    calories: Number(calories),
    proteinPct: Number(proteinPct),
    carbsPct: Number(carbsPct),
    fatPct: Number(fatPct)
  };

  if (
    !Number.isFinite(parsed.calories) ||
    !Number.isFinite(parsed.proteinPct) ||
    !Number.isFinite(parsed.carbsPct) ||
    !Number.isFinite(parsed.fatPct)
  ) {
    return fallbackGoals;
  }

  return normalizePercentGoals(parsed);
}

export function parseMacroGoals(input: {
  calories: number;
  proteinPct: number;
  carbsPct: number;
  fatPct: number;
}): MacroGoals {
  const parsed = {
    calories: Math.max(1, Math.round(Number(input.calories))),
    proteinPct: Math.max(0, Math.round(Number(input.proteinPct))),
    carbsPct: Math.max(0, Math.round(Number(input.carbsPct))),
    fatPct: Math.max(0, Math.round(Number(input.fatPct)))
  };

  if (
    !Number.isFinite(parsed.calories) ||
    !Number.isFinite(parsed.proteinPct) ||
    !Number.isFinite(parsed.carbsPct) ||
    !Number.isFinite(parsed.fatPct)
  ) {
    return fallbackGoals;
  }

  return normalizePercentGoals(parsed);
}

export function gramsFromPercentGoals(goals: MacroGoals) {
  return {
    protein_g: Math.round((goals.calories * (goals.proteinPct / 100)) / 4),
    carbs_g: Math.round((goals.calories * (goals.carbsPct / 100)) / 4),
    fat_g: Math.round((goals.calories * (goals.fatPct / 100)) / 9)
  };
}

export function macroCalorieSplit(totals: {
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}) {
  const proteinCalories = totals.protein_g * 4;
  const carbCalories = totals.carbs_g * 4;
  const fatCalories = totals.fat_g * 9;
  const total = proteinCalories + carbCalories + fatCalories;

  if (!total) {
    return { proteinPct: 0, carbsPct: 0, fatPct: 0 };
  }

  const proteinPct = Math.round((proteinCalories / total) * 100);
  const carbsPct = Math.round((carbCalories / total) * 100);
  return {
    proteinPct,
    carbsPct,
    fatPct: Math.max(0, 100 - proteinPct - carbsPct)
  };
}
