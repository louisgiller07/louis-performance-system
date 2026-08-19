import { describe, expect, it } from "vitest";
import { validateCheckin } from "./checkinValidation";
import { EMPTY_CHECKIN_FORM_STATE, type CheckinFormState } from "./checkinTypes";

function baseValidState(overrides: Partial<CheckinFormState> = {}): CheckinFormState {
  return {
    ...EMPTY_CHECKIN_FORM_STATE,
    sleep_hours: 7.5,
    sleep_quality: 7,
    sleep_wake_ups: 1,
    energy: 7,
    work_stress: 3,
    motivation: 8,
    leg_fatigue: 3,
    grip_fatigue: 3,
    pain: false,
    suspected_concussion: false,
    fever_or_illness: false,
    ...overrides,
  };
}

describe("validateCheckin", () => {
  it("accepts a fully valid neutral (pain=false, all health answers explicit false) checkin", () => {
    const result = validateCheckin(baseValidState());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.values.pain).toBe(false);
      expect(result.values.pain_intensity).toBeNull();
      expect(result.values.suspected_concussion).toBe(false);
      expect(result.values.fever_or_illness).toBe(false);
    }
  });

  it("rejects an out-of-range value (energy > 10)", () => {
    const result = validateCheckin(baseValidState({ energy: 15 }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.energy).toBeDefined();
    }
  });

  it("rejects sleep_hours outside 0-24", () => {
    const result = validateCheckin(baseValidState({ sleep_hours: 30 }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.sleep_hours).toBeDefined();
    }
  });

  it("rejects sleep_wake_ups outside 0-20", () => {
    const result = validateCheckin(baseValidState({ sleep_wake_ups: 25 }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.sleep_wake_ups).toBeDefined();
    }
  });

  // --- Tri-state health/safety answers: null must never pass as false. ---

  it("fresh form (no answer at all) fails: pain/concussion/illness all null", () => {
    const result = validateCheckin(baseValidState({ pain: null, suspected_concussion: null, fever_or_illness: null }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.pain).toBeDefined();
      expect(result.errors.suspected_concussion).toBeDefined();
      expect(result.errors.fever_or_illness).toBeDefined();
    }
  });

  it("fails when suspected_concussion is unanswered even if everything else is answered", () => {
    const result = validateCheckin(baseValidState({ suspected_concussion: null }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.suspected_concussion).toBeDefined();
      expect(result.errors.pain).toBeUndefined();
    }
  });

  it("fails when fever_or_illness is unanswered even if everything else is answered", () => {
    const result = validateCheckin(baseValidState({ fever_or_illness: null }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.fever_or_illness).toBeDefined();
    }
  });

  it("explicit false is accepted for every tri-state safety field (not the same as unanswered)", () => {
    const result = validateCheckin(
      baseValidState({
        pain: false,
        suspected_concussion: false,
        fever_or_illness: false,
      })
    );

    expect(result.ok).toBe(true);
  });

  it("explicit true is supported for suspected_concussion/fever_or_illness", () => {
    const result = validateCheckin(baseValidState({ suspected_concussion: true, fever_or_illness: true }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.values.suspected_concussion).toBe(true);
      expect(result.values.fever_or_illness).toBe(true);
    }
  });

  // --- pain=true: the four pain criteria become required tri-state too. ---

  it("pain=true with pain_new unanswered -> FAIL", () => {
    const result = validateCheckin(
      baseValidState({ pain: true, pain_intensity: 4, pain_new: null, pain_traumatic: false, pain_function_loss: false, pain_getting_worse: false })
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.pain_new).toBeDefined();
  });

  it("pain=true with pain_traumatic unanswered -> FAIL", () => {
    const result = validateCheckin(
      baseValidState({ pain: true, pain_intensity: 4, pain_new: false, pain_traumatic: null, pain_function_loss: false, pain_getting_worse: false })
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.pain_traumatic).toBeDefined();
  });

  it("pain=true with pain_function_loss unanswered -> FAIL", () => {
    const result = validateCheckin(
      baseValidState({ pain: true, pain_intensity: 4, pain_new: false, pain_traumatic: false, pain_function_loss: null, pain_getting_worse: false })
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.pain_function_loss).toBeDefined();
  });

  it("pain=true with pain_getting_worse unanswered -> FAIL", () => {
    const result = validateCheckin(
      baseValidState({ pain: true, pain_intensity: 4, pain_new: false, pain_traumatic: false, pain_function_loss: false, pain_getting_worse: null })
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.pain_getting_worse).toBeDefined();
  });

  it("rejects pain=true with pain_intensity missing", () => {
    const result = validateCheckin(baseValidState({ pain: true, pain_intensity: "" }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.pain_intensity).toBeDefined();
    }
  });

  it("accepts pain=true with a complete set of explicit pain criteria", () => {
    const result = validateCheckin(
      baseValidState({
        pain: true,
        pain_intensity: 4,
        pain_new: false,
        pain_traumatic: false,
        pain_function_loss: false,
        pain_getting_worse: true,
      })
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.values.pain_intensity).toBe(4);
      expect(result.values.pain_getting_worse).toBe(true);
    }
  });

  it("does NOT reject a stale pain_intensity left over from a previous pain=true state (regression: this used to silently block save)", () => {
    // Bug scenario: user answered pain=true, filled pain_intensity=4, then
    // switched back to pain=false without CheckinForm's normalization
    // running (e.g. any future code path that sets `pain` directly).
    // validateCheckin itself must be tolerant here — the pain section is
    // hidden once pain=false, so an error attached to pain_intensity would
    // be invisible to the user and the submit would appear to do nothing.
    const result = validateCheckin(baseValidState({ pain: false, pain_intensity: 5 }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.values.pain_intensity).toBeNull();
    }
  });

  it("pain=false normalizes all four pain criteria and pain_intensity/pain_location_code to not-applicable in the final payload, regardless of stray leftover values", () => {
    const result = validateCheckin(
      baseValidState({
        pain: false,
        pain_intensity: 7,
        pain_new: true,
        pain_traumatic: true,
        pain_function_loss: true,
        pain_getting_worse: true,
        pain_location_code: "knee_L",
      })
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.values.pain_intensity).toBeNull();
      expect(result.values.pain_new).toBe(false);
      expect(result.values.pain_traumatic).toBe(false);
      expect(result.values.pain_function_loss).toBe(false);
      expect(result.values.pain_getting_worse).toBe(false);
      expect(result.values.pain_location_code).toBeNull();
    }
  });
});
