export type EditableMacros = {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  calorieRemainder: number;
  proteinRaw: number;
  carbsRaw: number;
  fatRaw: number;
  calorieRemainderRaw: number;
};

export type MacroField = "protein_g" | "carbs_g" | "fat_g";

export function roundMacro(value: number) {
  return Math.max(0, Math.round(value));
}

export function macroCalories(protein_g: number, carbs_g: number, fat_g: number) {
  return roundMacro(protein_g * 4 + carbs_g * 4 + fat_g * 9);
}

function macroCaloriesExact(protein_g: number, carbs_g: number, fat_g: number) {
  return protein_g * 4 + carbs_g * 4 + fat_g * 9;
}

export function calorieRemainder(calories: number, protein_g: number, carbs_g: number, fat_g: number) {
  return Math.max(0, roundMacro(calories) - roundMacro(macroCaloriesExact(protein_g, carbs_g, fat_g)));
}

export function initialAdjustedMacros(input: {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}): EditableMacros {
  const proteinRaw = Math.max(0, Number(input.protein_g) || 0);
  const carbsRaw = Math.max(0, Number(input.carbs_g) || 0);
  const fatRaw = Math.max(0, Number(input.fat_g) || 0);
  const calorieRemainderRaw = Math.max(
    0,
    (Number(input.calories) || 0) - macroCaloriesExact(proteinRaw, carbsRaw, fatRaw)
  );

  return {
    calories: roundMacro(input.calories),
    protein_g: roundMacro(proteinRaw),
    carbs_g: roundMacro(carbsRaw),
    fat_g: roundMacro(fatRaw),
    calorieRemainder: roundMacro(calorieRemainderRaw),
    proteinRaw,
    carbsRaw,
    fatRaw,
    calorieRemainderRaw
  };
}

export function adjustMacroValue(current: EditableMacros, name: MacroField, value: string): EditableMacros {
  const nextValue = roundMacro(Number(value) || 0);
  const next = {
    ...current,
    [name]: nextValue,
    [`${name.replace("_g", "")}Raw`]: nextValue
  };

  return {
    ...next,
    calories:
      roundMacro(macroCaloriesExact(next.proteinRaw, next.carbsRaw, next.fatRaw) + next.calorieRemainderRaw)
  };
}

export function adjustCalories(current: EditableMacros, value: string): EditableMacros {
  if (value.trim() === "") {
    return {
      ...current,
      calories: 0
    };
  }

  const calories = roundMacro(Number(value) || 0);
  const baseCalories =
    current.calories ||
    roundMacro(
      macroCaloriesExact(current.proteinRaw, current.carbsRaw, current.fatRaw) + current.calorieRemainderRaw
    );

  if (!baseCalories) {
    return {
      ...current,
      calories
    };
  }

  const scale = calories / baseCalories;
  const proteinRaw = current.proteinRaw * scale;
  const carbsRaw = current.carbsRaw * scale;
  const fatRaw = current.fatRaw * scale;
  const calorieRemainderRaw = current.calorieRemainderRaw * scale;

  return {
    calories,
    protein_g: roundMacro(proteinRaw),
    carbs_g: roundMacro(carbsRaw),
    fat_g: roundMacro(fatRaw),
    calorieRemainder: roundMacro(calorieRemainderRaw),
    proteinRaw,
    carbsRaw,
    fatRaw,
    calorieRemainderRaw
  };
}
