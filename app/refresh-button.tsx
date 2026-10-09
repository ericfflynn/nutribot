"use client";

import { useFormStatus } from "react-dom";
import { refreshHealthAction } from "./actions";

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
