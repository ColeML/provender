import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const FOLDER = "./server/db/migrations";

async function migrationFiles() {
  return (await readdir(FOLDER)).filter((file) => file.endsWith(".sql")).sort();
}

async function apply(client: PGlite, file: string) {
  const sql = await readFile(`${FOLDER}/${file}`, "utf8");

  for (const statement of sql.split("--> statement-breakpoint")) {
    if (statement.trim()) {
      await client.exec(statement);
    }
  }
}

/**
 * The household migration has to work on a database that already has rows.
 *
 * Production could not be inspected when it was written — it is behind the bearer token — so
 * rather than assume the tables were empty, 0004 adds `household_id` with a default that adopts
 * existing rows and then drops it. This proves that, which is the only way the assumption stops
 * mattering.
 */
describe("the household migration", () => {
  it("adopts rows that already exist rather than rejecting them", async () => {
    const client = new PGlite();
    const files = await migrationFiles();
    const scoping = files.findIndex((file) => file.includes("scope_to_household"));

    expect(scoping).toBeGreaterThan(0);

    // Everything up to, but not including, the scoping migration.
    for (const file of files.slice(0, scoping)) {
      await apply(client, file);
    }

    await client.exec(`
      INSERT INTO config (key, value) VALUES ('people', '4');
      INSERT INTO recipes (id, title, base_servings) VALUES ('fajitas', 'Fajitas', 8);
      INSERT INTO ingredients (id, recipe_id, name, category, position)
      VALUES ('fajitas_salt', 'fajitas', 'salt', 'pantry', 0);
    `);

    await apply(client, files[scoping]);

    const config = await client.query<{ household_id: string }>("SELECT household_id FROM config");
    const recipes = await client.query<{ household_id: string }>(
      "SELECT household_id FROM recipes",
    );
    const ingredients = await client.query<{ household_id: string }>(
      "SELECT household_id FROM ingredients",
    );

    expect(config.rows).toEqual([{ household_id: "loewer" }]);
    expect(recipes.rows).toEqual([{ household_id: "loewer" }]);
    expect(ingredients.rows).toEqual([{ household_id: "loewer" }]);

    await client.close();
  }, 60_000);

  it("leaves no default behind, so a later insert must name its household", async () => {
    const client = new PGlite();

    for (const file of await migrationFiles()) {
      await apply(client, file);
    }

    await expect(
      client.exec("INSERT INTO recipes (id, title, base_servings) VALUES ('x', 'X', 4)"),
    ).rejects.toThrow(/household_id/);

    await client.close();
  }, 60_000);
});

describe("the recipe rating migration", () => {
  it("copies each recipe's most recent rating, within its own household", async () => {
    const client = new PGlite();
    const files = await migrationFiles();
    const rating = files.findIndex((file) => file.includes("add_recipe_rating"));

    expect(rating).toBeGreaterThan(0);

    for (const file of files.slice(0, rating)) {
      await apply(client, file);
    }

    await client.exec(`
      INSERT INTO households (id, name) VALUES ('loewer', 'Loewer'), ('other', 'Other')
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO recipes (household_id, id, title, base_servings) VALUES
        ('loewer', 'tacos', 'Tacos', 4),
        ('loewer', 'ziti', 'Ziti', 4),
        ('other', 'tacos', 'Their Tacos', 4);
      INSERT INTO meal_history (household_id, id, date, recipe_id, title, rating) VALUES
        ('loewer', '2026-06-01-tacos', '2026-06-01', 'tacos', 'Tacos', 2),
        ('loewer', '2026-08-01-tacos', '2026-08-01', 'tacos', 'Tacos', 5),
        ('loewer', '2026-09-01-tacos', '2026-09-01', 'tacos', 'Tacos', NULL),
        ('loewer', '2026-08-01-ziti', '2026-08-01', 'ziti', 'Ziti', NULL),
        ('other', '2026-07-01-tacos', '2026-07-01', 'tacos', 'Their Tacos', 1);
    `);

    await apply(client, files[rating]);

    const recipes = await client.query<{ household_id: string; id: string; rating: number | null }>(
      "SELECT household_id, id, rating FROM recipes ORDER BY household_id, id",
    );

    // Latest *rated* entry wins (5, not the unrated 09-01), and the other household's 1 stays theirs.
    expect(recipes.rows).toEqual([
      { household_id: "loewer", id: "tacos", rating: 5 },
      { household_id: "loewer", id: "ziti", rating: null },
      { household_id: "other", id: "tacos", rating: 1 },
    ]);

    await client.close();
  }, 60_000);

  it("re-runs without overwriting a newer rating, and skips out-of-range history", async () => {
    const client = new PGlite();
    const files = await migrationFiles();
    const rating = files.findIndex((file) => file.includes("add_recipe_rating"));

    for (const file of files.slice(0, rating)) {
      await apply(client, file);
    }

    await client.exec(`
      INSERT INTO households (id, name) VALUES ('loewer', 'Loewer') ON CONFLICT (id) DO NOTHING;
      INSERT INTO recipes (household_id, id, title, base_servings) VALUES
        ('loewer', 'tacos', 'Tacos', 4),
        ('loewer', 'ziti', 'Ziti', 4);
      INSERT INTO meal_history (household_id, id, date, recipe_id, title, rating) VALUES
        ('loewer', '2026-08-01-tacos', '2026-08-01', 'tacos', 'Tacos', 5),
        ('loewer', '2026-08-01-ziti', '2026-08-01', 'ziti', 'Ziti', 4),
        ('loewer', '2026-09-01-ziti', '2026-09-01', 'ziti', 'Ziti', 99);
    `);

    await apply(client, files[rating]);
    await client.exec("UPDATE recipes SET rating = 2 WHERE id = 'tacos'");
    await apply(client, files[rating]);

    const recipes = await client.query<{ id: string; rating: number | null }>(
      "SELECT id, rating FROM recipes ORDER BY id",
    );

    expect(recipes.rows).toEqual([
      { id: "tacos", rating: 2 },
      { id: "ziti", rating: 4 },
    ]);

    await client.close();
  }, 60_000);
});

describe("the recipe notes migration", () => {
  it("gives every existing recipe an empty list of notes", async () => {
    const client = new PGlite();
    const files = await migrationFiles();
    const notes = files.findIndex((file) => file.includes("add_recipe_notes"));

    expect(notes).toBeGreaterThan(0);

    for (const file of files.slice(0, notes)) {
      await apply(client, file);
    }

    await client.exec(`
      INSERT INTO households (id, name) VALUES ('loewer', 'Loewer') ON CONFLICT (id) DO NOTHING;
      INSERT INTO recipes (household_id, id, title, base_servings) VALUES ('loewer', 'tacos', 'Tacos', 4);
    `);

    await apply(client, files[notes]);

    const recipes = await client.query<{ notes: string[] }>("SELECT notes FROM recipes");

    expect(recipes.rows).toEqual([{ notes: [] }]);

    await client.close();
  }, 60_000);
});
