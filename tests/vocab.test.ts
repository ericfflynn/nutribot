// Open vocabularies (lib/vocab.ts): any word, folded onto ones in use.
import assert from "node:assert/strict";
import { test } from "node:test";
import { foldAll, foldOnto } from "../lib/vocab";

test("a new word folds onto one in use when it's the same words", () => {
  assert.equal(foldOnto("Ear ringing", ["ringing ears"]), "ringing ears");
  assert.equal(foldOnto("sore throats", ["sore throat"]), "sore throat");
  assert.equal(foldOnto("  #Headache! ", ["headache"]), "headache");
});

test("anything else stays as written, cleaned", () => {
  assert.equal(foldOnto("Jaw clicking", ["clicking"]), "jaw clicking");
  assert.equal(foldOnto("girlfriend", ["partner"]), "girlfriend");
  assert.equal(foldOnto("glass", ["glas"]), "glass");
});

test("a list is folded and deduplicated, against itself too", () => {
  assert.deepEqual(foldAll(["Ringing ears", "ear ringing", "Fever"], ["fever"]), ["ringing ears", "fever"]);
});
