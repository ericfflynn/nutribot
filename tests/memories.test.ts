import assert from "node:assert/strict";
import { test } from "node:test";
import { describeMemories, type Memory } from "@/lib/memories";

const memory = (id: string, content: string, extra: Partial<Memory> = {}): Memory => ({
  id,
  kind: "ongoing",
  content,
  status: "active",
  told: false,
  followUpOn: null,
  createdAt: "2026-11-01",
  updatedAt: "2026-11-01",
  ...extra
});

test("memories: every active one, and follow-ups due listed apart", () => {
  const block = describeMemories(
    [
      memory("a", "Launch at work through Nov 20", { followUpOn: "2026-11-06" }),
      memory("b", "Goal: lower resting HR", { kind: "goal" }),
      memory("c", "Interview on Nov 12", { followUpOn: "2026-11-12" })
    ],
    "2026-11-06"
  );
  assert.match(block, /<memories>[\s\S]*\[b\] \(goal, since 2026-11-01\) Goal: lower resting HR/);
  const due = block.split("<follow_ups_due>")[1];
  assert.match(due, /\[a\]/);
  assert.doesNotMatch(due, /\[c\]/);
  assert.equal(describeMemories([], "2026-11-06"), "");
});
