// Reminders, sent as web push to the Home Screen app. The rows live in
// reminders (the owner edits them on the Habits tab); what's due and what it
// says is in lib/reminder-rules.ts. A cron job runs every hour; each run
// sends at most one notification per device, holding everything due.
// Plan: docs/journal-habits-plan.md#reminders.
import type { Pool } from "pg";
import webpush from "web-push";
import { weekdayOf } from "./dates";
import { listHabitLogs, listHabits, trackedOn } from "./habits";
import { buildNotification, isDue, type DayState, type ReminderKind, type ReminderRule } from "./reminder-rules";

type Queryable = Pick<Pool, "query">;

export type PushSubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };

export function vapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

function configureWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) throw new Error("VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are required.");
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "https://nutribot-dusky.vercel.app", publicKey, privateKey);
}

export async function savePushSubscription(db: Pick<Pool, "query">, userName: string, subscription: PushSubscriptionInput) {
  await db.query(
    `
    insert into public.push_subscriptions (endpoint, user_name, p256dh, auth)
    values ($1, $2, $3, $4)
    on conflict (endpoint) do update set user_name = excluded.user_name, p256dh = excluded.p256dh, auth = excluded.auth
    `,
    [subscription.endpoint, userName, subscription.keys.p256dh, subscription.keys.auth]
  );
}

export async function deletePushSubscription(db: Pick<Pool, "query">, userName: string, endpoint: string) {
  await db.query(`delete from public.push_subscriptions where endpoint = $1 and user_name = $2`, [endpoint, userName]);
}

export async function listReminders(db: Queryable, userName: string): Promise<ReminderRule[]> {
  const { rows } = await db.query<ReminderRule>(
    `
    select
      r.id::text,
      r.kind,
      r.habit_id::text as "habitId",
      h.name as "habitName",
      r.hour::int,
      r.days::int[] as days,
      r.message,
      r.enabled and (h.id is null or h.active) as enabled,
      r.snoozed_until::text as "snoozedUntil",
      r.skip_date::text as "skipDate"
    from public.reminders r
    left join public.habits h on h.id = r.habit_id
    where r.user_name = $1
    order by r.hour, r.created_at
    `,
    [userName]
  );
  return rows;
}

export type ReminderInput = {
  kind: ReminderKind;
  habitId: string | null;
  hour: number;
  days: number[] | null;
  message: string | null;
  enabled: boolean;
};

// Adds a reminder, or changes one when id is given. Changing a reminder
// clears its snooze and today's dismissal.
export async function saveReminder(db: Queryable, userName: string, input: ReminderInput, id?: string | null) {
  const values = [userName, input.kind, input.habitId, input.hour, input.days, input.message, input.enabled];
  const { rows } = id
    ? await db.query<{ id: string }>(
        `
        update public.reminders
        set kind = $2, habit_id = $3::uuid, hour = $4, days = $5::smallint[], message = $6, enabled = $7,
          snoozed_until = null, skip_date = null
        where user_name = $1 and id = $8::uuid
        returning id::text
        `,
        [...values, id]
      )
    : await db.query<{ id: string }>(
        `
        insert into public.reminders (user_name, kind, habit_id, hour, days, message, enabled)
        select $1, $2, h.id, $4, $5::smallint[], $6, $7
        from (select 1) one
        left join public.habits h on h.id = $3::uuid and h.user_name = $1
        where $3::uuid is null or h.id is not null
        returning id::text
        `,
        values
      );
  if (!rows[0]) throw new Error("That reminder no longer exists.");
  return rows[0].id;
}

export async function deleteReminder(db: Queryable, userName: string, id: string) {
  const { rowCount } = await db.query(`delete from public.reminders where id = $1::uuid and user_name = $2`, [id, userName]);
  return Boolean(rowCount);
}

// A habit's own reminder, set from the habit editor: an hour, or null for none.
export async function setHabitReminder(db: Queryable, userName: string, habitId: string, hour: number | null) {
  if (hour == null) {
    await db.query(`delete from public.reminders where user_name = $1 and habit_id = $2::uuid and kind = 'habit'`, [
      userName,
      habitId
    ]);
    return;
  }
  await db.query(
    `
    insert into public.reminders (user_name, kind, habit_id, hour)
    select $1, 'habit', id, $3 from public.habits where id = $2::uuid and user_name = $1
    on conflict (user_name, habit_id) where kind = 'habit'
    do update set hour = excluded.hour, enabled = true, snoozed_until = null, skip_date = null
    `,
    [userName, habitId, hour]
  );
}

// Snooze: fire again on the first hourly run after `hours` from now.
export async function snoozeReminders(db: Queryable, userName: string, ids: string[], hours: number) {
  await db.query(
    `
    update public.reminders set snoozed_until = now() + make_interval(hours => $3)
    where user_name = $1 and id = any($2::uuid[])
    `,
    [userName, ids, hours]
  );
}

// Dismiss: done for today, snooze or not.
export async function dismissReminders(db: Queryable, userName: string, ids: string[], date: string) {
  await db.query(
    `
    update public.reminders set skip_date = $3::date, snoozed_until = null
    where user_name = $1 and id = any($2::uuid[])
    `,
    [userName, ids, date]
  );
}

export async function remindersSentOn(db: Queryable, userName: string, date: string) {
  const { rows } = await db.query<{ kind: string; sentAt: string }>(
    `select kind, sent_at::text as "sentAt" from public.reminder_sends where user_name = $1 and local_date = $2::date`,
    [userName, date]
  );
  return new Map(rows.map((row) => [row.kind, row.sentAt]));
}

// What's logged today, for completion-aware reminders.
export async function dayState(db: Queryable, userName: string, date: string): Promise<DayState> {
  const [{ rows: journal }, habits, logs] = await Promise.all([
    db.query(`select 1 from public.journal_entries where user_name = $1 and entry_date = $2::date limit 1`, [userName, date]),
    listHabits(db, userName),
    listHabitLogs(db, userName, date, date)
  ]);
  const loggedHabitIds = new Set(logs.map((log) => log.habitId));
  return {
    journaled: journal.length > 0,
    loggedHabitIds,
    unloggedHabits: habits
      .filter((habit) => !loggedHabitIds.has(habit.id) && trackedOn(habit, date))
      .map((habit) => ({ id: habit.id, name: habit.name }))
  };
}

// Sends what's due this hour to each of the user's devices. `localNow` is
// "YYYY-MM-DDTHH:MM" in APP_TIME_ZONE. Returns what happened, for the cron
// route's response.
export async function sendDueReminders(db: Pool, userName: string, localNow: string, force = false) {
  const date = localNow.slice(0, 10);
  const hour = Number(localNow.slice(11, 13));
  const [reminders, sent] = await Promise.all([listReminders(db, userName), remindersSentOn(db, userName, date)]);
  const context = { date, hour, weekday: weekdayOf(date), now: Date.now(), sentToday: new Set(sent.keys()) };
  const due = force ? reminders.filter((reminder) => reminder.enabled) : reminders.filter((reminder) => isDue(reminder, context));
  if (!due.length) return { userName, status: "nothing due" };

  const notification = buildNotification(due, await dayState(db, userName, date));
  // Snoozes that ran out are spent either way; quiet reminders count as sent
  // so a later run in the same hour doesn't re-check them.
  const claimIds = due.map((reminder) => reminder.id);
  const claim = async () => {
    const { rows } = await db.query<{ kind: string }>(
      `
      insert into public.reminder_sends (user_name, local_date, kind)
      select $1, $2::date, id from unnest($3::text[]) as id
      on conflict do nothing
      returning kind
      `,
      [userName, date, claimIds]
    );
    await db.query(
      `update public.reminders set snoozed_until = null where user_name = $1 and id = any($2::uuid[]) and snoozed_until <= now()`,
      [userName, claimIds]
    );
    return new Set(rows.map((row) => row.kind));
  };
  if (!notification) {
    await claim();
    return { userName, status: "already done" };
  }

  const { rows: subscriptions } = await db.query<{ endpoint: string; p256dh: string; auth: string }>(
    `select endpoint, p256dh, auth from public.push_subscriptions where user_name = $1`,
    [userName]
  );
  if (!subscriptions.length) return { userName, status: "no devices" };

  // Claim first, so a retried or duplicate job never sends twice. A snoozed
  // reminder was already claimed today, so it may claim nothing new.
  const claimed = await claim();
  const snoozedDue = due.some((reminder) => reminder.snoozedUntil && Date.parse(reminder.snoozedUntil) <= context.now);
  if (!claimed.size && !snoozedDue && !force) return { userName, status: "already sent" };

  configureWebPush();
  let delivered = 0;
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        JSON.stringify(notification),
        { TTL: 60 * 60 }
      );
      delivered += 1;
    } catch (error) {
      // 404 and 410 mean the subscription is gone; the app asks to enable again.
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await db.query(`delete from public.push_subscriptions where endpoint = $1`, [subscription.endpoint]);
      } else {
        console.error("push failed", status ?? "unknown");
      }
    }
  }
  if (!delivered && claimed.size) {
    // Let the next hourly run try again.
    await db.query(`delete from public.reminder_sends where user_name = $1 and local_date = $2::date and kind = any($3::text[])`, [
      userName,
      date,
      [...claimed]
    ]);
  }
  return { userName, status: delivered ? "sent" : "failed", devices: delivered, reminders: notification.reminderIds.length };
}
