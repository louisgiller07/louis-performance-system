/**
 * Pure unit tests for supabase/functions/completed-session/validation.ts.
 * No Docker, no Deno, no network — validation.ts is deliberately portable
 * plain TypeScript (see its own module doc), so vitest can import it
 * directly via a relative path even though it physically lives under
 * supabase/functions/**.
 */
import { describe, expect, it } from "vitest";
import { validateCompletedSessionBody, validateDateParam } from "../../../../supabase/functions/completed-session/validation.js";

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
  intervention: null,
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
    if (!result.ok) expect(result.error.code).toBe("invalid_body");
  });

  it("accepts an opaque intervention object without inspecting its shape", () => {
    const result = validateCompletedSessionBody({ ...VALID_DONE, intervention: { kind: "ANYTHING", nested: { a: 1 } } });
    expect(result.ok).toBe(true);
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
    const SKIPPED_BASE = { ...VALID_DONE, completion_status: "skipped" as const, actual_duration_min: null, rpe: null };

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
  // null. Deliberately NOT generalized to any other session_type.
  describe("session_type = REST (never invented training load)", () => {
    it("REST + done + null duration/rpe -> valid, session_load will be null via the DB trigger", () => {
      const result = validateCompletedSessionBody({
        ...VALID_DONE,
        session_type: "REST",
        completion_status: "done",
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
        actual_duration_min: null,
        rpe: null,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invalid_body_for_status");
    });
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
