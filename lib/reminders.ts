// The 8 pm reminder, sent as web push to the Home Screen app. At most one a
// day: weeknights (Sun-Thu) say to get off the Xbox, and any night without a
// journal entry asks for one. Plan: docs/journal-habits-plan.md#reminders.
import type { Pool } from "pg";
import webpush from "web-push";

export const REMINDER_HOUR = 20;

export type PushSubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };

export type Reminder = { title: string; body: string; url: string };

const CHECKIN_URL = `/chat?prompt=${encodeURIComponent("Evening check-in")}`;

// Sunday through Thursday: the nights before a workday.
export function isWeeknight(date: string) {
  return new Date(`${date}T12:00:00Z`).getUTCDay() <= 4;
}

export function reminderFor(date: string, journaled: boolean): Reminder | null {
  if (isWeeknight(date)) {
    return {
      title: "8 pm: Xbox off",
      body: journaled ? "Time to start winding down for bed." : "Start winding down. Quick journal before bed?",
      url: CHECKIN_URL
    };
  }
  return journaled ? null : { title: "How was today?", body: "Take a minute to journal.", url: CHECKIN_URL };
}

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

// Sends today's reminder to each of the user's devices, once per day.
// Returns what happened, for the cron route's response.
export async function sendDailyReminder(db: Pool, userName: string, date: string) {
  const { rows: journal } = await db.query(
    `select 1 from public.journal_entries where user_name = $1 and entry_date = $2::date limit 1`,
    [userName, date]
  );
  const reminder = reminderFor(date, journal.length > 0);
  if (!reminder) return { userName, status: "nothing to send" };

  const { rows: subscriptions } = await db.query<{ endpoint: string; p256dh: string; auth: string }>(
    `select endpoint, p256dh, auth from public.push_subscriptions where user_name = $1`,
    [userName]
  );
  if (!subscriptions.length) return { userName, status: "no devices" };

  // Claim the day first, so a retried or duplicate job never sends twice.
  const { rowCount } = await db.query(
    `
    insert into public.reminder_sends (user_name, local_date, kind) values ($1, $2::date, 'evening')
    on conflict do nothing
    `,
    [userName, date]
  );
  if (!rowCount) return { userName, status: "already sent" };

  configureWebPush();
  let sent = 0;
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        JSON.stringify(reminder),
        { TTL: 60 * 60 }
      );
      sent += 1;
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
  if (!sent) {
    await db.query(`delete from public.reminder_sends where user_name = $1 and local_date = $2::date and kind = 'evening'`, [
      userName,
      date
    ]);
  }
  return { userName, status: sent ? "sent" : "failed", devices: sent };
}
