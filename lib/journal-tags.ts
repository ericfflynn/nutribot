// Journal tags (docs/journal-tags.md): what came up in an entry, as a key
// and a word, and optionally how it felt. "with:partner", "work:deadline-"
// (felt bad), "did:game+" (felt good), "work-" (work felt bad, nothing more
// specific). Each key belongs to a body-state area, so the journal and the
// body state share one vocabulary. The keys are fixed; values are open
// (lib/vocab.ts). Pure, no database.
import { cleanWord, foldOnto } from "./vocab";

export const TAG_KEYS = [
  {
    key: "with",
    label: "With",
    area: "lifestyle.relationships",
    about: "who they were with: their partner is always partner and relatives family (check memories for who's who), anyone else by first name",
    values: ["partner", "family", "friends", "coworkers", "alone"]
  },
  {
    key: "did",
    label: "Did",
    area: "lifestyle",
    about: "something notable that other data doesn't cover (not workouts, meals, habits or sleep)",
    values: ["ate out", "date", "party", "event", "hosting", "travel", "game", "watched sports", "outdoors", "tv", "side project", "doctor", "errands"]
  },
  {
    key: "work",
    label: "Work",
    area: "lifestyle.career",
    about: "what work was like",
    values: ["deadline", "meeting", "presentation", "launch", "office", "busy", "after hours", "day off"]
  },
  {
    key: "stressor",
    label: "Stress from",
    area: "mental.mood",
    about: "what was behind stress, only when they say there was some",
    values: ["work", "relationship", "family", "money", "health", "home", "someone close", "personal"]
  }
] as const;

export type TagKey = (typeof TAG_KEYS)[number]["key"];
export const TAG_KEY_NAMES = TAG_KEYS.map((item) => item.key) as [TagKey, ...TagKey[]];
export const FEELINGS = ["good", "bad"] as const;
export type Feeling = (typeof FEELINGS)[number];

export type Tag = { key: TagKey; value: string | null; feeling: Feeling | null };

const keyOf = (name: string) => TAG_KEYS.find((item) => item.key === name);

// A tag in its stored form, or null when it isn't one: "key", "key:value",
// either followed by + (felt good) or - (felt bad). A key alone needs a feeling.
export function parseTag(text: string): Tag | null {
  const match = /^([a-z]+)(?::([^+-]*))?([+-])?$/.exec(text.trim().toLowerCase());
  if (!match || !keyOf(match[1])) return null;
  const value = match[2] ? cleanWord(match[2]) || null : null;
  const feeling = match[3] === "+" ? "good" : match[3] === "-" ? "bad" : null;
  return { key: match[1] as TagKey, value, feeling };
}

export function formatTag(tag: Tag) {
  return `${tag.key}${tag.value ? `:${tag.value}` : ""}${tag.feeling === "good" ? "+" : tag.feeling === "bad" ? "-" : ""}`;
}

// A tag tidied up: its value cleaned and folded onto a value already in use
// for that key (the suggested ones and the owner's own, `known`) when it's
// the same words. Null when it's empty: a key needs a value or a feeling.
export function normalizeTag(tag: Tag | string, known: readonly string[] = []): string | null {
  const parsed = typeof tag === "string" ? parseTag(tag) : tag;
  if (!parsed || !keyOf(parsed.key)) return null;
  const vocabulary = [
    ...known.map(parseTag).filter((item): item is Tag => item?.key === parsed.key && Boolean(item.value)).map((item) => item.value!),
    ...keyOf(parsed.key)!.values
  ];
  const value = parsed.value ? foldOnto(parsed.value, vocabulary) || null : null;
  if (value && value.length > 30) return null;
  if (!value && !parsed.feeling) return null;
  return formatTag({ key: parsed.key, value, feeling: parsed.feeling });
}

// Normalized and deduplicated (one per key and value; the later feeling
// wins), at most `max`, in order. Strings that aren't tags (older free tags)
// are dropped.
export function normalizeTags(tags: readonly (Tag | string)[], known: readonly string[] = [], max = 6): string[] {
  const byKey = new Map<string, string>();
  for (const tag of tags) {
    const value = normalizeTag(tag, known);
    if (!value) continue;
    const parsed = parseTag(value)!;
    byKey.set(`${parsed.key}:${parsed.value ?? ""}`, value);
  }
  return [...byKey.values()].slice(0, max);
}

export function keyLabel(key: TagKey) {
  return keyOf(key)!.label;
}

// "With partner", "Work: deadline", "Stress from work", "Work" (with its
// feeling shown apart).
export function tagLabel(tag: Tag | string) {
  const parsed = typeof tag === "string" ? parseTag(tag) : tag;
  if (!parsed) return typeof tag === "string" ? tag : "";
  const label = keyLabel(parsed.key);
  if (!parsed.value) return label;
  return parsed.key === "work" || parsed.key === "did" ? `${label}: ${parsed.value}` : `${label} ${parsed.value}`;
}

export function tagsOf(entry: { tags: readonly string[] }, key?: TagKey): Tag[] {
  return entry.tags.map(parseTag).filter((tag): tag is Tag => Boolean(tag) && (!key || tag!.key === key));
}

// For the chat: each key, what it's for and its suggested values.
export function describeTagKeys() {
  return TAG_KEYS.map((item) => `${item.key} (${item.about}): ${item.values.join(", ")}`).join("; ");
}
