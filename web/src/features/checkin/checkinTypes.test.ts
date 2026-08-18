import { describe, expect, it } from "vitest";
import { rowToFormState, EMPTY_CHECKIN_FORM_STATE, type CheckinRow } from "./checkinTypes";

function baseRow(overrides: Partial<CheckinRow> = {}): CheckinRow {
  return {
    checkin_date: "2026-08-19",
    sleep_hours: 7.5,
    sleep_quality: 7,
    sleep_wake_ups: 1,
    energy: 7,
    work_stress: 3,
    motivation: 8,
    leg_fatigue: 3,
    grip_fatigue: 3,
    pain: false,
    pain_intensity: null,
    pain_new: false,
    pain_location_code: null,
    pain_traumatic: false,
    pain_function_loss: false,
    pain_getting_worse: false,
    suspected_concussion: false,
    fever_or_illness: false,
    free_comment: null,
    ...overrides,
  };
}

describe("rowToFormState", () => {
  it("returns the empty (all-unanswered) state when there is no row", () => {
    expect(rowToFormState(null)).toEqual(EMPTY_CHECKIN_FORM_STATE);
  });

  it("prefills an existing row's explicit false values as explicit false, not unanswered", () => {
    const state = rowToFormState(baseRow({ pain_new: false, pain_traumatic: false, suspected_concussion: false }));

    expect(state.pain_new).toBe(false);
    expect(state.pain_traumatic).toBe(false);
    expect(state.suspected_concussion).toBe(false);
  });

  it("prefills an existing row's explicit true values as explicit true", () => {
    const state = rowToFormState(baseRow({ suspected_concussion: true, fever_or_illness: true }));

    expect(state.suspected_concussion).toBe(true);
    expect(state.fever_or_illness).toBe(true);
  });

  it("preserves a legacy NULL pain criterion as unanswered (null), never coerced to false", () => {
    const state = rowToFormState(baseRow({ pain_new: null, pain_traumatic: null, pain_function_loss: null, pain_getting_worse: null }));

    expect(state.pain_new).toBeNull();
    expect(state.pain_traumatic).toBeNull();
    expect(state.pain_function_loss).toBeNull();
    expect(state.pain_getting_worse).toBeNull();
  });
});
