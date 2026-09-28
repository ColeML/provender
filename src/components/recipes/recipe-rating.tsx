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
  const save = useMutation(
    trpc.recipes.setRating.mutationOptions({ scope: { id: `rating-${recipeId}` } }),
  );

  function onRate(next: number | null) {
    setRating(next);

    save.mutate(
      { recipeId, rating: next },
      {
        onError: () => {
          setRating(lastSaved.current);
          setFailed(true);
        },
        onSuccess: () => {
          lastSaved.current = next;
          setFailed(false);
          router.refresh();
        },
      },
    );
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
