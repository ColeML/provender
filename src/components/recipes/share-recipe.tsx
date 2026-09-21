"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useTRPC } from "@/lib/trpc/client";

interface ControlProps {
  origin: string;
  token: string | null;
  pending: boolean;
  onShare: () => void;
  onRevoke: (token: string) => void;
}

/**
 * The share control, with no data layer.
 *
 * Split from the wrapper below so the behaviour that matters — what the link reads as, what the
 * clipboard receives, that a second click cannot mint twice — is testable without standing up
 * tRPC.
 */
export function ShareControl({ origin, token, pending, onShare, onRevoke }: ControlProps) {
  const [copied, setCopied] = useState(false);

  if (token === null) {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!pending) {
            onShare();
          }
        }}
        className="border-border rounded-lg border px-3 py-2 text-sm disabled:opacity-40"
      >
        Share this recipe
      </button>
    );
  }

  const url = `${origin}/r/${token}`;

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
  }

  return (
    <div className="border-border flex flex-wrap items-center gap-2 rounded-lg border p-3">
      {/* Readable as well as copyable: the clipboard is not available over plain HTTP, and a link
          someone is about to hand out is worth being able to check. */}
      <input
        readOnly
        aria-label="Share link"
        value={url}
        onFocus={(event) => event.currentTarget.select()}
        className="bg-muted min-w-0 flex-1 rounded px-2 py-1 font-mono text-xs"
      />

      <button
        type="button"
        onClick={copy}
        className="border-border rounded-lg border px-3 py-1.5 text-sm"
      >
        Copy link
      </button>

      <button
        type="button"
        disabled={pending}
        onClick={() => onRevoke(token)}
        className="text-muted-foreground px-2 py-1.5 text-sm underline disabled:opacity-40"
      >
        Revoke link
      </button>

      <p aria-live="polite" className="text-muted-foreground w-full text-xs">
        {copied ? "Copied" : "Anyone with this link can read the recipe."}
      </p>
    </div>
  );
}

interface Props {
  recipeId: string;
  token: string | null;
  /**
   * Passed down from the server rather than read off `window`.
   *
   * A client component is server-rendered before it ever reaches a browser, so touching
   * `window.location` here throws `window is not defined` and 500s the whole recipe page.
   */
  origin: string;
}

/** Wires the control to tRPC. The page owns the current token, so a change refreshes it. */
export function ShareRecipe({ recipeId, token, origin }: Props) {
  const trpc = useTRPC();
  const router = useRouter();

  const settle = { onSuccess: () => router.refresh() };

  const share = useMutation(trpc.recipes.share.mutationOptions(settle));
  const revoke = useMutation(trpc.recipes.revokeShare.mutationOptions(settle));

  return (
    <ShareControl
      origin={origin}
      token={token}
      pending={share.isPending || revoke.isPending}
      onShare={() => share.mutate({ recipeId })}
      onRevoke={(current) => revoke.mutate({ recipeId, token: current })}
    />
  );
}
