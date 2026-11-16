import "server-only";

import { Agent, interceptors, request } from "undici";

import CHROME_HEADERS from "./chrome-headers.json";

const browser = new Agent().compose(interceptors.decompress());

export interface FetchedPage {
  status: number;
  /** The `location` header, for the caller to follow after checking where it points. */
  location: string | null;
  html: string;
}

/**
 * One request, sent with the headers Chrome sends when you type an address.
 *
 * Not `fetch`: it overwrites `sec-fetch-mode` with `cors`, and a `cors` request for a `document`
 * is a pairing no browser sends. `scripts/parse-page` sends the same file. When Chrome stable
 * moves on, raise the version in `user-agent` and in both `sec-ch-ua` brands, then recompute the
 * `Not…Brand` entry and the brand order, which Chrome derives from the major version.
 */
export async function fetchPage(url: string, signal: AbortSignal): Promise<FetchedPage> {
  const response = await request(url, {
    headers: { ...CHROME_HEADERS, "accept-encoding": "gzip, deflate, br, zstd" },
    dispatcher: browser,
    signal,
  });
  const location = response.headers.location;

  return {
    status: response.statusCode,
    location: typeof location === "string" ? location : null,
    html: await response.body.text(),
  };
}
