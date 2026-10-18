import "server-only";

import { db as defaultDb, schema, type Database, type Queryable } from "@server/db";
import { slug } from "@server/lib/slug";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

/**
 * The shops a household buys from, and which ingredients come from which.
 *
 * `householdId` is the required first parameter on every exported function — see the note in
 * `server/services/config.ts`.
 */

export type Store = typeof schema.stores.$inferSelect;
export type IngredientStore = typeof schema.ingredientStores.$inferSelect;

export interface StoreInput {
  name: string;
  notes?: string | null;
  primary?: boolean;
}

export interface IngredientStoreInput {
  name: string;
  storeId: string;
  only?: boolean;
}

export class StoreNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`No store named ${id}`);
  }
}

export class StoreExistsError extends Error {
  constructor(readonly id: string) {
    super(`A store named ${id} already exists`);
  }
}

export class IngredientStoreNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`No store is set for ${id}`);
  }
}

export class UnknownStoreError extends Error {
  constructor(readonly id: string) {
    super(`No store named ${id} — create it with POST /stores first`);
  }
}

/** The id a store or an ingredient rule gets from its name. */
export function storeId(name: string) {
  return slug(name);
}

/** Blank notes are no notes, so the planner is not handed an empty string to interpret. */
function cleanNotes(notes: string | null | undefined) {
  const trimmed = notes?.trim();

  return trimmed ? trimmed : null;
}

function storeScope(householdId: string, id: string) {
  return and(eq(schema.stores.householdId, householdId), eq(schema.stores.id, id));
}

/**
 * Unset the household's primary store, ahead of crowning another.
 *
 * Two rows briefly holding `primary` would violate `stores_one_primary_idx`, so this runs first
 * and in the same transaction as the write that sets the new one.
 */
async function clearPrimary(householdId: string, db: Queryable) {
  await db
    .update(schema.stores)
    .set({ primary: false, updateTime: sql`now()` })
    .where(and(eq(schema.stores.householdId, householdId), eq(schema.stores.primary, true)));
}

/** The primary store first, because that is where most of the list goes; then by name. */
export async function listStores(householdId: string, db: Queryable = defaultDb) {
  return db
    .select()
    .from(schema.stores)
    .where(eq(schema.stores.householdId, householdId))
    .orderBy(desc(schema.stores.primary), asc(schema.stores.name));
}

export async function getStore(householdId: string, id: string, db: Queryable = defaultDb) {
  const [store] = await db.select().from(schema.stores).where(storeScope(householdId, id));

  if (!store) {
    throw new StoreNotFoundError(id);
  }

  return store;
}

export async function createStore(
  householdId: string,
  id: string,
  input: StoreInput,
  db: Database = defaultDb,
) {
  return db.transaction(async (tx) => {
    if (input.primary) {
      await clearPrimary(householdId, tx);
    }

    // Insert-then-check, for the reason `createRecipe` gives.
    const [store] = await tx
      .insert(schema.stores)
      .values({
        householdId,
        id,
        name: input.name.trim(),
        notes: cleanNotes(input.notes),
        primary: input.primary ?? false,
      })
      .onConflictDoNothing({ target: [schema.stores.householdId, schema.stores.id] })
      .returning();

    if (!store) {
      throw new StoreExistsError(id);
    }

    return store;
  });
}

/** Partial update (AIP-134). The id stays what it was created as, so a rename keeps its rules. */
export async function updateStore(
  householdId: string,
  id: string,
  fields: Partial<StoreInput>,
  updateMask: string[],
  db: Database = defaultDb,
) {
  const named = new Set(updateMask);
  const patch: Record<string, unknown> = { updateTime: sql`now()` };

  if (named.has("name") && fields.name !== undefined) {
    patch.name = fields.name.trim();
  }

  if (named.has("notes")) {
    patch.notes = cleanNotes(fields.notes);
  }

  if (named.has("primary")) {
    patch.primary = fields.primary ?? false;
  }

  return db.transaction(async (tx) => {
    // Checked first, so an unknown id does not unset the real primary on its way to a 404.
    await getStore(householdId, id, tx);

    if (patch.primary === true) {
      await clearPrimary(householdId, tx);
    }

    const [store] = await tx
      .update(schema.stores)
      .set(patch)
      .where(storeScope(householdId, id))
      .returning();

    if (!store) {
      throw new StoreNotFoundError(id);
    }

    return store;
  });
}

/**
 * Forget a store, and every rule that sends an ingredient to it.
 *
 * Items on a shopping list that were bound for it are routed again, as a fresh write would route
 * them: to a usual-store rule, else the primary. Hand-added items need this most — a rebuild only
 * touches plan items, so nothing later would move them off a store that no longer exists.
 */
export async function deleteStore(householdId: string, id: string, db: Database = defaultDb) {
  await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(schema.stores)
      .where(storeScope(householdId, id))
      .returning({ id: schema.stores.id });

    if (deleted.length === 0) {
      throw new StoreNotFoundError(id);
    }

    const boundHere = and(
      eq(schema.shoppingListItems.householdId, householdId),
      eq(schema.shoppingListItems.storeId, id),
    );
    const orphans = await tx
      .select({ name: schema.shoppingListItems.name })
      .from(schema.shoppingListItems)
      .where(boundHere);

    // Read after the delete, so the store and the rules that cascaded with it are already gone.
    const routing = await storeRouting(householdId, tx);
    // Grouped by destination: the same name always routes the same way, so this is one update per
    // store rather than one per row across every week's list.
    const namesByStore = new Map<string | null, Set<string>>();

    for (const { name } of orphans) {
      const target = routeToStore(routing, name, null);
      const names = namesByStore.get(target) ?? new Set<string>();

      names.add(name);
      namesByStore.set(target, names);
    }

    for (const [target, names] of namesByStore) {
      await tx
        .update(schema.shoppingListItems)
        .set({ storeId: target, updateTime: sql`now()` })
        .where(and(boundHere, inArray(schema.shoppingListItems.name, [...names])));
    }
  });
}

export async function listIngredientStores(householdId: string, db: Queryable = defaultDb) {
  return db
    .select()
    .from(schema.ingredientStores)
    .where(eq(schema.ingredientStores.householdId, householdId))
    .orderBy(asc(schema.ingredientStores.name));
}

/** Set where an ingredient comes from. Setting it again moves it, rather than adding a second. */
export async function setIngredientStore(
  householdId: string,
  input: IngredientStoreInput,
  db: Database = defaultDb,
) {
  // Looked up rather than left to the foreign key, so the caller hears which store is unknown.
  await getStore(householdId, input.storeId, db);

  const values = {
    householdId,
    id: storeId(input.name),
    name: input.name.trim(),
    storeId: input.storeId,
    only: input.only ?? false,
  };

  const [rule] = await db
    .insert(schema.ingredientStores)
    .values(values)
    .onConflictDoUpdate({
      target: [schema.ingredientStores.householdId, schema.ingredientStores.id],
      set: {
        name: values.name,
        storeId: values.storeId,
        only: values.only,
        updateTime: sql`now()`,
      },
    })
    .returning();

  return rule;
}

export async function deleteIngredientStore(
  householdId: string,
  id: string,
  db: Database = defaultDb,
) {
  const deleted = await db
    .delete(schema.ingredientStores)
    .where(
      and(eq(schema.ingredientStores.householdId, householdId), eq(schema.ingredientStores.id, id)),
    )
    .returning({ id: schema.ingredientStores.id });

  if (deleted.length === 0) {
    throw new IngredientStoreNotFoundError(id);
  }
}

/** Everything `routeToStore` needs, read once per write rather than once per item. */
export interface StoreRouting {
  primary: string | null;
  known: Set<string>;
  rules: Map<string, { storeId: string; only: boolean }>;
}

export async function storeRouting(
  householdId: string,
  db: Queryable = defaultDb,
): Promise<StoreRouting> {
  const [stores, rules] = await Promise.all([
    listStores(householdId, db),
    listIngredientStores(householdId, db),
  ]);

  return {
    primary: stores.find((store) => store.primary)?.id ?? null,
    known: new Set(stores.map((store) => store.id)),
    rules: new Map(rules.map((rule) => [rule.id, { storeId: rule.storeId, only: rule.only }])),
  };
}

/**
 * Which store a shopping list item goes to.
 *
 * The exact, repeatable half of picking a store; the planner supplies the judgment by naming a
 * store per item. In order:
 *
 * 1. An `only` rule for the item's name. The household said it is bought nowhere else, so no
 *    caller overrides it — including a hand-added item that named another shop.
 * 2. The store the caller named.
 * 3. A rule without `only`, for an item the caller did not route.
 * 4. The primary store, so nothing is left without one once the household has set one.
 *
 * A rule is matched on the slug of the item's exact name. Recognising that "whole milk" is the
 * milk Braum's sells is judgment, which is the planner's to make by naming the store itself.
 */
export function routeToStore(
  routing: StoreRouting,
  name: string,
  requested: string | null | undefined,
) {
  if (requested !== null && requested !== undefined && !routing.known.has(requested)) {
    throw new UnknownStoreError(requested);
  }

  const rule = routing.rules.get(storeId(name));

  if (rule?.only) {
    return rule.storeId;
  }

  return requested ?? rule?.storeId ?? routing.primary;
}
