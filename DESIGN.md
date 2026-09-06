# Provender Design

Visual counterpart to [`coding-standards.md`](coding-standards.md). That file governs how code is
written; this one governs how the app looks and behaves. Read both before building a screen.

Provender is a household meal planner used by two people in three different situations, and the
situation — not the screen size alone — is what the design has to serve.

## The three surfaces

| Surface           | Where it is used                          | What that demands                                   |
| ----------------- | ----------------------------------------- | --------------------------------------------------- |
| `/plan`           | At a desk, once a week, deciding the menu | Dense, scannable, everything visible at once        |
| `/shop`           | One-handed, in a supermarket aisle        | Big targets, high contrast, forgiving of bad signal |
| `/recipes/[slug]` | At the stove, hands wet or full           | Large type, one step at a time, screen stays awake  |

`/plan` is a desktop screen. Below the desktop breakpoint it becomes a **read-only** week summary
that links into recipes — planning is a sit-down activity, and a cramped mobile plan editor would
go unused. `/shop` and `/recipes/[slug]` are phone screens first; on desktop they center in a
single column rather than growing a second layout to maintain.

## Priority order

When a rule below conflicts with something else:

1. **An existing pattern in the file you're editing.** Consistency within a file beats a
   marginally better default.
2. **A design token** (`bg-background`, `text-muted-foreground`, `--radius-lg`) over a raw value.
3. **An existing `src/components/ui/` primitive** over a hand-built equivalent.
4. **This document.**
5. **Upstream shadcn/Base UI defaults**, where Provender hasn't decided yet.

## Foundation

- **Tailwind CSS 4 + shadcn on Base UI.** Utility classes only — no inline `style`, no custom CSS
  files. Custom CSS is a last resort.
- **Tokens, not palette values.** Every color and radius comes from `src/app/globals.css`. Never
  an arbitrary hex, never a raw `oklch()` outside `globals.css`.
- **Dark mode is class-based**, via `next-themes`. Tokens first, `dark:` variants only where a
  token genuinely can't express the difference.
- **Fluid layouts first.** Reach for `md:`/`lg:` only when fluidity can't do the job.

## Component authority

`src/components/ui/` is the canonical set, and it stays small — a primitive is added when a screen
needs one, not speculatively. Generate new ones with the shadcn CLI run inside this repo against
its `components.json` (`pnpm dlx shadcn@latest add <component>`), not pasted from the public docs.
`components.json` pins the `base-luma` style and `neutral` base color, which is where the radius
scale, focus rings, and dark-mode surface treatment come from.

- Leave generated internals as-is. If a new primitive doesn't match an existing one, the CLI/config
  was bypassed — regenerate rather than hand-patch.
- Extend behavior with `class-variance-authority` variants. A component earns a variant when a
  second screen needs the same treatment.
- **Class composition goes through `cn()`** from `src/lib/utils.ts`. Never string-concatenate class
  names inline.

## Typography & icons

- One UI typeface for everything, including headings.
- A monospace face for anything that is data rather than prose: ids, quantities in a settings
  dump, raw JSON.
- **Icons are `lucide-react`, exclusively.** No mixing sets, no inline SVG for something the
  library already has.

## Cooking and shopping specifics

- **Tap targets on `/shop` and the cook view are at least 44px** and span the full row width. A
  checkbox you have to aim at fails in a supermarket.
- **Optimistic updates on anything ticked or toggled.** The store has bad signal; the UI commits
  immediately and reconciles after. A failed write surfaces and reverts — it never silently drops.
- **Quantities render as fractions** (½, ⅔, 1¼) from the stored numeric + unit. Formatting is the
  UI's job; the database stores numbers.
- **The cook view holds a Screen Wake Lock** while it is open and releases it on navigate away.
  Unsupported browsers degrade silently.

## Reject generated-design reflexes

The defaults a model reaches for when asked to "make it look nice", and why they're wrong here:

- Decorative gradients or glassmorphism on chrome that doesn't need visual weight.
- Drop shadows standing in for hierarchy a border or spacing change expresses more clearly.
- Marketing-style card grids for what is a list — a shopping list is rows, not tiles.
- Badges as decoration rather than status. A badge means something changed state.
- Nested cards to imply grouping — use spacing and one border.
- Mixed border radii on one view — pick one step on the scale per surface.
- Emoji in UI copy or empty states.
- Arbitrary one-off spacing (`mt-[13px]`) where a scale step would do.

## Accessibility

- **WCAG AA**, non-negotiable — including the contrast of a shopping list read under supermarket
  lighting.
- **Semantic HTML and real roles**, which is also what makes a component testable by
  `getByRole`. If it can't be found by role or label, accessibility and testing are both already
  broken.
- **Visible focus states** — never suppress a focus ring without an equivalent.
