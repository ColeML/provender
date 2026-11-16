# Day Share Links - Ticket Breakdown

## 1. Share a day's plan by a link that opens without a login

- **Type:** Story
- **Summary:** Share a day from `/plan/[date]` as a link anyone can open without logging in, for 3 days
- **Why:** A babysitter gets the day's meals, recipes, and notes without a household login.
- **AC:**
  - "Share" on `/plan/[date]` creates a link at `/d/{token}`, warns that the day's notes are included, and shows the same link again if one is still live
  - The page shows every planned meal that day (main, sides, extras) with ingredients as stored, steps, and notes; no forecast; not indexed by search engines
  - An expired token (3 days after creation) and an unknown token get the same 404; a day cleared after sharing shows "Nothing planned"
  - `day_shares` table and migration, with `"/d"` added to `PUBLIC_PATHS`
  - `server/services/isolation.test.ts` covers two households sharing the same date; the `AGENTS.md` invariant reads "token lookups only"
- **Size:** M
- **Blocks:** none

## 2. Revoke a day link, and share again after it expires

- **Type:** Story
- **Summary:** Turn off a day's link early, and get a new one once the old one has expired or been revoked
- **Why:** You can cut off access when plans change, and share the same day again later.
- **AC:**
  - The day page shows the live link with a "Stop sharing" control; after revoking, the link returns 404
  - Sharing a day whose link expired or was revoked creates a new token, and the old token stays dead
  - Two people sharing the same day at once end up with one live link and no error
  - Revoking a link that is already gone does nothing
- **Size:** S
- **Blocks:** Share a day's plan by a link that opens without a login
