// Loads everything buildBodyState reads for a day, in one round of queries.
import type { Pool } from "pg";
import { listSoreness } from "../body-log";
import { addDays } from "../dates";
import { getLatestHealthSyncRun, listHealthDays, listHealthWorkouts } from "../health/queries";
import { listHabitLogs, listHabits } from "../habits";
import { listIllnessDays } from "../illness";
import { listJournalEntries } from "../journal";
import { getUserGoals, getWaterOunces, listEntriesForDateRange } from "../supabase";
import { listFitbitWorkouts, listWorkoutSessions } from "../workouts";
import { buildBodyState } from "./build";
import type { BodySources, BodyState } from "./types";

export async function loadBodySources(db: Pool, userName: string, date: string): Promise<BodySources> {
  const yesterday = addDays(date, -1);
  const [health, healthWorkouts, sessions, fitbit, soreness, illness, journal, habits, habitLogs, meals, waterYesterday, waterToday, goals, lastSync] =
    await Promise.all([
      listHealthDays(userName, addDays(date, -62), date),
      listHealthWorkouts(userName, addDays(date, -30), date),
      listWorkoutSessions(db, userName, addDays(date, -30), date),
      listFitbitWorkouts(db, userName, addDays(date, -7), date),
      listSoreness(db, userName, addDays(date, -14), date),
      listIllnessDays(db, userName, addDays(date, -60), date),
      listJournalEntries(db, userName, addDays(date, -7), date),
      listHabits(db, userName),
      listHabitLogs(db, userName, addDays(date, -10), date),
      listEntriesForDateRange(userName, addDays(date, -7), date),
      getWaterOunces(userName, yesterday, db),
      getWaterOunces(userName, date, db),
      getUserGoals(userName, db),
      getLatestHealthSyncRun(userName)
    ]);
  return {
    health,
    healthWorkouts,
    sessions,
    fitbit,
    soreness,
    illness,
    journal,
    habits,
    habitLogs,
    meals,
    water: { [yesterday]: waterYesterday, [date]: waterToday },
    goals,
    lastSync
  };
}

export async function getBodyState(
  db: Pool,
  userName: string,
  date: string,
  trigger: BodyState["meta"]["trigger"] = "live"
): Promise<BodyState> {
  return buildBodyState(await loadBodySources(db, userName, date), date, { trigger });
}
