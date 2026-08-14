import { describe, it, expect } from "vitest";
import {
  mapDailyCheckinPainCriteria,
  IncompleteCheckinPainCriteriaError,
  type DailyCheckinPainCriteriaRow,
} from "../../src/supabase/mapping/dailyCheckinPainCriteria.js";

describe("M2_001 — mapDailyCheckinPainCriteria", () => {
  it("accepts a row where all three criteria are explicitly true", () => {
    const row: DailyCheckinPainCriteriaRow = {
      pain_traumatic: true,
      pain_function_loss: true,
      pain_getting_worse: true,
    };

    const result = mapDailyCheckinPainCriteria(row);

    expect(result).toEqual({
      pain_traumatic: true,
      pain_function_loss: true,
      pain_getting_worse: true,
    });
  });

  it("accepts a row where all three criteria are explicitly false", () => {
    const row: DailyCheckinPainCriteriaRow = {
      pain_traumatic: false,
      pain_function_loss: false,
      pain_getting_worse: false,
    };

    const result = mapDailyCheckinPainCriteria(row);

    expect(result).toEqual({
      pain_traumatic: false,
      pain_function_loss: false,
      pain_getting_worse: false,
    });
  });

  it("preserves a mixed true/false combination faithfully, field by field", () => {
    const row: DailyCheckinPainCriteriaRow = {
      pain_traumatic: true,
      pain_function_loss: false,
      pain_getting_worse: true,
    };

    const result = mapDailyCheckinPainCriteria(row);

    expect(result.pain_traumatic).toBe(true);
    expect(result.pain_function_loss).toBe(false);
    expect(result.pain_getting_worse).toBe(true);
  });

  it("rejects a current checkin when pain_traumatic alone is NULL", () => {
    const row: DailyCheckinPainCriteriaRow = {
      pain_traumatic: null,
      pain_function_loss: true,
      pain_getting_worse: false,
    };

    expect(() => mapDailyCheckinPainCriteria(row)).toThrow(IncompleteCheckinPainCriteriaError);
  });

  it("rejects a current checkin when pain_traumatic is absent/undefined (missing key)", () => {
    const row: DailyCheckinPainCriteriaRow = {
      pain_function_loss: true,
      pain_getting_worse: false,
      // pain_traumatic intentionally omitted — simulates a missing column/key at runtime.
    };

    expect(() => mapDailyCheckinPainCriteria(row)).toThrow(IncompleteCheckinPainCriteriaError);
  });

  it("rejects a current checkin when a criterion is a non-boolean runtime value", () => {
    const row: DailyCheckinPainCriteriaRow = {
      pain_traumatic: "true",
      pain_function_loss: true,
      pain_getting_worse: false,
    };

    expect(() => mapDailyCheckinPainCriteria(row)).toThrow(IncompleteCheckinPainCriteriaError);
  });

  it("rejects a current checkin when pain_function_loss alone is NULL", () => {
    const row: DailyCheckinPainCriteriaRow = {
      pain_traumatic: false,
      pain_function_loss: null,
      pain_getting_worse: false,
    };

    expect(() => mapDailyCheckinPainCriteria(row)).toThrow(IncompleteCheckinPainCriteriaError);
  });

  it("rejects a current checkin when pain_getting_worse alone is NULL", () => {
    const row: DailyCheckinPainCriteriaRow = {
      pain_traumatic: false,
      pain_function_loss: true,
      pain_getting_worse: null,
    };

    expect(() => mapDailyCheckinPainCriteria(row)).toThrow(IncompleteCheckinPainCriteriaError);
  });

  it("rejects a current checkin when all three criteria are NULL and lists every missing field", () => {
    const row: DailyCheckinPainCriteriaRow = {
      pain_traumatic: null,
      pain_function_loss: null,
      pain_getting_worse: null,
    };

    try {
      mapDailyCheckinPainCriteria(row);
      expect.fail("expected mapDailyCheckinPainCriteria to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(IncompleteCheckinPainCriteriaError);
      const incomplete = error as IncompleteCheckinPainCriteriaError;
      expect(incomplete.missingFields).toEqual([
        "pain_traumatic",
        "pain_function_loss",
        "pain_getting_worse",
      ]);
    }
  });

  it("never coerces NULL to false — a rejected row never reaches the returned value", () => {
    const row: DailyCheckinPainCriteriaRow = {
      pain_traumatic: null,
      pain_function_loss: false,
      pain_getting_worse: false,
    };

    let thrown = false;
    try {
      mapDailyCheckinPainCriteria(row);
    } catch {
      thrown = true;
    }

    expect(thrown).toBe(true);
  });
});
