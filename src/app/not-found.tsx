import Link from "next/link";

/**
 * The 404, at the root rather than inside `(app)`.
 *
 * Only the root file also answers a URL that matches no route at all; one inside the group would
 * leave every unrouted address on Next's built-in page, which draws its own stylesheet and follows
 * the operating system's color scheme instead of the theme class `next-themes` sets.
 */
export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="font-display text-2xl font-semibold">Not found</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Nothing answers that address.{" "}
        <Link href="/" className="text-foreground underline">
          Back to this week
        </Link>
        .
      </p>
    </main>
  );
}
