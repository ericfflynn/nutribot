// Ailments in the database (ailments, ailment_days) and the chat tools.
// Reports ride on journal cards (draft_journal's `ailments`); draft_ailment
// changes an ailment itself or logs past days. Nothing is saved until the
// owner taps Save. Rules are in lib/ailments-core.ts; spec: docs/ailments.md.
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { Pool } from "pg";
import { z } from "zod";
import {
  AILMENT_KINDS,
  AILMENT_SYMPTOMS,
  BODY_PART_NAMES,
  SEVERITY_GUIDES,
  ailmentLine,
  illnessDates,
  musclesFor,
  openAilmentsOn,
  partOf,
  severityLabel,
  type Ailment,
  type AilmentDay,
  type AilmentKind,
  type CauseRef
} from "./ailments-core";
import { addDays } from "./dates";
import { illnessSignal } from "./health/illness";
import { listHealthDays } from "./health/queries";
import { listIllnessDays } from "./illness";
import { TRACKED_MUSCLES, type TrackedMuscle } from "./workouts";

export * from "./ailments-core";

type Queryable = Pick<Pool, "query">;

// ---------- Reading ----------

// Ailments that overlap start..end: started by the end, not over before the start.
export async function listAilments(db: Queryable, userName: string, startDate: string, endDate: string): Promise<Ailment[]> {
  const { rows } = await db.query(
    `
    select a.id::text, a.kind, a.name, a.body_parts as "bodyParts", a.muscles, a.started_on::text as "startedOn",
      a.ended_on::text as "endedOn", a.cause, a.cause_refs as "causeRefs", a.note,
      coalesce(
        (select json_agg(json_build_object(
            'id', d.id::text, 'date', d.entry_date::text, 'severity', d.severity, 'symptoms', d.symptoms,
            'note', d.note, 'journalEntryId', d.journal_entry_id::text
          ) order by d.entry_date)
         from public.ailment_days d where d.ailment_id = a.id),
        '[]'::json
      ) as days
    from public.ailments a
    where a.user_name = $1 and a.started_on <= $3::date and (a.ended_on is null or a.ended_on >= $2::date)
    order by a.started_on
    `,
    [userName, startDate, endDate]
  );
  return rows.map((row) => ({ ...row, causeRefs: row.causeRefs ?? [], days: row.days as AilmentDay[] }));
}

export async function getAilment(db: Queryable, userName: string, id: string): Promise<Ailment | null> {
  if (!z.string().uuid().safeParse(id).success) return null;
  return (await listAilments(db, userName, "0001-01-01", "9999-12-31")).find((item) => item.id === id) ?? null;
}

// ---------- Writing ----------

export type NewAilment = {
  kind: AilmentKind;
  name: string;
  body_parts: string[];
  muscles: TrackedMuscle[];
  started_on: string;
  cause: string | null;
  cause_refs: CauseRef[];
};

// One day of an ailment, as a journal card carries it.
export type AilmentReport = {
  ailment_id: string | null; // null: `new` is created on save
  new: NewAilment | null;
  kind: AilmentKind;
  name: string;
  day: number; // its day number on the entry's date, for the card
  severity: number;
  symptoms: string[];
  note: string | null;
};

// A change to an ailment itself, or a new one with past days ("I had a cold
// last week"). Saving sets the fields and each listed day.
export type AilmentDraft = {
  type: "ailment";
  id: string;
  ailment_id: string | null;
  ailment: NewAilment & { ended_on: string | null; note: string | null };
  days: { date: string; severity: number; symptoms: string[]; note: string | null }[];
  saved_id: string | null;
  discarded?: boolean;
};

async function insertAilment(db: Queryable, userName: string, item: NewAilment & { ended_on?: string | null; note?: string | null }) {
  const { rows } = await db.query<{ id: string }>(
    `
    insert into public.ailments (user_name, kind, name, body_parts, muscles, started_on, ended_on, cause, cause_refs, note)
    values ($1, $2, $3, $4::text[], $5::text[], $6::date, $7::date, $8, $9::jsonb, $10)
    returning id::text
    `,
    [userName, item.kind, item.name, item.body_parts, item.muscles, item.started_on, item.ended_on ?? null, item.cause, JSON.stringify(item.cause_refs), item.note ?? null]
  );
  return rows[0].id;
}

// Sets one day (a second report the same day replaces it). A 0 ends the
// ailment that day; a report after its end opens it again (it came back).
async function setAilmentDay(
  db: Queryable,
  userName: string,
  ailmentId: string,
  date: string,
  day: { severity: number; symptoms: string[]; note: string | null },
  journalEntryId: string | null
) {
  await db.query(
    `
    insert into public.ailment_days (ailment_id, user_name, entry_date, severity, symptoms, note, journal_entry_id)
    values ($1::uuid, $2, $3::date, $4, $5::text[], $6, $7::uuid)
    on conflict (ailment_id, entry_date) do update
      set severity = excluded.severity, symptoms = excluded.symptoms, note = excluded.note,
          journal_entry_id = coalesce(excluded.journal_entry_id, public.ailment_days.journal_entry_id), updated_at = now()
    `,
    [ailmentId, userName, date, day.severity, day.symptoms, day.note, journalEntryId]
  );
  await db.query(
    `
    update public.ailments
    set ended_on = case
          when $4::int = 0 then least(coalesce(ended_on, $3::date), $3::date)
          when ended_on is not null and ended_on <= $3::date then null
          else ended_on
        end,
        started_on = least(started_on, $3::date),
        updated_at = now()
    where id = $1::uuid and user_name = $2
    `,
    [ailmentId, userName, date, day.severity]
  );
}

// A journal card's ailment lines: creates the new ones, then sets the day.
export async function saveAilmentReports(db: Queryable, userName: string, date: string, journalEntryId: string | null, reports: readonly AilmentReport[]) {
  for (const report of reports) {
    let id = report.ailment_id;
    if (!id) {
      if (!report.new) throw new Error("An ailment line has neither an id nor a new ailment.");
      id = await insertAilment(db, userName, report.new);
    } else {
      const { rowCount } = await db.query(`select 1 from public.ailments where id = $1::uuid and user_name = $2`, [id, userName]);
      if (!rowCount) throw new Error(`${report.name} no longer exists.`);
    }
    await setAilmentDay(db, userName, id, date, report, journalEntryId);
  }
}

export async function saveAilmentDraft(db: Queryable, userName: string, draft: AilmentDraft) {
  const item = draft.ailment;
  let id = draft.ailment_id;
  if (id) {
    const { rowCount } = await db.query(
      `
      update public.ailments
      set kind = $3, name = $4, body_parts = $5::text[], muscles = $6::text[], started_on = $7::date, ended_on = $8::date,
          cause = $9, cause_refs = $10::jsonb, note = $11, updated_at = now()
      where id = $1::uuid and user_name = $2
      `,
      [id, userName, item.kind, item.name, item.body_parts, item.muscles, item.started_on, item.ended_on, item.cause, JSON.stringify(item.cause_refs), item.note]
    );
    if (!rowCount) throw new Error(`${item.name} no longer exists.`);
  } else {
    id = await insertAilment(db, userName, item);
  }
  // After the fields, so a 0 day ends it and a new report reopens it.
  for (const day of draft.days) await setAilmentDay(db, userName, id, day.date, day, null);
  return id;
}

// "Fine today" on a day the watch flagged: a false alarm the illness signal is
// tuned against. Kept in illness_days as severity 0 (docs/illness.md).
export async function saveFeelingFine(db: Queryable, userName: string, date: string) {
  await db.query(
    `
    insert into public.illness_days (user_name, entry_date, severity, symptoms, note) values ($1, $2::date, 0, '{}', null)
    on conflict (user_name, entry_date) do update set severity = 0, updated_at = now()
    `,
    [userName, date]
  );
}

// ---------- Chat ----------

export const AILMENT_TOOLS = ["list_ailments", "draft_ailment"];

export const AILMENT_PROMPT = `## Ailments: illness, injury, pain
- An ailment is something that lasts and ends: a cold, a sore shoulder, a canker sore. Kinds: illness, injury (something happened: a tweak, a fall), pain (it hurts, cause unclear). Several can be open at once, and each stays open until they say it's gone; nothing expires on its own.
- Severity 0-3. Illness: ${SEVERITY_GUIDES.illness.join("; ")}. Injury or pain: ${SEVERITY_GUIDES.pain.join("; ")}. Judge it from their words; ask once only if you truly can't tell.
- Where a report goes: an answer to a check-in ("Morning check-in: ...", "Evening check-in: ...", or their reply to the check-in question) is a journal entry, so its ailments are lines on that journal card (draft_journal's ailments). Anything else about pain, an injury or feeling sick ("my shoulder hurts", "shoulder's better") is an ailment card: draft_ailment with today's day, for a new ailment or an open one (ailment_id). Don't make a journal entry for it, and don't offer one; one message makes one card.
- Call list_ailments first whenever they mention how their body feels (pain, sick, better), so you know what's open. Same or new: an open cold plus a sore throat is the same cold; a shoulder that ended weeks ago is new; the same body part still open is the same. Ask "same as the shoulder from last week, or something new?" only when you truly can't tell.
- A new one needs kind, a short plain name ("Right shoulder", "Head cold", "Canker sore"), body_parts (from: ${BODY_PART_NAMES.join(", ")}, or a muscle such as "rear delts"; pain at or near a joint is the joint even when they name a muscle by it ("the back of my rear delt" is the shoulder), a muscle only for a clear strain in its belly; with left or right when they say: "right shoulder"; empty for most illnesses) and cause: their words or guess, or null. Link the workouts it likely came from (cause_workout_ids: the session ids list_workouts shows) when they point at them.
- What injuries do to training: each body part affects the muscles whose work loads it (a shoulder: chest, delts, triceps, lats, upper back and traps). Below bad, the day's call weighs it (severity, how many days, whether it's easing) rather than following a fixed rule; a bad (3) one rests its whole region (a bad shoulder rests the whole upper body) and nothing hard. If they say a movement is fine ("curls don't bother it"), change its muscles with draft_ailment.
- "It's gone", "over the cold" is severity 0 for today: it ends the ailment. "A bit better" is a lower severity, not 0.
- Each morning, ask about every open ailment they haven't mentioned today ("How's the shoulder?"), in the same one short question as the check-in. Their answer is a line on the journal card.
- When the watch flags possible illness and they say they feel fine, set fine_today on the journal card: it records a false alarm and hides the warning. If the watch flags it and nothing is logged, you may mention it once, plainly.
- draft_ailment also changes an ailment itself (name, body parts, the muscles it affects, the cause, start or end date; leave out what isn't changing) or logs one from the past with its days ("I had a cold Oct 27 to Nov 1").
- If a new or worse ailment conflicts with today's call, revise the call (submit_call) and say so in a sentence. Never give medical advice beyond common sense; for something severe or lasting (pain past two weeks, numbness), suggest seeing a doctor once.`;

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Local date, YYYY-MM-DD.");
const symptom = z.enum(AILMENT_SYMPTOMS);
const muscle = z.enum(TRACKED_MUSCLES as unknown as [TrackedMuscle, ...TrackedMuscle[]]);

export const newAilmentShape = z.object({
  kind: z.enum(AILMENT_KINDS),
  name: z.string().min(2).max(40).describe('Short and plain: "Right shoulder", "Head cold".'),
  body_parts: z.array(z.string()).max(4).describe('From the body part list or a muscle, with a side when they say: "right shoulder". Empty for most illnesses.'),
  started_on: localDate.optional().describe("When it started, if before the entry's date."),
  cause: z.string().max(200).nullable().describe("Their words or guess; null when unknown."),
  cause_workout_ids: z.array(z.string()).max(4).optional().describe("Logged workouts it likely came from: the session ids list_workouts shows.")
});

export const reportShape = z.object({
  ailment_id: z.string().optional().describe("An open or recent ailment from list_ailments; leave out for a new one."),
  new: newAilmentShape.optional().describe("Only for a new ailment."),
  severity: z.number().int().min(0).max(3),
  symptoms: z.array(symptom).max(8).describe("Only ones they mention."),
  note: z.string().max(200).nullable().describe("A few of their words the symptoms don't cover; null if nothing.")
});

// Body parts as stored ("right shoulder"), or an error naming the bad one.
function checkParts(parts: readonly string[]): { parts: string[] } | { error: string } {
  const clean: string[] = [];
  for (const raw of parts) {
    const value = raw.trim().toLowerCase();
    if (!partOf(value)) return { error: `"${raw}" isn't a body part. Use one of ${BODY_PART_NAMES.join(", ")}, or a muscle.` };
    if (!clean.includes(value)) clean.push(value);
  }
  return { parts: clean };
}

async function causeRefsOf(db: Queryable, userName: string, ids: readonly string[] = []): Promise<CauseRef[] | { error: string }> {
  const valid = ids.filter((id) => z.string().uuid().safeParse(id).success);
  if (valid.length < ids.length) return { error: "cause_workout_ids must be session ids from list_workouts (\"session id ...\"), not watch workout ids." };
  if (!valid.length) return [];
  const { rows } = await db.query<{ id: string; name: string; date: string }>(
    `select id::text, name, entry_date::text as date from public.workout_sessions where user_name = $1 and id = any($2::uuid[]) order by entry_date`,
    [userName, valid]
  );
  if (rows.length < valid.length) return { error: "Some cause_workout_ids aren't saved workouts. Call list_workouts." };
  return rows.map((row) => ({ type: "workout" as const, id: row.id, label: `${row.name} (${row.date})` }));
}

async function toNew(
  db: Queryable,
  userName: string,
  input: z.infer<typeof newAilmentShape>,
  date: string
): Promise<NewAilment | { error: string }> {
  const parts = checkParts(input.body_parts);
  if ("error" in parts) return parts;
  if (input.kind !== "illness" && !parts.parts.length) return { error: "An injury or pain needs its body part." };
  const refs = await causeRefsOf(db, userName, input.cause_workout_ids);
  if ("error" in refs) return refs;
  return {
    kind: input.kind,
    name: input.name.trim(),
    body_parts: parts.parts,
    muscles: musclesFor(parts.parts),
    started_on: input.started_on && input.started_on < date ? input.started_on : date,
    cause: input.cause?.trim() || null,
    cause_refs: refs
  };
}

// draft_journal's ailment lines, checked and ready for the card.
export async function resolveReports(
  db: Queryable,
  userName: string,
  date: string,
  inputs: readonly z.infer<typeof reportShape>[]
): Promise<{ reports: AilmentReport[] } | { error: string }> {
  const known = await listAilments(db, userName, addDays(date, -120), date);
  const reports: AilmentReport[] = [];
  for (const input of inputs) {
    const symptoms = [...new Set(input.symptoms)];
    if (input.ailment_id) {
      const ailment = known.find((item) => item.id === input.ailment_id);
      if (!ailment) return { error: `No ailment with id ${input.ailment_id}. Call list_ailments.` };
      if (reports.some((report) => report.ailment_id === ailment.id)) return { error: `${ailment.name} is listed twice.` };
      reports.push({
        ailment_id: ailment.id,
        new: null,
        kind: ailment.kind,
        name: ailment.name,
        day: Math.max(1, Math.round((Date.parse(date) - Date.parse(ailment.startedOn)) / 86_400_000) + 1),
        severity: input.severity,
        symptoms,
        note: input.note?.trim() || null
      });
      continue;
    }
    if (!input.new) return { error: "Each ailment line needs ailment_id (from list_ailments) or new." };
    if (input.severity === 0) return { error: "A new ailment can't start at 0." };
    const fresh = await toNew(db, userName, input.new, date);
    if ("error" in fresh) return fresh;
    const open = openAilmentsOn(known, date).find(
      (item) => item.phase === "active" && item.name.toLowerCase() === fresh.name.toLowerCase()
    );
    if (open) return { error: `${open.name} is already open (id ${open.id}); report on it instead of starting a new one.` };
    reports.push({
      ailment_id: null,
      new: fresh,
      kind: fresh.kind,
      name: fresh.name,
      day: Math.round((Date.parse(date) - Date.parse(fresh.started_on)) / 86_400_000) + 1,
      severity: input.severity,
      symptoms,
      note: input.note?.trim() || null
    });
  }
  return { reports };
}

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }] };
}

type DraftSlot = { id: string } | { error: string };

function describeAilment(ailment: Ailment) {
  return {
    id: ailment.id,
    kind: ailment.kind,
    name: ailment.name,
    body_parts: ailment.bodyParts,
    affects_muscles: ailment.muscles,
    started_on: ailment.startedOn,
    ended_on: ailment.endedOn,
    cause: ailment.cause,
    cause_workouts: ailment.causeRefs.map((ref) => ref.label),
    days: ailment.days.map((day) => ({
      date: day.date,
      severity: `${day.severity} ${severityLabel(ailment.kind, day.severity)}`,
      symptoms: day.symptoms,
      note: day.note
    }))
  };
}

export function ailmentTools(context: {
  db: Pool;
  userName: string;
  today: string;
  resolveDraftId: (replaces: string | undefined) => DraftSlot;
  checkDate: (date: string) => { date: string } | { error: string };
  putDraft: (draft: AilmentDraft) => void;
}) {
  const { db, userName, today, resolveDraftId, checkDate, putDraft } = context;

  const listTool = tool(
    "list_ailments",
    "Read ailments (illness, injury, pain): those open today with the muscles they affect, and those over in the range (default the last 60 days), each with its days. Also today's watch illness signal.",
    { start_date: localDate.optional(), end_date: localDate.optional() },
    async (args) => {
      const end = args.end_date ?? today;
      const start = args.start_date ?? addDays(end, -60);
      const [ailments, health, fine] = await Promise.all([
        listAilments(db, userName, start < addDays(today, -60) ? start : addDays(today, -60), end > today ? end : today),
        listHealthDays(userName, addDays(today, -32), today),
        listIllnessDays(db, userName, today, today)
      ]);
      const open = openAilmentsOn(ailments, today);
      const signal = illnessSignal(health, today, illnessDates(ailments, today));
      return text({
        today,
        open_today: open.map((item) => ({ id: item.id, line: ailmentLine(item), phase: item.phase, reported_on: item.reportedOn, affects: item.affects })),
        watch_signal_today: fine.length ? "answered: feeling fine" : signal.level === "none" ? "nothing unusual" : { level: signal.level, reasons: signal.reasons },
        ailments: ailments.filter((item) => item.startedOn <= end && (!item.endedOn || item.endedOn >= start)).map(describeAilment)
      });
    },
    { annotations: { readOnlyHint: true } }
  );

  const draftTool = tool(
    "draft_ailment",
    "Create or revise an ailment card: a new ailment with today's day, a day for an open one (how it is today), a change to one (name, body parts, muscles it affects, cause, dates), or a past one with its days. Saved on Save. Check-in answers put their lines on the journal card instead.",
    {
      ailment_id: z.string().optional().describe("The ailment this reports on or changes (list_ailments); leave out for a new one."),
      kind: z.enum(AILMENT_KINDS).optional().describe("Required for a new one; leave out to keep it."),
      name: z.string().min(2).max(40).optional().describe("Required for a new one; leave out to keep it."),
      body_parts: z.array(z.string()).max(4).optional().describe("Leave out to keep them."),
      muscles: z.array(muscle).optional().describe("The muscles it affects; leave out to keep them (or use the body parts' own)."),
      started_on: localDate.optional().describe("A new one: when it started, default the first day listed. Leave out to keep it."),
      ended_on: localDate.nullable().optional().describe("When it was over; leave out to keep it. A 0 day ends it on its own."),
      cause: z.string().max(200).nullable().optional().describe("Their words or guess; leave out to keep it."),
      cause_workout_ids: z.array(z.string()).max(4).optional().describe("Logged workouts it likely came from: the session ids list_workouts shows. Leave out to keep them."),
      note: z.string().max(300).nullable().optional(),
      days: z
        .array(z.object({ date: localDate, severity: z.number().int().min(0).max(3), symptoms: z.array(symptom).max(8), note: z.string().max(200).nullable() }))
        .max(31)
        .describe("Days to set: today's report, or past days; empty to change only the fields."),
      replaces: z.string().optional().describe("Id of an open draft this revises.")
    },
    async (args) => {
      const target = resolveDraftId(args.replaces);
      if ("error" in target) return { ...text(target.error), isError: true };
      const existing = args.ailment_id ? await getAilment(db, userName, args.ailment_id) : null;
      if (args.ailment_id && !existing) return { ...text(`No ailment with id ${args.ailment_id}. Call list_ailments.`), isError: true };
      if (!existing && (!args.kind || !args.name)) return { ...text("A new ailment needs kind and name."), isError: true };
      if (!existing && !args.days.length) return { ...text("A new ailment needs at least one day."), isError: true };
      if (!existing && args.days.some((day) => day.severity === 0) && args.days.every((day) => day.severity === 0)) {
        return { ...text("A new ailment can't only have 0 days."), isError: true };
      }
      const days = [...args.days].sort((a, b) => a.date.localeCompare(b.date));
      const startedOn = args.started_on ?? existing?.startedOn ?? days[0].date;
      const endedOn = args.ended_on === undefined ? (existing?.endedOn ?? null) : args.ended_on;
      for (const date of [startedOn, ...(endedOn ? [endedOn] : []), ...days.map((day) => day.date)]) {
        const checked = checkDate(date);
        if ("error" in checked) return { ...text(checked.error), isError: true };
      }
      if (endedOn && endedOn < startedOn) return { ...text("ended_on is before started_on."), isError: true };
      const fresh = await toNew(
        db,
        userName,
        {
          kind: args.kind ?? existing!.kind,
          name: args.name ?? existing!.name,
          body_parts: args.body_parts ?? existing?.bodyParts ?? [],
          cause: args.cause === undefined ? (existing?.cause ?? null) : args.cause,
          cause_workout_ids: args.cause_workout_ids
        },
        startedOn
      );
      if ("error" in fresh) return { ...text(fresh.error), isError: true };
      const keepMuscles = existing && !args.muscles && !args.body_parts;
      putDraft({
        type: "ailment",
        id: target.id,
        ailment_id: existing?.id ?? null,
        ailment: {
          ...fresh,
          started_on: startedOn,
          muscles: args.muscles ? TRACKED_MUSCLES.filter((item) => args.muscles!.includes(item)) : keepMuscles ? existing.muscles : fresh.muscles,
          // Left out on a change: the linked workouts stay.
          cause_refs: existing && args.cause_workout_ids === undefined ? existing.causeRefs : fresh.cause_refs,
          ended_on: endedOn,
          note: args.note === undefined ? (existing?.note ?? null) : args.note?.trim() || null
        },
        days: days.map((day) => ({ ...day, symptoms: [...new Set(day.symptoms)], note: day.note?.trim() || null })),
        saved_id: null
      });
      return text({ draft_id: target.id });
    }
  );

  return [listTool, draftTool];
}
