export const metadata = { title: "Recipes — Provender" };

/** A stub so the nav does not link into a 404 before issue #40 builds the library and cook view. */
export default function Recipes() {
  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="text-2xl font-semibold">Recipes</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Not built yet — issue #40. Ask Claude Code to plan the week or scale a recipe in the
        meantime.
      </p>
    </main>
  );
}
