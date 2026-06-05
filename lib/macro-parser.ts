import OpenAI from "openai";
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

const macroEstimateResponseSchema = z.object({
  items: z.array(macroItemSchema).default([]),
  confidence: z.coerce.number().min(0).max(1).default(0.6),
  notes: z.string().optional().default(""),
  accuracy_suggestion: z.string().optional().default("")
});

export type ParsedMacros = z.infer<typeof macroSchema>;

export function parseMacroObject(input: unknown): ParsedMacros {
  return macroSchema.parse(input);
}

export function parseStoredMacros(input: string): ParsedMacros {
  return parseMacroObject(JSON.parse(input));
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

function parseGeneratedMacroEstimate(input: unknown): ParsedMacros {
  const parsed = macroEstimateResponseSchema.parse(input);
  return normalizeGeneratedMacroEstimate({
    ...parsed,
    calories: 0,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0
  });
}

const macroResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "macro_estimate",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["items", "confidence", "notes", "accuracy_suggestion"],
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "calories", "protein_g", "carbs_g", "fat_g", "assumption"],
            properties: {
              name: { type: "string" },
              calories: { type: "number", minimum: 0 },
              protein_g: { type: "number", minimum: 0 },
              carbs_g: { type: "number", minimum: 0 },
              fat_g: { type: "number", minimum: 0 },
              assumption: { type: "string" }
            }
          }
        },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        notes: { type: "string" },
        accuracy_suggestion: { type: "string" }
      }
    }
  }
} as const;

export async function parseMacros(
  input: string,
  feedback?: string,
  previousEstimate?: ParsedMacros
): Promise<ParsedMacros> {
  const client = new OpenAI();
  const correctionText = feedback?.trim()
    ? `\n\nUser correction/context to apply: ${feedback.trim()}`
    : "";
  const previousEstimateText = previousEstimate
    ? `\n\nPrevious structured estimate to revise:\n${JSON.stringify(previousEstimate, null, 2)}`
    : "";
  const response = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    response_format: macroResponseFormat,
    messages: [
      {
        role: "system",
        content:
          "Estimate nutrition macros from casual meal text. Return only the requested structured JSON. Do not write generic caveats."
      },
      {
        role: "user",
        content: `Input: ${input}${previousEstimateText}${correctionText}

Return JSON with:
{
  "items": [
    {
      "name": "food item",
      "calories": number,
      "protein_g": number,
      "carbs_g": number,
      "fat_g": number,
      "assumption": "portion assumption for this item"
    }
  ],
  "confidence": number from 0 to 1,
  "notes": "short note about the estimate",
  "accuracy_suggestion": "specific question or detail that would improve accuracy, or empty string"
}

Use reasonable estimates when exact quantities are missing. Never return null.
Do not write generic notes like "estimated values are based on typical serving sizes", "actual values may vary", or "based on a typical serving".
The notes field must contain a concrete assumption you made only if it matters, for example "Assumed 1 cup cooked orzo soup and 4 oz gyro meat."
Estimate nutrition at the food item level. The app will calculate meal totals from the item values.
If confidence is below 0.75, accuracy_suggestion must ask for the single most useful missing detail, such as portion size, brand, cooking fat, weight, or quantity.
Avoid generic notes like "values may vary." Tell the user exactly what would improve accuracy.
If a correction is provided with a previous structured estimate, revise that previous estimate instead of estimating from scratch.
If the correction changes only one food item, keep every other food item and its macros unchanged unless the correction explicitly affects them.
If a correction is provided, apply it directly and explain the adjustment briefly in notes.`
      }
    ]
  });

  const content = response.choices[0].message.content || "{}";
  return parseGeneratedMacroEstimate(JSON.parse(content));
}
