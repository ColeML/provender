import type { StepPart } from "@server/lib/step-quantities";

import { formatQuantity } from "@/lib/quantity";

interface Props {
  parts: StepPart[];
}

/** A step's text, with its marked amounts set in the mono that quantities use everywhere else. */
export function StepText({ parts }: Props) {
  return (
    <span className="text-xl leading-snug">
      {parts.map((part, index) =>
        typeof part === "string" ? (
          part
        ) : (
          // Parts never reorder, so the position is a stable key.
          // A mono space is as wide as a digit, so "1 cup" reads as double-spaced in a sentence.
          <span key={index} className="font-mono [word-spacing:-0.3em]">
            {formatQuantity(part.quantity, part.unit)}
          </span>
        ),
      )}
    </span>
  );
}
