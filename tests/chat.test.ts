// Which drafts the chat brain sees as open and as already saved (lib/chat.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Draft } from "../lib/brain";
import { openDraftsFrom, savedDraftsFrom, type ChatMessage } from "../lib/chat";

const journal = (id: string, savedId: string | null): Draft => ({
  type: "journal",
  id,
  date: "2026-10-17",
  kind: "evening",
  body: "Long day.",
  ratings: { mood: 3, energy: null, stress: null, soreness: null },
  tags: [],
  saved_id: savedId
});

const reply = (id: string, drafts: Draft[]): ChatMessage => ({ id, role: "assistant", content: "", drafts, createdAt: "" });

test("a saved draft leaves the open drafts and shows as saved, with its id", () => {
  const messages = [reply("1", [journal("a", null)]), reply("2", [journal("a", "entry-1"), journal("b", null)])];
  assert.deepEqual(
    openDraftsFrom(messages).map((draft) => draft.id),
    ["b"]
  );
  assert.deepEqual(
    savedDraftsFrom(messages).map((draft) => [draft.id, draft.saved_id]),
    [["a", "entry-1"]]
  );
});

test("only the newest version of a draft counts", () => {
  // Revised after the first version was shown; the revision isn't saved.
  const messages = [reply("1", [journal("a", "entry-1")]), reply("2", [journal("a", null)])];
  assert.equal(savedDraftsFrom(messages).length, 0);
  assert.equal(openDraftsFrom(messages).length, 1);
});
