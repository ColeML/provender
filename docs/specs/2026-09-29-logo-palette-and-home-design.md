# Move the palette to the logo's teal and gold, then rebuild the home screen as a week calendar

This ships as two pull requests, in order. The first swaps the color tokens for ones sampled from
`scripts/logo.jpg`. The second rebuilds `/` as seven ruled day rows, with today marked in gold. The
home screen depends on the new `accent` token, so the palette has to land first.

## 1. Palette

Teal is primary, gold marks what matters on the screen, and dark mode sits on a teal-black ground
in place of the brown one. Values were sampled from the logo (cream `#F9F0DE`, teal
`#1B444A`–`#26575B`, gold `#AA8348`–`#E1C17A`), then darkened or lifted until they meet WCAG AA.

| Token | Light | Dark | Contrast |
| ----- | ----- | ---- | -------- |
| `background` | `#F9F0DE` | `#0F1C1D` | — |
| `foreground` | `#17302F` | `#EDE3CC` | 12.36 / 13.67 on background |
| `card` | `#FDF8EE` | `#162729` | foreground 13.22 / 12.14 |
| `card-foreground` | `#17302F` | `#EDE3CC` | as foreground |
| `primary` | `#1F4E54` | `#6FB0B0` | 8.15 / 7.07 with its foreground |
| `primary-foreground` | `#F9F0DE` | `#0F1C1D` | — |
| `muted` | `#F0E5CE` | `#1B2E30` | muted-foreground 4.95 / 6.22 on it |
| `muted-foreground` | `#6E5F49` | `#9DB0A8` | 5.46 / 7.65 on background, 5.84 / 6.79 on card |
| `border` | `#E3D6BC` | `#24393B` | 1.27 / 1.43, below 3:1 on purpose |
| `input` | `#E8DCC3` | `#203436` | 1.20 / 1.33 fill; dark foreground 10.25 on it |
| `accent` | `#85642F` | `#E1C17A` | 4.80 / 10.06 on background, 5.14 / 8.93 on card |
| `accent-foreground` | `#F9F0DE` | `#0F1C1D` | — |
| `destructive` | `#8B2E1F` | `#DA6C55` | 7.39 / 5.20 on background, 7.91 / 4.61 on card |
| `destructive-foreground` | `#F9F0DE` | `#0F1C1D` | — |
| `ring` | `#2C5D62` | `#6FB0B0` | 6.51 / 7.07 on background |

- **Gold becomes `accent`, and `ring` becomes teal.** No component uses `accent` today, so it is
  free to take the gold. If the focus ring stayed gold, a focused row would look like the today
  row. This keeps DESIGN.md's rule that gold marks one thing per screen.
- **Light gold is `#85642F`, not the logo's `#AA8348`.** The logo value measures 3.07:1 on the
  cream. That passes for a rule, but not for text, and the darker value keeps `accent` safe for
  both.
- **The wordmark's copper (`#BD8052`) stays out of the UI.** It measures 2.91:1 on the cream, and
  cream with serif and copper is a common generated look.
- `src/app/globals.css` keeps its convention: an `oklch()` value with the source hex and its
  contrast in a comment.
- `src/app/manifest.ts` and the `themeColor` entries in `src/app/layout.tsx` move to the new
  backgrounds, so the phone's status bar matches the page.
- DESIGN.md's palette section is rewritten around the logo. Its "Illuminated" framing and the
  manuscript rules stay.
- Out of scope: re-rendering the app icons. `scripts/render-icons` draws the tile in `#F5EEDD`,
  which is visually indistinguishable from `#F9F0DE` at icon size.

## 2. Home screen

The home screen is a week at a glance, laid out like the calendar page at the front of a Book of
Hours: one ruled line per day.

- **Header:** the "This week" `h1`, then the week as a date range ("Sep 28 – Oct 4") in place of
  `2026-W40`, then the existing items-to-buy link. When the week shown isn't the current one, the
  range is followed by "the most recent week planned", as now.
- **Rows:** Monday through Sunday, always seven. Each row opens with a header line: the full
  weekday on the left and the short date ("Sep 28") in mono on the right. Beneath it, each planned
  meal gets a line with its slot ("breakfast", "lunch", "dinner") in a label column and the main
  dish beside it, in meal order. Slots with nothing planned are left out.
- **Today:** a 3px `accent` rule on the row's left edge. No label; the rule is enough.
- **Past days:** `muted-foreground`, still links.
- **Unplanned dates:** "Nothing planned" in `muted-foreground`, linking to `/plan/[date]`.
- **No plan at all:** the existing empty state is unchanged. The "week exists but no days are
  filled in" message goes away, because that week now shows seven "Nothing planned" rows.

`weekOverview` in `server/services/overview.ts` gains `dates: string[]`, the plan week's seven dates
from `weekDates`, so the page does no date math. Every plan day already falls inside those dates.

"Today" is computed in the browser. Every server path takes the date from UTC, and 7pm Central is
already the next day in UTC, which is dinner time. A small client component renders the rows. It
marks nothing during server render, and marks today and past days after mount.

Accessibility: the today row carries `aria-current="date"`. Tap targets stay at least 44px tall, and
both links in a row keep the focus ring from #122.

## Testing

- `src/app/(app)/home.test.tsx`: seven rows with gaps filled, grouped slots on one date, today and
  past marking under a fake clock, and no today row when the week shown is an earlier one.
- `server/services/overview` test: `dates` holds the plan week's seven dates.
- Existing unit and e2e suites pass.
- Screenshots of `/`, `/shop`, a recipe page, and `/login`, at 390px and desktop width, in light
  and dark. The palette touches every screen, so the other surfaces get a visual check too.

## Open questions

- `isCurrentWeek` also uses UTC, so on Sunday evening the header can switch to "the most recent
  week planned" early. This spec leaves that alone.
