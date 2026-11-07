import assert from "node:assert/strict";
import { test } from "node:test";
import { checkCall, guardrailsOf, rulesCall, type Guardrails } from "@/lib/body-state/call";
import type { BodyState } from "@/lib/body-state/types";
import type { WorkoutSession } from "@/lib/workouts";

const TODAY = "2026-11-12";

// Just the parts guardrailsOf reads.
function state(overrides: { phase?: string; severity?: number; readiness?: "normal" | "easy" | "rest"; out?: Record<string, string> } = {}) {
  return {
    meta: { date: TODAY },
    physical: {
      illness: { phase: overrides.phase ?? "well", headline: "Sick, day 2", told: overrides.severity != null ? { severity: overrides.severity } : null },
      sleep: { minutes: 450, status: "good" },
      recovery: { score: 70, headline: "70, green" },
      vitals: { status: "good", headline: "" },
      training: {
        readiness: { level: overrides.readiness ?? "normal", reasons: ["recovery red (20)"] },
        muscles: ["Lats", "Chest", "Quads", "Biceps"].map((muscle) => ({ muscle, out: overrides.out?.[muscle] ?? null })),
        suggested: { name: "Pull day", work: [{ muscle: "Lats", intensity: "hard" }], note: null }
      }
    }
  } as unknown as BodyState;
}

const capOf = (guardrails: Guardrails, muscle: string) => guardrails.muscles.find((item) => item.muscle === muscle)?.max;

test("guardrails: sick is rest, easy caps at medium, sore muscles are out", () => {
  const sick = guardrailsOf(state({ phase: "sick", severity: 2 }), { sessions: [] });
  assert.equal(sick.rest, true);
  assert.deepEqual(sick.allowedKinds, ["rest", "walk"]);
  const easy = guardrailsOf(state({ readiness: "easy", out: { Chest: "sore" } }), { sessions: [] });
  assert.equal(easy.maxIntensity, "medium");
  assert.equal(capOf(easy, "Lats"), "medium");
  assert.equal(capOf(easy, "Chest"), null);
  const rest = guardrailsOf(state({ readiness: "rest" }), { sessions: [] });
  assert.deepEqual(rest.allowedKinds, ["rest", "walk", "mobility"]);
});

test("guardrails: a muscle hit hard this week is medium at most", () => {
  const hard = { id: "a", date: "2026-11-10", name: "Pull", workoutType: "strength", muscleGroups: ["Lats"], muscleIntensity: {}, rpe: 8 } as unknown as WorkoutSession;
  const guardrails = guardrailsOf(state(), { sessions: [hard] });
  assert.equal(capOf(guardrails, "Lats"), "medium");
  assert.equal(capOf(guardrails, "Quads"), "hard");
});

test("checkCall: kind, out muscles and caps are enforced", () => {
  const guardrails = guardrailsOf(state({ readiness: "easy", out: { Chest: "sore" } }), { sessions: [] });
  const strength = (work: { muscle: string; intensity: string }[]) => ({ kind: "strength", work, accessory: [] }) as never;
  assert.equal(checkCall(strength([{ muscle: "Lats", intensity: "medium" }]), guardrails), null);
  assert.match(checkCall(strength([{ muscle: "Lats", intensity: "hard" }]), guardrails)!, /medium at most/);
  assert.match(checkCall(strength([{ muscle: "Chest", intensity: "light" }]), guardrails)!, /out today \(sore\)/);
  assert.match(checkCall(strength([]), guardrails)!, /needs muscles/);
  const rest = guardrailsOf(state({ phase: "sick", severity: 2 }), { sessions: [] });
  assert.match(checkCall({ kind: "strength", work: [{ muscle: "Lats", intensity: "light" }], accessory: [] } as never, rest)!, /isn't allowed/);
  assert.equal(checkCall({ kind: "walk", work: [], accessory: [] }, rest), null);
});

test("the rules' call comes from Training's suggestion", () => {
  const call = rulesCall(state(), `${TODAY}T07:00`);
  assert.equal(call.source, "rules");
  assert.equal(call.kind, "strength");
  assert.equal(call.dayType, "Pull day");
});
