"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateJournalEntryAction } from "./actions";
import { MOOD_LABELS, STRESS_LABELS, recordedRatings, type JournalEntry, type Rating } from "@/lib/journal";
import { TAG_CATEGORIES, categoryLabel, categoryOf, normalizeTag, type TagCategory } from "@/lib/journal-tags";

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

// Fix a saved entry's mood, optional stress and tags. Tags are picked from
// the categories, or typed; either way they're normalized on save.
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
  const [category, setCategory] = useState<TagCategory>("work");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (tag: string) =>
    setTags((current) => (current.includes(tag) ? current.filter((value) => value !== tag) : [...current, tag]));
  const addCustom = () => {
    const tag = normalizeTag(custom, knownTags);
    if (tag && !tags.includes(tag)) setTags([...tags, tag]);
    setCustom("");
  };
  const options = [
    ...new Set([
      ...(TAG_CATEGORIES.find((item) => item.id === category)?.tags ?? []),
      ...knownTags.filter((tag) => categoryOf(tag) === category)
    ])
  ];

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
              <button key={tag} type="button" className="muscle-toggle small on" onClick={() => toggle(tag)} aria-label={`Remove ${tag}`}>
                {tag} ✕
              </button>
            ))}
          </div>
        ) : null}
        <div className="type-filter tag-categories" role="tablist">
          {TAG_CATEGORIES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={item.id === category}
              className={item.id === category ? "on" : undefined}
              onClick={() => setCategory(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="muscle-row">
          {options
            .filter((tag) => !tags.includes(tag))
            .map((tag) => (
              <button key={tag} type="button" className="muscle-toggle small" onClick={() => toggle(tag)}>
                {tag}
              </button>
            ))}
        </div>
        <div className="tag-custom">
          <input
            value={custom}
            maxLength={40}
            placeholder="Custom tag"
            onChange={(event) => setCustom(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addCustom();
              }
            }}
          />
          <button type="button" className="pill-button" onClick={addCustom} disabled={!custom.trim()}>
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

  const counts = new Map<string, number>();
  for (const entry of entries) for (const value of entry.tags) counts.set(value, (counts.get(value) ?? 0) + 1);
  const knownTags = [...counts.keys()];
  const byCategory = TAG_CATEGORIES.map((category) => ({
    id: category.id,
    tags: knownTags.filter((value) => categoryOf(value) === category.id).sort((a, b) => counts.get(b)! - counts.get(a)!)
  })).filter((group) => group.tags.length);

  const shown = tag ? entries.filter((entry) => entry.tags.includes(tag)) : entries.filter((entry) => entry.date >= recentFrom);
  const rest = tag ? entries.filter((entry) => !entry.tags.includes(tag)) : [];
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
      {byCategory.length ? (
        <div className="journal-tag-filter" aria-label="Filter by tag">
          {byCategory.map((group) => (
            <div key={group.id}>
              <span>{categoryLabel(group.id)}</span>
              <div className="muscle-row">
                {group.tags.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={tag === value ? "muscle-toggle small on" : "muscle-toggle small"}
                    aria-pressed={tag === value}
                    onClick={() => setTag(tag === value ? null : value)}
                  >
                    {value} {counts.get(value)}
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
                `${name} ${withTag.toFixed(1)} with “${tag}”${without != null ? ` vs ${without.toFixed(1)} otherwise` : ""}`
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
                          <span key={value}>{value}</span>
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
        <p className="footnote">{tag ? `No entries tagged “${tag}”.` : "No entries yet. Tell the chat how your day went."}</p>
      )}
    </section>
  );
}
