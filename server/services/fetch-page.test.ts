import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { brotliCompressSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

import CHROME_HEADERS from "./chrome-headers.json";
import { fetchPage } from "./fetch-page";

let close: () => void = () => {};

afterEach(() => close());

async function serve(
  handler: (headers: IncomingHttpHeaders) => {
    status: number;
    headers?: Record<string, string>;
    body?: Buffer | string;
  },
) {
  const received: IncomingHttpHeaders[] = [];
  const server = createServer((req, res) => {
    received.push(req.headers);
    const { status, headers, body } = handler(req.headers);

    res.writeHead(status, headers);
    res.end(body);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  close = () => server.close();

  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, received };
}

describe("chrome-headers.json", () => {
  it("claims one Chrome version everywhere", () => {
    const major = /Chrome\/(\d+)\.0\.0\.0/.exec(CHROME_HEADERS["user-agent"])?.[1];

    expect(major).toBeDefined();
    expect(CHROME_HEADERS["user-agent"]).toContain("Macintosh");
    expect(CHROME_HEADERS["sec-ch-ua"]).toContain(`"Google Chrome";v="${major}"`);
    expect(CHROME_HEADERS["sec-ch-ua"]).toContain(`"Chromium";v="${major}"`);
    expect(CHROME_HEADERS["sec-ch-ua-platform"]).toBe('"macOS"');
  });
});

describe("fetchPage", () => {
  it("sends Chrome's navigation headers unchanged", async () => {
    const { url, received } = await serve(() => ({ status: 200, body: "<html></html>" }));

    await fetchPage(url, AbortSignal.timeout(5_000));

    expect(received[0]).toMatchObject(CHROME_HEADERS);
    expect(received[0]["sec-fetch-mode"]).toBe("navigate");
  });

  it("decodes a compressed page", async () => {
    const { url } = await serve(() => ({
      status: 200,
      headers: { "content-encoding": "br" },
      body: brotliCompressSync("<html>muffins</html>"),
    }));

    await expect(fetchPage(url, AbortSignal.timeout(5_000))).resolves.toMatchObject({
      status: 200,
      html: "<html>muffins</html>",
    });
  });

  it("hands a redirect back instead of following it", async () => {
    const { url, received } = await serve(() => ({
      status: 301,
      headers: { location: "http://169.254.169.254/" },
    }));

    await expect(fetchPage(url, AbortSignal.timeout(5_000))).resolves.toMatchObject({
      status: 301,
      location: "http://169.254.169.254/",
    });
    expect(received).toHaveLength(1);
  });
});
