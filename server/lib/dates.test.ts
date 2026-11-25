import { describe, expect, it } from "vitest";

import { dateIn, isTimeZone } from "./dates";

// 7:30 pm Tuesday in Chicago, already Wednesday in UTC.
const EVENING = new Date("2026-11-25T01:30:00Z");

describe("dateIn", () => {
  it("reads the calendar date in the zone, not in UTC", () => {
    expect(dateIn("America/Chicago", EVENING)).toBe("2026-11-24");
    expect(dateIn("UTC", EVENING)).toBe("2026-11-25");
  });

  it("pads single-digit months and days", () => {
    expect(dateIn("UTC", new Date("2026-03-04T12:00:00Z"))).toBe("2026-03-04");
  });
});

describe("isTimeZone", () => {
  it.each(["America/Chicago", "UTC", "Europe/London", "Asia/Kolkata"])("accepts %s", (zone) => {
    expect(isTimeZone(zone)).toBe(true);
  });

  it.each(["Central", "America/Nowhere", "CST6CDT/extra", "", "-06:00"])("refuses %j", (zone) => {
    expect(isTimeZone(zone)).toBe(false);
  });
});
