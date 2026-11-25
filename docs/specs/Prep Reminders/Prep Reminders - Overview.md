# Prep Reminders - Overview

Remind the household the evening before a planned dish that has to be started ahead: chicken that
marinates overnight, beans that soak, dough that chills, overnight oats. **"Tomorrow is fajitas.
Tonight: marinate the chicken."**

The split is the project's usual one. Knowing a dish needs prep is judgment, so the agent marks it
when it saves the recipe. Telling someone at the right time is exact, so the app does it.

## Current state

- Prep-ahead steps are buried in `recipes.instructions` (`text[]`). Nothing marks them.
- A day holds a main, sides and extras in each of breakfast, lunch and dinner (`plan_days`,
  `plan_day_recipes`).
- The home page (`src/app/(app)/page.tsx`, via `weekOverview`) is where a "Tonight" card goes.
- `public/sw.js` handles `install`, `activate`, `fetch` and `message`, but has no `push` handler.
- There is no `vercel.json`, so there are no scheduled jobs. The app is on the Vercel **Hobby** plan: a
  cron runs at most once a day and fires anywhere within its hour.
- `src/proxy.ts` blocks every route except `/login`, `/api/auth`, `/r` and `/d`, plus the JSON
  paths `/v1` and `/api/trpc`.
- `overview.ts` works out "today" in UTC. At 7 pm Central it is already tomorrow in UTC.

## Design

Three parts, each shippable alone.

### 1. Recipes say what has to happen ahead

- `recipes.prep_ahead text[] not null default '{}'`: plain-text tasks written for the night
  before, such as `"Marinate the chicken in the fridge (8–24 hours)."` They use no `{amount|ingredient}`
  braces, so they don't scale.
- Exposed on the existing recipe create, `PATCH` and read schemas, so `/openapi.json` picks it up
  and no endpoint is new.
- The `add-recipe` skill fills it from the steps: marinating, brining, soaking, overnight chilling
  or resting, thawing, overnight oats or chia. An empty list is the normal case, and the skill never
  invents prep the steps don't call for.
- The recipe page shows an editable "Prep ahead" list above the steps, built like
  `recipe-notes.tsx`.
- A one-time agent pass proposes tasks for the existing library, which the household approves as a list.

### 2. The app works out tonight's prep

- A `timezone` config key (IANA, default `America/Chicago`), editable in Settings.
  `householdToday(householdId)` replaces the UTC "today" in `overview.ts`, so the home page and
  the reminder read the same clock.
- `server/services/prep.ts`: `getPrepFor(householdId, date)` returns `{ slot, recipeId, title,
  tasks }[]` for every slot and every main, side and extra planned on `date`.
- The home page shows a **Tonight** card all day whenever tomorrow has prep. Each task links to its
  recipe, and the card names the slot when it isn't dinner.

### 3. Push, the evening before

- Web Push through the service worker. `web-push` on the server, with `VAPID_PUBLIC_KEY`,
  `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` in the environment.
- Table `push_subscriptions`: `endpoint` (primary key), `household_id` (foreign key, cascade), `p256dh`,
  `auth`, `last_sent_on date null`, `create_time`. Subscribing again upserts on `endpoint`.
- A Settings "Prep reminders" switch subscribes or unsubscribes this device through tRPC
  `protectedProcedure` (`push.subscribe`, `push.unsubscribe`, `push.vapidPublicKey`). On iPhone, when
  the app is open in Safari rather than installed to the Home Screen, the switch explains how to
  install it instead.
- `vercel.json` cron `0 0 * * *` hits `GET /api/cron/prep-reminders`. That arrives at 6–7 pm
  Central in winter and 7–8 pm in summer. "Tomorrow" is computed in the household's time zone.
- One push per device per night, listing every dish. Tapping it opens `/plan/[tomorrow]`. No push on a
  night with no prep. A `404`/`410` from the push service deletes the subscription.
- `public/sw.js` gains `push` and `notificationclick` handlers.

### Auth and isolation (second grilling pass)

- **A.** If `CRON_SECRET` is unset, the route fails closed: it returns `500` and sends nothing.
- **B.** `/api/cron` joins `JSON_PATHS` in `src/proxy.ts`. Because it skips the proxy, the route is
  its own boundary: it checks `Authorization: Bearer $CRON_SECRET` with `timingSafeEqual` before
  touching the database, and returns `401` otherwise.
- **C.** `last_sent_on` makes the run idempotent: a repeat run for the same household-local
  tomorrow sends nothing.
- **D.** An upsert on `endpoint` can move a subscription between households. That's acceptable, because an
  endpoint is a hard-to-guess URL only that browser knows, and the household always comes from the session.
- **E.** AGENTS.md's household invariant gains one named exception:
  `listHouseholdsWithPushSubscriptions()`, which returns ids only and is called only by the cron route.
  Everything after it is household-scoped, and `isolation.test.ts` covers it with the two `fajitas`
  households.
- **F.** `sw.js` already calls `skipWaiting` and `clients.claim`, so installed PWAs pick up the new
  handlers on their next load. The switch subscribes only after the new worker is active.
- **G.** Push bodies name the dishes. Web Push encrypts them end to end, so the push service can't read them.

## Decisions

| # | Decision | Settled |
|---|---|---|
| 1 | Order | Three independently shippable parts; push can be cut |
| 2 | Where prep lives | A separate `prep_ahead text[]` column, not a flag on each step or a marker in the step text |
| 3 | Amounts in tasks | Plain text, no braces |
| 4 | Lead time | The night before only; multi-day prep goes in the day's note |
| 5 | Which dishes | Every slot; main, sides and extras |
| 6 | Time zone | A `timezone` config key, also used by `overview.ts` |
| 7 | Card visibility | All day, whenever tomorrow has prep |
| 8 | Send time | One daily Vercel cron at 00:00 UTC (Hobby plan) |
| 9 | Cron auth | Bearer `CRON_SECRET`, timing-safe, fails closed; `/api/cron` in `JSON_PATHS` |
| 10 | Cross-household read | A named invariant exception, returning ids only |
| 11 | Subscriptions | Keyed by `endpoint`, upserted, deleted on 404/410, one push per device per night |
| 12 | iPhone | Home Screen install is acceptable; no calendar feed |
| 13 | Existing recipes | A one-time agent pass, approved as a list |
| 14 | Editing | A "Prep ahead" list on the recipe page, like notes |
| 15 | plan-week | Out of scope for v1 |

## Rejected alternatives

- **A flag on each step, or a marker in the step text.** Changes the shape of `instructions` or its parser everywhere.
- **A reminder lead time stored per task.** No v1 case needs it.
- **An hourly cron with a send time in Settings.** Needs Vercel Pro.
- **GitHub Actions or a scheduled Claude task as the scheduler.** A second place to keep secrets in.
- **A calendar feed or email for iPhone.** Home Screen push is acceptable.
- **Looping over every `households` row.** The same invariant break, with more queries.
- **AI at send time.** The cron only reads stored tasks.

## Assumptions

- Neon runs Postgres 11 or later, so the column default changes only metadata and doesn't rewrite `recipes`.
- Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically.
- Every household is on Central time today, so one cron window works for all of them.

## No-gos

Lead times other than the night before; reminders at other times of day; snoozing or ticking off;
email, SMS or calendar feeds; per-person targeting; AI at send time; plan-week scheduling around
prep nights.
