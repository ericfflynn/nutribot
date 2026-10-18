"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { autoSyncHealthAction, refreshHealthAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="text-button" type="submit" disabled={pending}>
      {pending ? "Refreshing…" : "Refresh"}
    </button>
  );
}

export function RefreshButton() {
  return (
    <form action={refreshHealthAction}>
      <SubmitButton />
    </form>
  );
}

// Pulls fresh watch data when the app opens or comes back to the foreground
// (the Home Screen app resumes more often than it reloads). The server skips
// it when a sync started in the last 15 minutes. Shows while it runs.
let inFlight = false;

export function HealthAutoSync() {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    async function sync() {
      if (inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      setSyncing(true);
      try {
        const result = await autoSyncHealthAction();
        if (result.synced) router.refresh();
      } catch {
        // Offline or a failed run: Today's sync note shows what happened.
      } finally {
        inFlight = false;
        setSyncing(false);
      }
    }
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [router]);

  if (!syncing) return null;
  return (
    <span className="auto-sync" role="status">
      <span className="spinner dark" aria-hidden="true" /> Syncing
    </span>
  );
}
