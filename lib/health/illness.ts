// Illness signal from the watch: the body fighting something shows up as a
// resting heart rate above its usual, often with a warmer night, lower HRV or
// faster breathing, a day or two before or as symptoms start. Each day is
// compared with the owner's own baseline. Rules and calibration:
// docs/illness.md (keep it in sync).
import type { HealthDay } from "./queries";

// The baseline is days -31 to -4: the 3 days before are left out so a signal
// that's been building doesn't hide itself. Logged sick days are left out too.
const BASELINE_FROM = 31;
const BASELINE_TO = 4;
const MIN_BASELINE_DAYS = 14;

export type IllnessLevel = "none" | "possible" | "likely";

export type IllnessSignal = {
  date: string;
  level: IllnessLevel;
  points: number;
  // What stood out, one line each: "Resting HR 60, usually 57".
  reasons: string[];
  restingHr: { value: number; usual: number } | null;
};

const NONE = (date: string): IllnessSignal => ({ date, level: "none", points: 0, reasons: [], restingHr: null });

function shift(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function stats(values: number[]) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
  return { mean, sd };
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// One day's points. Resting HR carries it: +2 bpm (and well outside its usual
// spread) is 1, +3 is 2, +5 is 3. Sleep temperature (already relative to the
// watch's baseline) +0.4°C is 1, +1.0°C is 2; HRV 20% under its median is 1;
// breathing 1 breath a minute faster is 1.
// The baseline days for `date`: days −31 to −4 with resting HR, logged sick
// days left out. Null with fewer than 14. The body state's vitals use it too.
export function baselineDays(byDay: ReadonlyMap<string, HealthDay>, date: string, sick: ReadonlySet<string> = new Set()) {
  const base: HealthDay[] = [];
  for (let ago = BASELINE_FROM; ago >= BASELINE_TO; ago -= 1) {
    const other = byDay.get(shift(date, -ago));
    if (other && other.restingHr != null && !sick.has(other.day)) base.push(other);
  }
  return base.length < MIN_BASELINE_DAYS ? null : base;
}

function dayPoints(byDay: Map<string, HealthDay>, date: string, sick: ReadonlySet<string>) {
  const day = byDay.get(date);
  if (!day || day.restingHr == null) return null;
  const base = baselineDays(byDay, date, sick);
  if (!base) return null;

  let points = 0;
  const reasons: string[] = [];
  const rhr = stats(base.map((item) => item.restingHr!));
  const usual = Math.round(rhr.mean);
  const up = day.restingHr - rhr.mean;
  const rhrPoints = up >= 5 ? 3 : up >= 3 ? 2 : up >= 2 && up >= 2 * Math.max(rhr.sd, 1) ? 1 : 0;
  if (rhrPoints) reasons.push(`Resting HR ${day.restingHr}, usually ${usual}`);
  points += rhrPoints;

  const temp = day.sleepTempVsBaselineC;
  if (temp != null && temp >= 0.4) {
    points += temp >= 1 ? 2 : 1;
    reasons.push(`Sleep temperature +${temp.toFixed(1)}°C`);
  }

  const hrvs = base.map((item) => item.hrvMs).filter((value): value is number => value != null);
  if (day.hrvMs != null && hrvs.length >= MIN_BASELINE_DAYS) {
    const usualHrv = median(hrvs);
    if (day.hrvMs <= usualHrv * 0.8) {
      points += 1;
      reasons.push(`HRV ${Math.round(day.hrvMs)} ms, usually ${Math.round(usualHrv)}`);
    }
  }

  const breaths = base.map((item) => item.breathsPerMin).filter((value): value is number => value != null);
  if (day.breathsPerMin != null && breaths.length >= MIN_BASELINE_DAYS) {
    const usualBreaths = stats(breaths).mean;
    if (day.breathsPerMin - usualBreaths >= 1) {
      points += 1;
      reasons.push(`Breathing ${day.breathsPerMin.toFixed(1)}/min, usually ${usualBreaths.toFixed(1)}`);
    }
  }

  return { points, rhrPoints, tempHigh: temp != null && temp >= 1, reasons, restingHr: { value: day.restingHr, usual } };
}

// A day counts as flagged with 2 points, as long as resting HR or a fever-like
// temperature is part of it (a low HRV and a warm room alone aren't enough).
const flagged = (day: ReturnType<typeof dayPoints>) => day != null && day.points >= 2 && (day.rhrPoints > 0 || day.tempHigh);

// The signal on `date`: possible on one flagged day; likely on 4 points, or 3
// with the day before flagged too. `days` must include the 31 days before.
export function illnessSignal(days: readonly HealthDay[], date: string, sickDates: ReadonlySet<string> = new Set()): IllnessSignal {
  const byDay = new Map(days.map((day) => [day.day, day]));
  const today = dayPoints(byDay, date, sickDates);
  if (!today || !flagged(today)) return { ...NONE(date), points: today?.points ?? 0 };
  const yesterday = dayPoints(byDay, shift(date, -1), sickDates);
  const likely = today.points >= 4 || (today.points >= 3 && flagged(yesterday));
  return { date, level: likely ? "likely" : "possible", points: today.points, reasons: today.reasons, restingHr: today.restingHr };
}
