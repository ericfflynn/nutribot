"use client";

import { useEffect, useState } from "react";
import { deletePushSubscriptionAction, savePushSubscriptionAction } from "./actions";
import type { PushSubscriptionInput } from "@/lib/reminders";

type State = "loading" | "unsupported" | "denied" | "off" | "on";

function keyBytes(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

// The 8 pm reminder switch. iPhones only deliver web push to the Home Screen
// app, and only ask for permission after a tap.
export function RemindersToggle({ publicKey }: { publicKey: string | null }) {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!publicKey || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => setState(subscription ? "on" : "off"))
      .catch(() => setState("unsupported"));
  }, [publicKey]);

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(publicKey!)
      });
      const result = await savePushSubscriptionAction(subscription.toJSON() as PushSubscriptionInput);
      if (!result.ok) throw new Error();
      setState("on");
    } catch {
      setError("Couldn't turn reminders on. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await deletePushSubscriptionAction(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setState("off");
    } catch {
      setError("Couldn't turn reminders off. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const note: Record<State, string> = {
    loading: "",
    unsupported: "Add NutriBot to your Home Screen from Safari to get reminders.",
    denied: "Notifications are off for NutriBot in iPhone Settings.",
    off: "One nudge at 8 pm: Xbox off on weeknights, and a journal reminder if you haven't written one.",
    on: "On. At most one a day, in the 8 pm hour."
  };

  return (
    <section className="card reminders-card" aria-label="Reminders">
      <div className="card-heading">
        <h2 className="card-title">Reminders</h2>
        {state === "off" ? (
          <button type="button" className="pill-button" onClick={enable} disabled={busy}>
            {busy ? "Turning on…" : "Turn on"}
          </button>
        ) : state === "on" ? (
          <button type="button" className="text-button" onClick={disable} disabled={busy}>
            Turn off
          </button>
        ) : null}
      </div>
      {note[state] ? <p className="footnote">{note[state]}</p> : null}
      {error ? <p className="chat-error">{error}</p> : null}
    </section>
  );
}
