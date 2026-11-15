# Day Share Links - Overview

A day's plan can be shared as a link that opens without a login and stops working 3 days after it is created. It is for handing the day to a babysitter.

## Design

- **Link target:** a household and a date. Each open reads that date's meals live, so edits made after sharing show up. A day is up to three `plan_days` rows (or none), so the share does not reference them.
- **Table `day_shares`:** `token` (primary key, 32 random bytes, base64url, stored in the clear like `recipe_shares`), `household_id`, `date`, `create_time`, `expire_time` (`create_time` + 3 days). Foreign key to the household with cascade delete. Unique index on `(household_id, date)`: one link per day.
- **Re-sharing:** creating a share deletes an expired or revoked row for that date and inserts a new one in one transaction. A live row is returned again instead.
- **Services (`server/services/day-shares.ts`):** `createDayShare`, `getDayShare`, `deleteDayShare` take `householdId`. `getSharedDay(token)` finds the row by token with `expire_time > now()`, reads the household from that row, then loads `daySlots` and each dish's ingredients.
- **Page `/d/[share_token]`:** not indexed, read at request time. Shows every planned meal that day (main, sides, extras) with ingredients as stored, steps, and the day's notes. No forecast. Expired, revoked, and unknown tokens get the same 404. A day cleared after sharing shows "Nothing planned".
- **Proxy:** `"/d"` added to `PUBLIC_PATHS` in `src/proxy.ts`.
- **Creating a link:** tRPC procedures for create, get and revoke, and a share button on `/plan/[date]` that warns the day's notes are included. No `/v1` endpoint.
- **`AGENTS.md`:** the "only `getSharedRecipe`" invariant becomes "the only household-free lookups are by share token". `server/services/isolation.test.ts` gets a case with two households sharing the same date.

## Decisions

| Question | Settled |
|---|---|
| Live read or snapshot | Live read by date |
| Expiry | 3 days after the link is created |
| Revoke early | Yes |
| Links per day | One live link |
| Content | Every meal, full recipes as stored, notes; no forecast |
| Path | `/d/{token}`, `getSharedDay` alongside `getSharedRecipe` |
| Where to create | Day page button only; no `/v1` endpoint |

Calls made without the user: a cleared day shows "Nothing planned" instead of 404; a link made more than 3 days ahead expires before its day; expired rows are not cleaned up.

## Rejected

- **Snapshot of the day:** edits after sharing would never reach the reader.
- **Nullable columns on `recipe_shares`:** its rules (one per recipe, deleted with the recipe) don't fit a date.
- **Signed URL with no table:** can't be revoked, and the app can't show the same link again.
