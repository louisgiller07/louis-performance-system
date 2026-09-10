/**
 * Pure unit tests for supabase/functions/completed-session/validation.ts.
 * No Docker, no Deno, no network — validation.ts is deliberately portable
 * plain TypeScript (see its own module doc), so vitest can import it
 * directly via a relative path even though it physically lives under
 * supabase/functions/**.
 */
import { describe, expect, it } from "vitest";
import {
  validateCompletedSessionBody,
  validateDateParam,
  PERFORMED_FIXED_LOAD_KINDS,
} from "../../../../supabase/functions/completed-session/validation.js";

// V0.3_007B — `intervention` is now the ONE athlete-authored fact for a
// performed session: required (non-null) for done/partial/replaced, and
// `session_type` must always be exactly its derived coarse projection (see
// validation.ts's own mapTrainingInterventionToSessionType). RECOVERY_ACTIVE
// is a fixed-load kind (no load_profile), deriving to RECOVERY — matches
// this fixture's session_type.
const VALID_DONE = {
  session_date: "2026-08-12",
  decision_id: null,
  session_type: "RECOVERY",
  completion_status: "done",
  actual_duration_min: 42,
  rpe: 7,
  post_leg_fatigue: 4,
  post_grip_fatigue: 3,
  new_pain: false,
  new_pain_note: null,
  intervention: { kind: "RECOVERY_ACTIVE" },
  main_content: null,
};

describe("validateCompletedSessionBody — shape", () => {
  it("accepts a fully valid 'done' body", () => {
    const result = validateCompletedSessionBody(VALID_DONE);
    expect(result.ok).toBe(true);
  });

  it("rejects a non-object body", () => {
    const result = validateCompletedSessionBody("nope");
    expect(result).toEqual({ ok: false, error: { code: "invalid_body", message: expect.any(String) } });
  });

  it("rejects an array body", () => {
    const result = validateCompletedSessionBody([1, 2, 3]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_body");
  });

  it("rejects a body missing a canonical key", () => {
    const { new_pain_note: _drop, ...incomplete } = VALID_DONE;
    const result = validateCompletedSessionBody(incomplete);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_body");
  });

  it("rejects an unknown field", () => {
    const result = validateCompletedSessionBody({ ...VALID_DONE, whatever: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unknown_field");
  });

  it("rejects free_notes as an unknown field — not part of the M5_003 client contract", () => {
    const result = validateCompletedSessionBody({ ...VALID_DONE, free_notes: "hello" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unknown_field");
  });

  for (const forbidden of ["athlete_id", "session_load", "planned_session_id", "id", "created_at", "updated_at", "submitted_at"]) {
    it(`rejects forbidden field '${forbidden}' with forbidden_field, not unknown_field`, () => {
      const result = validateCompletedSessionBody({ ...VALID_DONE, [forbidden]: "x" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("forbidden_field");
    });
  }

  it("classifies a body with BOTH a forbidden field and an unknown field as forbidden_field (forbidden detection runs first)", () => {
    const result = validateCompletedSessionBody({ ...VALID_DONE, athlete_id: "x", whatever: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("forbidden_field");
  });
});

describe("validateCompletedSessionBody — session_date / decision_id / enums", () => {
  it("rejects an invalid session_date format", () => {
    const result = validateCompletedSessionBody({ ...VALID_DONE, session_date: "12-08-2026" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_date_format");
  });

  it("rejects an impossible calendar date", () => {
    const result = validateCompletedSessionBody({ ...VALID_DONE, session_date: "2026-02-30" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_date_format");
  });

  it("accepts decision_id null", () => {
    const result = validateCompletedSessionBody({ ...VALID_DONE, decision_id: null });
    expect(result.ok).toBe(true);
  });

  it("accepts a well-formed UUID decision_id", () => {
    const result = validateCompletedSessionBody({ ...VALID_DONE, decision_id: "11111111-1111-1111-1111-111111111111" });
    expect(result.ok).toBe(true);
  });

  it("rejects a non-UUID decision_id string", () => {
    const result = validateCompletedSessionBody({ ...VALID_DONE, decision_id: "not-a-uuid" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_body");
  });

  it("rejects an invalid session_type", () => {
    const result = validateCompletedSessionBody({ ...VALID_DONE, session_type: "YOGA" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_enum");
  });

  it("rejects an invalid completion_status", () => {
    const result = validateCompletedSessionBody({ ...VALID_DONE, completion_status: "finished" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_enum");
  });

  it("rejects a non-object intervention", () => {
    const result = validateCompletedSessionBody({ ...VALID_DONE, intervention: "not an object" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_intervention");
  });
});

describe("validateCompletedSessionBody — status-dependent numeric matrix", () => {
  for (const status of ["done", "partial", "replaced"] as const) {
    describe(`completion_status = ${status}`, () => {
      it("accepts full valid numeric fields", () => {
        const result = validateCompletedSessionBody({ ...VALID_DONE, completion_status: status });
        expect(result.ok).toBe(true);
      });

      it("rejects actual_duration_min = null", () => {
        const result = validateCompletedSessionBody({ ...VALID_DONE, completion_status: status, actual_duration_min: null });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("invalid_body_for_status");
      });

      it("rejects actual_duration_min = 0 (must be > 0)", () => {
        const result = validateCompletedSessionBody({ ...VALID_DONE, completion_status: status, actual_duration_min: 0 });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("invalid_range");
      });

      it("rejects rpe = null", () => {
        const result = validateCompletedSessionBody({ ...VALID_DONE, completion_status: status, rpe: null });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("invalid_body_for_status");
      });

      it("rejects rpe = 11 (out of 0..10)", () => {
        const result = validateCompletedSessionBody({ ...VALID_DONE, completion_status: status, rpe: 11 });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("invalid_range");
      });

      it("rejects post_leg_fatigue = null", () => {
        const result = validateCompletedSessionBody({ ...VALID_DONE, completion_status: status, post_leg_fatigue: null });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("invalid_body_for_status");
      });

      it("rejects post_grip_fatigue = -1 (out of 0..10)", () => {
        const result = validateCompletedSessionBody({ ...VALID_DONE, completion_status: status, post_grip_fatigue: -1 });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("invalid_range");
      });
    });
  }

  describe("completion_status = skipped", () => {
    // skipped has no performed intervention at all (see completedSessionTypes.ts) — intervention must be null.
    const SKIPPED_BASE = { ...VALID_DONE, completion_status: "skipped" as const, actual_duration_min: null, rpe: null, intervention: null };

    it("accepts actual_duration_min/rpe null and fatigue fields null", () => {
      const result = validateCompletedSessionBody({ ...SKIPPED_BASE, post_leg_fatigue: null, post_grip_fatigue: null });
      expect(result.ok).toBe(true);
    });

    it("accepts fatigue fields present and in range", () => {
      const result = validateCompletedSessionBody(SKIPPED_BASE);
      expect(result.ok).toBe(true);
    });

    it("rejects actual_duration_min non-null", () => {
      const result = validateCompletedSessionBody({ ...SKIPPED_BASE, actual_duration_min: 30 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invalid_body_for_status");
    });

    it("rejects rpe non-null", () => {
      const result = validateCompletedSessionBody({ ...SKIPPED_BASE, rpe: 5 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invalid_body_for_status");
    });

    it("rejects an out-of-range post_leg_fatigue when present", () => {
      const result = validateCompletedSessionBody({ ...SKIPPED_BASE, post_leg_fatigue: 15 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invalid_range");
    });
  });

  // M5_003 final review: session_type REST must never force an invented
  // duration/RPE — the frozen M5_001A DB/RPC contract already allows these
  // null. Deliberately NOT generalized to any other session_type. V0.3_007B:
  // every non-skipped case here now carries a matching intervention
  // ({ kind: "REST" }) so the new session_type/intervention coherence check
  // passes and each test actually exercises the numeric rule it names.
  describe("session_type = REST (never invented training load)", () => {
    it("REST + done + null duration/rpe -> valid, session_load will be null via the DB trigger", () => {
      const result = validateCompletedSessionBody({
        ...VALID_DONE,
        session_type: "REST",
        completion_status: "done",
        intervention: { kind: "REST" },
        actual_duration_min: null,
        rpe: null,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.actual_duration_min).toBeNull();
        expect(result.value.rpe).toBeNull();
      }
    });

    it("REST + done + non-null duration -> rejected", () => {
      const result = validateCompletedSessionBody({
        ...VALID_DONE,
        session_type: "REST",
        completion_status: "done",
        intervention: { kind: "REST" },
        actual_duration_min: 30,
        rpe: null,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invalid_body_for_status");
    });

    it("REST + done + non-null rpe -> rejected", () => {
      const result = validateCompletedSessionBody({
        ...VALID_DONE,
        session_type: "REST",
        completion_status: "done",
        intervention: { kind: "REST" },
        actual_duration_min: null,
        rpe: 5,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invalid_body_for_status");
    });

    it("REST + done accepts fatigue fields null or in range", () => {
      const nullFatigue = validateCompletedSessionBody({
        ...VALID_DONE,
        session_type: "REST",
        completion_status: "done",
        intervention: { kind: "REST" },
        actual_duration_min: null,
        rpe: null,
        post_leg_fatigue: null,
        post_grip_fatigue: null,
      });
      expect(nullFatigue.ok).toBe(true);

      const presentFatigue = validateCompletedSessionBody({
        ...VALID_DONE,
        session_type: "REST",
        completion_status: "done",
        intervention: { kind: "REST" },
        actual_duration_min: null,
        rpe: null,
      });
      expect(presentFatigue.ok).toBe(true);
    });

    it("REST + replaced + null duration/rpe -> valid — REST is the actual replacement", () => {
      const result = validateCompletedSessionBody({
        ...VALID_DONE,
        session_type: "REST",
        completion_status: "replaced",
        intervention: { kind: "REST" },
        actual_duration_min: null,
        rpe: null,
      });
      expect(result.ok).toBe(true);
    });

    it("REST + replaced + non-null duration -> rejected", () => {
      const result = validateCompletedSessionBody({
        ...VALID_DONE,
        session_type: "REST",
        completion_status: "replaced",
        intervention: { kind: "REST" },
        actual_duration_min: 20,
        rpe: null,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invalid_body_for_status");
    });

    it("REST + partial -> rejected — 'partial rest' is not a meaningful state", () => {
      const result = validateCompletedSessionBody({
        ...VALID_DONE,
        session_type: "REST",
        completion_status: "partial",
        intervention: { kind: "REST" },
        actual_duration_min: null,
        rpe: null,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invalid_body_for_status");
    });

    it("REST + skipped still uses the global skipped semantics (not a REST-specific rule)", () => {
      const result = validateCompletedSessionBody({
        ...VALID_DONE,
        session_type: "REST",
        completion_status: "skipped",
        intervention: null,
        actual_duration_min: null,
        rpe: null,
      });
      expect(result.ok).toBe(true);
    });

    it("a non-REST session_type is unaffected — still requires full numeric fields", () => {
      const result = validateCompletedSessionBody({
        ...VALID_DONE,
        session_type: "BIKE_MAINTENANCE",
        completion_status: "done",
        intervention: { kind: "BIKE_MAINTENANCE" },
        actual_duration_min: null,
        rpe: null,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invalid_body_for_status");
    });
  });
});

// V0.3_007B — server-side enforcement of the performed-intervention contract:
// `intervention` is the ONE athlete-authored fact for done/partial/replaced,
// `session_type` is always its derived coarse projection (never an
// independent client-supplied value trusted at face value), and `skipped`
// has no performed intervention concept at all. This is the authoritative
// layer — the web client (completedSessionValidation.ts) already enforces
// the same rules, but a client is never trusted alone.
describe("validateCompletedSessionBody — performed intervention (V0.3_007B)", () => {
  it("rejects intervention = null for done", () => {
    const result = validateCompletedSessionBody({ ...VALID_DONE, completion_status: "done", intervention: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_body_for_status");
  });

  it("rejects intervention = null for partial", () => {
    const result = validateCompletedSessionBody({ ...VALID_DONE, completion_status: "partial", intervention: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_body_for_status");
  });

  it("rejects intervention = null for replaced", () => {
    const result = validateCompletedSessionBody({ ...VALID_DONE, completion_status: "replaced", intervention: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_body_for_status");
  });

  it("rejects a non-null intervention for skipped", () => {
    const result = validateCompletedSessionBody({
      ...VALID_DONE,
      completion_status: "skipped",
      session_type: "RECOVERY",
      intervention: { kind: "RECOVERY_ACTIVE" },
      actual_duration_min: null,
      rpe: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_body_for_status");
  });

  it("rejects an intervention with an unrecognized kind", () => {
    const result = validateCompletedSessionBody({ ...VALID_DONE, intervention: { kind: "YOGA" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_intervention");
  });

  it("rejects an intervention with an extra unknown field — never accepted opaquely", () => {
    const result = validateCompletedSessionBody({ ...VALID_DONE, intervention: { kind: "RECOVERY_ACTIVE", nested: { a: 1 } } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_intervention");
  });

  it("rejects a fixed-load kind carrying a load_profile", () => {
    const result = validateCompletedSessionBody({ ...VALID_DONE, intervention: { kind: "RECOVERY_ACTIVE", load_profile: "LIGHT" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_intervention");
  });

  it("rejects a load-variable kind with no load_profile", () => {
    const result = validateCompletedSessionBody({
      ...VALID_DONE,
      session_type: "AEROBIC_BASE",
      intervention: { kind: "AEROBIC_BASE" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_intervention");
  });

  it("rejects a load-variable kind with an invalid load_profile value", () => {
    const result = validateCompletedSessionBody({
      ...VALID_DONE,
      session_type: "AEROBIC_BASE",
      intervention: { kind: "AEROBIC_BASE", load_profile: "EXTREME" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_intervention");
  });

  it("rejects session_type that doesn't match the intervention's derived coarse type", () => {
    const result = validateCompletedSessionBody({
      ...VALID_DONE,
      session_type: "DH_TECHNICAL",
      intervention: { kind: "AEROBIC_BASE", load_profile: "MODERATE" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("session_type_mismatch");
  });

  it("accepts RACE_ACTIVITY — never a valid plan, but a valid performed reality", () => {
    const result = validateCompletedSessionBody({ ...VALID_DONE, session_type: "RACE_PREP", intervention: { kind: "RACE_ACTIVITY" } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.intervention).toEqual({ kind: "RACE_ACTIVITY" });
  });

  // REV-003 proof at the authoritative layer: two rich kinds that collide
  // onto the SAME coarse bucket by load_profile alone must still round-trip
  // distinctly through `intervention`, never collapsed to a shared identity.
  it.each([
    ["STRENGTH_LOWER", "HEAVY", "STRENGTH_A"],
    ["STRENGTH_LOWER", "LIGHT", "STRENGTH_B"],
    ["STRENGTH_UPPER", "HEAVY", "STRENGTH_A"],
    ["STRENGTH_UPPER", "MODERATE", "STRENGTH_B"],
    ["POWER", "HEAVY", "STRENGTH_A"],
    ["GRIP_WORK", "MODERATE", "STRENGTH_B"],
    ["PUMPTRACK", "LIGHT", "DH_TECHNICAL"],
    ["DH_LIGHT", "LIGHT", "RECOVERY"],
  ] as const)("kind=%s load_profile=%s derives session_type=%s", (kind, loadProfile, expectedSessionType) => {
    const result = validateCompletedSessionBody({
      ...VALID_DONE,
      session_type: expectedSessionType,
      intervention: { kind, load_profile: loadProfile },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.intervention).toEqual({ kind, load_profile: loadProfile });
  });

  // V0.3_007B final review, Issue C — clarifying which performed kinds
  // structurally carry a load_profile. Only PERFORMED_LOAD_VARIABLE_KINDS
  // do (covered by the it.each above); the fixed-load group below
  // structurally never does — a load_profile there is ALWAYS rejected, and
  // its absence is ALWAYS required. No second load-policy map: this table
  // exercises the exact same PERFORMED_FIXED_LOAD_KINDS/
  // mapTrainingInterventionToSessionType this module already uses.
  const DERIVED_SESSION_TYPE_FOR_FIXED_KIND: Record<(typeof PERFORMED_FIXED_LOAD_KINDS)[number], string> = {
    MOBILITY: "RECOVERY",
    RECOVERY_ACTIVE: "RECOVERY",
    REST: "REST",
    BIKE_MAINTENANCE: "BIKE_MAINTENANCE",
    RACE_ACTIVITY: "RACE_PREP",
  };

  describe.each(PERFORMED_FIXED_LOAD_KINDS)("fixed-load kind = %s (never carries load_profile)", (kind) => {
    const sessionType = DERIVED_SESSION_TYPE_FOR_FIXED_KIND[kind];
    const needsNullLoad = sessionType === "REST";

    it("accepted with no load_profile, derives the correct coarse session_type, round-trips verbatim", () => {
      const result = validateCompletedSessionBody({
        ...VALID_DONE,
        session_type: sessionType,
        intervention: { kind },
        ...(needsNullLoad ? { actual_duration_min: null, rpe: null } : {}),
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.intervention).toEqual({ kind }); // load_profile ABSENT, never fabricated as null/LIGHT/MODERATE/HEAVY
        expect(result.value.session_type).toBe(sessionType);
      }
    });

    for (const loadProfile of ["HEAVY", "MODERATE", "LIGHT"] as const) {
      it(`rejected when a load_profile (${loadProfile}) is supplied — structurally absent, never fabricated`, () => {
        const result = validateCompletedSessionBody({
          ...VALID_DONE,
          session_type: sessionType,
          intervention: { kind, load_profile: loadProfile },
          ...(needsNullLoad ? { actual_duration_min: null, rpe: null } : {}),
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("invalid_intervention");
      });
    }
  });

  it("REST + done round-trips through the full contract with no duration/RPE and no load_profile key at all", () => {
    const result = validateCompletedSessionBody({
      ...VALID_DONE,
      session_type: "REST",
      completion_status: "done",
      intervention: { kind: "REST" },
      actual_duration_min: null,
      rpe: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.intervention).toEqual({ kind: "REST" });
      expect(Object.prototype.hasOwnProperty.call(result.value.intervention, "load_profile")).toBe(false);
      expect(result.value.actual_duration_min).toBeNull();
      expect(result.value.rpe).toBeNull();
    }
  });

  it("intervention round-trips verbatim (kind + load_profile), never re-derived or altered", () => {
    const result = validateCompletedSessionBody({
      ...VALID_DONE,
      session_type: "AEROBIC_INTERVALS",
      intervention: { kind: "AEROBIC_INTERVALS", load_profile: "HEAVY" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.intervention).toEqual({ kind: "AEROBIC_INTERVALS", load_profile: "HEAVY" });
  });
});

describe("validateCompletedSessionBody — pain shape", () => {
  it("rejects new_pain missing/non-boolean", () => {
    const { new_pain: _drop, ...withoutPain } = VALID_DONE;
    const result = validateCompletedSessionBody(withoutPain);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_body"); // missing canonical key, caught before pain-shape logic
  });

  it("rejects new_pain=true with new_pain_note=null", () => {
    const result = validateCompletedSessionBody({ ...VALID_DONE, new_pain: true, new_pain_note: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_pain_shape");
  });

  it("rejects new_pain=true with new_pain_note='' (empty)", () => {
    const result = validateCompletedSessionBody({ ...VALID_DONE, new_pain: true, new_pain_note: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_pain_shape");
  });

  it("rejects new_pain=true with new_pain_note='   ' (whitespace-only)", () => {
    const result = validateCompletedSessionBody({ ...VALID_DONE, new_pain: true, new_pain_note: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_pain_shape");
  });

  it("rejects new_pain=true with a note over 500 characters", () => {
    const result = validateCompletedSessionBody({ ...VALID_DONE, new_pain: true, new_pain_note: "a".repeat(501) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_pain_shape");
  });

  it("accepts new_pain=true with a valid trimmed note, and trims it", () => {
    const result = validateCompletedSessionBody({ ...VALID_DONE, new_pain: true, new_pain_note: "  Genou douloureux  " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.new_pain_note).toBe("Genou douloureux");
  });

  it("rejects new_pain=false with a non-null new_pain_note", () => {
    const result = validateCompletedSessionBody({ ...VALID_DONE, new_pain: false, new_pain_note: "should not be here" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_pain_shape");
  });

  it("accepts new_pain=false with new_pain_note=null", () => {
    const result = validateCompletedSessionBody({ ...VALID_DONE, new_pain: false, new_pain_note: null });
    expect(result.ok).toBe(true);
  });
});

describe("validateDateParam", () => {
  it("rejects null (missing)", () => {
    const result = validateDateParam(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("missing_date");
  });

  it("rejects an empty string", () => {
    const result = validateDateParam("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("missing_date");
  });

  it("rejects a malformed date", () => {
    const result = validateDateParam("2026/08/12");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_date_format");
  });

  it("accepts a valid canonical date", () => {
    const result = validateDateParam("2026-08-12");
    expect(result).toEqual({ ok: true, value: "2026-08-12" });
  });
});
