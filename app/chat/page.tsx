import { ChatThread } from "../chat-sheet";
import { ReminderBanner } from "../reminders-toggle";
import { AppShell, Login } from "../shared-ui";
import { getSessionUser } from "@/lib/auth";
import { todayLocalDate } from "@/lib/dates";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ?prompt= puts text in the composer, e.g. "Evening check-in" from a reminder.
// ?reminders= (ids) shows snooze and dismiss for the reminder that opened it.
export default async function ChatPage({
  searchParams
}: {
  searchParams?: Promise<{ prompt?: string; reminders?: string }>;
}) {
  const user = await getSessionUser();
  const params = await searchParams;
  const prompt = params?.prompt?.slice(0, 200);
  const reminderIds = (params?.reminders ?? "")
    .split(",")
    .filter((id) => UUID.test(id))
    .slice(0, 20);
  if (!user) {
    return <Login />;
  }

  const today = todayLocalDate();
  return (
    <AppShell user={user} date={today} active="chat" title="Chat">
      <section className="chat-page">
        {reminderIds.length ? <ReminderBanner ids={reminderIds} /> : null}
        <ChatThread date={today} today={today} prefill={prompt ? { text: prompt } : undefined} />
      </section>
    </AppShell>
  );
}
