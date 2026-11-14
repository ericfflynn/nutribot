import assert from "node:assert/strict";
import { test } from "node:test";
import { onePerDay } from "@/lib/health/google";

// Synthetic weigh-ins: only the source and time matter here.
function weighIn(day: number, hours: number, source: Record<string, unknown>, grams = 80000) {
  return {
    dataSource: source,
    weight: { sampleTime: { civilTime: { date: { year: 2026, month: 11, day }, time: { hours, minutes: 0 } } }, weightGrams: grams }
  };
}

const scale = { platform: "HEALTH_KIT", application: { packageName: "com.yolanda.fitindex" } };
const mfp = { platform: "HEALTH_KIT", application: { packageName: "com.myfitnesspal.mfp" } };
const fitbit = { platform: "FITBIT", recordingMethod: "MANUAL" };

test("weight: one reading a day, the scale first, then Fitbit, then anything else", () => {
  const kept = onePerDay([weighIn(3, 7, mfp), weighIn(3, 9, scale), weighIn(3, 8, fitbit), weighIn(4, 8, mfp), weighIn(4, 7, fitbit)]);
  assert.equal(kept.length, 2);
  const byDay = new Map(kept.map((point) => [(point.weight as { sampleTime: { civilTime: { date: { day: number } } } }).sampleTime.civilTime.date.day, point]));
  assert.deepEqual(byDay.get(3)?.dataSource, scale);
  assert.deepEqual(byDay.get(4)?.dataSource, fitbit);
});

test("weight: the earliest reading of the day within a source", () => {
  const kept = onePerDay([weighIn(5, 19, scale, 81000), weighIn(5, 7, scale, 80000)]);
  assert.equal(kept.length, 1);
  assert.equal((kept[0].weight as { weightGrams: number }).weightGrams, 80000);
});
