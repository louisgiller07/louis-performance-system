import { describe, it, expect } from "vitest";
import { isRaceCoachingRelevant, InvalidRaceCalendarStatusError } from "../src/supabase/repositories/raceCalendarRepo.js";

/**
 * V0.3_005B (NAL-007A) — the canonical status/date truth table locked in
 * docs/11_DECISION_LOG.md. Pure logic, no DB — the real end-to-end wiring
 * (SQL fetch -> filter -> RawContext.upcoming_races) is proven separately
 * in tests/supabase/buildRawContext.integration.test.ts against a real
 * local Supabase instance.
 */
describe("V0.3_005B (NAL-007A) — isRaceCoachingRelevant", () => {
  const TODAY = "2026-09-08";

  it.each(["planned", "registered", "confirmed"] as const)(
    "%s is always relevant regardless of dates (A, B, C, K)",
    (status) => {
      expect(isRaceCoachingRelevant(status, "2099-01-01", TODAY)).toBe(true); // future
      expect(isRaceCoachingRelevant(status, TODAY, TODAY)).toBe(true); // in progress
      expect(isRaceCoachingRelevant(status, "2020-01-01", TODAY)).toBe(true); // ended long ago (POST_EVENT window is a separate, later date check)
    }
  );

  it.each(["cancelled", "skipped"] as const)("%s is never relevant regardless of dates (D, E, F, G, L, M)", (status) => {
    expect(isRaceCoachingRelevant(status, "2099-01-01", TODAY)).toBe(false); // would-be PRE_EVENT
    expect(isRaceCoachingRelevant(status, TODAY, TODAY)).toBe(false); // would-be IN_PROGRESS
    expect(isRaceCoachingRelevant(status, "2026-09-07", TODAY)).toBe(false); // would-be POST_EVENT (ended yesterday)
  });

  describe("completed", () => {
    it("H: a future completed race is excluded (would-be PRE_EVENT)", () => {
      expect(isRaceCoachingRelevant("completed", "2099-01-01", TODAY)).toBe(false);
    });

    it("I: a completed race whose end_date is today is excluded (would-be IN_PROGRESS)", () => {
      expect(isRaceCoachingRelevant("completed", TODAY, TODAY)).toBe(false);
    });

    it("J: a completed race that ended yesterday is included (POST_EVENT must remain active)", () => {
      expect(isRaceCoachingRelevant("completed", "2026-09-07", TODAY)).toBe(true);
    });

    it("a completed race that ended long ago is included (still POST_EVENT-eligible by this filter; M1's own 2-day window narrows it further)", () => {
      expect(isRaceCoachingRelevant("completed", "2020-01-01", TODAY)).toBe(true);
    });
  });

  it("throws InvalidRaceCalendarStatusError for a non-string status, never silently treating it as active", () => {
    expect(() => isRaceCoachingRelevant(null, "2026-09-07", TODAY)).toThrow(InvalidRaceCalendarStatusError);
    expect(() => isRaceCoachingRelevant(undefined, "2026-09-07", TODAY)).toThrow(InvalidRaceCalendarStatusError);
  });

  it("throws InvalidRaceCalendarStatusError for an unrecognized string value, never silently treating it as active", () => {
    expect(() => isRaceCoachingRelevant("withdrawn", "2026-09-07", TODAY)).toThrow(InvalidRaceCalendarStatusError);
  });
});
