import { neonConfig } from "@neondatabase/serverless";
import { afterEach, describe, expect, it } from "vitest";

import { useLocalWsProxy } from "./local-proxy";

/**
 * Captured once at import, before any test has mutated the singleton.
 *
 * `neonConfig` is process-wide, and `wsProxy` cannot be reset to `undefined` — it has a default of
 * `host => host + "/v2"` that the getter returns for an unset value. Re-reading it per test would
 * capture whatever the previous test left behind, which makes an "unchanged" assertion pass
 * against an already-redirected driver.
 */
const PRISTINE = {
  wsProxy: neonConfig.wsProxy,
  useSecureWebSocket: neonConfig.useSecureWebSocket,
  pipelineTLS: neonConfig.pipelineTLS,
  pipelineConnect: neonConfig.pipelineConnect,
};

afterEach(() => {
  Object.assign(neonConfig, PRISTINE);
});

describe("useLocalWsProxy", () => {
  it("leaves the driver pointed at Neon when no proxy is configured", () => {
    expect(useLocalWsProxy(undefined, "development")).toBe(false);
    expect(neonConfig.wsProxy).toBe(PRISTINE.wsProxy);
    expect(neonConfig.useSecureWebSocket).toBe(PRISTINE.useSecureWebSocket);
  });

  it("routes to the proxy with the address the driver asked for", () => {
    useLocalWsProxy("localhost:5441/v1", "development");

    const wsProxy = neonConfig.wsProxy;

    expect(typeof wsProxy === "function" ? wsProxy("db", 5432) : wsProxy).toBe(
      "localhost:5441/v1?address=db:5432",
    );
  });

  it("drops TLS, because a proxy on this machine serves plain ws", () => {
    useLocalWsProxy("localhost:5441/v1", "development");

    expect(neonConfig.useSecureWebSocket).toBe(false);
  });

  it("refuses to redirect a production deployment away from Neon", () => {
    expect(() => useLocalWsProxy("evil.example.com/v1", "production")).toThrow(/production/);
    expect(neonConfig.wsProxy).toBe(PRISTINE.wsProxy);
    expect(neonConfig.useSecureWebSocket).toBe(PRISTINE.useSecureWebSocket);
  });
});
