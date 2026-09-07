# Provender Coding Standards

How code is written here. Its visual counterpart is [`DESIGN.md`](DESIGN.md). Adapted from the
YouVersion Web Chapter standards by way of the Atlas codebase, and tailored to this stack:
Next.js (App Router), React 19 (React Compiler), TypeScript, Tailwind CSS 4 + shadcn/Base UI,
Drizzle, tRPC, Hono, oxlint/oxfmt, Vitest.

Prefer these principles over memorized habits from other projects — when in doubt, match what the
codebase already does.

## Core principles

- **AHA — Avoid Hasty Abstraction.** Prefer duplication over the wrong abstraction. Extract shared
  code once a pattern has proven itself, not before.
- **Readability over cleverness.** Favor explicit-but-verbose over concise-but-implicit.
- **Minimum code that solves the problem.** No speculative features, configurability, or error
  handling for impossible scenarios.
- **Consistency.** All code should look like a single person typed it.

## The architecture rule

**`server/services/*` is the only place logic lives.** Provender has three ways in — a tRPC
procedure, a REST handler, and a Server Component — and all three call the same service function.
Handlers and procedures parse input, call a service, and shape the response. They decide nothing.

This is what makes two transports safe. They cannot disagree about what a recipe is if neither of
them has an opinion. A pull request that puts a business rule in a route handler or a tRPC
procedure is wrong regardless of which transport it is in — move it into a service and call it
from both.

Services take their database handle as a parameter defaulting to the shared client, so a test can
pass a stub without mocking the module graph.

## TypeScript

- Use `interface` for component props (named `Props`); `type` for everything else.
- No `any`. Let inference do the work; add explicit types at boundaries (API shapes, exported
  functions).
- Resolve "possibly undefined" by narrowing (`if (value) { ... }`) or `??` — never by asserting.
- Avoid `as` casts. `as const` is fine; overriding a library's broken types needs a comment saying
  why the cast is safe.
- Prefer `??` over `||` for defaults: `||` swallows `""`, `0`, and `false`.
- Strict equality (`===` / `!==`).

## React

`src/components/ui/` follows upstream shadcn conventions — leave generated files as-is. These
rules govern app code.

- **Function components only**, typed with a local `interface Props`. No `React.FC`; type
  `children: React.ReactNode` explicitly.
- **Function declarations** for components and standalone functions; arrow functions for callbacks.
- **Destructure props in the signature**, not the body.
- **Derive state, don't sync it.** If a value can be computed from existing state or props, compute
  it during render.
- **Avoid `useEffect` unless it is truly external synchronization.** The React Compiler handles
  memoization — don't hand-roll `useMemo`/`useCallback` unless measurement says otherwise.
- **Conditional rendering:** guard clauses over nested ternaries. ~20+ lines of JSX in a branch
  wants to be its own component.
- Fragments instead of style-less wrapper `div`s.
- `async`/`await` with `try`/`catch` over `.then()` chains; batch independent calls with
  `Promise.all`.

## Next.js (App Router)

- **Server-first.** Pages and layouts are Server Components; add `'use client'` only at the leaves
  that need interactivity. A Server Component calls services directly — it does not fetch its own
  HTTP endpoints.
- **A page that reads live data sets `export const dynamic = "force-dynamic"`.** Otherwise Next
  prerenders it at build time, which both freezes the data and makes a reachable database a
  requirement for building.
- **Navigation:** `next/link` for internal routes; plain `<a>` for external URLs.
- **Images:** `next/image`, with `priority` on large above-the-fold images.
- **Dynamic segments are descriptive:** `[recipe_id]`, not `[id]`.
- **Environment variables:** never commit secrets. `NEXT_PUBLIC_` only for values safe in the
  browser. New secrets must be added to Vercel _and_ to `.github/workflows/web.yml` where a job
  needs them, or the deploy breaks.

## The REST API

`/v1` follows Google's API design guide (the AIPs). The full resource list and conventions are in
the Overview note; the rules a handler has to honor:

- `lowerCamelCase` JSON fields (AIP-140); every resource carries `name`, `createTime`,
  `updateTime` (AIP-142).
- Standard methods before custom ones. Custom methods take the `:verb` suffix (AIP-136) and are a
  last resort.
- `PATCH` with `updateMask`, never `PUT` (AIP-134). Create takes a client-assigned id (AIP-133).
- List returns `nextPageToken` and accepts `pageSize`/`pageToken`/`filter`/`orderBy`.
- Errors use the AIP-193 shape via `server/api/errors.ts`. Never return a bare string or Hono's
  default.
- The OpenAPI document at `/v1/openapi.json` is generated from the zod schemas. It is what the
  Claude Code skills read, so a route without a schema is a route they cannot discover.

## Auth

Two credentials, deliberately unrelated:

- **Browsers** sign in with one shared household password (Auth.js Credentials provider, JWT
  session, no adapter and no users table) and carry a session cookie.
- **Claude Code** sends `Authorization: Bearer $PROVENDER_API_TOKEN` to `/v1`. It never gets a
  cookie, and the cookie never authenticates `/v1`.

Enforcement is layered, and `src/proxy.ts` is *not* the security boundary — Next's own guidance is
that Proxy should not be used for session management or authorization. It checks only that a
cookie exists, so an unauthenticated browser lands on the login page instead of an error. The real
checks are `auth()` in Server Components, `protectedProcedure` in tRPC, and the bearer middleware
on `/v1`. **A new page or procedure must do its own check; do not rely on the proxy.**

New procedures use `protectedProcedure`. There is no bare `procedure` export, and `publicProcedure`
is named for what it is, so "I meant this to be public" and "I forgot" look different in a diff.

`/v1/openapi.json` is deliberately public — it describes the API without exposing data, and an
agent needs to discover the surface before it authenticates. Everything else under `/v1` answers
401 before 404, so an unauthenticated caller cannot map which endpoints exist.

## Database

- Migrations are generated (`pnpm db:generate`), never hand-written, and are committed with the
  schema change that produced them.
- A table unreachable from `server/db/schema/index.ts` does not exist as far as migrations are
  concerned.
- Multi-statement writes go in a transaction. This is why the client is the Neon WebSocket driver
  rather than the HTTP one.

## Testing

Philosophy: **test the application the way a user uses it.**

- **Query like a user** (Testing Library priority): `getByRole`, `getByLabelText`, `getByText`.
  Avoid `data-testid` — a last resort, not a default.
- **Use `userEvent`, not `fireEvent`.** `const user = userEvent.setup()` before `render`, and
  `await` every interaction.
- **Always assert the outcome.** Every interaction is followed by an assertion that the DOM or
  system updated.
- Use `queryBy*` for `.not.toBeInTheDocument()`; `findBy*` already asserts presence.
- **Database tests run against PGlite**, a real Postgres in-process, via `createTestDb()` in
  `server/db/testing.ts`. It applies the committed migrations, so a test also fails when a
  migration and the schema disagree. Each test gets its own database, so there is no shared state
  to reset.
- **PGlite is single-connection**, so it cannot exercise two writers racing on a row. If a change
  genuinely needs that, add a Docker-backed suite for those tests specifically rather than moving
  everything off the fast path — `pnpm vitest` needs nothing installed today, locally or in CI,
  and that is worth keeping.
- **Mock the network layer, not implementation details.** For anything that is not the database,
  prefer a stub passed as a parameter over mocking modules.
- Co-locate tests as `*.test.ts(x)`. Name them by outcome (`it('applies sales tax')`).
- **When a test contradicts the code, the code is wrong until proven otherwise.** Don't loosen an
  assertion to make a run go green.

## Verification

Before considering a change done:

```bash
pnpm lint        # oxlint
pnpm fmt:check   # oxfmt
pnpm typecheck   # next typegen && tsc --noEmit
pnpm vitest run  # vitest, once
pnpm build       # catches prerender-time failures the others miss
```

Use `pnpm`, never `npm` or `yarn`.
