// Which Fitbit workout records are the same physical workout. Pure functions,
// no database: lib/health/dedupe.ts loads the records and stores the result.
//
// Every exercise record comes from Google Health, but Fitbit can record one
// workout more than once: an auto-detected walk alongside a started one, a run
// that was paused and restarted, a 0-minute stub left by a misfired start.
// Duplicates are folded into one canonical record; metrics are never summed.

export type WorkoutRecord = {
  id: string;
  type: string;
  startedAt: number; // epoch ms
  endedAt: number;
  activeMinutes: number | null;
  calories: number | null;
  avgHr: number | null;
  distanceMiles: number | null;
  steps: number | null;
};

// A decision the owner made by hand, which auto-detection never overrides:
// "merge" folds record into canonical, "separate" keeps record on its own.
export type ManualDecision = { recordId: string; canonicalId: string };

// Exercise types that describe the same activity. Anything not listed is its
// own family.
const FAMILIES: string[][] = [
  ["WALKING", "HIKING"],
  ["RUNNING", "TREADMILL"],
  ["BIKING", "SPINNING"],
  ["WEIGHTLIFTING", "WEIGHTS"]
];

export function activityFamily(type: string) {
  return FAMILIES.find((family) => family.includes(type))?.[0] ?? type;
}

// Share of the shorter record that overlaps the longer one, 0-1.
export function overlapShare(a: WorkoutRecord, b: WorkoutRecord) {
  const overlap = Math.min(a.endedAt, b.endedAt) - Math.max(a.startedAt, b.startedAt);
  const shorter = Math.min(a.endedAt - a.startedAt, b.endedAt - b.startedAt);
  if (shorter <= 0) {
    // A zero-length stub: inside the other record (a minute of slack) or not.
    const stub = a.endedAt - a.startedAt <= 0 ? a : b;
    const other = stub === a ? b : a;
    return stub.startedAt >= other.startedAt - 60_000 && stub.startedAt <= other.endedAt + 60_000 ? 1 : 0;
  }
  return Math.max(0, overlap) / shorter;
}

// Two records are the same workout when they're the same kind of activity and
// at least half of the shorter one overlaps the longer.
export const DUPLICATE_OVERLAP = 0.5;

export function isDuplicatePair(a: WorkoutRecord, b: WorkoutRecord) {
  return activityFamily(a.type) === activityFamily(b.type) && overlapShare(a, b) >= DUPLICATE_OVERLAP;
}

// Records that overlap but don't qualify as duplicates (different activity,
// or a small overlap): shown to the owner as "merge?" suggestions.
export function isPossibleDuplicate(a: WorkoutRecord, b: WorkoutRecord) {
  return !isDuplicatePair(a, b) && overlapShare(a, b) > 0;
}

function filledMetrics(record: WorkoutRecord) {
  return [record.activeMinutes, record.calories, record.avgHr, record.distanceMiles, record.steps].filter(
    (value) => value != null && value > 0
  ).length;
}

// The most complete record wins: longest active time, then the most metrics,
// then the most calories, then the earliest id so the choice is stable.
export function compareCompleteness(a: WorkoutRecord, b: WorkoutRecord) {
  return (
    (b.activeMinutes ?? 0) - (a.activeMinutes ?? 0) ||
    filledMetrics(b) - filledMetrics(a) ||
    (b.calories ?? 0) - (a.calories ?? 0) ||
    a.id.localeCompare(b.id)
  );
}

// Maps each duplicate record id to its canonical record id. Canonical records
// and records with no duplicate are absent. Records the owner decided on are
// left out of auto-detection; their decisions are applied by the caller.
export function findDuplicates(records: WorkoutRecord[], manual: ManualDecision[] = []): Map<string, string> {
  const decided = new Set(manual.flatMap((decision) => [decision.recordId, decision.canonicalId]));
  const candidates = records.filter((record) => !decided.has(record.id)).sort((a, b) => a.startedAt - b.startedAt);

  // Union-find over duplicate pairs, so a chain of overlaps is one workout.
  const parent = new Map(candidates.map((record) => [record.id, record.id]));
  const find = (id: string): string => {
    const up = parent.get(id)!;
    if (up === id) return id;
    const root = find(up);
    parent.set(id, root);
    return root;
  };
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      if (candidates[j].startedAt > candidates[i].endedAt + 60_000) break;
      if (isDuplicatePair(candidates[i], candidates[j])) {
        parent.set(find(candidates[j].id), find(candidates[i].id));
      }
    }
  }

  const clusters = new Map<string, WorkoutRecord[]>();
  for (const record of candidates) {
    const root = find(record.id);
    clusters.set(root, [...(clusters.get(root) ?? []), record]);
  }
  const result = new Map<string, string>();
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    const [canonical, ...duplicates] = [...members].sort(compareCompleteness);
    for (const duplicate of duplicates) result.set(duplicate.id, canonical.id);
  }
  return result;
}

// Follows a canonical id through manual merges to the record that's shown,
// guarding against cycles.
export function resolveCanonical(id: string, mapping: Map<string, string>) {
  const seen = new Set<string>();
  let current = id;
  while (mapping.has(current) && mapping.get(current) !== current && !seen.has(current)) {
    seen.add(current);
    current = mapping.get(current)!;
  }
  return current;
}
