import { householdForSession } from "@server/auth/household";
import { currentOrLatestPlan } from "@server/services/plans";
import { listItems } from "@server/services/shopping";
import { redirect } from "next/navigation";

import { ShoppingList } from "@/components/shop/shopping-list";
import { loginUrl } from "@/lib/login-url";

import { auth } from "../../../../auth";

/** Live data, and read at request time — see the note on the home page. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Shopping list — Provender" };

export default async function Shop() {
  const session = await auth();

  if (!session?.user) {
    redirect(await loginUrl());
  }

  const householdId = householdForSession(session);
  const plan = await currentOrLatestPlan(householdId);
  const items = plan ? await listItems(householdId, plan.id) : [];

  return (
    <ShoppingList
      planId={plan?.id ?? null}
      budgetTarget={
        plan?.budgetTarget === undefined || plan?.budgetTarget === null
          ? null
          : Number(plan.budgetTarget)
      }
      initialItems={items.map((item) => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity === null ? null : Number(item.quantity),
        unit: item.unit,
        category: item.category,
        estCost: item.estCost === null ? null : Number(item.estCost),
        purchased: item.purchased,
        haveAlready: item.haveAlready,
        feedsRecipes: item.feedsRecipes,
      }))}
    />
  );
}
