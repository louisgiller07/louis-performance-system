import { describe, expect, it } from "vitest";
import { validateCompletedSessionForm } from "./completedSessionValidation";
import { emptyCompletedSessionForm, type CompletedSessionFormState } from "./completedSessionTypes";

const VALID_DONE: CompletedSessionFormState = {
  ...emptyCompletedSessionForm(null),
  completion_status: "done",
  session_type: "RECOVERY",
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
    const SKIPPED: CompletedSessionFormState = { ...VALID_DONE, completion_status: "skipped", actual_duration_min: "", rpe: "" };

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

  // M5_003 final review: session_type REST never requires an invented
  // duration/RPE — deliberately not generalized to any other session_type.
  describe("session_type = REST", () => {
    const REST_DONE: CompletedSessionFormState = {
      ...VALID_DONE,
      session_type: "REST",
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

    it("a non-REST session_type still requires duration/rpe", () => {
      const result = validateCompletedSessionForm({ ...REST_DONE, session_type: "BIKE_MAINTENANCE" }, DATE);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.actual_duration_min).toBeDefined();
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

  it("carries session_date, decision_id, and opaque fields straight through", () => {
    const result = validateCompletedSessionForm(
      { ...VALID_DONE, decision_id: "d1", intervention: { a: 1 }, main_content: { b: 2 } },
      DATE
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.values.session_date).toBe(DATE);
      expect(result.values.decision_id).toBe("d1");
      expect(result.values.intervention).toEqual({ a: 1 });
      expect(result.values.main_content).toEqual({ b: 2 });
    }
  });
});
