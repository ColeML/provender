# Logo Palette and Home Week Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the color tokens to the logo's teal and gold, then rebuild `/` as seven ruled day rows with today marked in gold.

**Architecture:** Two pull requests. PR 1 changes only tokens (`src/app/globals.css`), the status-bar colors, and DESIGN.md. PR 2 adds `dates` to `weekOverview`, and moves the home rows into a client component that works out "today" in the browser with `useSyncExternalStore`. The server renders the rows unmarked, and the client marks them.

**Tech Stack:** Next.js (App Router, Server Components), Tailwind CSS 4, React 19, Vitest + Testing Library (jsdom), PGlite test databases.

**Spec:** `docs/specs/2026-09-29-logo-palette-and-home-design.md`

## Global Constraints

- Colors come only from tokens in `src/app/globals.css`. Never a raw hex or a stock Tailwind ramp in a component (DESIGN.md).
- `globals.css` convention: an `oklch()` value, then the source hex in a comment.
- Gold (`accent`) marks one thing per screen: today's row.
- Tap targets at least 44px (`min-h-11`), and both links in a row keep the focus ring from #122.
- All logic lives in `server/services/*`. Pages and components are thin callers (AGENTS.md).
- Comments: none by default. Only a non-obvious why earns one, one or two lines (CLAUDE.md).
- American English in all prose and comments.
- Branches follow the repo convention: `feat/logo-palette`, then `feat/home-week-calendar` cut from it.
- Invoke `cml:git-workflow` before writing any commit message or PR.

## Review Focus

1. **Evening in the US.** At 8pm Central the UTC date is already tomorrow. Today must still be the browser's local date. Pinned in Task 3 with `TZ=America/Chicago`.
2. **A date with a lunch and no dinner.** It shows the lunch, not "Nothing planned". Pinned in Task 3.
3. **Hydration.** The server snapshot is `null`, so the first client render matches the server HTML. Checked in Task 4 as zero hydration errors in the browser console.
4. **A week crossing the year.** 2026-W53 reads "Dec 28 – Jan 3". Pinned in Task 3.
5. **A long title at 390px** ("Instant Pot Teriyaki Chicken and Rice") wraps inside its column without pushing the date column. Checked in Task 4's screenshot.

---

## PR 1 — `feat/logo-palette`

### Task 1: Swap the tokens, the status-bar colors, and DESIGN.md

**Files:**
- Modify: `src/app/globals.css:6-63` (the header comment, `:root`, and `.dark`)
- Modify: `src/app/layout.tsx:35-36`
- Modify: `src/app/manifest.ts:10-11`
- Modify: `DESIGN.md` (the "The palette" section)

**Interfaces:**
- Produces: `accent` is now gold (light `#85642F`, dark `#E1C17A`), and `ring` is teal. Task 3 uses `border-l-accent` and `text-accent`.

- [ ] **Step 1: Branch**

```bash
git checkout main && git pull --ff-only origin main && git checkout -b feat/logo-palette
```

- [ ] **Step 2: Replace the `:root` and `.dark` blocks in `src/app/globals.css`**

Replace everything from the `/** The Illuminated palette.` comment through the closing `}` of `.dark` with:

```css
/**
 * The Illuminated palette, drawn from the logo. See DESIGN.md for the provenance and the rules.
 *
 * Every value is checked for WCAG contrast against the surface it sits on, and the hex it came
 * from is kept in a comment so the next person can re-check the arithmetic rather than trust it.
 */
:root {
  --radius: 0.625rem;

  --background: oklch(0.957 0.026 84.6); /* #F9F0DE the logo's cream */
  --foreground: oklch(0.289 0.031 192.2); /* #17302F teal-black ink, 12.36:1 */
  --card: oklch(0.98 0.014 84.6); /* #FDF8EE */
  --card-foreground: oklch(0.289 0.031 192.2); /* #17302F, 13.22:1 */
  --primary: oklch(0.394 0.052 206.6); /* #1F4E54 the logo's teal, 8.15:1 with its foreground */
  --primary-foreground: oklch(0.957 0.026 84.6); /* #F9F0DE */
  --muted: oklch(0.925 0.033 85.5); /* #F0E5CE */
  --muted-foreground: oklch(0.494 0.038 77.2); /* #6E5F49 faded ink, 5.46:1, 4.95:1 on muted */
  --border: oklch(0.88 0.038 84.6); /* #E3D6BC */
  --input: oklch(0.898 0.036 85.4); /* #E8DCC3 */

  /**
   * The logo's gold, darkened. Its own #AA8348 reaches 3.07:1 on the cream, enough for a rule but
   * not for the "Today" label beside it. This is 4.80:1 on the page and 5.14:1 on a card.
   */
  --accent: oklch(0.526 0.082 77.1); /* #85642F */
  --accent-foreground: oklch(0.957 0.026 84.6); /* #F9F0DE */
  --destructive: oklch(0.437 0.13 31.7); /* #8B2E1F vermilion, 7.39:1 */
  --destructive-foreground: oklch(0.957 0.026 84.6); /* #F9F0DE */

  /** Teal, not gold, so a focused row never reads as today's. 6.51:1 on the page. */
  --ring: oklch(0.446 0.053 204.2); /* #2C5D62 */
}

/**
 * The logo's teal at night: a teal-black ground under parchment text. `primary` lifts to a pale
 * teal because a dark surface needs its buttons light, which is also shadcn's convention.
 */
.dark {
  --background: oklch(0.215 0.018 202); /* #0F1C1D */
  --foreground: oklch(0.918 0.032 87.3); /* #EDE3CC parchment, 13.67:1 */
  --card: oklch(0.259 0.023 205.2); /* #162729 */
  --card-foreground: oklch(0.918 0.032 87.3); /* #EDE3CC, 12.14:1 */
  --primary: oklch(0.714 0.066 195.8); /* #6FB0B0, 7.07:1 with its foreground */
  --primary-foreground: oklch(0.215 0.018 202); /* #0F1C1D */
  --muted: oklch(0.286 0.025 204.3); /* #1B2E30 */
  --muted-foreground: oklch(0.74 0.024 168.5); /* #9DB0A8, 7.65:1, 6.22:1 on muted */
  --border: oklch(0.328 0.027 203.5); /* #24393B */
  --input: oklch(0.309 0.026 203.8); /* #203436 */
  --accent: oklch(0.823 0.097 86.1); /* #E1C17A the logo's light gold, 10.06:1 */
  --accent-foreground: oklch(0.215 0.018 202); /* #0F1C1D */
  --destructive: oklch(0.656 0.143 33.2); /* #DA6C55 vermilion, lifted, 5.20:1 */
  --destructive-foreground: oklch(0.215 0.018 202); /* #0F1C1D */
  --ring: oklch(0.714 0.066 195.8); /* #6FB0B0 */
}
```

- [ ] **Step 3: Check every pair's contrast**

Save this as `cr.mjs` in the session scratchpad:

```js
const L = (h) => {
  const c = [1, 3, 5]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const cr = (a, b) => {
  const [x, y] = [L(a), L(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
let failed = false;
for (const p of process.argv.slice(2)) {
  const [a, b, min] = p.split(":");
  const r = cr(a, b);
  const ok = r >= Number(min);
  failed ||= !ok;
  console.log(ok ? "ok  " : "FAIL", p, r.toFixed(2));
}
process.exit(failed ? 1 : 0);
```

Run:

```bash
node "$SCRATCHPAD/cr.mjs" \
  "#17302F:#F9F0DE:4.5" "#17302F:#FDF8EE:4.5" "#F9F0DE:#1F4E54:4.5" "#6E5F49:#F9F0DE:4.5" \
  "#6E5F49:#FDF8EE:4.5" "#6E5F49:#F0E5CE:4.5" "#85642F:#F9F0DE:4.5" "#85642F:#FDF8EE:4.5" \
  "#8B2E1F:#F9F0DE:4.5" "#2C5D62:#F9F0DE:3" \
  "#EDE3CC:#0F1C1D:4.5" "#EDE3CC:#162729:4.5" "#0F1C1D:#6FB0B0:4.5" "#9DB0A8:#0F1C1D:4.5" \
  "#9DB0A8:#162729:4.5" "#9DB0A8:#1B2E30:4.5" "#E1C17A:#0F1C1D:4.5" "#E1C17A:#162729:4.5" \
  "#DA6C55:#0F1C1D:4.5" "#DA6C55:#162729:4.5" "#6FB0B0:#0F1C1D:3"
```

Expected: every line `ok`, exit 0.

- [ ] **Step 4: Move the status-bar and manifest colors**

`src/app/layout.tsx`:

```tsx
    { media: "(prefers-color-scheme: light)", color: "#F9F0DE" },
    { media: "(prefers-color-scheme: dark)", color: "#0F1C1D" },
```

`src/app/manifest.ts`:

```ts
    background_color: "#F9F0DE",
    theme_color: "#F9F0DE",
```

- [ ] **Step 5: Rewrite DESIGN.md's palette section**

Replace the section from `## The palette` up to, but not including, `## Foundation` with:

```markdown
## The palette

**Illuminated, in the logo's colors.** A manuscript page: teal-black ink on the logo's cream, its
teal for what you act on, and its gold for the one line the scribe wanted you to notice. The name
fits the app — *provender* is the word in Genesis 42:27 for the fodder Joseph's brothers fed their
donkeys, and rubrication is genuinely how a scribe marked the important line in a body of text,
which is the same job a status color does here.

| Token | Light | Dark | Used for |
| ----- | ----- | ---- | -------- |
| `background` | cream `#F9F0DE` | `#0F1C1D` | the page |
| `foreground` | teal-black `#17302F` | parchment `#EDE3CC` | body text |
| `primary` | teal `#1F4E54` | `#6FB0B0` | buttons, a ticked box |
| `muted-foreground` | faded ink `#6E5F49` | `#9DB0A8` | secondary text, quantities, past days |
| `accent` | gold `#85642F` | `#E1C17A` | the one thing per screen that matters most |
| `destructive` | vermilion `#8B2E1F` | `#DA6C55` | over budget, a failed write |
| `ring` | teal `#2C5D62` | `#6FB0B0` | focus |

Every value is sampled from `scripts/logo.jpg`, then darkened or lifted until it meets AA. Dark
mode is the logo's teal at night: a teal-black ground under parchment text. Inverting the light
ramp would give a flat grey that loses the teal.

- **Contrast is checked, not assumed.** Body text clears 4.5:1 on the surface behind it and focus
  rings clear 3:1, both verified before a token lands. The logo's gold is the worked example: its
  own `#AA8348` manages 3.07:1 on the cream, enough for a rule but not for text, so the token is
  the darker `#85642F`.
- **Gold is for one thing per screen.** A page where three elements are gold has none. That is
  also why the focus ring is teal: a gold ring would make a focused row look like today's.
- **The wordmark's copper stays in the logo.** At 2.91:1 on the cream it fails even as a rule.
- Hairline `border` sits below 3:1 on purpose. It separates rows; it never carries meaning on its
  own, and a control that needs a visible boundary gets `ring` or `muted-foreground`, not `border`.
```

- [ ] **Step 6: Run the static checks and the suite**

```bash
pnpm lint && pnpm fmt:check && pnpm typecheck && pnpm vitest run && pnpm build
```

Expected: all pass. No test asserts a color, so a failure here means a typo in the CSS.

- [ ] **Step 7: Screenshot every surface**

Start the dev server with `preview_start {name: "dev"}` (compose stack up, database migrated). Mint a session with `pnpm tsx scripts/dev-session.ts`, and set the printed cookie in the preview tab with `document.cookie = "<printed value>; path=/"`, then reload. Screenshot `/`, `/shop`, `/recipes`, one `/recipes/[slug]`, and `/login` (in a tab with no cookie) at 390px (`resize_window` 390x844) and desktop, in light and dark (`resize_window colorScheme`). Check: buttons are teal, focus rings are teal (Tab through `/shop`), the `LogoMark` on `/login` still sits on its parchment tile in dark mode, and nothing is gold. Reset with `resize_window preset: "desktop"`.

- [ ] **Step 8: Commit**

```bash
git add src/app/globals.css src/app/layout.tsx src/app/manifest.ts DESIGN.md
git commit -m "feat(design): move the palette to the logo's teal and gold"
```

---

## PR 2 — `feat/home-week-calendar`

### Task 2: `weekOverview` returns the plan week's dates

**Files:**
- Modify: `server/services/overview.ts`
- Test: `server/services/overview.test.ts`

**Interfaces:**
- Produces: `WeekOverview.dates: string[]`, seven `YYYY-MM-DD` strings Monday through Sunday when `planId` is set, `[]` when it is `null`.

- [ ] **Step 1: Branch from the palette branch**

```bash
git checkout feat/logo-palette && git checkout -b feat/home-week-calendar
```

- [ ] **Step 2: Write the failing test**

In `server/services/overview.test.ts`, add `dates: [],` to the `toEqual` in "reports no plan rather than failing when nothing is planned", and add:

```ts
  it("lists the plan week's seven dates, Monday first", async () => {
    await createPlan(H, THIS_WEEK, 120, db);

    expect((await weekOverview(H, db)).dates).toEqual([
      "2026-09-14",
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
    ]);
  });
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run server/services/overview.test.ts`
Expected: FAIL. `dates` is undefined, and the no-plan `toEqual` has an extra key.

- [ ] **Step 4: Implement**

In `server/services/overview.ts`:

```ts
import { isoWeekFor, parseIsoWeek, weekDates } from "@server/lib/iso-week";
```

Add to `WeekOverview`, after `isCurrentWeek`:

```ts
  /** The plan week's seven dates, Monday first, so the screen can show the days nothing is planned. */
  dates: string[];
```

No-plan return:

```ts
    return { planId: null, isCurrentWeek: false, dates: [], days: [], outstandingItems: 0 };
```

In the final return, after `isCurrentWeek`:

```ts
    dates: weekDatesFor(plan.id),
```

and above `weekOverview`:

```ts
function weekDatesFor(planId: string) {
  const week = parseIsoWeek(planId);

  return week === undefined ? [] : weekDates(week);
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm vitest run server/services/overview.test.ts`
Expected: PASS. `src/app/(app)/home.test.tsx` now fails typecheck on its mock missing `dates`; Task 3 fixes that.

- [ ] **Step 6: Commit**

```bash
git add server/services/overview.ts server/services/overview.test.ts
git commit -m "feat(overview): return the plan week's seven dates"
```

### Task 3: The seven-row week, with today marked

**Files:**
- Create: `src/components/home/week-days.tsx`
- Modify: `src/app/(app)/page.tsx`
- Test: `src/app/(app)/home.test.tsx`

**Interfaces:**
- Consumes: `WeekOverview.dates` (Task 2), `OverviewDay` from `@server/services/overview`, the `accent` token (Task 1).
- Produces: `export function WeekDays({ dates, days }: { dates: string[]; days: OverviewDay[] })`.

- [ ] **Step 1: Update the test helper and the tests whose names change**

In `src/app/(app)/home.test.tsx`, add `within` to the Testing Library import. Add below the imports:

```ts
const W37 = [
  "2026-09-07",
  "2026-09-08",
  "2026-09-09",
  "2026-09-10",
  "2026-09-11",
  "2026-09-12",
  "2026-09-13",
];
```

In `renderHome`'s default object, add `dates: W37,` after `isCurrentWeek: false,`. Change `afterEach` to:

```ts
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});
```

In "links every meal to its day, not only the dinner", change the name `"Monday"` to `"Mon 7"`. In "lists each day's main, linked to the recipe", change `screen.getByText("Monday")` to `screen.getByRole("link", { name: "Mon 7" })`.

- [ ] **Step 2: Write the failing tests**

Append inside the `describe`:

```ts
  it("shows the week as a date range", async () => {
    await renderHome({ planId: "2026-W37", isCurrentWeek: true });

    expect(screen.getByText(/Sep 7 – Sep 13/)).toBeInTheDocument();
  });

  it("writes a week that crosses the year with each end's own month", async () => {
    await renderHome({
      planId: "2026-W53",
      isCurrentWeek: true,
      dates: [
        "2026-12-28",
        "2026-12-29",
        "2026-12-30",
        "2026-12-31",
        "2027-01-01",
        "2027-01-02",
        "2027-01-03",
      ],
    });

    expect(screen.getByText(/Dec 28 – Jan 3/)).toBeInTheDocument();
  });

  it("draws all seven days, and offers to plan the empty ones", async () => {
    await renderHome({
      planId: "2026-W37",
      isCurrentWeek: true,
      days: [day({ date: "2026-09-07", mainRecipeId: "ziti", mainTitle: "Ziti" })],
    });

    const empty = screen.getAllByRole("link", { name: "Nothing planned" });

    expect(empty).toHaveLength(6);
    expect(empty[0]).toHaveAttribute("href", "/plan/2026-09-08");
    expect(screen.getByRole("link", { name: "Sun 13" })).toBeInTheDocument();
  });

  it("does not call a day with only a lunch unplanned", async () => {
    await renderHome({
      planId: "2026-W37",
      isCurrentWeek: true,
      days: [day({ date: "2026-09-07", mealSlot: "lunch", mainRecipeId: "soup", mainTitle: "Soup" })],
    });

    const monday = screen.getByRole("link", { name: "Mon 7" }).closest("li");

    expect(monday).not.toBeNull();
    expect(within(monday as HTMLElement).getByRole("link", { name: "Soup" })).toBeInTheDocument();
    expect(within(monday as HTMLElement).queryByText("Nothing planned")).toBeNull();
  });

  it("puts a date's meals in one row", async () => {
    await renderHome({
      planId: "2026-W37",
      isCurrentWeek: true,
      days: [
        day({ date: "2026-09-07", mealSlot: "breakfast", mainRecipeId: "oats", mainTitle: "Oats" }),
        day({ date: "2026-09-07", mealSlot: "dinner", mainRecipeId: "ziti", mainTitle: "Ziti" }),
      ],
    });

    const monday = screen.getByRole("link", { name: "Mon 7" }).closest("li") as HTMLElement;

    expect(within(monday).getByRole("link", { name: "Oats" })).toBeInTheDocument();
    expect(within(monday).getByRole("link", { name: "Ziti" })).toBeInTheDocument();
  });

  it("marks today, and fades the days already past", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-09T12:00:00Z"));

    await renderHome({ planId: "2026-W37", isCurrentWeek: true });

    const row = (name: string) => screen.getByRole("link", { name }).closest("li");

    expect(row("Wed 9")).toHaveAttribute("aria-current", "date");
    expect(within(row("Wed 9") as HTMLElement).getByText("Today")).toBeInTheDocument();
    expect(row("Mon 7")).toHaveClass("text-muted-foreground");
    expect(row("Thu 10")).not.toHaveClass("text-muted-foreground");
  });

  it("keeps today on the local date after UTC has rolled over", async () => {
    vi.stubEnv("TZ", "America/Chicago");
    vi.useFakeTimers({ toFake: ["Date"] });
    // 8pm Wednesday in Chicago, already Thursday in UTC.
    vi.setSystemTime(new Date("2026-09-10T01:00:00Z"));

    await renderHome({ planId: "2026-W37", isCurrentWeek: true });

    expect(screen.getByRole("link", { name: "Wed 9" }).closest("li")).toHaveAttribute(
      "aria-current",
      "date",
    );
  });

  it("marks no day as today when the week shown is an earlier one", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-16T12:00:00Z"));

    await renderHome({ planId: "2026-W37", isCurrentWeek: false });

    expect(screen.queryByText("Today")).toBeNull();
    expect(screen.getByRole("link", { name: "Sun 13" }).closest("li")).toHaveClass(
      "text-muted-foreground",
    );
  });
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm vitest run "src/app/(app)/home.test.tsx"`
Expected: FAIL. No "Mon 7" link, no date range, no "Nothing planned".

- [ ] **Step 4: Create `src/components/home/week-days.tsx`**

```tsx
"use client";

import type { OverviewDay } from "@server/services/overview";
import Link from "next/link";
import { useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const DAY_NUMBER = new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: "UTC" });

const SLOT_LABELS: Record<string, string> = {
  breakfast: "breakfast",
  lunch: "lunch",
  dinner: "dinner",
};

const FOCUS = "focus-visible:ring-ring rounded-sm focus-visible:ring-3 focus-visible:outline-none";

const subscribe = () => () => {};

function localDate() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * The browser's date, not the server's. The server clock is UTC, which is already tomorrow by
 * dinner time in the US. `null` on the server, so the first client render matches its HTML.
 */
function useToday() {
  return useSyncExternalStore(subscribe, localDate, () => null);
}

export function WeekDays({ dates, days }: { dates: string[]; days: OverviewDay[] }) {
  const today = useToday();

  return (
    <ul className="divide-border mt-6 divide-y">
      {dates.map((date) => {
        const meals = days.filter((day) => day.date === date);
        const calendarDay = new Date(`${date}T00:00:00Z`);
        const isToday = date === today;
        const isPast = today !== null && date < today;

        return (
          <li
            key={date}
            aria-current={isToday ? "date" : undefined}
            className={cn(
              "flex items-baseline gap-3 border-l-3 py-3 pl-3",
              isToday ? "border-l-accent" : "border-l-transparent",
              isPast && "text-muted-foreground",
            )}
          >
            <span className="relative flex min-h-11 w-16 shrink-0 flex-col justify-center font-mono text-sm">
              {/* The overlay stretches the link's hit area over the span's full height. */}
              <Link
                href={`/plan/${date}`}
                className="focus-visible:after:ring-ring underline after:absolute after:inset-0 after:rounded-sm focus-visible:outline-none focus-visible:after:ring-3"
              >
                {WEEKDAY.format(calendarDay)} {DAY_NUMBER.format(calendarDay)}
              </Link>
              {isToday ? <span className="text-accent font-sans text-xs">Today</span> : null}
            </span>

            {meals.length === 0 ? (
              <Link href={`/plan/${date}`} className={cn("text-muted-foreground flex min-h-11 flex-1 items-center text-sm", FOCUS)}>
                Nothing planned
              </Link>
            ) : (
              <ul className="min-w-0 flex-1 space-y-1">
                {meals.map((meal) => (
                  <li key={meal.mealSlot} className="flex items-baseline gap-2">
                    {/* Dinner is the default, so only the other meals are named. */}
                    {meal.mealSlot === "dinner" ? null : (
                      <span className="text-muted-foreground shrink-0 text-sm">
                        {SLOT_LABELS[meal.mealSlot] ?? meal.mealSlot}
                      </span>
                    )}
                    {meal.mainRecipeId === null ? (
                      <span className="text-muted-foreground text-sm">
                        {meal.status === "planned" ? "No main" : meal.status}
                      </span>
                    ) : (
                      /* `box-decoration-clone` keeps the ring closed around a title that wraps. */
                      <Link
                        href={`/recipes/${meal.mainRecipeId}`}
                        className={cn("box-decoration-clone text-base", FOCUS)}
                      >
                        {meal.mainTitle ?? meal.mainRecipeId}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 5: Rewrite the plan branch of `src/app/(app)/page.tsx`**

Replace the imports, the constants, and the component body below `export const dynamic` with:

```tsx
import { householdForSession } from "@server/auth/household";
import { weekOverview } from "@server/services/overview";
import Link from "next/link";
import { redirect } from "next/navigation";

import { WeekDays } from "@/components/home/week-days";

import { auth } from "../../../auth";
```

(keep the `dynamic` export and its comment unchanged), then:

```tsx
const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

const formatDay = (date: string) => DAY.format(new Date(`${date}T00:00:00Z`));

export default async function Home() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const { planId, isCurrentWeek, dates, days, outstandingItems } = await weekOverview(
    householdForSession(session),
  );

  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="font-display text-2xl font-semibold">This week</h1>

      {planId === null ? (
        <p className="text-muted-foreground mt-2 text-sm">
          No week is planned yet.{" "}
          <Link href="/plan" className="text-foreground underline">
            Plan one
          </Link>
          .
        </p>
      ) : (
        <>
          <p className="text-muted-foreground mt-1 text-sm">
            {formatDay(dates[0])} – {formatDay(dates[6])}
            {isCurrentWeek ? null : " — the most recent week planned"}
            {outstandingItems > 0 ? (
              <>
                {" · "}
                <Link href="/shop" className="text-foreground underline">
                  {outstandingItems === 1 ? "1 item to buy" : `${outstandingItems} items to buy`}
                </Link>
              </>
            ) : (
              " · nothing left to buy"
            )}
          </p>

          <WeekDays dates={dates} days={days} />
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run "src/app/(app)/home.test.tsx"`
Expected: PASS, all tests, old and new. If the Chicago test fails with Thursday marked, the runtime ignored the `TZ` change. Confirm with `console.log(new Date().getDate())` in the test before touching the component.

- [ ] **Step 7: Run the full checks**

```bash
pnpm lint && pnpm fmt:check && pnpm typecheck && pnpm vitest run && pnpm build
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/home/week-days.tsx "src/app/(app)/page.tsx" "src/app/(app)/home.test.tsx"
git commit -m "feat(home): show the week as seven ruled days, with today marked"
```

### Task 4: Check it in the browser

**Files:** none changed unless a check fails.

- [ ] **Step 1: Seed the current week locally**

Local data only. `PROVENDER_BASE_URL` must be `http://localhost:3000`, or `scripts/prov` writes to production.

```bash
export PROVENDER_BASE_URL=http://localhost:3000
./scripts/prov POST "/recipes?recipeId=home-check-ziti" '{"title":"Baked Ziti","baseServings":6}'
./scripts/prov POST "/recipes?recipeId=home-check-teriyaki" '{"title":"Instant Pot Teriyaki Chicken and Rice","baseServings":6}'
./scripts/prov POST "/plans?planId=2026-W40" '{"budgetTarget":120}'
./scripts/prov PUT /plans/2026-W40/days/2026-09-28 '{"servings":6,"main":"home-check-ziti"}'
./scripts/prov PUT /plans/2026-W40/days/2026-09-30 '{"servings":6,"main":"home-check-teriyaki"}'
```

Adjust the week and dates to the current week if the run date is not in 2026-W40.

- [ ] **Step 2: Screenshot**

Same session setup as Task 1 Step 7. Screenshot `/` at 390px and desktop, light and dark. Confirm: seven rows; the today row has the gold rule and label; earlier rows are muted; the teriyaki title wraps inside its column; "Nothing planned" rows link to `/plan/[date]`. Run `read_console_messages` with `onlyErrors: true` and expect no hydration errors. Tab through the page and confirm each link shows the teal ring. Reset with `resize_window preset: "desktop"`.

- [ ] **Step 3: Remove the seed data**

```bash
./scripts/prov DELETE /plans/2026-W40/days/2026-09-28
./scripts/prov DELETE /plans/2026-W40/days/2026-09-30
```

The two `home-check-*` recipes stay in the local database only. That database is disposable, so leaving them costs nothing.
