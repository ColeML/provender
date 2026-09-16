/**
 * A surface with nothing on it yet, drawn as a blank page rather than a failure.
 *
 * The message stays in the UI face — `DESIGN.md` reserves the display face for a page `h1` and
 * the wordmark, and an empty state's lead line is neither. The rule above it is the manuscript
 * reference, which borders carry here rather than any texture.
 */
export function EmptyState({
  children,
  hint,
  footer,
}: {
  /** The one line naming what is absent. */
  children: React.ReactNode;
  /** What the reader can do about it, when there is something. */
  hint?: React.ReactNode;
  /** Quiet marginalia under the message. */
  footer?: React.ReactNode;
}) {
  return (
    <section className="border-border mt-8 border-t pt-6 pb-12">
      <p className="text-base">{children}</p>

      {hint === undefined ? null : <p className="text-muted-foreground mt-2 text-sm">{hint}</p>}

      {footer === undefined ? null : <footer className="mt-8">{footer}</footer>}
    </section>
  );
}
