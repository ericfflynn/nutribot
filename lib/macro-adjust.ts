export type EditableMacros = {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  calorieRemainder: number;
};

export type MacroField = "protein_g" | "carbs_g" | "fat_g";

export function roundMacro(value: number) {
  return Math.max(0, Math.round(value));
}

export function macroCalories(protein_g: number, carbs_g: number, fat_g: number) {
  return roundMacro(protein_g * 4 + carbs_g * 4 + fat_g * 9);
}

export function calorieRemainder(calories: number, protein_g: number, carbs_g: number, fat_g: number) {
  return Math.max(0, roundMacro(calories) - macroCalories(protein_g, carbs_g, fat_g));
}

export function initialAdjustedMacros(input: {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}): EditableMacros {
  return {
    calories: roundMacro(input.calories),
    protein_g: roundMacro(input.protein_g),
    carbs_g: roundMacro(input.carbs_g),
    fat_g: roundMacro(input.fat_g),
    calorieRemainder: calorieRemainder(input.calories, input.protein_g, input.carbs_g, input.fat_g)
  };
}

export function adjustMacroValue(current: EditableMacros, name: MacroField, value: string): EditableMacros {
  const next = {
    ...current,
    [name]: roundMacro(Number(value) || 0)
  };

  return {
    ...next,
    calories: macroCalories(next.protein_g, next.carbs_g, next.fat_g) + next.calorieRemainder
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
    current.calories || macroCalories(current.protein_g, current.carbs_g, current.fat_g) + current.calorieRemainder;

  if (!baseCalories) {
    return {
      ...current,
      calories
    };
  }

  const scale = calories / baseCalories;
  return {
    calories,
    protein_g: roundMacro(current.protein_g * scale),
    carbs_g: roundMacro(current.carbs_g * scale),
    fat_g: roundMacro(current.fat_g * scale),
    calorieRemainder: roundMacro(current.calorieRemainder * scale)
  };
}
