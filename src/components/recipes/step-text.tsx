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
          <span key={index} className="font-mono">
            {formatQuantity(part.quantity, part.unit)}
          </span>
        ),
      )}
    </span>
  );
}
