import { createContext } from "@server/trpc/context";
import { appRouter } from "@server/trpc/routers";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

function handler(request: Request) {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: appRouter,
    createContext,
  });
}

export { handler as GET, handler as POST };
