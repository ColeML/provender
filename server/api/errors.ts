import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ZodError } from "zod";

/**
 * The canonical status codes from Google's API design guide (AIP-193), and the HTTP status each
 * maps to. Only the ones this API can actually return are listed — an enum of all sixteen would
 * be a list of codes no handler emits.
 */
const STATUS_CODES = {
  INVALID_ARGUMENT: 400,
  UNAUTHENTICATED: 401,
  PERMISSION_DENIED: 403,
  NOT_FOUND: 404,
  ALREADY_EXISTS: 409,
  FAILED_PRECONDITION: 400,
  INTERNAL: 500,
  UNAVAILABLE: 503,
} as const satisfies Record<string, ContentfulStatusCode>;

export type ApiStatus = keyof typeof STATUS_CODES;

type ErrorDetail = Record<string, unknown>;

export interface ApiErrorBody {
  error: {
    code: number;
    message: string;
    status: ApiStatus;
    details?: ErrorDetail[];
  };
}

function errorBody(status: ApiStatus, message: string, details?: ErrorDetail[]): ApiErrorBody {
  return {
    error: { code: STATUS_CODES[status], message, status, ...(details ? { details } : {}) },
  };
}

export function apiError(c: Context, status: ApiStatus, message: string, details?: ErrorDetail[]) {
  return c.json(errorBody(status, message, details), STATUS_CODES[status]);
}

/**
 * A zod failure as an `INVALID_ARGUMENT` with per-field detail.
 *
 * The `BadRequest` detail type and its `fieldViolations` array are AIP-193's own shape, so a
 * client that already speaks Google APIs can read this without special-casing Provender.
 */
export function validationError(c: Context, error: ZodError) {
  return apiError(c, "INVALID_ARGUMENT", "The request has invalid fields", [
    {
      "@type": "type.googleapis.com/google.rpc.BadRequest",
      fieldViolations: error.issues.map((issue) => ({
        field: issue.path.join("."),
        description: issue.message,
      })),
    },
  ]);
}
