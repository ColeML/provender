import { api } from "@server/api/app";
import { handle } from "hono/vercel";

export const GET = handle(api);
export const POST = handle(api);
export const PATCH = handle(api);
export const DELETE = handle(api);
