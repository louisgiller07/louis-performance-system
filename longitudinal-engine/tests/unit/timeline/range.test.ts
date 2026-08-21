import { describe, expect, it } from "vitest";
import { InvalidDateRangeError, materializeDateRange } from "../../../src/timeline/range.js";

describe("materializeDateRange", () => {
  it("materializes a single-day range (fromDate === toDate) as valid", () => {
    const dates = materializeDateRange({ fromDate: "2026-08-10", toDate: "2026-08-10" });
    expect(dates).toEqual(["2026-08-10"]);
  });

  it("materializes a 30-day range with exactly 30 ascending dates", () => {
    const dates = materializeDateRange({ fromDate: "2026-08-01", toDate: "2026-08-30" });
    expect(dates).toHaveLength(30);
    expect(dates[0]).toBe("2026-08-01");
    expect(dates[29]).toBe("2026-08-30");
    expect(dates).toEqual([...dates].sort());
  });

  it("crosses a month boundary correctly", () => {
    const dates = materializeDateRange({ fromDate: "2026-08-30", toDate: "2026-09-02" });
    expect(dates).toEqual(["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"]);
  });

  it("crosses a year boundary correctly", () => {
    const dates = materializeDateRange({ fromDate: "2026-12-30", toDate: "2027-01-02" });
    expect(dates).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  });

  it("includes Feb 29 on a leap year", () => {
    const dates = materializeDateRange({ fromDate: "2028-02-27", toDate: "2028-03-01" });
    expect(dates).toEqual(["2028-02-27", "2028-02-28", "2028-02-29", "2028-03-01"]);
  });

  it("rejects Feb 29 on a non-leap year as an impossible calendar date", () => {
    expect(() => materializeDateRange({ fromDate: "2027-02-29", toDate: "2027-03-01" })).toThrow(InvalidDateRangeError);
  });

  it("rejects a malformed date string", () => {
    expect(() => materializeDateRange({ fromDate: "2026/08/10", toDate: "2026-08-15" })).toThrow(InvalidDateRangeError);
  });

  it("rejects an impossible calendar date (month 13)", () => {
    expect(() => materializeDateRange({ fromDate: "2026-13-01", toDate: "2026-13-05" })).toThrow(InvalidDateRangeError);
  });

  it("rejects an impossible calendar date (Feb 30)", () => {
    expect(() => materializeDateRange({ fromDate: "2026-02-30", toDate: "2026-03-01" })).toThrow(InvalidDateRangeError);
  });

  it("rejects a reversed range (fromDate after toDate)", () => {
    expect(() => materializeDateRange({ fromDate: "2026-08-15", toDate: "2026-08-10" })).toThrow(InvalidDateRangeError);
  });
});
