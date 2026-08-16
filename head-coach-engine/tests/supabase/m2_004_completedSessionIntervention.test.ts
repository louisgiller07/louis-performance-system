import { describe, it, expect } from "vitest";
import {
  mapCompletedSessionIntervention,
  type CompletedSessionInterventionRow,
} from "../../src/supabase/mapping/completedSessionIntervention.js";
import { InvalidTrainingInterventionJsonError } from "../../src/supabase/mapping/parseTrainingIntervention.js";

describe("M2_004 — mapCompletedSessionIntervention", () => {
  it("reconstructs a valid rich intervention exactly", () => {
    const row: CompletedSessionInterventionRow = {
      intervention: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
    };

    const result = mapCompletedSessionIntervention(row);

    expect(result).toEqual({ kind: "DH_PERFORMANCE", load_profile: "HEAVY" });
  });

  it("preserves duration_min, focus, cue and load_profile exactly", () => {
    const row: CompletedSessionInterventionRow = {
      intervention: {
        kind: "STRENGTH_LOWER",
        load_profile: "MODERATE",
        duration_min: 55,
        focus: "posterior chain",
        cue: "brace before pull",
      },
    };

    const result = mapCompletedSessionIntervention(row);

    expect(result).toEqual({
      kind: "STRENGTH_LOWER",
      load_profile: "MODERATE",
      duration_min: 55,
      focus: "posterior chain",
      cue: "brace before pull",
    });
  });

  it("preserves a fixed-load kind with no load_profile", () => {
    const row: CompletedSessionInterventionRow = { intervention: { kind: "RACE_ACTIVITY" } };

    const result = mapCompletedSessionIntervention(row);

    expect(result).toEqual({ kind: "RACE_ACTIVITY" });
  });

  it("rejects an invalid intervention JSON explicitly, instead of falling back", () => {
    const row: CompletedSessionInterventionRow = { intervention: { kind: "NOT_A_REAL_KIND" } };

    expect(() => mapCompletedSessionIntervention(row)).toThrow(InvalidTrainingInterventionJsonError);
  });

  it("rejects a load-variable kind missing load_profile", () => {
    const row: CompletedSessionInterventionRow = { intervention: { kind: "AEROBIC_INTERVALS" } };

    expect(() => mapCompletedSessionIntervention(row)).toThrow(InvalidTrainingInterventionJsonError);
  });

  it("maps a SQL NULL intervention to null", () => {
    const row: CompletedSessionInterventionRow = { intervention: null };

    const result = mapCompletedSessionIntervention(row);

    expect(result).toBeNull();
  });

  it("maps a missing intervention key to null", () => {
    const row: CompletedSessionInterventionRow = {};

    const result = mapCompletedSessionIntervention(row);

    expect(result).toBeNull();
  });

  it("never infers an intervention from main_content — the row shape has no such input", () => {
    // CompletedSessionInterventionRow only exposes `intervention`. A caller
    // cannot pass main_content through this boundary even if the SQL row
    // carries a rich-looking payload there — there is structurally no path
    // for it to leak in.
    const row = {
      main_content: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
    } as CompletedSessionInterventionRow & { main_content: unknown };

    const result = mapCompletedSessionIntervention(row);

    expect(result).toBeNull();
  });

  it("never infers an intervention from session_type — the row shape has no such input", () => {
    // Same structural argument as above, for session_type.
    const row = {
      session_type: "REST",
    } as CompletedSessionInterventionRow & { session_type: string };

    const result = mapCompletedSessionIntervention(row);

    expect(result).toBeNull();
  });
});
