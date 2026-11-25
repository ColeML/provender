# Prep Reminders - Ticket Breakdown

## 1. The home page's "today" follows the household's time zone

- **Type:** Story
- **Summary:** Add a household time zone setting and use it for "today" on the home page
- **Why:** After 6–7 pm Central the home page stops jumping to tomorrow, and later slices share the same clock.
- **AC:**
  - A `timezone` config key (IANA name, default `America/Chicago`) can be read and written through `/v1/config` and edited in Settings
  - An invalid zone name is refused with a 400 that names the field; nothing is saved
  - `householdToday(householdId)` in `server/services` replaces the UTC `new Date()` date in `overview.ts`
  - A test pins 2026-11-25T01:30Z: `America/Chicago` gives 2026-11-24 and the current week, and UTC gives 2026-11-25
  - Walked at 375px, light and dark: change the zone in Settings and watch the home page follow
- **Size:** S
- **Blocks:** none

## 2. Mark the prep a recipe needs started the night before

- **Type:** Story
- **Summary:** A recipe carries a "Prep ahead" list that the agent fills when saving it and the household can edit
- **Why:** The prep that hides in step 2 becomes a short, visible list the reminders can read.
- **AC:**
  - Migration adds `recipes.prep_ahead text[] not null default '{}'`; recipe create, `PATCH` and read carry it, and `/openapi.json` shows it
  - The recipe page shows a "Prep ahead" list above the steps when it has tasks, and the household can add, edit and remove tasks the way they edit notes; with no tasks, there's only an "add" control and no empty heading
  - `.claude/skills/add-recipe/SKILL.md` gains a step: fill `prep_ahead` only from what the steps call for (marinate, brine, soak, overnight chill or rest, thaw, overnight oats or chia), leave it empty otherwise, and write plain text with no braces
  - The shared recipe page `/r/{token}` shows the list read-only
  - Walked at 375px, light and dark, with no console errors
- **Size:** M
- **Blocks:** none

## 3. Fill in prep-ahead tasks for the existing recipe library

- **Type:** Task
- **Summary:** The agent proposes prep-ahead tasks for every saved recipe, and the household approves them as a list
- **Why:** Reminders work for the dishes already in rotation, not only for recipes saved from now on.
- **AC:**
  - The agent reads every recipe's steps and presents only the ones it would mark, each with its proposed tasks
  - Only the approved entries are written, through `PATCH /v1/recipes/{id}`; recipes the household rejects or leaves unmentioned are untouched
  - A recipe that already has `prep_ahead` is shown with its current tasks and isn't overwritten without a yes
- **Size:** S
- **Blocks:** Mark the prep a recipe needs started the night before

## 4. Show tonight's prep for tomorrow on the home page

- **Type:** Story
- **Summary:** A "Tonight" card on the home page lists what to start tonight for tomorrow's planned dishes
- **Why:** Anyone who opens the app sees "marinate the chicken" in time, even with no notifications.
- **AC:**
  - `getPrepFor(householdId, date)` in `server/services/prep.ts` returns `{ slot, recipeId, title, tasks }[]` for every slot and every main, side and extra on `date`, in `MEAL_ORDER`
  - The card shows all day when tomorrow (household time) has prep: each dish, its slot when not dinner, and its tasks, linking to the recipe
  - No card when tomorrow is unplanned or nothing planned has prep
  - Tests: tasks from a side and an extra, a breakfast slot, both empty cases, and the two `fajitas` households in `isolation.test.ts` never seeing each other's prep
  - Walked at 375px, light and dark, with no console errors
- **Size:** M
- **Blocks:** The home page's "today" follows the household's time zone; Mark the prep a recipe needs started the night before

## 5. Turn on notifications on a device and get a test push

- **Type:** Story
- **Summary:** A "Prep reminders" switch in Settings subscribes this device to push notifications, with a "Send test" button
- **Why:** Each person's phone is set up and shown to work before any real reminder depends on it.
- **AC:**
  - Migration adds `push_subscriptions` (`endpoint` primary key, `household_id` foreign key with cascade, `p256dh`, `auth`, `last_sent_on date null`, `create_time`); tRPC `push.subscribe` upserts on `endpoint`, `push.unsubscribe` deletes this device's row, `push.vapidPublicKey` serves the key, and all three use `protectedProcedure`
  - Turning the switch on asks for permission from the tap and saves the subscription; turning it off removes it; a denied permission leaves the switch off with a message saying how to allow it
  - On iPhone, when the app is open in Safari rather than installed to the Home Screen, the switch explains how to install it instead of asking for permission
  - `public/sw.js` handles `push` (shows the payload's title and body) and `notificationclick` (focuses an open tab or opens the payload's URL), tested in `src/service-worker.test.ts`
  - "Send test" delivers a push to this device only; a `404`/`410` from the push service deletes the subscription
  - Walked at 375px, light and dark, including a test push received from a local dev server
- **Size:** M
- **Blocks:** none

## 6. Send each device a push the evening before a dish that needs prep

- **Type:** Story
- **Summary:** A nightly scheduled run sends one push per subscribed device listing tomorrow's prep
- **Why:** The household is told at dinner time without having to open the app.
- **AC:**
  - `vercel.json` adds a cron job at `0 0 * * *` that calls `GET /api/cron/prep-reminders`; `/api/cron` joins `JSON_PATHS` in `src/proxy.ts`
  - The route returns `500` and sends nothing when `CRON_SECRET` is unset, and `401` for a missing or wrong bearer token (compared with `timingSafeEqual`), before any database read
  - For each id from `listHouseholdsWithPushSubscriptions()`, it calls `getPrepFor` for the household's local tomorrow and sends one push per device ("Tonight: prep for tomorrow", one line per dish, opening `/plan/[tomorrow]`); a night with no prep sends nothing
  - `last_sent_on` keeps a second run for the same tomorrow from sending again; a `404`/`410` deletes that subscription and the rest still send
  - AGENTS.md's household invariant names `listHouseholdsWithPushSubscriptions()` as its one non-token exception, and `isolation.test.ts` shows one `fajitas` household's devices never receive the other's prep
  - Triggered locally with the secret and walked end to end: a planned dish with prep produces a push on a subscribed phone
- **Size:** M
- **Blocks:** Show tonight's prep for tomorrow on the home page; Turn on notifications on a device and get a test push
