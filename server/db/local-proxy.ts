import "server-only";

import { neonConfig } from "@neondatabase/serverless";

/**
 * Point the driver at a WebSocket proxy in front of a Postgres on this machine.
 *
 * `@neondatabase/serverless` speaks Neon's WebSocket protocol, not plain TCP, so a local Postgres
 * is unreachable without `neondatabase/wsproxy` in front of it — see `docker-compose.yml`. Left
 * unset, which is every deployment, nothing here runs and the driver talks to Neon as before.
 *
 * Returns whether the redirect was applied.
 */
export function useLocalWsProxy(
  proxy: string | undefined = process.env.DATABASE_WS_PROXY,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean {
  if (!proxy) {
    return false;
  }

  // A deployment that reaches this has been handed a variable that would send every query, and
  // the credentials with them, to whatever host it names. Failing to start is the safe answer.
  if (nodeEnv === "production") {
    throw new Error("DATABASE_WS_PROXY is set in production. It is a local-development option.");
  }

  neonConfig.wsProxy = (host, port) => `${proxy}?address=${host}:${port}`;
  neonConfig.useSecureWebSocket = false;
  neonConfig.pipelineTLS = false;
  neonConfig.pipelineConnect = false;

  return true;
}
