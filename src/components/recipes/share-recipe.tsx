"use client";

import { useMutation } from "@tanstack/react-query";
import { Share } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
 * An icon beside the title that opens a popover, so the cook view keeps its screen for the recipe.
 * Split from the wrapper below so the behaviour that matters — what the link reads as, what the
 * clipboard receives, that a second click cannot mint twice — is testable without standing up
 * tRPC.
 */
export function ShareControl({ origin, token, pending, onShare, onRevoke }: ControlProps) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label="Share this recipe"
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring -mr-3 inline-flex size-11 shrink-0 items-center justify-center rounded-lg focus-visible:ring-3 focus-visible:outline-none"
      >
        <Share aria-hidden className="size-5" />
      </PopoverTrigger>

      <PopoverContent
        align="end"
        // The trigger sits in the gutter by `-mr-3`; this brings the popup back to the page edge.
        alignOffset={12}
        className="w-80 max-w-[calc(100vw-2rem)] gap-3 rounded-lg"
      >
        {token === null ? (
          <>
            <p className="text-muted-foreground">
              Make a link anyone can open to read this recipe, without signing in.
            </p>

            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (!pending) {
                  onShare();
                }
              }}
              className="bg-primary text-primary-foreground focus-visible:ring-ring min-h-11 rounded-lg px-3 text-sm focus-visible:ring-3 focus-visible:outline-none disabled:opacity-40"
            >
              Create link
            </button>
          </>
        ) : (
          <LinkPanel
            url={`${origin}/r/${token}`}
            pending={pending}
            onRevoke={() => onRevoke(token)}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

/** The popover's body once a link exists. It unmounts when the popover closes, which resets "Copied". */
function LinkPanel({
  url,
  pending,
  onRevoke,
}: {
  url: string;
  pending: boolean;
  onRevoke: () => void;
}) {
  const [copied, setCopied] = useState(false);

  // Read here rather than in an effect: this only renders once the popover opens, which is always
  // in a browser. Phones and Safari have the share sheet; most desktop browsers do not.
  const canShare = typeof navigator.share === "function";

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
  }

  async function share() {
    try {
      await navigator.share({ url });
    } catch {
      // Dismissing the share sheet rejects too, and that is not a failure worth reporting.
    }
  }

  return (
    <>
      {/* Readable as well as copyable: the clipboard is not available over plain HTTP, and a link
          someone is about to hand out is worth being able to check. */}
      <input
        readOnly
        aria-label="Share link"
        value={url}
        onFocus={(event) => event.currentTarget.select()}
        className="bg-muted w-full min-w-0 rounded px-2 py-1.5 font-mono text-xs"
      />

      <div className="flex flex-wrap items-center gap-2">
        {canShare ? (
          <button
            type="button"
            onClick={share}
            className="bg-primary text-primary-foreground focus-visible:ring-ring min-h-11 rounded-lg px-3 text-sm focus-visible:ring-3 focus-visible:outline-none"
          >
            Share link
          </button>
        ) : null}

        <button
          type="button"
          onClick={copy}
          className="border-border focus-visible:ring-ring min-h-11 rounded-lg border px-3 text-sm focus-visible:ring-3 focus-visible:outline-none"
        >
          Copy link
        </button>

        <button
          type="button"
          disabled={pending}
          onClick={onRevoke}
          className="text-muted-foreground focus-visible:ring-ring ml-auto min-h-11 rounded-lg px-2 text-sm underline focus-visible:ring-3 focus-visible:outline-none disabled:opacity-40"
        >
          Revoke link
        </button>
      </div>

      <p aria-live="polite" className="text-muted-foreground text-xs">
        {copied ? "Copied" : "Anyone with this link can read the recipe."}
      </p>
    </>
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
