# Prep reminders: a push the night before a dish that needs it

Some dishes have to be started the day before: chicken that marinates overnight, beans that
soak, dough that rests in the fridge, overnight oats, a roast that thaws. Today the only place
that lives is the recipe's steps, which nobody reads until they are cooking, and by then it is too
late. Provender should tell the household the evening before: **"Tomorrow is fajitas. Tonight:
marinate the chicken."**

**Status: shaping.** Nothing is built. The decisions below are recommendations; the open questions
at the end need an answer before building.

## Current state

- A recipe's steps are `recipes.instructions` (`text[]`). Nothing marks a step as one that has to
  happen ahead, so "marinate at least 8 hours" sits in step 2 like any other step.
- A day can carry `plan_days.notes`, which the `plan-week` skill fills with the reasoning for the
  day. It could say "marinate Monday night", but the household only sees it if they open that day.
- The app is already an installable PWA: `src/app/manifest.ts` and `public/sw.js`, which handles
  `install`, `activate`, `fetch` and `message`. It has no `push` handler, and nothing in the repo
  sends a push or runs on a schedule. There is no `vercel.json`, so there are no crons.
- Config has a `location` (weather uses it), but no time zone.

## Problem

Knowing a dish needs prep is judgment: reading "marinate overnight" or "refrigerate dough at
least 12 hours" out of free-text steps. Telling someone at the right time is exact and repeatable.
That is this project's split exactly: the agent marks the prep when it saves the recipe, and the
app does the reminding.

## Appetite

Medium: one build. Push delivery is the expensive part (keys, subscriptions, a scheduled sender, a
service worker handler). If it runs long, the in-app "Tonight" card ships alone, since it is useful
without push.

## Solution

### 1. The recipe says what has to happen ahead (agent judgment)

- New column `recipes.prep_ahead text[] not null default '{}'`: one element per task, written as
  an instruction for the night before, e.g. `"Marinate the chicken in the fridge (8–24 hours)."`
- The **`add-recipe` skill** reads the steps and fills it when saving: marinating, brining,
  soaking, overnight chilling or resting, thawing frozen meat, overnight oats or chia, anything the
  steps say needs hours before cooking starts. Most recipes have none, and an empty list is the
  normal case. The skill does not invent prep the steps do not call for.
- Written through the existing recipe create/`PATCH` endpoints, so it appears in
  `/openapi.json` with no new endpoint. The recipe page shows the list under a "Prep ahead"
  heading above the steps, and the household can edit it there like notes.
- A one-time backfill: the agent walks the existing library and proposes `prep_ahead` for the
  recipes that need it, for the household to approve as a list, the way plan-week presents a week.

### 2. The app works out tonight's prep (deterministic)

- `server/services/prep.ts`: `getPrepFor(householdId, date)` returns, for every slot planned on
  `date` (breakfast, lunch and dinner, since overnight oats are breakfast), each linked recipe
  (main, side and extras, since a side can need soaking too) that has `prep_ahead` tasks:
  `{ slot, recipeId, title, tasks }`. Empty if nothing is planned or nothing needs prep.
- Reminders are always for **tomorrow's** dishes, sent **tonight**. One lead time, "the night
  before", covers marinating, soaking, chilling and overnight oats.

### 3. The household sees it in the app

- The home page shows a **"Tonight"** card when tomorrow has prep: the dish, the slot if it is not
  dinner, and the tasks, each linking to its recipe. No card when there is nothing to do. This
  works with no push at all, on every device, and is the fallback if push is never turned on.

### 4. Push, the evening before

- **Web Push** through the service worker, with VAPID keys in the environment
  (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`) and the `web-push` package on the server.
- **Opting in** is a "Prep reminders" switch in Settings. Turning it on asks for notification
  permission and saves the browser's subscription in a new `push_subscriptions` table
  (`household_id`, `endpoint` primary key, keys, `create_time`). Turning it off deletes that
  device's row. Each device opts in on its own; the household gets one push per device.
- **Sending** is a Vercel Cron hitting `GET /api/cron/prep-reminders`, guarded by
  `CRON_SECRET`. For each household with a subscription it calls `getPrepFor(household, tomorrow)`
  and, if non-empty, sends one push per subscription: title "Tonight: prep for tomorrow", body
  "Fajitas: marinate the chicken", and tapping it opens tomorrow's `/plan/[date]`. A `404`/`410`
  from the push service deletes that subscription.
- **One push a night**, however many dishes need prep; the body lists them.
- `public/sw.js` gains `push` (show the notification) and `notificationclick` (focus or open the
  URL) handlers, tested in `src/service-worker.test.ts` like the rest of the worker.

## Rabbit holes

- **The cron is household-free.** The invariants allow household-free lookups only by share token.
  The cron must not query plans or recipes across households. It lists the household ids that
  have a subscription (the one cross-household read, of a table holding no plan data), then calls
  the ordinary household-scoped `getPrepFor` per household. Add the cron to
  `isolation.test.ts` so a second household's prep never reaches the first's devices.
- **Time zone.** "Tonight" and "tomorrow" are the household's, not UTC's. Add a `timezone`
  config setting (IANA, default `America/Chicago`) rather than deriving it from `location`.
- **Vercel cron precision.** On the Hobby plan a cron runs at most once a day and fires anywhere
  within its hour. One fixed daily run (e.g. 6 pm in the household's zone, `0 23 * * *` UTC in
  winter) fits that; a per-household time needs an hourly cron and the Pro plan. Daylight saving
  shifts a fixed UTC schedule by an hour twice a year; acceptable for v1.
- **iOS.** Web Push works on iPhone only for a PWA added to the Home Screen (iOS 16.4+), and the
  permission prompt has to come from a tap. The Settings switch is that tap; if the page is open
  in Safari rather than installed, the switch explains how to install instead of failing silently.
- **A late-planned day.** A day planned after the cron has run for that night gets no push. The
  Tonight card still shows it. Acceptable.

## No-gos

- Lead times other than "the night before" (a turkey that thaws for three days, a 48-hour brine).
  Those go in the day's note.
- Reminders at other times of day ("start the slow cooker at 8 am"), snoozing, or ticking a task
  off.
- Email, SMS, or a calendar (ICS) feed.
- Per-person targeting; a subscription belongs to the household.
- AI at send time. The cron reads stored tasks; it never parses steps.

## Open questions

1. **Push, or the Tonight card first?** Recommended: both in one build, card first so it can ship
   alone. The card is a day of work; push is most of the rest.
2. **What time?** Recommended: one fixed time for the household, 6 pm, the moment dinner is
   being made and the fridge is open. Making it a setting needs an hourly cron (Vercel Pro).
3. **Which Vercel plan is the app on?** Decides whether the send time can be a setting.
4. **Which devices?** If anyone in the household uses an iPhone, they need to add Provender to the
   Home Screen to get pushes. Is that acceptable, or should the calendar feed (a no-go above) come
   back in as the iPhone path?

## Testing

- `prep.test.ts`: tasks from main, side and extras; breakfast slots included; nothing planned
  and nothing to prep both return empty; household isolation.
- Cron route: rejects a missing or wrong `CRON_SECRET`; sends one push per subscription with the
  right body; deletes a subscription on `410`; sends nothing to a household with no prep.
- `sw.js`: `push` shows the payload's title and body; `notificationclick` opens its URL.
- Walked by hand at 375px in light and dark: marking prep on a recipe, the Tonight card, turning
  reminders on in Settings, and a push received by triggering the cron route locally.
