import { describe, it, expect } from "vitest";
import {
  mapPlannedSessionRow,
  type PlannedSessionRow,
} from "../../src/supabase/mapping/plannedSessionIntervention.js";
import {
  parseTrainingIntervention,
  InvalidTrainingInterventionJsonError,
} from "../../src/supabase/mapping/parseTrainingIntervention.js";
import { invertDbSessionType } from "../../src/supabase/mapping/invertDbSessionType.js";

const AMBIGUOUS_SESSION_TYPES = [
  "STRENGTH_A",
  "STRENGTH_B",
  "AEROBIC_BASE",
  "AEROBIC_INTERVALS",
  "DH_TECHNICAL",
  "DH_PERFORMANCE",
  "RECOVERY",
] as const;

describe("M2_003 — parseTrainingIntervention", () => {
  it("reconstructs a valid load-variable intervention, preserving kind/load_profile precisely", () => {
    const result = parseTrainingIntervention({ kind: "STRENGTH_LOWER", load_profile: "HEAVY" });

    expect(result).toEqual({ kind: "STRENGTH_LOWER", load_profile: "HEAVY" });
  });

  it("preserves optional duration_min/focus/cue exactly", () => {
    const result = parseTrainingIntervention({
      kind: "DH_TECHNICAL",
      load_profile: "MODERATE",
      duration_min: 90,
      focus: "cornering",
      cue: "look ahead",
    });

    expect(result).toEqual({
      kind: "DH_TECHNICAL",
      load_profile: "MODERATE",
      duration_min: 90,
      focus: "cornering",
      cue: "look ahead",
    });
  });

  it("reconstructs a valid fixed-load intervention with no load_profile", () => {
    const result = parseTrainingIntervention({ kind: "REST" });

    expect(result).toEqual({ kind: "REST" });
  });

  it("rejects a JSON value that is not an object", () => {
    expect(() => parseTrainingIntervention("STRENGTH_A")).toThrow(InvalidTrainingInterventionJsonError);
    expect(() => parseTrainingIntervention(null)).toThrow(InvalidTrainingInterventionJsonError);
    expect(() => parseTrainingIntervention(42)).toThrow(InvalidTrainingInterventionJsonError);
  });

  it("rejects an unknown kind", () => {
    expect(() => parseTrainingIntervention({ kind: "NOT_A_REAL_KIND" })).toThrow(
      InvalidTrainingInterventionJsonError
    );
  });

  it("rejects a load-variable kind missing load_profile", () => {
    expect(() => parseTrainingIntervention({ kind: "POWER" })).toThrow(InvalidTrainingInterventionJsonError);
  });

  it("rejects a load-variable kind with an invalid load_profile value", () => {
    expect(() => parseTrainingIntervention({ kind: "GRIP_WORK", load_profile: "EXTREME" })).toThrow(
      InvalidTrainingInterventionJsonError
    );
  });

  it("rejects a fixed-load kind that carries a load_profile", () => {
    expect(() => parseTrainingIntervention({ kind: "REST", load_profile: "LIGHT" })).toThrow(
      InvalidTrainingInterventionJsonError
    );
  });

  it("rejects a wrong-typed optional field instead of coercing it", () => {
    expect(() =>
      parseTrainingIntervention({ kind: "AEROBIC_BASE", load_profile: "LIGHT", duration_min: "60" })
    ).toThrow(InvalidTrainingInterventionJsonError);
  });
});

describe("M2_003 — invertDbSessionType (deterministic partial inversion)", () => {
  it("inverts REST deterministically", () => {
    expect(invertDbSessionType("REST")).toEqual({ kind: "REST" });
  });

  it("inverts BIKE_MAINTENANCE deterministically", () => {
    expect(invertDbSessionType("BIKE_MAINTENANCE")).toEqual({ kind: "BIKE_MAINTENANCE" });
  });

  it("inverts RACE_PREP to RACE_ACTIVITY deterministically", () => {
    expect(invertDbSessionType("RACE_PREP")).toEqual({ kind: "RACE_ACTIVITY" });
  });

  it.each(AMBIGUOUS_SESSION_TYPES)("never fabricates a rich intervention for ambiguous type %s", (type) => {
    expect(invertDbSessionType(type)).toBeNull();
  });
});

describe("M2_003 — mapPlannedSessionRow", () => {
  it("uses the rich intervention JSONB as source of truth when present", () => {
    const row: PlannedSessionRow = {
      session_type: "STRENGTH_A",
      intervention: { kind: "STRENGTH_UPPER", load_profile: "HEAVY" },
      planned_intent: null,
    };

    const result = mapPlannedSessionRow(row);

    expect(result.planned_session).toEqual({ kind: "STRENGTH_UPPER", load_profile: "HEAVY" });
    expect(result.warnings).toEqual([]);
  });

  it("throws explicitly when the intervention JSON is invalid, rather than falling back silently", () => {
    const row: PlannedSessionRow = {
      session_type: "STRENGTH_A",
      intervention: { kind: "NOT_A_REAL_KIND" },
    };

    expect(() => mapPlannedSessionRow(row)).toThrow(InvalidTrainingInterventionJsonError);
  });

  it("falls back to the deterministic inversion for REST when intervention is absent", () => {
    const row: PlannedSessionRow = { session_type: "REST" };

    const result = mapPlannedSessionRow(row);

    expect(result.planned_session).toEqual({ kind: "REST" });
    expect(result.warnings).toEqual([]);
  });

  it("falls back to the deterministic inversion for BIKE_MAINTENANCE when intervention is absent", () => {
    const row: PlannedSessionRow = { session_type: "BIKE_MAINTENANCE", intervention: null };

    const result = mapPlannedSessionRow(row);

    expect(result.planned_session).toEqual({ kind: "BIKE_MAINTENANCE" });
    expect(result.warnings).toEqual([]);
  });

  it("falls back to RACE_ACTIVITY for legacy RACE_PREP when intervention is absent", () => {
    const row: PlannedSessionRow = { session_type: "RACE_PREP" };

    const result = mapPlannedSessionRow(row);

    expect(result.planned_session).toEqual({ kind: "RACE_ACTIVITY" });
    expect(result.warnings).toEqual([]);
  });

  it.each(AMBIGUOUS_SESSION_TYPES)(
    "never fabricates a rich intervention for legacy ambiguous session_type %s — null + warning",
    (type) => {
      const row: PlannedSessionRow = { session_type: type };

      const result = mapPlannedSessionRow(row);

      expect(result.planned_session).toBeNull();
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain(type);
    }
  );

  it("keeps an explicit planned_intent verbatim", () => {
    const row: PlannedSessionRow = {
      session_type: "AEROBIC_BASE",
      planned_intent: "Volume base avant bloc de course, cf plan hebdo",
    };

    const result = mapPlannedSessionRow(row);

    expect(result.planned_intent).toBe("Volume base avant bloc de course, cf plan hebdo");
  });

  it("maps a SQL NULL planned_intent to null, preserving the SQL NULL boundary", () => {
    const row: PlannedSessionRow = { session_type: "REST", planned_intent: null };

    const result = mapPlannedSessionRow(row);

    expect(result.planned_intent).toBeNull();
  });

  it("treats a missing planned_intent key as unknown and returns null", () => {
    const row: PlannedSessionRow = { session_type: "REST" };

    const result = mapPlannedSessionRow(row);

    expect(result.planned_intent).toBeNull();
  });

  it("never infers planned_intent from primary_objective or any other field — the row shape has no such input", () => {
    // PlannedSessionRow only exposes session_type / intervention / planned_intent.
    // A caller cannot pass primary_objective through this boundary even if the
    // SQL row carries one — there is structurally no path for it to leak in.
    const row = {
      session_type: "AEROBIC_BASE",
      planned_intent: null,
      primary_objective: "Base aerobie longue",
    } as PlannedSessionRow & { primary_objective: string };

    const result = mapPlannedSessionRow(row);

    expect(result.planned_intent).toBeNull();
  });
});
