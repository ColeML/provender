import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { LOGO_MARK_SIZE } from "./logo-mark";

describe("LOGO_MARK_SIZE", () => {
  // render-icons trims the mark to its content, so a new logo changes the file's size without
  // touching this constant.
  it("matches public/logo-mark.png, so the page reserves the right space", () => {
    const png = readFileSync(join(process.cwd(), "public/logo-mark.png"));

    // A PNG's IHDR chunk carries the width and height as big-endian integers at bytes 16 and 20.
    expect({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) }).toEqual(LOGO_MARK_SIZE);
  });
});
