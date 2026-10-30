// Sick days the owner logs through chat (illness_days) and the chat tools.
// Same draft-then-Save contract as the other tools. Severities and episodes are
// in lib/illness-days.ts; the watch-based signal is lib/health/illness.ts.
// Plan: docs/illness.md.
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { Pool } from "pg";
import { z } from "zod";
import { addDays } from "./dates";
import { illnessSignal } from "./health/illness";
import { listHealthDays } from "./health/queries";
import {
  EASE_DAYS,
  SEVERITY_GUIDE,
  SEVERITY_LABELS,
  SYMPTOMS,
  episodesOf,
  sickOn,
  type IllnessDay,
  type IllnessDraft,
  type IllnessInput
} from "./illness-days";

export * from "./illness-days";

type Queryable = Pick<Pool, "query">;

export async function listIllnessDays(db: Queryable, userName: string, startDate: string, endDate: string): Promise<IllnessDay[]> {
  const { rows } = await db.query<IllnessDay>(
    `
    select id::text, entry_date::text as "date", severity::int as "severity", symptoms, note
    from public.illness_days
    where user_name = $1 and entry_date between $2::date and $3::date
    order by entry_date
    `,
    [userName, startDate, endDate]
  );
  return rows;
}

export async function saveIllnessDays(db: Queryable, userName: string, draft: Pick<IllnessDraft, "start_date" | "end_date"> & IllnessInput) {
  const { rows } = await db.query<{ id: string }>(
    `
    insert into public.illness_days (user_name, entry_date, severity, symptoms, note)
    select $1, day::date, $4, $5::text[], $6
    from generate_series($2::date, $3::date, interval '1 day') as day
    on conflict (user_name, entry_date) do update
      set severity = excluded.severity, symptoms = excluded.symptoms, note = excluded.note, updated_at = now()
    returning id::text
    `,
    [userName, draft.start_date, draft.end_date, draft.severity, draft.symptoms, draft.note]
  );
  return rows.map((row) => row.id).join(",");
}

export const ILLNESS_TOOLS = ["draft_illness", "list_illness"];

export const ILLNESS_PROMPT = `## Illness
- When they say they're sick, getting sick, still sick or feeling better, call draft_illness. One card can cover several days at the same severity ("sick since Tuesday" is start_date Tuesday, end_date today). Saving replaces whatever those days had.
- severity: ${SEVERITY_GUIDE.join("; ")}. Judge it from what they say; ask once only if you truly can't tell mild from sick.
- symptoms: only ones they mention, from: ${SYMPTOMS.join(", ")}. Anything else goes in note, in their words. Don't ask for a symptom list.
- "Feeling better" or "over it" is severity 0 for today; it ends the illness. "A bit better" is a lower severity, not 0.
- When the watch flags possible illness and they say they feel fine, draft severity 0 for today: it records a false alarm (used to tune the signal) and hides the warning.
- Call list_illness first when they talk about being sick, so you know whether an illness is already going (and since when) and what the watch shows. If the watch flags possible illness and they haven't logged anything, you may mention it once, plainly ("your resting heart rate is up 5 and you ran warm last night").
- In a check-in while they're sick, ask how they feel today and draft today's day. Keep it to one short question.
- While sick, the Training tab suggests rest (sick or very sick) or light work only (mild), then eases back for ${EASE_DAYS} days. Don't push workouts. Never give medical advice beyond common sense; for something severe or lasting, suggest seeing a doctor once.`;

type DraftSlot = { id: string } | { error: string };

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }] };
}

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Local date, YYYY-MM-DD.");
const MAX_RANGE_DAYS = 31;

export function illnessTools(context: {
  db: Pool;
  userName: string;
  today: string;
  resolveDraftId: (replaces: string | undefined) => DraftSlot;
  checkDate: (date: string) => { date: string } | { error: string };
  putDraft: (draft: IllnessDraft) => void;
}) {
  const { db, userName, today, resolveDraftId, checkDate, putDraft } = context;

  const draftIllness = tool(
    "draft_illness",
    "Create or revise a draft that logs how sick the owner is on one day or a run of days. Saved on Save.",
    {
      start_date: localDate,
      end_date: localDate.describe("Same as start_date for one day."),
      severity: z.number().int().min(0).max(3),
      symptoms: z.array(z.enum(SYMPTOMS)).max(SYMPTOMS.length),
      note: z.string().max(500).nullable().describe("Anything else in their words; null if nothing."),
      replaces: z.string().optional().describe("Id of an open draft this revises.")
    },
    async (args) => {
      const target = resolveDraftId(args.replaces);
      if ("error" in target) return { ...text(target.error), isError: true };
      for (const date of [args.start_date, args.end_date]) {
        const checked = checkDate(date);
        if ("error" in checked) return { ...text(checked.error), isError: true };
      }
      if (args.end_date < args.start_date) return { ...text("end_date is before start_date."), isError: true };
      if (addDays(args.start_date, MAX_RANGE_DAYS) < args.end_date) return { ...text(`At most ${MAX_RANGE_DAYS} days per card.`), isError: true };
      putDraft({
        type: "illness",
        id: target.id,
        start_date: args.start_date,
        end_date: args.end_date,
        severity: args.severity,
        symptoms: [...new Set(args.symptoms)],
        note: args.note?.trim() || null,
        saved_id: null
      });
      return text({ draft_id: target.id });
    }
  );

  const listIllness = tool(
    "list_illness",
    "Read logged sick days and illness episodes in a date range (up to 366 days), plus today's watch illness signal and whether they count as sick today.",
    { start_date: localDate, end_date: localDate },
    async (args) => {
      const days = await listIllnessDays(db, userName, args.start_date, args.end_date);
      const recent = await listIllnessDays(db, userName, addDays(today, -40), today);
      const health = await listHealthDays(userName, addDays(today, -32), today);
      const signal = illnessSignal(health, today, new Set(recent.filter((day) => day.severity > 0).map((day) => day.date)));
      const status = sickOn(recent, today);
      return text({
        today,
        sick_today: status
          ? { severity: SEVERITY_LABELS[status.severity], since: status.since, day: status.dayNumber, logged_today: status.loggedToday }
          : null,
        watch_signal_today: signal.level === "none" ? "nothing unusual" : { level: signal.level, reasons: signal.reasons },
        episodes: episodesOf(days).map((episode) => ({
          start: episode.start,
          last_sick_day: episode.last,
          ended_with_better: episode.ended,
          peak: SEVERITY_LABELS[episode.peak]
        })),
        days: days.map((day) => ({ date: day.date, severity: SEVERITY_LABELS[day.severity], symptoms: day.symptoms, note: day.note }))
      });
    },
    { annotations: { readOnlyHint: true } }
  );

  return [draftIllness, listIllness];
}
