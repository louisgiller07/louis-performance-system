import { describe, it, expect } from "vitest";
import { mapDailyCheckinRow, IncompleteDailyCheckinError } from "../../src/supabase/mapping/dailyCheckinRow.js";
import { IncompleteCheckinPainCriteriaError } from "../../src/supabase/mapping/dailyCheckinPainCriteria.js";
import type { DailyCheckinRow } from "../../src/supabase/repositories/dailyCheckinsRepo.js";

function completeRow(overrides: Partial<DailyCheckinRow> = {}): DailyCheckinRow {
  return {
    checkin_date: "2026-08-16",
    sleep_hours: 7.5,
    sleep_quality: 7,
    sleep_wake_ups: 1,
    energy: 6,
    work_stress: 3,
    motivation: 8,
    leg_fatigue: 2,
    grip_fatigue: 2,
    pain: false,
    pain_intensity: null,
    pain_new: false,
    pain_location_code: null,
    pain_traumatic: false,
    pain_function_loss: false,
    pain_getting_worse: false,
    suspected_concussion: false,
    fever_or_illness: false,
    free_comment: null,
    ...overrides,
  };
}

describe("M2 read path — mapDailyCheckinRow", () => {
  it("maps a complete M2 checkin row to a valid DailyCheckin", () => {
    const checkin = mapDailyCheckinRow(completeRow());

    expect(checkin.date).toBe("2026-08-16");
    expect(checkin.sleep_hours).toBe(7.5);
    expect(checkin.pain).toBe(false);
    expect(checkin.pain_new).toBe(false);
    expect(checkin.pain_traumatic).toBe(false);
    expect(checkin.suspected_concussion).toBe(false);
  });

  it("canonical boundary normalization (docs/11_DECISION_LOG.md): pain=false + DB pain_intensity=NULL → M1 pain_intensity=0", () => {
    const checkin = mapDailyCheckinRow(completeRow({ pain: false, pain_intensity: null }));

    expect(checkin.pain_intensity).toBe(0);
  });

  it("requires a real pain_intensity when pain is true", () => {
    const row = completeRow({ pain: true, pain_intensity: 4, pain_new: true });

    const checkin = mapDailyCheckinRow(row);

    expect(checkin.pain).toBe(true);
    expect(checkin.pain_intensity).toBe(4);
  });

  it("confirms pain=true + pain_intensity=NULL remains rejected — the normalization never applies to this case", () => {
    const row = completeRow({ pain: true, pain_intensity: null, pain_new: true });

    expect(() => mapDailyCheckinRow(row)).toThrow(IncompleteDailyCheckinError);
  });

  it("rejects a checkin where pain_new is NULL — never coerced to false", () => {
    const row = completeRow({ pain_new: null });

    expect(() => mapDailyCheckinRow(row)).toThrow(IncompleteDailyCheckinError);
  });

  it("rejects a checkin where a required numeric field (sleep_hours) is missing", () => {
    const row = completeRow({ sleep_hours: null });

    expect(() => mapDailyCheckinRow(row)).toThrow(IncompleteDailyCheckinError);
  });

  it("lists every missing/invalid field in the rejection error", () => {
    const row = completeRow({ sleep_hours: null, energy: null, pain_new: null });

    try {
      mapDailyCheckinRow(row);
      expect.fail("expected mapDailyCheckinRow to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(IncompleteDailyCheckinError);
      const incomplete = error as IncompleteDailyCheckinError;
      expect(incomplete.missingFields).toEqual(expect.arrayContaining(["sleep_hours", "energy", "pain_new"]));
    }
  });

  it("rejects a checkin where one of the three enriched pain criteria (M2_001) is NULL", () => {
    const row = completeRow({ pain_traumatic: null });

    expect(() => mapDailyCheckinRow(row)).toThrow(IncompleteCheckinPainCriteriaError);
  });

  it("keeps pain_location_code and free_comment undefined when NULL, never fabricated", () => {
    const checkin = mapDailyCheckinRow(completeRow({ pain_location_code: null, free_comment: null }));

    expect(checkin.pain_location_code).toBeUndefined();
    expect(checkin.free_comment).toBeUndefined();
  });

  it("passes through pain_location_code and free_comment when present", () => {
    const checkin = mapDailyCheckinRow(
      completeRow({ pain_location_code: "wrist_R", free_comment: "Petite gêne au poignet" })
    );

    expect(checkin.pain_location_code).toBe("wrist_R");
    expect(checkin.free_comment).toBe("Petite gêne au poignet");
  });
});
