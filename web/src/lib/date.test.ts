import { describe, expect, it, vi, afterEach } from "vitest";
import { addDays, todayLocal } from "./date";

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

afterEach(() => {
  vi.useRealTimers();
});

describe("todayLocal", () => {
  it("rolls over to the next day for a positive-offset timezone near UTC midnight", () => {
    // 2026-08-18T22:30:00Z is already 2026-08-19T00:30 in Europe/Zurich (UTC+2, DST).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-18T22:30:00Z"));

    expect(todayLocal("Europe/Zurich")).toBe("2026-08-19");
  });

  it("stays on the previous day for a negative-offset timezone near UTC midnight", () => {
    // 2026-08-19T02:00:00Z is still 2026-08-18T16:00 in Pacific/Honolulu (UTC-10, no DST).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T02:00:00Z"));

    expect(todayLocal("Pacific/Honolulu")).toBe("2026-08-18");
  });

  it("UTC itself has no rollover at the same instant", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-18T22:30:00Z"));

    expect(todayLocal("UTC")).toBe("2026-08-18");
  });

  it("always returns YYYY-MM-DD", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-05T12:00:00Z"));

    expect(todayLocal("Europe/Zurich")).toMatch(DATE_FORMAT);
    expect(todayLocal("Pacific/Honolulu")).toMatch(DATE_FORMAT);
  });

  it("uses the runtime's default timezone when none is given", () => {
    expect(todayLocal()).toMatch(DATE_FORMAT);
  });
});

describe("addDays", () => {
  it("adds days within the same month", () => {
    expect(addDays("2026-08-01", 6)).toBe("2026-08-07");
  });

  it("rolls over a month boundary", () => {
    expect(addDays("2026-08-28", 6)).toBe("2026-09-03");
  });

  it("rolls over a year boundary", () => {
    expect(addDays("2026-12-28", 6)).toBe("2027-01-03");
  });

  it("rolls over a leap-day boundary (2028 is a leap year)", () => {
    expect(addDays("2028-02-27", 2)).toBe("2028-02-29");
  });

  it("rolls February 28 into March 1 on a non-leap year", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("supports zero days (identity)", () => {
    expect(addDays("2026-08-19", 0)).toBe("2026-08-19");
  });
});
