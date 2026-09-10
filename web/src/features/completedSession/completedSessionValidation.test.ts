import { describe, expect, it } from "vitest";
import { validateCompletedSessionForm } from "./completedSessionValidation";
import { emptyCompletedSessionForm, type CompletedSessionFormState } from "./completedSessionTypes";

const VALID_DONE: CompletedSessionFormState = {
  ...emptyCompletedSessionForm(),
  completion_status: "done",
  performed_kind: "AEROBIC_BASE",
  performed_load: "MODERATE",
  actual_duration_min: 42,
  rpe: 7,
  post_leg_fatigue: 4,
  post_grip_fatigue: 3,
  new_pain: false,
  new_pain_note: "",
};

const DATE = "2026-08-12";

describe("validateCompletedSessionForm", () => {
  it("accepts a fully valid 'done' form", () => {
    const result = validateCompletedSessionForm(VALID_DONE, DATE);
    expect(result.ok).toBe(true);
  });

  // V0.3_007B — the one athlete-authored fact, session_type is always derived.
  describe("rich performed intervention (V0.3_007B)", () => {
    it("requires performed_kind for done/partial/replaced", () => {
      for (const status of ["done", "partial", "replaced"] as const) {
        const result = validateCompletedSessionForm({ ...VALID_DONE, completion_status: status, performed_kind: "" }, DATE);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.errors.performed_kind).toBeDefined();
      }
    });

    it("derives session_type from performed_kind/performed_load, never independently supplied", () => {
      const result = validateCompletedSessionForm(
        { ...VALID_DONE, performed_kind: "DH_LIGHT", performed_load: "LIGHT" },
        DATE
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.values.session_type).toBe("RECOVERY"); // DH_LIGHT coarsens to RECOVERY
        expect(result.values.intervention).toEqual({ kind: "DH_LIGHT", load_profile: "LIGHT" });
      }
    });

    // REV-003 — the whole point: a rich kind now round-trips exactly, never
    // collapsed to a vague coarse guess.
    it("STRENGTH_LOWER and STRENGTH_UPPER both round-trip their real rich kind, even though both may coarsen to the same DB bucket", () => {
      const lower = validateCompletedSessionForm({ ...VALID_DONE, performed_kind: "STRENGTH_LOWER", performed_load: "HEAVY" }, DATE);
      const upper = validateCompletedSessionForm({ ...VALID_DONE, performed_kind: "STRENGTH_UPPER", performed_load: "HEAVY" }, DATE);
      expect(lower.ok && lower.values.intervention).toEqual({ kind: "STRENGTH_LOWER", load_profile: "HEAVY" });
      expect(upper.ok && upper.values.intervention).toEqual({ kind: "STRENGTH_UPPER", load_profile: "HEAVY" });
    });

    it("rejects a load_profile on a fixed-load performed kind", () => {
      const result = validateCompletedSessionForm({ ...VALID_DONE, performed_kind: "REST", performed_load: "HEAVY" }, DATE);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.performed_load).toBeDefined();
    });

    it("rejects a missing load_profile on a load-variable performed kind", () => {
      const result = validateCompletedSessionForm({ ...VALID_DONE, performed_kind: "STRENGTH_LOWER", performed_load: null }, DATE);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.performed_load).toBeDefined();
    });

    it("accepts RACE_ACTIVITY (never plannable, but a valid performed reality)", () => {
      const result = validateCompletedSessionForm({ ...VALID_DONE, performed_kind: "RACE_ACTIVITY", performed_load: null }, DATE);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.values.intervention).toEqual({ kind: "RACE_ACTIVITY" });
        expect(result.values.session_type).toBe("RACE_PREP");
      }
    });

    it("intervention is always null for skipped, regardless of any stale performed_kind left in the draft", () => {
      const result = validateCompletedSessionForm(
        { ...VALID_DONE, completion_status: "skipped", skipped_session_type: "DH_PERFORMANCE", performed_kind: "DH_LIGHT" },
        DATE
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.values.intervention).toBeNull();
        expect(result.values.session_type).toBe("DH_PERFORMANCE");
      }
    });

    it("skipped requires skipped_session_type", () => {
      const result = validateCompletedSessionForm({ ...VALID_DONE, completion_status: "skipped", skipped_session_type: "" }, DATE);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.skipped_session_type).toBeDefined();
    });
  });

  for (const status of ["done", "partial", "replaced"] as const) {
    describe(`completion_status = ${status}`, () => {
      it("requires actual_duration_min", () => {
        const result = validateCompletedSessionForm({ ...VALID_DONE, completion_status: status, actual_duration_min: "" }, DATE);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.errors.actual_duration_min).toBeDefined();
      });

      it("rejects actual_duration_min <= 0", () => {
        const result = validateCompletedSessionForm({ ...VALID_DONE, completion_status: status, actual_duration_min: 0 }, DATE);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.errors.actual_duration_min).toBeDefined();
      });

      it("requires rpe", () => {
        const result = validateCompletedSessionForm({ ...VALID_DONE, completion_status: status, rpe: "" }, DATE);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.errors.rpe).toBeDefined();
      });

      it("rejects rpe out of 0..10", () => {
        const result = validateCompletedSessionForm({ ...VALID_DONE, completion_status: status, rpe: 11 }, DATE);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.errors.rpe).toBeDefined();
      });

      it("requires post_leg_fatigue and post_grip_fatigue", () => {
        const result = validateCompletedSessionForm(
          { ...VALID_DONE, completion_status: status, post_leg_fatigue: "", post_grip_fatigue: "" },
          DATE
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.errors.post_leg_fatigue).toBeDefined();
          expect(result.errors.post_grip_fatigue).toBeDefined();
        }
      });
    });
  }

  describe("completion_status = skipped", () => {
    const SKIPPED: CompletedSessionFormState = {
      ...VALID_DONE,
      completion_status: "skipped",
      performed_kind: "",
      performed_load: null,
      skipped_session_type: "RECOVERY",
      actual_duration_min: "",
      rpe: "",
    };

    it("accepts with duration/rpe empty and fatigue fields empty", () => {
      const result = validateCompletedSessionForm({ ...SKIPPED, post_leg_fatigue: "", post_grip_fatigue: "" }, DATE);
      expect(result.ok).toBe(true);
    });

    it("accepts with fatigue fields filled", () => {
      const result = validateCompletedSessionForm(SKIPPED, DATE);
      expect(result.ok).toBe(true);
    });

    it("does not require actual_duration_min/rpe", () => {
      const result = validateCompletedSessionForm(SKIPPED, DATE);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.values.actual_duration_min).toBeNull();
        expect(result.values.rpe).toBeNull();
      }
    });

    it("rejects an out-of-range fatigue value when present", () => {
      const result = validateCompletedSessionForm({ ...SKIPPED, post_leg_fatigue: 15 }, DATE);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.post_leg_fatigue).toBeDefined();
    });
  });

  // M5_003 final review: a REST performed/skipped activity never requires an
  // invented duration/RPE — deliberately not generalized to any other kind.
  // V0.3_007B: "REST" here is the DERIVED effective session type, from
  // performed_kind="REST" (done/replaced) — no independent session_type field anymore.
  describe("REST performed activity", () => {
    const REST_DONE: CompletedSessionFormState = {
      ...VALID_DONE,
      performed_kind: "REST",
      performed_load: null,
      completion_status: "done",
      actual_duration_min: "",
      rpe: "",
    };

    it("REST + done + empty duration/rpe -> valid", () => {
      const result = validateCompletedSessionForm(REST_DONE, DATE);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.values.actual_duration_min).toBeNull();
        expect(result.values.rpe).toBeNull();
        expect(result.values.intervention).toEqual({ kind: "REST" });
        expect(result.values.session_type).toBe("REST");
      }
    });

    it("REST + replaced + empty duration/rpe -> valid (REST is the actual replacement)", () => {
      const result = validateCompletedSessionForm({ ...REST_DONE, completion_status: "replaced" }, DATE);
      expect(result.ok).toBe(true);
    });

    it("REST + partial -> rejected", () => {
      const result = validateCompletedSessionForm({ ...REST_DONE, completion_status: "partial" }, DATE);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.completion_status).toBeDefined();
    });

    it("accepts optional fatigue fields for REST", () => {
      const result = validateCompletedSessionForm({ ...REST_DONE, post_leg_fatigue: 3, post_grip_fatigue: 2 }, DATE);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.values.post_leg_fatigue).toBe(3);
        expect(result.values.post_grip_fatigue).toBe(2);
      }
    });

    it("a non-REST performed kind still requires duration/rpe", () => {
      const result = validateCompletedSessionForm({ ...REST_DONE, performed_kind: "BIKE_MAINTENANCE" }, DATE);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.actual_duration_min).toBeDefined();
    });
  });

  describe("REST as the skipped session type", () => {
    it("skipped + REST also never requires duration/rpe (skipped already implies null, same as before)", () => {
      const result = validateCompletedSessionForm(
        { ...VALID_DONE, completion_status: "skipped", skipped_session_type: "REST", performed_kind: "", performed_load: null, actual_duration_min: "", rpe: "" },
        DATE
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.values.session_type).toBe("REST");
    });
  });

  describe("pain shape", () => {
    it("requires new_pain to be answered", () => {
      const result = validateCompletedSessionForm({ ...VALID_DONE, new_pain: null }, DATE);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.new_pain).toBeDefined();
    });

    it("requires a non-empty note when new_pain is true", () => {
      const result = validateCompletedSessionForm({ ...VALID_DONE, new_pain: true, new_pain_note: "" }, DATE);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.new_pain_note).toBeDefined();
    });

    it("rejects a whitespace-only note when new_pain is true", () => {
      const result = validateCompletedSessionForm({ ...VALID_DONE, new_pain: true, new_pain_note: "   " }, DATE);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.new_pain_note).toBeDefined();
    });

    it("accepts and trims a valid note when new_pain is true", () => {
      const result = validateCompletedSessionForm({ ...VALID_DONE, new_pain: true, new_pain_note: "  Genou  " }, DATE);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.values.new_pain_note).toBe("Genou");
    });

    it("accepts new_pain=false with an empty note", () => {
      const result = validateCompletedSessionForm({ ...VALID_DONE, new_pain: false, new_pain_note: "" }, DATE);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.values.new_pain_note).toBeNull();
    });
  });

  it("carries session_date, decision_id, and main_content straight through", () => {
    const result = validateCompletedSessionForm({ ...VALID_DONE, decision_id: "d1", main_content: { b: 2 } }, DATE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.values.session_date).toBe(DATE);
      expect(result.values.decision_id).toBe("d1");
      expect(result.values.main_content).toEqual({ b: 2 });
    }
  });
});
