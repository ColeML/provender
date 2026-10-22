import { CSB_VERSES, type VerseReference } from "@/lib/verses";

/** Names only the translation: the full CSB credit line is on `/settings`. */
export function Verse({ reference }: { reference: VerseReference }) {
  return (
    <figure className="text-muted-foreground text-sm">
      <blockquote>
        <p>{CSB_VERSES[reference]}</p>
      </blockquote>
      <figcaption className="mt-1">{reference} · CSB</figcaption>
    </figure>
  );
}
