import { ChatThread } from "../chat-sheet";
import { AppShell, Login } from "../shared-ui";
import { getSessionUser } from "@/lib/auth";
import { todayLocalDate } from "@/lib/dates";

export const dynamic = "force-dynamic";

// ?prompt= puts text in the composer, e.g. "Evening check-in" from a reminder.
export default async function ChatPage({ searchParams }: { searchParams?: Promise<{ prompt?: string }> }) {
  const user = await getSessionUser();
  const prompt = (await searchParams)?.prompt?.slice(0, 200);
  if (!user) {
    return <Login />;
  }

  const today = todayLocalDate();
  return (
    <AppShell user={user} date={today} active="chat" title="Chat">
      <section className="chat-page">
        <ChatThread date={today} today={today} prefill={prompt ? { text: prompt } : undefined} />
      </section>
    </AppShell>
  );
}
