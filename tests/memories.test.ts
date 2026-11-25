import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkMemory,
  coreMemories,
  describeMemories,
  goalProgress,
  isLive,
  memoriesFor,
  staleOn,
  type Memory
} from "@/lib/memories-core";
import { callMemories } from "@/lib/body-state/call";

// Synthetic memories only.
const memory = (id: string, content: string, extra: Partial<Memory> = {}): Memory => ({
  id,
  kind: "fact",
  content,
  status: "active",
  told: false,
  followUpOn: null,
  areas: ["lifestyle.relationships"],
  target: null,
  createdAt: "2026-11-01",
  updatedAt: "2026-11-01",
  resolvedAt: null,
  ...extra
});

const pref = memory("p", "No pull day right after a heavy chest day", { kind: "preference", areas: ["physical.training"] });
const food = memory("f", "Doesn't like oatmeal", { kind: "preference", areas: ["physical.fuel"] });
const tone = memory("t", "Wants it short, no lectures", { kind: "preference", areas: ["chat"] });
const goal = memory("g", "Get to 180 lb", { kind: "goal", areas: ["physical.fuel", "physical.training"], target: { metric: "weight_lb", target: 180 } });
const rough = memory("s", "Tension at home since Nov 20", {
  kind: "situation",
  areas: ["lifestyle.relationships", "mental.mood"],
  followUpOn: "2026-11-30",
  createdAt: "2026-11-20",
  updatedAt: "2026-11-20"
});
const brother = memory("b", "Sam is their younger brother");

test("memories: a situation fades a week after its review day unless updated", () => {
  assert.equal(staleOn(rough), "2026-12-08");
  assert.ok(isLive(rough, "2026-12-07"));
  assert.ok(!isLive(rough, "2026-12-08"));
  // Updated after its review day: a week from the update.
  assert.ok(isLive({ ...rough, updatedAt: "2026-12-05" }, "2026-12-10"));
  // Only situations fade.
  assert.equal(staleOn(pref), null);
  assert.ok(isLive(pref, "2027-06-01"));
});

test("memories: live on a past day means saved by then and not yet over", () => {
  assert.ok(!isLive(rough, "2026-11-19"));
  const over = { ...rough, status: "resolved" as const, resolvedAt: "2026-11-25" };
  assert.ok(isLive(over, "2026-11-24"));
  assert.ok(!isLive(over, "2026-11-25"));
});

test("memories: the core is goals, live situations, chat preferences and few facts", () => {
  const all = [pref, food, tone, goal, rough, brother];
  assert.deepEqual(coreMemories(all, "2026-11-24").map((item) => item.id), ["t", "g", "s", "b"]);
  // Many facts: search finds them instead.
  const facts = Array.from({ length: 21 }, (_, index) => memory(`x${index}`, `Fact ${index}`));
  assert.deepEqual(coreMemories([goal, ...facts], "2026-11-24").map((item) => item.id), ["g"]);
});

test("memories: an area gets its own, of the kinds asked", () => {
  const all = [pref, food, tone, goal, rough];
  assert.deepEqual(memoriesFor(all, ["physical.training"], "2026-11-24", ["preference", "pattern"]).map((item) => item.id), ["p"]);
  assert.deepEqual(memoriesFor(all, ["physical.fuel"], "2026-11-24").map((item) => item.id), ["f", "g"]);
});

test("memories: the chat's block holds the core, counts the rest and lists follow-ups due", () => {
  const block = describeMemories([pref, food, goal, rough], "2026-11-30", {
    weighIns: [
      { day: "2026-10-25", pounds: 195 },
      { day: "2026-11-28", pounds: 191.2 }
    ]
  });
  assert.match(block, /\[g\] \(goal; physical\.fuel, physical\.training; since 2026-11-01\) Get to 180 lb \[target 180 lb: 191\.2 lb on 2026-11-28, down 3\.8 since 2026-10-25, 11\.2 lb above the target\]/);
  assert.match(block, /\[s\] \(situation; .*review 2026-11-30\)/);
  assert.doesNotMatch(block.split("<follow_ups_due>")[0], /\[p\]/);
  assert.match(block, /2 more, by area/);
  assert.match(block.split("<follow_ups_due>")[1], /\[s\]/);
  assert.equal(describeMemories([], "2026-11-24"), "");
});

test("memories: goal progress needs a weight target and a weigh-in", () => {
  assert.equal(goalProgress(goal, []), null);
  assert.equal(goalProgress(pref, [{ day: "2026-11-28", pounds: 190 }]), null);
  assert.equal(goalProgress(goal, [{ day: "2026-11-28", pounds: 180 }]), "180 lb on 2026-11-28, at the target");
});

test("memories: code checks areas, a situation's review day and where a target goes", () => {
  assert.equal(checkMemory({ kind: "fact", areas: [], followUpOn: null, target: null }), "Give at least one area.");
  assert.match(checkMemory({ kind: "situation", areas: ["mental.mood"], followUpOn: null, target: null })!, /review day/);
  assert.match(checkMemory({ kind: "fact", areas: ["chat"], followUpOn: null, target: { metric: "weight_lb", target: 180 } })!, /Only a goal/);
  assert.equal(checkMemory({ kind: "goal", areas: ["physical.fuel"], followUpOn: null, target: { metric: "weight_lb", target: 180 } }), null);
});

test("memories: the call reads training preferences, goals and situations, not food or facts", () => {
  const block = callMemories([pref, food, tone, goal, rough, brother], "2026-11-24");
  for (const id of ["p", "g", "s"]) assert.match(block, new RegExp(`\\[${id}\\]`));
  for (const id of ["f", "t", "b"]) assert.doesNotMatch(block, new RegExp(`\\[${id}\\]`));
  assert.equal(callMemories([food], "2026-11-24"), "");
});
