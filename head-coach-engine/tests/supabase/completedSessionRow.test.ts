import { describe, it, expect } from "vitest";
import {
  mapCompletedSessionRow,
  InvalidCompletedSessionRowError,
} from "../../src/supabase/mapping/completedSessionRow.js";
import { InvalidTrainingInterventionJsonError } from "../../src/supabase/mapping/parseTrainingIntervention.js";

describe("M2 read path — mapCompletedSessionRow", () => {
  it("maps a row with a valid rich intervention", () => {
    const summary = mapCompletedSessionRow({
      session_date: "2026-08-15",
      session_type: "STRENGTH_A",
      intervention: { kind: "STRENGTH_LOWER", load_profile: "HEAVY" },
    });

    expect(summary).toEqual({
      date: "2026-08-15",
      intervention: { kind: "STRENGTH_LOWER", load_profile: "HEAVY" },
    });
  });

  it("returns null when intervention is NULL — no legacy fallback for completed_sessions", () => {
    const summary = mapCompletedSessionRow({
      session_date: "2026-08-15",
      session_type: "STRENGTH_A",
      intervention: null,
    });

    expect(summary).toBeNull();
  });

  it("propagates an explicit rejection when intervention JSON is invalid", () => {
    expect(() =>
      mapCompletedSessionRow({
        session_date: "2026-08-15",
        session_type: "STRENGTH_A",
        intervention: { kind: "NOT_A_REAL_KIND" },
      })
    ).toThrow(InvalidTrainingInterventionJsonError);
  });

  it("rejects a row with no session_date", () => {
    expect(() =>
      mapCompletedSessionRow({ session_type: "REST", intervention: { kind: "REST" } })
    ).toThrow(InvalidCompletedSessionRowError);
  });
});
