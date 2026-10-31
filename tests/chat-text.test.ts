import assert from "node:assert/strict";
import { test } from "node:test";
import { parseChatText } from "@/lib/chat-text";

test("paragraphs split on blank lines, single newlines stay in the paragraph", () => {
  assert.deepEqual(parseChatText("One.\nStill one.\n\nTwo."), [
    { kind: "p", lines: ["One.", "Still one."] },
    { kind: "p", lines: ["Two."] }
  ]);
});

test("bullet and numbered lists group their lines", () => {
  assert.deepEqual(parseChatText("Your watch:\n\n- **Resting HR:** 71\n- HRV 64 ms\n\n1. First\n2) Second\nAfter."), [
    { kind: "p", lines: ["Your watch:"] },
    { kind: "ul", items: ["**Resting HR:** 71", "HRV 64 ms"] },
    { kind: "ol", items: ["First", "Second"] },
    { kind: "p", lines: ["After."] }
  ]);
});

test("heading marks are dropped, numbers in text are not lists", () => {
  assert.deepEqual(parseChatText("## Today\n3.5 hours of sleep"), [{ kind: "p", lines: ["Today", "3.5 hours of sleep"] }]);
});
