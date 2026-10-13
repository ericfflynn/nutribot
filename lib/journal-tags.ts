// Journal tags: a small vocabulary in categories, plus custom tags. Every tag
// is normalized the same way when the chat drafts it, when the owner edits
// it, and when history is read, so "Work", "work " and "#work" are one tag
// and patterns over time stay countable. Pure, no database.

export const TAG_CATEGORIES = [
  { id: "work", label: "Work", tags: ["work", "deadline", "meeting", "coding", "productive", "burnout"] },
  { id: "relationships", label: "Relationships", tags: ["family", "partner", "friends", "conflict"] },
  { id: "health", label: "Health", tags: ["sick", "headache", "pain", "injury", "doctor", "diet"] },
  { id: "exercise", label: "Exercise", tags: ["workout", "sore", "rest day", "cardio", "personal best"] },
  { id: "sleep", label: "Sleep", tags: ["poor sleep", "good sleep", "tired", "nap", "late night"] },
  { id: "social", label: "Social", tags: ["social", "party", "date night", "alone time", "hosting"] },
  { id: "growth", label: "Personal Growth", tags: ["reading", "learning", "meditation", "gratitude", "therapy"] },
  { id: "other", label: "Other", tags: ["stress", "relaxing", "travel", "money", "errands", "weather"] }
] as const;

export type TagCategory = (typeof TAG_CATEGORIES)[number]["id"];

export const PREDEFINED_TAGS: string[] = TAG_CATEGORIES.flatMap((category) => [...category.tags]);

// Different words for the same thing.
const SYNONYMS: Record<string, string> = {
  "bad sleep": "poor sleep",
  "slept badly": "poor sleep",
  "slept poorly": "poor sleep",
  "no sleep": "poor sleep",
  insomnia: "poor sleep",
  "slept well": "good sleep",
  "great sleep": "good sleep",
  exhausted: "tired",
  fatigue: "tired",
  gym: "workout",
  lifting: "workout",
  training: "workout",
  exercise: "workout",
  programming: "coding",
  job: "work",
  office: "work",
  stressed: "stress",
  stressful: "stress",
  anxiety: "stress",
  relaxed: "relaxing",
  relax: "relaxing",
  chill: "relaxing",
  friend: "friends",
  girlfriend: "partner",
  boyfriend: "partner",
  wife: "partner",
  husband: "partner",
  ill: "sick",
  illness: "sick",
  cold: "sick",
  pr: "personal best",
  "family time": "family",
  socializing: "social",
  "date": "date night",
  meditate: "meditation",
  read: "reading"
};

// Words that place a custom tag in a category ("sore legs" is Exercise).
const CATEGORY_HINTS: [TagCategory, RegExp][] = [
  ["exercise", /\b(sore|run|lift|gym|workout|walk|hike|ride|yoga|pilates|swim|golf|tennis)\b/],
  ["health", /\b(sick|ache|pain|sore throat|headache|fever|tooth|dentist|doctor|lymph|allerg|nause|injur|med)/],
  ["sleep", /\b(sleep|slept|tired|nap|insomnia|bed)\b/],
  ["work", /\b(work|meeting|deadline|boss|project|client|code|coding|email)\b/],
  ["relationships", /\b(family|mom|dad|brother|sister|partner|wife|husband|kids?|parents?)\b/],
  ["social", /\b(friends?|party|dinner|drinks|social|hang)\b/],
  ["growth", /\b(read|learn|meditat|journal|therapy|gratitude|goal)\w*/]
];

// Lowercase, single-spaced, no "#", "_" or "-", synonyms folded, and a plural
// folded onto a known tag ("headaches" is "headache"). `known` adds the
// owner's own tags to fold onto.
export function normalizeTag(tag: string, known: readonly string[] = []) {
  let value = tag
    .toLowerCase()
    .replace(/^#+/, "")
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N} ']+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) return "";
  value = SYNONYMS[value] ?? value;
  const vocabulary = new Set([...PREDEFINED_TAGS, ...known]);
  if (vocabulary.has(value)) return value;
  const singular = value.endsWith("es") && vocabulary.has(value.slice(0, -2)) ? value.slice(0, -2) : value.endsWith("s") ? value.slice(0, -1) : value;
  if (vocabulary.has(singular)) return singular;
  if (vocabulary.has(`${value}s`)) return `${value}s`;
  return SYNONYMS[singular] ?? value;
}

// Normalized, deduplicated, at most `max` tags, in their original order.
export function normalizeTags(tags: readonly string[], known: readonly string[] = [], max = 8) {
  const result: string[] = [];
  for (const tag of tags) {
    const value = normalizeTag(tag, known);
    if (value && value.length <= 40 && !result.includes(value)) result.push(value);
  }
  return result.slice(0, max);
}

export function categoryOf(tag: string): TagCategory {
  const predefined = TAG_CATEGORIES.find((category) => (category.tags as readonly string[]).includes(tag));
  if (predefined) return predefined.id;
  return CATEGORY_HINTS.find(([, pattern]) => pattern.test(tag))?.[0] ?? "other";
}

export function categoryLabel(id: TagCategory) {
  return TAG_CATEGORIES.find((category) => category.id === id)!.label;
}
