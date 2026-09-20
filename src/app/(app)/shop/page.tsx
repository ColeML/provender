import { householdForSession } from "@server/auth/household";
import { isoWeekFor, parseIsoWeek } from "@server/lib/iso-week";
import { currentOrLatestPlan, findPlan } from "@server/services/plans";
import { listItems } from "@server/services/shopping";
import { redirect } from "next/navigation";

import { ShoppingList } from "@/components/shop/shopping-list";
import { loginUrl } from "@/lib/login-url";

import { auth } from "../../../../auth";

/** Live data, and read at request time — see the note on the home page. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Shopping list — Provender" };

export default async function Shop({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const session = await auth();

  if (!session?.user) {
    redirect(await loginUrl());
  }

  const householdId = householdForSession(session);
  const { week } = await searchParams;
  const currentPlanId = isoWeekFor(new Date().toISOString().slice(0, 10));

  // `?week=` is user-editable, so a typo falls back to the default view rather than stranding the
  // reader on a week the nav cannot step out of.
  const asked = week !== undefined && parseIsoWeek(week) !== undefined ? week : undefined;
  const plan =
    asked === undefined
      ? await currentOrLatestPlan(householdId)
      : await findPlan(householdId, asked);

  // A week nobody has planned still names itself, so the nav can step back out of it.
  const planId = asked ?? plan?.id ?? currentPlanId;
  const items = plan ? await listItems(householdId, plan.id) : [];

  return (
    <ShoppingList
      planId={planId}
      atDefault={asked === undefined}
      planned={plan !== undefined && plan !== null}
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
