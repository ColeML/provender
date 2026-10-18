"use client";

import { useMutation } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { useTRPC } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

const STARS = [1, 2, 3, 4, 5] as const;

export function RecipeRating({
  recipeId,
  initialRating,
}: {
  recipeId: string;
  initialRating: number | null;
}) {
  const trpc = useTRPC();
  const router = useRouter();
  const [rating, setRating] = useState(initialRating);
  const [failed, setFailed] = useState(false);
  const lastSaved = useRef(initialRating);
  const latestTap = useRef(0);
  const save = useMutation(
    trpc.recipes.setRating.mutationOptions({ scope: { id: `rating-${recipeId}` } }),
  );

  // Callbacks passed to mutate() fire only for the most recent call, so a quick second tap would
  // drop the first tap's onSuccess. mutateAsync settles once per call, and the scope keeps order.
  async function onRate(next: number | null) {
    const tap = ++latestTap.current;

    setRating(next);

    try {
      await save.mutateAsync({ recipeId, rating: next });
      lastSaved.current = next;

      if (tap === latestTap.current) {
        setFailed(false);
        router.refresh();
      }
    } catch {
      if (tap === latestTap.current) {
        setRating(lastSaved.current);
        setFailed(true);
      }
    }
  }

  return (
    <section aria-labelledby="rating" className="mt-6">
      <h2 id="rating" className="text-muted-foreground text-xs">
        Rating
      </h2>

      <div className="mt-1 flex gap-1">
        {STARS.map((star) => (
          <button
            key={star}
            type="button"
            aria-label={star === 1 ? "1 star" : `${star} stars`}
            aria-pressed={rating === star}
            onClick={() => onRate(rating === star ? null : star)}
            className="focus-visible:ring-ring flex size-11 items-center justify-center rounded-lg focus-visible:ring-3 focus-visible:outline-none"
          >
            <Star
              aria-hidden
              className={cn(
                "size-7",
                rating !== null && star <= rating
                  ? "fill-primary text-primary"
                  : "text-muted-foreground",
              )}
            />
          </button>
        ))}
      </div>

      {failed ? (
        <p role="alert" className="text-destructive mt-2 text-sm">
          Could not save that rating.
        </p>
      ) : null}
    </section>
  );
}
