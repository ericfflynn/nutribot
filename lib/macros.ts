// Meal macro estimates: the shape stored in macro_entries and produced by the
// chat brain's draft_meal tool, with totals summed from the items.
import { z } from "zod";

const macroItemSchema = z.object({
  name: z.string(),
  calories: z.coerce.number().nonnegative().default(0),
  protein_g: z.coerce.number().nonnegative().default(0),
  carbs_g: z.coerce.number().nonnegative().default(0),
  fat_g: z.coerce.number().nonnegative().default(0),
  assumption: z.string().optional().default("")
});

const macroSchema = z.object({
  calories: z.coerce.number().nonnegative().default(0),
  protein_g: z.coerce.number().nonnegative().default(0),
  carbs_g: z.coerce.number().nonnegative().default(0),
  fat_g: z.coerce.number().nonnegative().default(0),
  items: z.array(macroItemSchema).default([]),
  confidence: z.coerce.number().min(0).max(1).default(0.6),
  notes: z.string().optional().default(""),
  accuracy_suggestion: z.string().optional().default("")
});


export type ParsedMacros = z.infer<typeof macroSchema>;

export function parseMacroObject(input: unknown): ParsedMacros {
  return macroSchema.parse(input);
}


type MacroTotalKey = "calories" | "protein_g" | "carbs_g" | "fat_g";

function roundMacro(value: number) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function sumItemMacro(items: ParsedMacros["items"], key: MacroTotalKey) {
  return items.reduce((sum, item) => sum + roundMacro(item[key]), 0);
}

export function normalizeGeneratedMacroEstimate(parsed: ParsedMacros): ParsedMacros {
  if (!parsed.items.length) {
    return {
      ...parsed,
      calories: roundMacro(parsed.calories),
      protein_g: roundMacro(parsed.protein_g),
      carbs_g: roundMacro(parsed.carbs_g),
      fat_g: roundMacro(parsed.fat_g)
    };
  }

  return {
    ...parsed,
    calories: sumItemMacro(parsed.items, "calories"),
    protein_g: sumItemMacro(parsed.items, "protein_g"),
    carbs_g: sumItemMacro(parsed.items, "carbs_g"),
    fat_g: sumItemMacro(parsed.items, "fat_g"),
    items: parsed.items.map((item) => ({
      ...item,
      calories: roundMacro(item.calories),
      protein_g: roundMacro(item.protein_g),
      carbs_g: roundMacro(item.carbs_g),
      fat_g: roundMacro(item.fat_g)
    }))
  };
}
