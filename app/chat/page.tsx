import { ChatThread } from "../chat-sheet";
import { AppShell, Login } from "../shared-ui";
import { getSessionUser } from "@/lib/auth";
import { todayLocalDate } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const user = await getSessionUser();
  if (!user) {
    return <Login />;
  }

  const today = todayLocalDate();
  return (
    <AppShell user={user} date={today} active="chat" title="Chat">
      <section className="chat-page">
        <ChatThread date={today} today={today} />
      </section>
    </AppShell>
  );
}
