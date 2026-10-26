"use client";

import { useFormStatus } from "react-dom";

/** Not dimmed while pending, unlike the app's other disabled buttons: its label is the status. */
export function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-primary text-primary-foreground focus-visible:ring-ring mt-2 h-11 rounded-lg text-sm font-medium focus-visible:ring-3 focus-visible:outline-none disabled:cursor-progress"
    >
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}
