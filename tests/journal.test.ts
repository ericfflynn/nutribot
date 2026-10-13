// Journal tags and rating labels (lib/journal-tags.ts, lib/journal.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { categoryOf, normalizeTag, normalizeTags } from "../lib/journal-tags";
import { ratingLabel, recordedRatings } from "../lib/journal";

test("tag variants collapse to one tag", () => {
  assert.equal(normalizeTag("Work"), "work");
  assert.equal(normalizeTag("  #work "), "work");
  assert.equal(normalizeTag("Poor_Sleep"), "poor sleep");
  assert.equal(normalizeTag("bad sleep"), "poor sleep");
  assert.equal(normalizeTag("headaches"), "headache");
  assert.equal(normalizeTag("friend"), "friends");
  assert.equal(normalizeTag("meetings"), "meeting");
});

test("custom tags fold onto the owner's own tags", () => {
  assert.equal(normalizeTag("Sore Legs", ["sore legs"]), "sore legs");
  assert.equal(normalizeTag("golf rounds", ["golf round"]), "golf round");
});

test("normalizeTags dedupes after normalizing", () => {
  assert.deepEqual(normalizeTags(["Work", "work", "#WORK", "gym", "lifting"]), ["work", "workout"]);
});

test("custom tags land in a sensible category", () => {
  assert.equal(categoryOf("sore legs"), "exercise");
  assert.equal(categoryOf("toothache"), "health");
  assert.equal(categoryOf("client call"), "work");
  assert.equal(categoryOf("new couch"), "other");
});

test("ratings carry labels and unrecorded ones are left out", () => {
  assert.equal(ratingLabel("mood", 4), "Good");
  assert.equal(ratingLabel("stress", 1), "None / relaxed");
  const shown = recordedRatings({ mood: 2, energy: null, stress: null, soreness: null });
  assert.deepEqual(shown, [{ name: "mood", value: 2, label: "A little down" }]);
});
