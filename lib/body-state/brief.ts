// What the Today screen says from the body state: the morning check-in's
// brief and the month's "What happened" list. Plain rules for now; Claude's
// daily call replaces the brief's wording later (docs/body-state.md, The call).
import { addDays, weekdayOf } from "../dates";
import type { BodyState } from "./types";

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const monthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const short = (date: string) => monthDay.format(new Date(`${date}T00:00:00Z`));

function hm(minutes: number) {
  return `${Math.floor(minutes / 60)} h ${Math.round(minutes % 60)} m`;
}

export type Reply = { label: string; message: string };

export type Brief = {
  text: string; // two or three sentences
  call: string; // "a rest day", "Pull day, medium"
  replies: Reply[];
};

// The day's call from Training's suggestion, with illness applied.
export function callOf(state: BodyState) {
  const { illness, training } = state.physical;
  if (illness.phase === "sick" && (illness.told?.severity ?? 2) >= 2) return "a rest day";
  if (illness.phase === "sick") return "light movement only";
  const pick = training.suggested;
  if (!pick.name) return "rest or active recovery";
  const levels = new Set(pick.work.map((item) => item.intensity));
  const level = levels.size === 1 ? `, ${[...levels][0]}` : "";
  return `${pick.name}${level}`;
}

export function morningBrief(state: BodyState): Brief {
  const { sleep, recovery, vitals, illness } = state.physical;
  const parts: string[] = [];
  if (sleep.minutes != null) parts.push(`You slept ${hm(sleep.minutes)}${sleep.status === "watch" || sleep.status === "low" ? ", short of your need" : ""}.`);
  if (illness.phase === "sick" && illness.told) {
    const since = WEEKDAY[weekdayOf(illness.told.since)];
    const watch = vitals.status === "low" || vitals.status === "watch" ? `your watch agrees: ${vitals.headline.split(" · ")[0].replace(/^./, (letter) => letter.toLowerCase())}` : "your watch looks closer to normal";
    parts.push(`You've been sick since ${since}, and ${watch}.`);
  } else if (illness.phase === "early_signs") {
    parts.push(`Your watch shows early signs of getting sick: ${illness.signal.reasons.join(", ").replace(/^./, (letter) => letter.toLowerCase())}.`);
  } else if (illness.phase === "recovering") {
    parts.push("You're over being sick, so ease back in.");
  } else if (recovery.score != null) {
    parts.push(`Recovery is ${recovery.headline}.`);
  }
  const call = callOf(state);
  const question =
    illness.phase === "sick" ? "How are you feeling today?" : illness.phase === "early_signs" ? "Feeling off at all?" : "How are you feeling?";
  const replies: Reply[] =
    illness.phase === "sick"
      ? [
          { label: "Still sick", message: "Morning check-in: still sick." },
          { label: "A bit better", message: "Morning check-in: a bit better." },
          { label: "I feel better", message: "Morning check-in: I feel better, I think I'm over it." }
        ]
      : illness.phase === "early_signs"
        ? [
            { label: "I feel fine", message: "Morning check-in: I feel fine." },
            { label: "Getting sick", message: "Morning check-in: I think I'm getting sick." },
            { label: "Not sure", message: "Morning check-in: not sure, a bit off maybe." }
          ]
        : [
            { label: "Feeling good", message: "Morning check-in: feeling good." },
            { label: "Okay", message: "Morning check-in: okay." },
            { label: "Off today", message: "Morning check-in: feeling off today." }
          ];
  return { text: parts.join(" "), call, replies: replies };
}

export type Happening = {
  kind: "sick" | "early_signs" | "red_recovery";
  start: string;
  end: string;
  ongoing: boolean;
  label: string; // "Oct 27 →", "Oct 1 – 6"
  title: string;
  text: string;
  ask: boolean; // unexplained early signs: ask whether he was sick
};

function rangeLabel(start: string, end: string, ongoing: boolean) {
  if (ongoing) return `${short(start)} →`;
  if (start === end) return short(start);
  return start.slice(0, 7) === end.slice(0, 7) ? `${short(start)} – ${Number(end.slice(8))}` : `${short(start)} – ${short(end)}`;
}

function spanOf(values: (number | null)[]) {
  const known = values.filter((value): value is number => value != null).map((value) => Math.round(value));
  if (!known.length) return null;
  const low = Math.min(...known);
  const high = Math.max(...known);
  return low === high ? `${low}` : `${low}–${high}`;
}

// A month's notable stretches, newest first: illness (with the early signs
// before it), early signs nothing came of, red recovery days.
export function whatHappened(days: readonly { date: string; state: BodyState }[], latest: string): Happening[] {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const items: Happening[] = [];
  let index = 0;
  while (index < sorted.length) {
    const { state } = sorted[index];
    const phase = state.physical.illness.phase;
    if (phase === "early_signs" || phase === "sick") {
      // A stretch allows a one-day gap: Oct 1, 3, 4, 5, 6 is one stretch.
      const flagged = (at: number) => ["early_signs", "sick"].includes(sorted[at]?.state.physical.illness.phase ?? "");
      const run = [sorted[index]];
      let next = index + 1;
      while (next < sorted.length) {
        if (flagged(next) && sorted[next].date <= addDays(run[run.length - 1].date, 2)) {
          run.push(sorted[next]);
          next += 1;
        } else if (!flagged(next) && flagged(next + 1) && sorted[next + 1].date <= addDays(run[run.length - 1].date, 2)) {
          next += 1;
        } else break;
      }
      const start = run[0].date;
      const end = run[run.length - 1].date;
      const ongoing = end >= addDays(latest, -1);
      const rhr = run.map((day) => day.state.physical.vitals.restingHr.value);
      const usual = run.map((day) => day.state.physical.vitals.restingHr.usual);
      const firstSick = run.find((day) => day.state.physical.illness.phase === "sick");
      if (firstSick) {
        const told = firstSick.state.physical.illness.told;
        const early = run[0].state.physical.illness.phase === "early_signs";
        const rise = rhr[0] != null && rhr[rhr.length - 1] != null ? ` Resting HR ${rhr[0]} → ${rhr[rhr.length - 1]}.` : "";
        items.push({
          kind: "sick",
          start,
          end,
          ongoing,
          label: rangeLabel(start, end, ongoing),
          title: "Sick",
          text: `${early ? `Early signs ${short(start)}, a day before you said so. ` : ""}Sick since ${short(told?.since ?? firstSick.date)}${told?.source === "journal" ? " (journal)" : ""}.${rise}`,
          ask: false
        });
      } else {
        const range = spanOf(rhr);
        const typical = spanOf(usual);
        items.push({
          kind: "early_signs",
          start,
          end,
          ongoing,
          label: rangeLabel(start, end, ongoing),
          title: "Early signs, nothing logged",
          text: range && typical ? `Resting HR ${range}, usually ${typical}. Were you sick?` : "Were you sick?",
          ask: !ongoing
        });
      }
      index = next;
      continue;
    }
    if (state.physical.recovery.band === "red") {
      items.push({
        kind: "red_recovery",
        start: sorted[index].date,
        end: sorted[index].date,
        ongoing: false,
        label: short(sorted[index].date),
        title: "Red recovery",
        text: `${state.physical.recovery.headline.replace(/, red/, "").replace("last night", "the night before")}.`,
        ask: false
      });
    }
    index += 1;
  }
  return items.reverse();
}
