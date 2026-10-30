"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { discardDraftAction, newChatAction, saveDraftAction } from "./actions";
import type { Draft, IgnoreDraft, MealDraft, WorkoutDraft } from "@/lib/brain";
import type { HabitDraft, HabitsDraft, JournalDraft } from "@/lib/brain-checkin";
import type { FeedbackDraft } from "@/lib/feedback";
import { SEVERITY_LABELS, type IllnessDraft } from "@/lib/illness-days";
import { describeGoal, formatHabitAmount, scaleGuideLines } from "@/lib/habits";
import { recordedRatings } from "@/lib/journal";
import type { ChatMessage } from "@/lib/chat";
import { WORKOUT_TYPE_LABELS, describeMuscles, type FitbitWorkout } from "@/lib/workouts";

const timeFormat = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });

function clock(localDateTime: string) {
  return timeFormat.format(new Date(`${localDateTime}:00Z`));
}

function describeWatch(w: FitbitWorkout) {
  const parts = [`${w.name} ${clock(w.startedAt)}–${clock(w.endedAt)}`];
  if (w.activeMinutes != null) parts.push(`${w.activeMinutes} min`);
  if (w.avgHr != null) parts.push(`avg HR ${w.avgHr}`);
  return parts.join(" · ");
}

function dayLabel(date: string, today: string) {
  if (date === today) return null;
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`)
  );
}

// "08:30" as "8:30 AM".
function clockLabel(time: string) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(
    new Date(`1970-01-01T${time}:00Z`)
  );
}

type DraftHandlers = {
  today: string;
  superseded: boolean;
  onSave: (fitbitWorkoutId?: string | null) => Promise<void>;
  onDiscard: () => Promise<void>;
};

function DraftActions({
  draft,
  superseded,
  busy,
  onSave,
  onDiscard
}: {
  draft: Draft;
  superseded: boolean;
  busy: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  // Drafts that change something saved instead of adding to it.
  const isEdit =
    ((draft.type === "meal" || draft.type === "journal") && Boolean(draft.edits)) ||
    (draft.type === "habits" && Boolean(draft.replaces_logs?.length));
  if (draft.saved_id) return <p className="draft-status saved">{isEdit ? "Updated" : "Saved"}</p>;
  if (draft.discarded) return <p className="draft-status">Discarded</p>;
  if (superseded) return <p className="draft-status">Revised below</p>;
  return (
    <div className="draft-actions">
      <button type="button" className="draft-discard" onClick={onDiscard} disabled={busy}>
        Discard
      </button>
      <button type="button" className="draft-save" onClick={onSave} disabled={busy}>
        {busy ? "Saving…" : isEdit ? "Update" : "Save"}
      </button>
    </div>
  );
}

function MealCard({ draft, today, superseded, onSave, onDiscard }: { draft: MealDraft } & DraftHandlers) {
  const [busy, setBusy] = useState(false);
  const { estimate } = draft;
  const day = dayLabel(draft.date, today);
  const run = (action: () => Promise<void>) => async () => {
    setBusy(true);
    await action();
    setBusy(false);
  };
  return (
    <div className="draft-card">
      <div className="draft-head">
        <span className="draft-kind">
          {draft.edits ? "Edit · " : ""}
          {draft.meal_type}
          {day ? ` · ${day}` : ""}
          {draft.eaten_at ? ` · ${clockLabel(draft.eaten_at)}` : ""}
        </span>
        <strong>{estimate.calories} cal</strong>
      </div>
      {draft.edits ? (
        <p className="draft-edit-note">
          Replaces your saved {draft.edits.meal_type ?? "meal"}
          {draft.edits.date !== draft.date ? ` on ${dayLabel(draft.edits.date, "") ?? draft.edits.date}` : ""} ·{" "}
          {draft.edits.calories} cal
        </p>
      ) : null}
      <div className="draft-macros">
        <span className="macro-protein">{estimate.protein_g}g protein</span>
        <span className="macro-carbs">{estimate.carbs_g}g carbs</span>
        <span className="macro-fat">{estimate.fat_g}g fat</span>
      </div>
      <ul className="draft-items">
        {estimate.items.map((item, index) => (
          <li key={index}>
            <span>
              {item.name}
              {item.assumption ? <small>{item.assumption}</small> : null}
            </span>
            <span>{item.calories} cal</span>
          </li>
        ))}
      </ul>
      {estimate.accuracy_suggestion ? <p className="draft-question">{estimate.accuracy_suggestion}</p> : null}
      <DraftActions
        draft={draft}
        superseded={superseded}
        busy={busy}
        onSave={run(() => onSave())}
        onDiscard={run(onDiscard)}
      />
    </div>
  );
}

function WorkoutCard({ draft, today, superseded, onSave, onDiscard }: { draft: WorkoutDraft } & DraftHandlers) {
  const [busy, setBusy] = useState(false);
  // "" means not linked yet; otherwise a Fitbit workout id.
  const [choice, setChoice] = useState(draft.match.match?.id ?? "");
  const [changing, setChanging] = useState(false);
  const day = dayLabel(draft.date, today);
  const candidates = [draft.match.match, ...draft.match.alternatives].filter((w): w is FitbitWorkout => Boolean(w));
  const chosen = candidates.find((w) => w.id === choice) ?? null;
  const open = !draft.saved_id && !draft.discarded && !superseded;

  const run = (action: () => Promise<void>) => async () => {
    setBusy(true);
    await action();
    setBusy(false);
  };
  const overridden = choice !== (draft.match.match?.id ?? "");

  return (
    <div className="draft-card">
      <div className="draft-head">
        <span className="draft-kind">
          {(WORKOUT_TYPE_LABELS[draft.workout_type] ?? "workout").toLowerCase()}
          {day ? ` · ${day}` : ""}
        </span>
        <strong>{draft.rpe != null ? `RPE ${draft.rpe}` : "RPE ?"}</strong>
      </div>
      <p className="draft-title">{draft.name}</p>
      <div className="draft-chips">
        {describeMuscles(draft.muscle_groups, draft.muscle_intensity).map((group) => (
          <span key={group}>{group}</span>
        ))}
      </div>
      <div className="draft-watch">
        {draft.untracked ? (
          <span>Not on the watch{draft.duration_min ? ` · ${draft.duration_min} min` : ""}</span>
        ) : chosen ? (
          <span>
            {draft.match.status === "ambiguous" && !overridden ? "Best guess: " : "Matched: "}
            {describeWatch(chosen)}
          </span>
        ) : (
          <span>No watch workout yet. It'll link when the watch syncs.</span>
        )}
        {open && !draft.untracked && candidates.length > 0 ? (
          <button type="button" className="text-button" onClick={() => setChanging((value) => !value)}>
            {changing ? "Done" : "Change"}
          </button>
        ) : null}
      </div>
      {changing && open ? (
        <ul className="draft-picker">
          {candidates.map((w) => (
            <li key={w.id}>
              <label>
                <input type="radio" name={`watch-${draft.id}`} checked={choice === w.id} onChange={() => setChoice(w.id)} />
                {describeWatch(w)}
              </label>
            </li>
          ))}
          <li>
            <label>
              <input type="radio" name={`watch-${draft.id}`} checked={choice === ""} onChange={() => setChoice("")} />
              None of these: link it later
            </label>
          </li>
        </ul>
      ) : null}
      {draft.questions.length ? <p className="draft-question">{draft.questions.join(" ")}</p> : null}
      <DraftActions
        draft={draft}
        superseded={superseded}
        busy={busy}
        onSave={run(() => onSave(overridden ? choice || null : undefined))}
        onDiscard={run(onDiscard)}
      />
    </div>
  );
}

// The frame shared by journal and habit cards: a heading, then Save/Discard.
function CheckinCard({
  draft,
  kind,
  aside,
  superseded,
  onSave,
  onDiscard,
  children
}: {
  draft: Draft;
  kind: string;
  aside?: ReactNode;
  children: ReactNode;
} & Omit<DraftHandlers, "today">) {
  const [busy, setBusy] = useState(false);
  const run = (action: () => Promise<void>) => async () => {
    setBusy(true);
    await action();
    setBusy(false);
  };
  return (
    <div className="draft-card">
      <div className="draft-head">
        <span className="draft-kind">{kind}</span>
        {aside ? <strong>{aside}</strong> : null}
      </div>
      {children}
      <DraftActions draft={draft} superseded={superseded} busy={busy} onSave={run(() => onSave())} onDiscard={run(onDiscard)} />
    </div>
  );
}

function timeRange(start: string | null, end: string | null) {
  if (!start && !end) return "";
  const at = (time: string | null) => (time ? clock(`2000-01-01T${time}`) : "?");
  return start && end ? `${at(start)}–${at(end)}` : end ? `until ${at(end)}` : `from ${at(start)}`;
}

function JournalCard({ draft, today, ...handlers }: { draft: JournalDraft } & DraftHandlers) {
  const day = dayLabel(draft.date, today);
  const ratings = recordedRatings(draft.ratings);
  return (
    <CheckinCard draft={draft} kind={`${draft.edits ? "Edit · " : ""}${draft.kind} journal${day ? ` · ${day}` : ""}`} {...handlers}>
      {draft.edits ? (
        <p className="draft-edit-note">
          Replaces your saved {draft.edits.kind} entry
          {draft.edits.date !== draft.date ? ` from ${dayLabel(draft.edits.date, "") ?? draft.edits.date}` : ""}
        </p>
      ) : null}
      {ratings.length ? (
        <div className="draft-ratings">
          {ratings.map((rating) => (
            <span key={rating.name}>
              {rating.name} <strong>{rating.value}</strong> {rating.label}
            </span>
          ))}
        </div>
      ) : null}
      <p className="draft-body">{draft.body}</p>
      {draft.tags.length ? (
        <div className="draft-chips">
          {draft.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      ) : null}
    </CheckinCard>
  );
}

function HabitsCard({ draft, today, ...handlers }: { draft: HabitsDraft } & DraftHandlers) {
  const day = dayLabel(draft.date, today);
  return (
    <CheckinCard draft={draft} kind={`${draft.replaces_logs?.length ? "Edit · " : ""}habits${day ? ` · ${day}` : ""}`} {...handlers}>
      {draft.replaces_logs?.length ? (
        <p className="draft-edit-note">Replaces your saved {draft.replaces_logs.map((log) => log.label).join(", ")}</p>
      ) : null}
      <ul className="draft-items">
        {draft.logs.map((log, index) => (
          <li key={`${log.habitId}-${index}`}>
            <span>
              {log.name}
              {log.details || log.startedAt || log.endedAt ? (
                <small>{[log.details, timeRange(log.startedAt, log.endedAt)].filter(Boolean).join(" · ")}</small>
              ) : null}
            </span>
            <span>{formatHabitAmount(log, log.amount)}</span>
          </li>
        ))}
      </ul>
    </CheckinCard>
  );
}

function HabitCard({ draft, ...handlers }: { draft: HabitDraft } & DraftHandlers) {
  const { habit } = draft;
  const measure = habit.measure === "intensity" ? "Intensity 1–3" : habit.measure === "count" ? `Count of ${habit.unit}` : "Minutes";
  const details = [measure, habit.direction === "limit" ? "less is better" : "more is better"];
  const goal = describeGoal(habit);
  if (goal) details.push(`goal: ${goal.toLowerCase()}`);
  if (!habit.active) details.push("archived");
  return (
    <CheckinCard draft={draft} kind={draft.habit_id ? "change habit" : "new habit"} {...handlers}>
      <p className="draft-title">{habit.name}</p>
      <p className="draft-edit-note">{details.join(" · ")}</p>
      {habit.scaleGuide ? (
        <ul className="draft-items">
          {scaleGuideLines(habit.scaleGuide).map((line) => (
            <li key={line}>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </CheckinCard>
  );
}

function IgnoreCard({ draft, ...handlers }: { draft: IgnoreDraft } & DraftHandlers) {
  return (
    <CheckinCard draft={draft} kind={draft.ignored ? "ignore watch workout" : "restore watch workout"} {...handlers}>
      <p className="draft-title">{draft.label}</p>
      <p className="draft-edit-note">{draft.date}</p>
    </CheckinCard>
  );
}

function FeedbackCard({ draft, ...handlers }: { draft: FeedbackDraft } & DraftHandlers) {
  return (
    <CheckinCard
      draft={draft}
      kind={`${draft.feedback_id ? (draft.status && draft.status !== "open" ? `mark ${draft.status}` : "change") : "app"} ${draft.kind} · ${draft.area}`}
      {...handlers}
    >
      <p className="draft-title">{draft.title}</p>
      <p className="draft-body">{draft.details}</p>
    </CheckinCard>
  );
}

function IllnessCard({ draft, ...handlers }: { draft: IllnessDraft } & DraftHandlers) {
  const range = draft.start_date === draft.end_date ? draft.start_date : `${draft.start_date} to ${draft.end_date}`;
  return (
    <CheckinCard draft={draft} kind={draft.severity === 0 ? "feeling better" : "sick day"} {...handlers}>
      <p className="draft-title">{SEVERITY_LABELS[draft.severity]}</p>
      <p className="draft-edit-note">{range}</p>
      {draft.symptoms.length ? <p className="draft-body">{draft.symptoms.join(", ")}</p> : null}
      {draft.note ? <p className="draft-body">{draft.note}</p> : null}
    </CheckinCard>
  );
}

// Opens the chat sheet from anywhere, optionally with text ready to send.
const OPEN_EVENT = "nutribot:open-chat";
// With send, the text goes straight to the chat (a check-in's quick reply).
export function openChat(text = "", options: { send?: boolean } = {}) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { text, send: options.send ?? false } }));
}

// A button that opens the chat with text ready to send.
export function ChatPromptButton({ prompt, children }: { prompt: string; children: ReactNode }) {
  return (
    <button type="button" className="pill-button" onClick={() => openChat(prompt)}>
      {children}
    </button>
  );
}

// The conversation: thread, draft cards and composer. Used by the floating
// sheet and the Chat tab; both show the same current conversation.
export function ChatThread({
  date,
  today,
  toolbar,
  prefill
}: {
  date: string;
  today: string;
  // Extra controls for the header row, e.g. the sheet's close button.
  toolbar?: ReactNode;
  // Text to put in the composer; a new object replaces what's there. With
  // send, it's sent as soon as the thread has loaded.
  prefill?: { text: string; send?: boolean };
}) {
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch("/api/brain")
      .then((response) => response.json())
      .then((data) => {
        if (Array.isArray(data.messages)) setMessages(data.messages);
        else setError(data.error || "Couldn't load the chat.");
        setLoaded(true);
      })
      .catch(() => setError("Couldn't load the chat."));
  }, []);

  const sentPrefill = useRef<object | null>(null);
  useEffect(() => {
    if (!prefill) return;
    if (prefill.send) {
      if (loaded && sentPrefill.current !== prefill) {
        sentPrefill.current = prefill;
        void send(prefill.text);
      }
      return;
    }
    setInput(prefill.text);
    inputRef.current?.focus();
    // send is recreated each render; prefill and loaded decide when to run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill, loaded]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages, sending]);

  async function send(text?: string) {
    const message = (text ?? input).trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    setInput("");
    const pending: ChatMessage = { id: `pending-${Date.now()}`, role: "user", content: message, drafts: [], createdAt: "" };
    setMessages((current) => [...current, pending]);
    try {
      const response = await fetch("/api/brain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, date })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The assistant couldn't answer.");
      setMessages((current) => [
        ...current,
        { id: data.message_id, role: "assistant", content: data.reply, drafts: data.drafts, createdAt: "" }
      ]);
    } catch (caught) {
      setMessages((current) => current.filter((item) => item.id !== pending.id));
      setInput(message);
      setError(caught instanceof Error ? caught.message : "The assistant couldn't answer.");
    } finally {
      setSending(false);
    }
  }

  async function startNewChat() {
    if (sending) return;
    const result = await newChatAction();
    if (!result.ok) {
      setError("Couldn't start a new chat.");
      return;
    }
    setMessages([]);
    setError(null);
  }

  function replaceDraft(messageId: string, draft: Draft) {
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId
          ? { ...message, drafts: message.drafts.map((item) => (item.id === draft.id ? draft : item)) }
          : message
      )
    );
  }

  // A draft revised in a later reply shows its latest version only there.
  const lastMessageFor = new Map<string, string>();
  for (const message of messages) for (const draft of message.drafts) lastMessageFor.set(draft.id, message.id);

  return (
    <div className="chat-thread-wrap">
      <header className="chat-header">
        <button type="button" className="text-button" onClick={startNewChat} disabled={sending || !messages.length}>
          New chat
        </button>
        {toolbar}
      </header>
      <div className="chat-thread" ref={threadRef}>
        {loaded && !messages.length ? (
          <p className="chat-empty">
            Tell me what you ate or trained ("eggs and toast", "chest and tris, hard"), or how your day went. Ask anything else too.
          </p>
        ) : null}
        {messages.map((message) => (
          <div key={message.id} className={`chat-message ${message.role}`}>
            {message.content ? <p className="chat-bubble">{message.content}</p> : null}
            {message.drafts.map((draft) => {
              const handlers: DraftHandlers = {
                today,
                superseded: lastMessageFor.get(draft.id) !== message.id,
                onSave: async (fitbitWorkoutId) => {
                  const result = await saveDraftAction(message.id, draft.id, fitbitWorkoutId);
                  if (result.ok) {
                    replaceDraft(message.id, result.draft);
                    router.refresh();
                  } else setError(result.error);
                },
                onDiscard: async () => {
                  const result = await discardDraftAction(message.id, draft.id);
                  if (result.ok) replaceDraft(message.id, result.draft);
                  else setError(result.error);
                }
              };
              switch (draft.type) {
                case "meal":
                  return <MealCard key={draft.id} draft={draft} {...handlers} />;
                case "workout":
                  return <WorkoutCard key={draft.id} draft={draft} {...handlers} />;
                case "journal":
                  return <JournalCard key={draft.id} draft={draft} {...handlers} />;
                case "habits":
                  return <HabitsCard key={draft.id} draft={draft} {...handlers} />;
                case "habit":
                  return <HabitCard key={draft.id} draft={draft} {...handlers} />;
                case "feedback":
                  return <FeedbackCard key={draft.id} draft={draft} {...handlers} />;
                case "ignore":
                  return <IgnoreCard key={draft.id} draft={draft} {...handlers} />;
                case "illness":
                  return <IllnessCard key={draft.id} draft={draft} {...handlers} />;
              }
            })}
          </div>
        ))}
        {sending ? <p className="chat-typing">Thinking…</p> : null}
      </div>
      {error ? <p className="chat-error">{error}</p> : null}
      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <textarea
          ref={inputRef}
          value={input}
          placeholder="What did you eat or train?"
          rows={1}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
        />
        <button type="submit" disabled={sending || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

// The floating Chat button and the full-screen sheet it opens.
export function ChatSheet({ date, today }: { date: string; today: string }) {
  const [open, setOpen] = useState(false);
  const [prefill, setPrefill] = useState<{ text: string; send?: boolean } | undefined>();

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string; send?: boolean }>).detail;
      const text = detail?.text ?? "";
      setOpen(true);
      if (text) setPrefill({ text, send: detail?.send });
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);

    // iOS Safari ignores overflow: hidden on body, so pin the page in place
    // while the sheet is open and restore the scroll position afterwards.
    const scrollY = window.scrollY;
    const { body } = document;
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";

    // Size the sheet to the visible area so the keyboard doesn't cover the composer.
    const viewport = window.visualViewport;
    const fit = () => {
      if (!viewport) return;
      document.documentElement.style.setProperty("--chat-height", `${viewport.height}px`);
      document.documentElement.style.setProperty("--chat-top", `${viewport.offsetTop}px`);
    };
    fit();
    viewport?.addEventListener("resize", fit);
    viewport?.addEventListener("scroll", fit);

    return () => {
      document.removeEventListener("keydown", onKey);
      viewport?.removeEventListener("resize", fit);
      viewport?.removeEventListener("scroll", fit);
      body.style.position = "";
      body.style.top = "";
      body.style.left = "";
      body.style.right = "";
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  return (
    <>
      {open ? null : (
        <button type="button" className="fab" onClick={() => setOpen(true)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 5h16v11H9l-5 4z" />
          </svg>
          Chat
        </button>
      )}
      {open ? (
        <div className="chat-backdrop" onClick={() => setOpen(false)}>
          <section
            className="chat-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Chat"
            onClick={(event) => event.stopPropagation()}
          >
            <ChatThread
              date={date}
              today={today}
              prefill={prefill}
              toolbar={
                <button type="button" className="chat-close" aria-label="Close" onClick={() => setOpen(false)}>
                  ✕
                </button>
              }
            />
          </section>
        </div>
      ) : null}
    </>
  );
}
