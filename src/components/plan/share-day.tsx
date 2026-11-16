"use client";

import { useMutation } from "@tanstack/react-query";
import { Share } from "lucide-react";
import { useRouter } from "next/navigation";

import { LinkPanel } from "@/components/recipes/share-recipe";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTRPC } from "@/lib/trpc/client";

export interface LiveDayShare {
  token: string;
  /** ISO 8601. */
  expireTime: string;
}

interface ControlProps {
  origin: string;
  share: LiveDayShare | null;
  pending: boolean;
  onShare: () => void;
}

const UNTIL = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** The share control, with no data layer, so it is testable without tRPC. */
export function ShareDayControl({ origin, share, pending, onShare }: ControlProps) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label="Share this day"
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring -mr-3 inline-flex size-11 shrink-0 items-center justify-center rounded-lg focus-visible:ring-3 focus-visible:outline-none"
      >
        <Share aria-hidden className="size-5" />
      </PopoverTrigger>

      <PopoverContent
        align="end"
        alignOffset={12}
        className="w-80 max-w-[calc(100vw-2rem)] gap-3 rounded-lg"
      >
        {share === null ? (
          <>
            <p className="text-muted-foreground">
              Anyone with this link can read every meal, recipe and note for this day, without
              signing in. It stops working 3 days after you create it.
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
            url={`${origin}/d/${share.token}`}
            note={`Includes the day's notes. Works until ${UNTIL.format(new Date(share.expireTime))}.`}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Wires the control to tRPC. The page owns the current share, so a new one refreshes it. */
export function ShareDay({
  date,
  share,
  origin,
}: {
  date: string;
  share: LiveDayShare | null;
  origin: string;
}) {
  const trpc = useTRPC();
  const router = useRouter();

  const create = useMutation(
    trpc.plans.shareDay.mutationOptions({ onSuccess: () => router.refresh() }),
  );

  return (
    <ShareDayControl
      origin={origin}
      share={share}
      pending={create.isPending}
      onShare={() => create.mutate({ date })}
    />
  );
}
