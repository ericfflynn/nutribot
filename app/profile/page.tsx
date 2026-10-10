import { redirect } from "next/navigation";

// The old meal logger. Logging moved to chat; keep old links working.
export default function ProfilePage() {
  redirect("/chat");
}
