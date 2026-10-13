// Duplicate workout detection (lib/health/dedupe-rules.ts). Synthetic records
// shaped like the duplicates Fitbit actually produces.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findDuplicates,
  isDuplicatePair,
  isPossibleDuplicate,
  resolveCanonical,
  type WorkoutRecord
} from "../lib/health/dedupe-rules";

const T0 = Date.parse("2026-10-01T12:00:00Z");
const MIN = 60_000;

function record(id: string, type: string, startMin: number, lengthMin: number, extra: Partial<WorkoutRecord> = {}): WorkoutRecord {
  return {
    id,
    type,
    startedAt: T0 + startMin * MIN,
    endedAt: T0 + (startMin + lengthMin) * MIN,
    activeMinutes: lengthMin,
    calories: lengthMin * 8,
    avgHr: lengthMin ? 110 : null,
    distanceMiles: null,
    steps: null,
    ...extra
  };
}

test("a run recorded twice folds into the longer recording", () => {
  const long = record("run-a", "RUNNING", 0, 18);
  const short = record("run-b", "RUNNING", 0, 7);
  assert.deepEqual([...findDuplicates([short, long])], [["run-b", "run-a"]]);
});

test("a zero-minute stub inside a workout is a duplicate", () => {
  const lift = record("lift", "WEIGHTLIFTING", 0, 28);
  const stub = record("stub", "WEIGHTLIFTING", 15, 0, { activeMinutes: 0, calories: null });
  assert.ok(isDuplicatePair(lift, stub));
  assert.equal(findDuplicates([lift, stub]).get("stub"), "lift");
});

test("a zero-minute stub outside any workout stays on its own", () => {
  const lift = record("lift", "WEIGHTLIFTING", 0, 28);
  const stub = record("stub", "WEIGHTLIFTING", 90, 0, { activeMinutes: 0 });
  assert.equal(findDuplicates([lift, stub]).size, 0);
});

test("a chain of overlapping walks becomes one workout with one canonical", () => {
  const long = record("walk-long", "WALKING", 0, 96);
  const nested = record("walk-nested", "WALKING", 60, 35);
  const stub = record("walk-stub", "WALKING", 57, 0, { activeMinutes: 0 });
  const result = findDuplicates([nested, stub, long]);
  assert.equal(result.get("walk-nested"), "walk-long");
  assert.equal(result.get("walk-stub"), "walk-long");
  assert.equal(result.size, 2);
});

test("different activities never merge automatically, but are suggested", () => {
  const walk = record("walk", "WALKING", 0, 39);
  const lift = record("lift", "WEIGHTLIFTING", 37, 28);
  assert.equal(findDuplicates([walk, lift]).size, 0);
  assert.ok(isPossibleDuplicate(walk, lift));
});

test("same activity with a small overlap stays separate", () => {
  const first = record("run-1", "RUNNING", 0, 30);
  const second = record("run-2", "RUNNING", 25, 30);
  assert.equal(findDuplicates([first, second]).size, 0);
  assert.ok(isPossibleDuplicate(first, second));
});

test("related types count as one activity (treadmill and running)", () => {
  const run = record("run", "RUNNING", 0, 30);
  const treadmill = record("tread", "TREADMILL", 2, 26);
  assert.equal(findDuplicates([run, treadmill]).get("tread"), "run");
});

test("records the owner decided on are left out of auto-detection", () => {
  const long = record("run-a", "RUNNING", 0, 18);
  const short = record("run-b", "RUNNING", 0, 7);
  const separated = [
    { recordId: "run-a", canonicalId: "run-a" },
    { recordId: "run-b", canonicalId: "run-b" }
  ];
  assert.equal(findDuplicates([long, short], separated).size, 0);
});

test("the result is the same on every run, whatever the input order", () => {
  const records = [
    record("a", "WALKING", 0, 40),
    record("b", "WALKING", 5, 40),
    record("c", "WALKING", 10, 40, { calories: 999 })
  ];
  const first = [...findDuplicates(records)].sort();
  const second = [...findDuplicates([...records].reverse())].sort();
  assert.deepEqual(first, second);
});

test("ties on active time go to the record with more metrics", () => {
  const bare = record("bare", "RUNNING", 0, 20, { avgHr: null, calories: null });
  const rich = record("rich", "RUNNING", 0, 20, { distanceMiles: 2, steps: 3000 });
  assert.equal(findDuplicates([bare, rich]).get("bare"), "rich");
});

test("resolveCanonical follows chains and survives cycles", () => {
  assert.equal(resolveCanonical("a", new Map([["a", "b"], ["b", "c"]])), "c");
  assert.equal(resolveCanonical("a", new Map([["a", "b"], ["b", "a"]])), "a");
  assert.equal(resolveCanonical("x", new Map([["x", "x"]])), "x");
});
