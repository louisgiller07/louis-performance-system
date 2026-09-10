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
      completion_status: "done",
    });

    expect(summary).toEqual({
      date: "2026-08-15",
      intervention: { kind: "STRENGTH_LOWER", load_profile: "HEAVY" },
      completion_status: "done",
    });
  });

  // V0.3_007B — G: a legacy row (intervention NULL) remains excluded
  // regardless of completion_status — no coarse inversion, no fallback,
  // even for a real completion_status value.
  it("returns null when intervention is NULL — no legacy fallback for completed_sessions", () => {
    const summary = mapCompletedSessionRow({
      session_date: "2026-08-15",
      session_type: "STRENGTH_A",
      intervention: null,
      completion_status: "done",
    });

    expect(summary).toBeNull();
  });

  it("returns null when intervention is NULL for a skipped row too (the expected, common real-world shape)", () => {
    const summary = mapCompletedSessionRow({
      session_date: "2026-08-15",
      session_type: "DH_PERFORMANCE",
      intervention: null,
      completion_status: "skipped",
    });

    expect(summary).toBeNull();
  });

  it("propagates an explicit rejection when intervention JSON is invalid", () => {
    expect(() =>
      mapCompletedSessionRow({
        session_date: "2026-08-15",
        session_type: "STRENGTH_A",
        intervention: { kind: "NOT_A_REAL_KIND" },
        completion_status: "done",
      })
    ).toThrow(InvalidTrainingInterventionJsonError);
  });

  it("rejects a row with no session_date", () => {
    expect(() =>
      mapCompletedSessionRow({ session_type: "REST", intervention: { kind: "REST" }, completion_status: "done" })
    ).toThrow(InvalidCompletedSessionRowError);
  });

  // V0.3_007B — completion_status is now required-present and validated.
  it("rejects a row with a missing completion_status", () => {
    expect(() =>
      mapCompletedSessionRow({ session_date: "2026-08-15", session_type: "REST", intervention: { kind: "REST" } })
    ).toThrow(InvalidCompletedSessionRowError);
  });

  it("rejects a row with an unknown completion_status value", () => {
    expect(() =>
      mapCompletedSessionRow({
        session_date: "2026-08-15",
        session_type: "REST",
        intervention: { kind: "REST" },
        completion_status: "not_a_real_status",
      })
    ).toThrow(InvalidCompletedSessionRowError);
  });

  it("passes through each of the 4 canonical completion_status values verbatim", () => {
    for (const status of ["done", "partial", "skipped", "replaced"] as const) {
      const summary = mapCompletedSessionRow({
        session_date: "2026-08-15",
        session_type: "DH_PERFORMANCE",
        intervention: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
        completion_status: status,
      });
      expect(summary?.completion_status).toBe(status);
    }
  });
});
