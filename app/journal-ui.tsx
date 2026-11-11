"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { updateJournalEntryAction } from "./actions";
import { MOOD_LABELS, STRESS_LABELS, recordedRatings, type JournalEntry, type Rating } from "@/lib/journal";
import { TAG_KEYS, keyLabel, normalizeTag, normalizeTags, parseTag, tagLabel, tagsOf, type Feeling, type TagKey } from "@/lib/journal-tags";

const dayFormat = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

function formatDay(date: string) {
  return dayFormat.format(new Date(`${date}T00:00:00Z`));
}

// 1-5 buttons with labels; tapping the chosen one clears it.
function ScalePicker({
  label,
  labels,
  value,
  onChange
}: {
  label: string;
  labels: readonly string[];
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <fieldset className="workout-editor-groups">
      <legend>
        {label}: {value == null ? "not recorded" : `${value} · ${labels[value - 1]}`}
      </legend>
      <div className="scale-picker">
        {labels.map((text, index) => {
          const level = index + 1;
          const on = value === level;
          return (
            <button
              key={text}
              type="button"
              className={on ? "muscle-toggle small on" : "muscle-toggle small"}
              aria-pressed={on}
              aria-label={`${level}, ${text}`}
              onClick={() => onChange(on ? null : level)}
            >
              {level}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

// A tag as a chip: "Work: deadline", tinted and labeled when it felt good or bad.
export function TagChip({ tag, children }: { tag: string; children?: ReactNode }) {
  const parsed = parseTag(tag);
  const feeling = parsed?.feeling;
  return (
    <span className={feeling ? `tag-chip ${feeling}` : "tag-chip"}>
      {tagLabel(tag)}
      {feeling ? <small> · felt {feeling}</small> : null}
      {children}
    </span>
  );
}

// Fix a saved entry's mood, optional stress and tags. A tag is a key, then a
// value picked or typed, and optionally how it felt; normalized on save.
function JournalEntryEditor({
  entry,
  knownTags,
  onClose
}: {
  entry: JournalEntry;
  knownTags: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [ratings, setRatings] = useState<Record<Rating, number | null>>(entry.ratings);
  const [tags, setTags] = useState<string[]>(entry.tags);
  const [custom, setCustom] = useState("");
  const [key, setKey] = useState<TagKey>("with");
  const [feeling, setFeeling] = useState<Feeling | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = (value: string | null) => {
    const tag = normalizeTag({ key, value, feeling }, knownTags);
    if (tag) setTags(normalizeTags([...tags, tag], knownTags));
    setCustom("");
  };
  const options = [
    ...new Set([
      ...(TAG_KEYS.find((item) => item.key === key)?.values ?? []),
      ...knownTags.map(parseTag).filter((tag) => tag?.key === key && tag.value).map((tag) => tag!.value!)
    ])
  ].filter((value) => !tags.some((tag) => parseTag(tag)?.key === key && parseTag(tag)?.value === value));

  async function save() {
    setBusy(true);
    setError(null);
    const result = await updateJournalEntryAction(entry.id, { ratings, tags });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Couldn't save that.");
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <div className="workout-editor">
      <ScalePicker label="Mood" labels={MOOD_LABELS} value={ratings.mood} onChange={(mood) => setRatings({ ...ratings, mood })} />
      <ScalePicker
        label="Stress (optional)"
        labels={STRESS_LABELS}
        value={ratings.stress}
        onChange={(stress) => setRatings({ ...ratings, stress })}
      />
      <fieldset className="workout-editor-groups">
        <legend>Tags</legend>
        {tags.length ? (
          <div className="muscle-row">
            {tags.map((tag) => (
              <button key={tag} type="button" className="tag-remove" onClick={() => setTags(tags.filter((item) => item !== tag))} aria-label={`Remove ${tagLabel(tag)}`}>
                <TagChip tag={tag}> ✕</TagChip>
              </button>
            ))}
          </div>
        ) : null}
        <div className="type-filter tag-categories" role="tablist">
          {TAG_KEYS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={item.key === key}
              className={item.key === key ? "on" : undefined}
              onClick={() => setKey(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="muscle-row" aria-label="How it felt">
          {([null, "good", "bad"] as const).map((option) => (
            <button
              key={option ?? "none"}
              type="button"
              className={feeling === option ? "muscle-toggle small on" : "muscle-toggle small"}
              aria-pressed={feeling === option}
              onClick={() => setFeeling(option)}
            >
              {option ? `Felt ${option}` : "No feeling"}
            </button>
          ))}
        </div>
        <div className="muscle-row">
          {feeling ? (
            <button type="button" className="muscle-toggle small" onClick={() => add(null)}>
              {keyLabel(key)} as a whole
            </button>
          ) : null}
          {options.map((value) => (
            <button key={value} type="button" className="muscle-toggle small" onClick={() => add(value)}>
              {value}
            </button>
          ))}
        </div>
        <div className="tag-custom">
          <input
            value={custom}
            maxLength={30}
            placeholder={`Other ${keyLabel(key).toLowerCase()}`}
            onChange={(event) => setCustom(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (custom.trim()) add(custom);
              }
            }}
          />
          <button type="button" className="pill-button" onClick={() => add(custom)} disabled={!custom.trim()}>
            Add
          </button>
        </div>
      </fieldset>
      {error ? <p className="workout-editor-error">{error}</p> : null}
      <div className="workout-editor-actions">
        <span className="workout-editor-spacer" />
        <button type="button" className="button secondary compact" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="button compact" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

// Whether an entry matches a filter: "work" (any work tag), "work:deadline"
// (that value), "work-" or "work+" (work that felt bad or good).
function matches(entry: JournalEntry, filter: string) {
  const want = parseTag(filter);
  if (!want) return false;
  return tagsOf(entry, want.key).some((tag) => (!want.value || tag.value === want.value) && (!want.feeling || tag.feeling === want.feeling));
}

function filterLabel(filter: string) {
  const want = parseTag(filter)!;
  if (want.value) return tagLabel({ ...want, feeling: null });
  return want.feeling ? `${keyLabel(want.key)} felt ${want.feeling}` : `any ${keyLabel(want.key).toLowerCase()}`;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

// Journal history. Unfiltered it shows the recent days; picking a tag shows
// every entry with it in the loaded range, with average mood and stress
// against the rest, so patterns over weeks are visible.
export function JournalHistory({
  entries,
  recentFrom,
  rangeDays
}: {
  entries: JournalEntry[];
  recentFrom: string;
  rangeDays: number;
}) {
  const [tag, setTag] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Filters by key: the key as a whole, each value, and how it felt.
  const knownTags = [...new Set(entries.flatMap((entry) => entry.tags))];
  const count = (filter: string) => entries.filter((entry) => matches(entry, filter)).length;
  const byKey = TAG_KEYS.map((item) => {
    const values = [...new Set(entries.flatMap((entry) => tagsOf(entry, item.key)).map((tag) => tag.value).filter((value): value is string => Boolean(value)))];
    const filters = [item.key, `${item.key}+`, `${item.key}-`, ...values.map((value) => `${item.key}:${value}`)].filter((filter) => count(filter) > 0);
    return { key: item.key, filters: filters.sort((a, b) => Number(b === item.key) - Number(a === item.key) || count(b) - count(a)) };
  }).filter((group) => group.filters.length);

  const shown = tag ? entries.filter((entry) => matches(entry, tag)) : entries.filter((entry) => entry.date >= recentFrom);
  const rest = tag ? entries.filter((entry) => !matches(entry, tag)) : [];
  const stat = (list: JournalEntry[], rating: Rating) =>
    average(list.map((entry) => entry.ratings[rating]).filter((value): value is number => value != null));
  const pattern = tag
    ? [
        ["mood", stat(shown, "mood"), stat(rest, "mood")],
        ["stress", stat(shown, "stress"), stat(rest, "stress")]
      ].filter(([, withTag]) => withTag != null) as [string, number, number | null][]
    : [];

  return (
    <section className="card" aria-label="Journal">
      <div className="card-heading">
        <h2 className="card-title">Journal</h2>
        <span className="card-aside">{tag ? `${rangeDays} days` : "14 days"}</span>
      </div>
      {byKey.length ? (
        <div className="journal-tag-filter" aria-label="Filter by tag">
          {byKey.map((group) => (
            <div key={group.key}>
              <span>{keyLabel(group.key)}</span>
              <div className="muscle-row">
                {group.filters.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={tag === value ? "muscle-toggle small on" : "muscle-toggle small"}
                    aria-pressed={tag === value}
                    onClick={() => setTag(tag === value ? null : value)}
                  >
                    {value === group.key ? "All" : value.endsWith("+") ? "Felt good" : value.endsWith("-") ? "Felt bad" : parseTag(value)!.value} {count(value)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {tag && pattern.length ? (
        <p className="journal-pattern">
          {pattern
            .map(
              ([name, withTag, without]) =>
                `${name} ${withTag.toFixed(1)} with ${filterLabel(tag)}${without != null ? ` vs ${without.toFixed(1)} otherwise` : ""}`
            )
            .join(" · ")}
        </p>
      ) : null}
      {shown.length ? (
        <ul className="journal-list">
          {shown.map((entry) => {
            const ratings = recordedRatings(entry.ratings);
            return (
              <li key={entry.id}>
                <details>
                  <summary>
                    <span className="journal-when">
                      {formatDay(entry.date)} · {entry.kind}
                    </span>
                    {ratings.length ? (
                      <span className="journal-ratings">
                        {ratings.map((rating) => `${rating.name} ${rating.value} · ${rating.label}`).join("  ·  ")}
                      </span>
                    ) : null}
                    <span className="journal-preview">{entry.body}</span>
                  </summary>
                  <p className="journal-body">{entry.body}</p>
                  {editingId === entry.id ? (
                    <JournalEntryEditor entry={entry} knownTags={knownTags} onClose={() => setEditingId(null)} />
                  ) : (
                    <div className="journal-entry-foot">
                      <div className="draft-chips">
                        {entry.tags.map((value) => (
                          <TagChip key={value} tag={value} />
                        ))}
                      </div>
                      <button type="button" className="text-button" onClick={() => setEditingId(entry.id)}>
                        Edit mood & tags
                      </button>
                    </div>
                  )}
                </details>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="footnote">{tag ? `No entries with ${filterLabel(tag)}.` : "No entries yet. Tell the chat how your day went."}</p>
      )}
    </section>
  );
}
