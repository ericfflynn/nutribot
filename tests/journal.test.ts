// Journal tags and rating labels (lib/journal-tags.ts, lib/journal.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeTag, normalizeTags, parseTag, tagLabel } from "../lib/journal-tags";
import { ratingLabel, recordedRatings } from "../lib/journal";

test("a tag is a key, an optional value and an optional feeling", () => {
  assert.deepEqual(parseTag("work:deadline-"), { key: "work", value: "deadline", feeling: "bad" });
  assert.deepEqual(parseTag("with:tom+"), { key: "with", value: "tom", feeling: "good" });
  assert.deepEqual(parseTag("work-"), { key: "work", value: null, feeling: "bad" });
  assert.equal(parseTag("sore legs"), null);
  assert.equal(parseTag("health:doctor"), null);
});

test("values are cleaned, synonyms and plurals folded, and a bare key needs a feeling", () => {
  assert.equal(normalizeTag({ key: "with", value: "Girlfriend", feeling: null }), "with:partner");
  assert.equal(normalizeTag({ key: "work", value: "Deadlines", feeling: "bad" }), "work:deadline-");
  assert.equal(normalizeTag({ key: "did", value: "golf rounds", feeling: null }, ["did:golf round"]), "did:golf round");
  assert.equal(normalizeTag({ key: "work", value: null, feeling: null }), null);
  assert.equal(normalizeTag("work"), null);
});

test("one tag per key and value; old free tags are dropped", () => {
  assert.deepEqual(normalizeTags(["work:deadline", "work:deadline-", "sore legs", "with:friend"]), ["work:deadline-", "with:friends"]);
});

test("labels read as words", () => {
  assert.equal(tagLabel("with:partner"), "With partner");
  assert.equal(tagLabel("work:deadline-"), "Work: deadline");
  assert.equal(tagLabel("stressor:money"), "Stress from money");
  assert.equal(tagLabel("work-"), "Work");
});

test("ratings carry labels and unrecorded ones are left out", () => {
  assert.equal(ratingLabel("mood", 4), "Good");
  assert.equal(ratingLabel("stress", 1), "None / relaxed");
  const shown = recordedRatings({ mood: 2, energy: null, stress: null, soreness: null });
  assert.deepEqual(shown, [{ name: "mood", value: 2, label: "A little down" }]);
});
