import { describe, expect, it } from "vitest";
import { currentLongitudinalProcessingDate, LONGITUDINAL_PROCESSING_TIMEZONE } from "../../../src/timeline/processingDate.js";

describe("currentLongitudinalProcessingDate", () => {
  it("fixed timezone constant is Europe/Zurich", () => {
    expect(LONGITUDINAL_PROCESSING_TIMEZONE).toBe("Europe/Zurich");
  });

  it("returns YYYY-MM-DD format", () => {
    const result = currentLongitudinalProcessingDate(new Date("2026-06-15T12:00:00Z"));
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("default (no argument) uses the real current clock and returns a valid calendar date", () => {
    const result = currentLongitudinalProcessingDate();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  describe("winter (CET, UTC+1) — no DST", () => {
    it("a UTC instant comfortably within the Zurich day", () => {
      expect(currentLongitudinalProcessingDate(new Date("2026-01-15T12:00:00Z"))).toBe("2026-01-15");
    });

    it("just before the Zurich midnight boundary (UTC 22:59 = Zurich 23:59) stays the SAME day", () => {
      expect(currentLongitudinalProcessingDate(new Date("2026-01-15T22:59:00Z"))).toBe("2026-01-15");
    });

    it("just after the Zurich midnight boundary (UTC 23:01 = Zurich 00:01 next day) rolls to the NEXT day", () => {
      expect(currentLongitudinalProcessingDate(new Date("2026-01-15T23:01:00Z"))).toBe("2026-01-16");
    });
  });

  describe("summer (CEST, UTC+2) — DST active", () => {
    it("a UTC instant comfortably within the Zurich day", () => {
      expect(currentLongitudinalProcessingDate(new Date("2026-07-15T12:00:00Z"))).toBe("2026-07-15");
    });

    it("just before the Zurich midnight boundary (UTC 21:59 = Zurich 23:59) stays the SAME day", () => {
      expect(currentLongitudinalProcessingDate(new Date("2026-07-15T21:59:00Z"))).toBe("2026-07-15");
    });

    it("just after the Zurich midnight boundary (UTC 22:01 = Zurich 00:01 next day) rolls to the NEXT day", () => {
      expect(currentLongitudinalProcessingDate(new Date("2026-07-15T22:01:00Z"))).toBe("2026-07-16");
    });
  });

  describe("DST transitions — 2026 EU rule (spring forward last Sunday of March, fall back last Sunday of October)", () => {
    it("the day before spring-forward (2026-03-28, still CET/UTC+1)", () => {
      expect(currentLongitudinalProcessingDate(new Date("2026-03-28T22:30:00Z"))).toBe("2026-03-28");
    });

    it("the day of spring-forward (2026-03-29, already CEST/UTC+2 by midday)", () => {
      expect(currentLongitudinalProcessingDate(new Date("2026-03-29T10:00:00Z"))).toBe("2026-03-29");
    });

    it("the day before fall-back (2026-10-24, still CEST/UTC+2)", () => {
      expect(currentLongitudinalProcessingDate(new Date("2026-10-24T21:30:00Z"))).toBe("2026-10-24");
    });

    it("the day of fall-back (2026-10-25, already CET/UTC+1 by midday)", () => {
      expect(currentLongitudinalProcessingDate(new Date("2026-10-25T10:00:00Z"))).toBe("2026-10-25");
    });
  });

  it("New Year's Eve UTC-day still reads as the Zurich next-day boundary correctly (year rollover)", () => {
    expect(currentLongitudinalProcessingDate(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
  });
});
