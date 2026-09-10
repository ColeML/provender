export const metadata = { title: "Plan — Provender" };

/** A stub so the nav does not link into a 404 before issue #38 builds the week grid. */
export default function Plan() {
  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="text-2xl font-semibold">Plan</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Not built yet — issue #38. Ask Claude Code to plan the week or scale a recipe in the
        meantime.
      </p>
    </main>
  );
}
