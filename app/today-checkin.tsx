"use client";

import { useRef, useState, type PointerEvent } from "react";
import { openChat } from "./chat-sheet";
import type { Reply } from "@/lib/body-state/brief";
import { CHECKIN_DISMISSED_COOKIE, type CheckinKind } from "@/lib/checkin";

// Remember a swiped-away check-in for the page's next render. The cookie keeps
// the last few and expires after two days.
function rememberDismissed(date: string, kind: CheckinKind) {
  const current = document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${CHECKIN_DISMISSED_COOKIE}=`))
    ?.slice(CHECKIN_DISMISSED_COOKIE.length + 1);
  const values = (current ?? "").split("|").filter((value) => value && value !== `${date}:${kind}`);
  values.push(`${date}:${kind}`);
  document.cookie = `${CHECKIN_DISMISSED_COOKIE}=${values.slice(-4).join("|")}; path=/; max-age=172800; samesite=lax`;
}

// The check-in at the top of Today: the brief and quick replies, plus a box
// to say more in the morning. Each answer goes to the chat, which drafts the
// journal entry (and the sick day, when there is one) for the owner to save.
// The page shows it only until that check-in is answered; swiping it sideways
// puts it away for the day and the cards below move up.
export function TodayCheckin({
  date,
  kind,
  kicker,
  text,
  call,
  replies,
  allowMore
}: {
  date: string;
  kind: CheckinKind;
  kicker: string; // "Morning check-in"
  text: string;
  call: string | null;
  replies: Reply[];
  allowMore: boolean;
}) {
  const [more, setMore] = useState("");
  const [gone, setGone] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; dx: number; t: number; active: boolean } | null>(null);
  const dragged = useRef(false);
  const send = (message: string) => openChat(message, { send: true });

  const slide = (dx: number, animate: boolean) => {
    const card = wrap.current?.firstElementChild as HTMLElement | null;
    if (!card) return;
    card.style.transition = animate ? "transform 0.22s ease, opacity 0.22s ease" : "none";
    card.style.transform = dx ? `translateX(${dx}px)` : "";
    card.style.opacity = dx ? String(Math.max(0.3, 1 - Math.abs(dx) / card.offsetWidth)) : "";
  };

  const dismiss = (direction: number) => {
    rememberDismissed(date, kind);
    const box = wrap.current;
    if (!box || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setGone(true);
      return;
    }
    slide(direction * (box.offsetWidth + 40), true);
    // Then close the gap so the cards below move up.
    window.setTimeout(() => {
      box.style.height = `${box.offsetHeight}px`;
      void box.offsetHeight;
      box.style.transition = "height 0.25s ease, margin-bottom 0.25s ease";
      box.style.height = "0px";
      box.style.marginBottom = "calc(-1 * var(--checkin-gap, 24px))";
      window.setTimeout(() => setGone(true), 260);
    }, 220);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if ((event.target as HTMLElement).closest("input")) return;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, t: event.timeStamp, active: false };
    dragged.current = false;
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (!state.active) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        drag.current = null; // a scroll, not a swipe
        return;
      }
      if (Math.abs(dx) < 10) return;
      state.active = true;
      dragged.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    state.dx = dx;
    slide(dx, false);
  };

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    drag.current = null;
    if (!state?.active) return;
    const width = event.currentTarget.offsetWidth;
    const speed = Math.abs(state.dx) / Math.max(1, event.timeStamp - state.t);
    if (event.type === "pointerup" && (Math.abs(state.dx) > width * 0.35 || (speed > 0.6 && Math.abs(state.dx) > 40))) {
      dismiss(Math.sign(state.dx));
    } else {
      slide(0, true);
    }
  };

  if (gone) return null;

  return (
    <div
      ref={wrap}
      className="checkin-swipe"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onClickCapture={(event) => {
        // A swipe that started on a reply button isn't a tap.
        if (dragged.current) {
          event.preventDefault();
          event.stopPropagation();
          dragged.current = false;
        }
      }}
    >
      <section className="card checkin-prompt" aria-label={kicker}>
        <div className="checkin-prompt-head">
          <span>{kicker}</span>
          <button type="button" className="checkin-dismiss" aria-label={`Dismiss ${kicker.toLowerCase()}`} onClick={() => dismiss(1)}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
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
        {allowMore ? (
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
        ) : null}
      </section>
    </div>
  );
}
