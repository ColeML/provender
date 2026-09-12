import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

const dir = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  test: {
    // Baseline for tests that exercise getEnv(); override individual values with vi.stubEnv.
    env: {
      DATABASE_URL: "postgresql://provender:provender_dev@localhost:5432/provender",
      AUTH_SECRET: "test-secret",
      AUTH_PASSWORD_HASH: "test-hash",
      PROVENDER_API_TOKEN: "test-token",
    },
    unstubEnvs: true,
    // Sixteen files build a fresh PGlite Postgres and replay every migration in a `beforeEach` —
    // 428ms warm, which blows the default 10s hook timeout on a loaded machine (#128). The same
    // build runs inside one test body, so `testTimeout` needs the same room. 67% of cores measured
    // fastest of the caps tried (8 on a 12-core machine, against a default of cores-1); it is a
    // percentage so that a smaller runner scales with its core count rather than oversubscribing.
    maxWorkers: "67%",
    hookTimeout: 30_000,
    testTimeout: 30_000,
    // Node by default, because most of the suite is services and SQL. A component test opts into
    // a DOM with `// @vitest-environment jsdom` at the top of the file — `environmentMatchGlobs`
    // was removed in Vitest 4 — so a database test never pays for jsdom.
    setupFiles: ["./vitest.setup.ts"],
    // Extends rather than replaces: assigning `exclude` outright drops vitest's own defaults,
    // including **/dist/**.
    exclude: [...configDefaults.exclude, "python/**", ".next/**"],
  },
  resolve: {
    // Mirrors tsconfig `paths`. Anchored regexes rather than bare string prefixes, so a plain "@"
    // alias does not also match scoped package names and rewrite them into src/.
    alias: [
      { find: /^@server\//, replacement: `${dir("./server")}/` },
      { find: /^@\//, replacement: `${dir("./src")}/` },
      // `server-only` throws on import outside a React Server Component, which would make every
      // server module untestable. Next resolves it to an empty stub via the `react-server` export
      // condition; point at that same stub rather than setting the condition globally, which
      // would also change how React resolves and break client-component tests.
      { find: /^server-only$/, replacement: dir("./node_modules/server-only/empty.js") },
    ],
  },
});
