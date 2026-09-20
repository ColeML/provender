import { describe, expect, it } from "vitest";

import {
  isCalendarDate,
  isoWeekFor,
  parseIsoWeek,
  shiftIsoWeek,
  weekDates,
  weeksInYear,
} from "./iso-week";

describe("weekDates", () => {
  it("matches the week v1 is currently planning", () => {
    // The live WeekPlan runs Mon 2026-08-31 to Sun 2026-09-06.
    expect(weekDates({ year: 2026, week: 36 })).toEqual([
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
    ]);
  });

  it("starts on a Monday and runs seven days", () => {
    const dates = weekDates({ year: 2026, week: 1 });

    expect(dates).toHaveLength(7);
    expect(new Date(`${dates[0]}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  it("handles a week that spans a year boundary", () => {
    // 2026-W53 runs into 2027.
    const dates = weekDates({ year: 2026, week: 53 });

    expect(dates[0]).toBe("2026-12-28");
    expect(dates[6]).toBe("2027-01-03");
  });
});

describe("isoWeekFor", () => {
  it.each([
    ["2026-08-31", "2026-W36"],
    ["2026-09-06", "2026-W36"],
    ["2026-09-07", "2026-W37"],
    // January 1st 2027 is a Friday, so it belongs to the last week of 2026.
    ["2027-01-01", "2026-W53"],
    ["2027-01-04", "2027-W01"],
  ])("puts %s in %s", (date, week) => {
    expect(isoWeekFor(date)).toBe(week);
  });

  it("round-trips every day of a week back to that week", () => {
    for (const date of weekDates({ year: 2026, week: 36 })) {
      expect(isoWeekFor(date)).toBe("2026-W36");
    }
  });
});

describe("parseIsoWeek", () => {
  it.each(["2026-W36", "2026-W01", "2026-W53"])("accepts %s", (id) => {
    expect(parseIsoWeek(id)).toBeDefined();
  });

  it.each([
    ["2026-W00", "week zero"],
    ["2026-W54", "beyond any year"],
    ["2027-W53", "beyond that year — 2027 has 52"],
    ["2026-36", "no W"],
    ["26-W36", "two-digit year"],
    ["2026-W3", "unpadded week"],
    ["", "empty"],
  ])("rejects %s (%s)", (id) => {
    expect(parseIsoWeek(id)).toBeUndefined();
  });
});

describe("weeksInYear", () => {
  it.each([
    [2026, 53],
    [2027, 52],
    [2020, 53],
    [2021, 52],
  ])("says %i has %i weeks", (year, weeks) => {
    expect(weeksInYear(year)).toBe(weeks);
  });
});

describe("isCalendarDate", () => {
  it.each(["2026-08-31", "2026-02-28", "2024-02-29"])("accepts %s", (date) => {
    expect(isCalendarDate(date)).toBe(true);
  });

  it.each([
    ["2026-02-30", "February never has 30 days — Date rolls it to March 2nd"],
    ["2026-13-45", "no such month or day"],
    ["2026-02-29", "2026 is not a leap year"],
    ["2026-8-31", "unpadded"],
    ["not-a-date", "not a date at all"],
  ])("rejects %s (%s)", (date) => {
    expect(isCalendarDate(date)).toBe(false);
  });
});

describe("shiftIsoWeek", () => {
  it("steps forward and back within a year", () => {
    expect(shiftIsoWeek("2026-W39", 1)).toBe("2026-W40");
    expect(shiftIsoWeek("2026-W39", -1)).toBe("2026-W38");
  });

  it("pads the week number back to two digits", () => {
    expect(shiftIsoWeek("2026-W10", -1)).toBe("2026-W09");
  });

  it("rolls into the next year past the last week", () => {
    // 2026 starts on a Thursday, so it is a 53-week year.
    expect(weeksInYear(2026)).toBe(53);
    expect(shiftIsoWeek("2026-W53", 1)).toBe("2027-W01");
  });

  it("rolls back into the previous year's last week", () => {
    // 2025 is a 52-week year, so stepping back from its first week lands on 2024-W52.
    expect(shiftIsoWeek("2026-W01", -1)).toBe("2025-W52");
    expect(shiftIsoWeek("2025-W01", -1)).toBe("2024-W52");
  });

  it("agrees with weekDates seven days on", () => {
    const next = shiftIsoWeek("2026-W52", 1)!;

    expect(weekDates(parseIsoWeek(next)!)[0]).toBe("2026-12-28");
  });

  it("returns undefined for an id that is not an ISO week", () => {
    expect(shiftIsoWeek("2026-W99", 1)).toBeUndefined();
    expect(shiftIsoWeek("not-a-week", 1)).toBeUndefined();
  });
});
