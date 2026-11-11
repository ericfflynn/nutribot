// Open vocabularies (tag values, symptoms): any word is allowed, and a new
// one folds onto a word already in use when it's the same words, give or take
// case, punctuation, plurals and order ("Ear ringing" is "ringing ears").
// Meaning ("girlfriend" is "partner") is the chat's call, from the words the
// owner already uses, not a table here. Pure.

export function cleanWord(text: string) {
  return text
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N} ']+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// The words, singular and sorted: what two spellings must share to be one.
function shapeOf(text: string) {
  return cleanWord(text)
    .split(" ")
    .map((word) => (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word))
    .sort()
    .join(" ");
}

// `text` cleaned, or the known word it's a variant of. Empty when nothing's left.
export function foldOnto(text: string, known: Iterable<string>) {
  const value = cleanWord(text);
  if (!value) return "";
  const shape = shapeOf(value);
  for (const word of known) if (word === value) return word;
  for (const word of known) if (shapeOf(word) === shape) return word;
  return value;
}

// Each folded, deduplicated, in order.
export function foldAll(texts: readonly string[], known: Iterable<string>, maxLength = 40) {
  const words = [...known];
  const result: string[] = [];
  for (const text of texts) {
    const value = foldOnto(text, [...words, ...result]);
    if (value && value.length <= maxLength && !result.includes(value)) result.push(value);
  }
  return result;
}
