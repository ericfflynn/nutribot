"use client";

import { useState } from "react";
import { openChat } from "./chat-sheet";
import type { Reply } from "@/lib/body-state/brief";

// The check-in at the top of Today: the brief, quick replies and a box to say
// more. Each answer goes to the chat, which drafts the journal entry (and the
// sick day, when there is one) for the owner to save.
export function TodayCheckin({
  kicker,
  status,
  text,
  call,
  replies
}: {
  kicker: string; // "Morning check-in"
  status: string; // "Not answered", "Checked in 9:07 AM"
  text: string;
  call: string | null;
  replies: Reply[];
}) {
  const [more, setMore] = useState("");
  const send = (message: string) => openChat(message, { send: true });
  return (
    <section className="card checkin-prompt" aria-label={kicker}>
      <div className="checkin-prompt-head">
        <span>{kicker}</span>
        <span>{status}</span>
      </div>
      <p>
        {text}
        {call ? (
          <>
            {" "}
            <strong>My call: {call}.</strong>
          </>
        ) : null}
      </p>
      {replies.length ? (
        <div className="checkin-replies">
          {replies.map((reply) => (
            <button key={reply.label} type="button" onClick={() => send(reply.message)}>
              {reply.label}
            </button>
          ))}
        </div>
      ) : null}
      <form
        className="checkin-more"
        onSubmit={(event) => {
          event.preventDefault();
          if (!more.trim()) return;
          send(`${kicker}: ${more.trim()}`);
          setMore("");
        }}
      >
        <label className="visually-hidden" htmlFor="checkin-more">
          Tell it more
        </label>
        <input id="checkin-more" value={more} onChange={(event) => setMore(event.target.value)} placeholder="Or tell me more…" />
        <button type="submit" aria-label="Send" disabled={!more.trim()}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
          </svg>
        </button>
      </form>
    </section>
  );
}
