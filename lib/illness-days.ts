// Sick days: severities, symptoms, and the episodes they make up. Pure, so
// the browser can use the labels; the database and chat tools are in
// lib/illness.ts. Plan: docs/illness.md.
import { addDays } from "./dates";

// 0 means better: it closes an episode.
export const SEVERITY_LABELS = ["Better", "Mild", "Sick", "Very sick"] as const;
export const SEVERITY_GUIDE = [
  "0 Better: recovered or nearly, back to normal",
  "1 Mild: a bit off, a cold above the neck (sniffles, scratchy throat), can go about the day",
  "2 Sick: clearly unwell, low energy, below-the-neck symptoms (aches, chest, stomach) or a fever",
  "3 Very sick: in bed, can't do much"
];
export const SYMPTOMS = [
  "sore throat",
  "congestion",
  "runny nose",
  "sneezing",
  "cough",
  "fever",
  "chills",
  "headache",
  "body aches",
  "fatigue",
  "nausea",
  "upset stomach",
  "diarrhea",
  "no appetite",
  "dizziness"
] as const;
export type Symptom = (typeof SYMPTOMS)[number];

export type IllnessInput = { severity: number; symptoms: Symptom[]; note: string | null };
export type IllnessDay = IllnessInput & { id: string; date: string };

// One card for one or more days at the same severity ("sick since Tuesday").
// Saving sets each day, replacing what was logged for it.
export type IllnessDraft = IllnessInput & {
  type: "illness";
  id: string;
  start_date: string;
  end_date: string;
  saved_id: string | null;
  discarded?: boolean;
};

// An episode: logged sick days (severity 1+) with at most a day's gap between
// them. A day with nothing logged carries the last severity forward for
// CARRY_DAYS; after that, or after a "Better" log, the episode is over.
const MAX_GAP_DAYS = 1;
export const CARRY_DAYS = 2;

export type Episode = {
  start: string;
  last: string; // the last sick day logged
  peak: number;
  days: IllnessDay[]; // sick days, oldest first
  ended: string | null; // the Better day, or null when it just stopped being logged
};

export function episodesOf(days: readonly IllnessDay[]): Episode[] {
  const episodes: Episode[] = [];
  let current: Episode | null = null;
  for (const day of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    if (day.severity === 0) {
      if (current && !current.ended) current.ended = day.date;
      current = null;
      continue;
    }
    if (current && addDays(current.last, MAX_GAP_DAYS + 1) >= day.date) {
      current.last = day.date;
      current.peak = Math.max(current.peak, day.severity);
      current.days.push(day);
    } else {
      current = { start: day.date, last: day.date, peak: day.severity, days: [day], ended: null };
      episodes.push(current);
    }
  }
  return episodes;
}

export type SickStatus = {
  severity: number; // today's, or carried from the last logged day
  symptoms: Symptom[];
  since: string;
  dayNumber: number; // day 1 is the first sick day
  loggedToday: boolean;
  episode: Episode;
};

// Whether the owner counts as sick on `date`: an episode with a sick day on
// it, or one logged in the CARRY_DAYS before and not closed by Better.
export function sickOn(days: readonly IllnessDay[], date: string): SickStatus | null {
  const known = days.filter((day) => day.date <= date);
  const episode = episodesOf(known).at(-1);
  if (!episode || (episode.ended && episode.ended <= date) || addDays(episode.last, CARRY_DAYS) < date) return null;
  const latest = episode.days.at(-1)!;
  const dayNumber = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${episode.start}T00:00:00Z`)) / 86_400_000) + 1;
  return { severity: latest.severity, symptoms: latest.symptoms, since: episode.start, dayNumber, loggedToday: latest.date === date, episode };
}

// Easing back: the days right after an episode that reached Sick (2+).
export const EASE_DAYS = 2;
export function easingOn(days: readonly IllnessDay[], date: string) {
  if (sickOn(days, date)) return null;
  const episode = episodesOf(days.filter((day) => day.date < date)).at(-1);
  if (!episode || episode.peak < 2) return null;
  const over = episode.ended ?? addDays(episode.last, 1);
  return over <= date && addDays(over, EASE_DAYS) > date ? episode : null;
}
