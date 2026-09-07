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
