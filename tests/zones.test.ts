import assert from "node:assert/strict";
import { test } from "node:test";
import { zonePace } from "@/lib/health/zones";

test("zone pace: Monday morning starts on pace", () => {
  assert.deepEqual(zonePace(0, 150, 0), { status: "on_pace", behind: 0 });
});

test("zone pace: behind by the share of finished days", () => {
  // Thursday with Mon-Wed over: 3/7 of 150 is 64.
  assert.deepEqual(zonePace(40, 150, 3), { status: "behind", behind: 24 });
  assert.deepEqual(zonePace(70, 150, 3), { status: "on_pace", behind: 0 });
});

test("zone pace: the goal reached is done", () => {
  assert.deepEqual(zonePace(25, 25, 2), { status: "done", behind: 0 });
});
