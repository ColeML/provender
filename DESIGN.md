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

## The palette

**Illuminated.** A medieval manuscript page: iron-gall ink on vellum, vermilion for what the
scribe wanted you to notice, gold leaf for what mattered most, verdigris for the rest. The name
fits the app — *provender* is the word in Genesis 42:27 for the fodder Joseph's brothers fed their
donkeys, and rubrication is genuinely how a scribe marked the important line in a body of text,
which is the same job a status color does here.

| Token | Light | Dark | Used for |
| ----- | ----- | ---- | -------- |
| `background` | vellum `#F5EEDD` | `#181310` | the page |
| `foreground` | iron gall `#2B2118` | parchment `#EDE3CC` | body text |
| `primary` | iron gall `#2B2118` | pale gold `#E8D9A8` | buttons, a ticked box |
| `muted-foreground` | faded ink `#6E5F49` | `#AB9A7D` | secondary text, quantities |
| `destructive` | vermilion `#8B2E1F` | `#DA6C55` | over budget, a failed write |
| `accent` | verdigris `#1F4E5F` | `#5FA0AF` | a second status, sparingly |
| `ring` | old gold `#9C7B15` | leaf gold `#C9A227` | focus |

Dark mode is the scriptorium at night, not an inverted page: a warm ink-stained ground under
parchment text. Inverting the light ramp yields a blue-grey that fights every warm hue in it.

- **Contrast is checked, not assumed.** Body text clears 4.5:1 on the surface behind it and focus
  rings clear 3:1, both verified before a token lands. Leaf gold is the worked example — it reads
  beautifully and manages only 2.09:1 on vellum, so light mode uses a darker gold and keeps the
  leaf for dark backgrounds.
- **Gold is for one thing per screen.** A page where three elements are gold has none.
- Hairline `border` sits below 3:1 on purpose. It separates rows; it never carries meaning on its
  own, and a control that needs a visible boundary gets `ring` or `muted-foreground`, not `border`.

## Foundation

- **Tailwind CSS 4 + shadcn on Base UI.** Utility classes only — no inline `style`, no custom CSS
  files. Custom CSS is a last resort.
- **Tokens, not palette values.** Every color and radius comes from `src/app/globals.css`. Never
  an arbitrary hex, never a raw `oklch()` outside `globals.css`, and never a stock Tailwind ramp
  (`text-red-600`) where a token says the same thing — a status color has to move with the theme.
- **Every token the components reference is defined.** `bg-input` and `border-destructive` shipped
  in the generated checkbox for a while with no matching token, so Tailwind emitted no rule at all
  and the styles were simply absent. Adding a primitive means checking its classes resolve.
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
