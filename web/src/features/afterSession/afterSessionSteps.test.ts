import { describe, expect, it } from "vitest";
import { afterSessionSteps, isStepAnswered } from "./afterSessionSteps";
import { emptyCompletedSessionForm, type CompletedSessionFormState } from "../completedSession/completedSessionTypes";

function flow(overrides: Partial<Parameters<typeof afterSessionSteps>[0]> = {}) {
  return {
    form: emptyCompletedSessionForm(),
    ambiguousDecisions: false,
    decisionLinkResolved: true,
    showChangeReason: false,
    showTechnicalOutcome: false,
    hideDurationRpe: false,
    skippedTypeLocked: false,
    showBodyInReason: false,
    showPainInReason: false,
    fieldErrors: {},
    ...overrides,
  };
}
const skipped = (over: Partial<CompletedSessionFormState> = {}): CompletedSessionFormState => ({ ...emptyCompletedSessionForm(), completion_status: "skipped", ...over });

describe("A11 — afterSessionSteps: only what is used", () => {
  it("a completed session: status → activity (+ duration) → effort → signal (no body: M1 does not read it for a done session)", () => {
    expect(afterSessionSteps(flow())).toEqual(["status", "activity", "effort", "signal"]);
  });

  it("several decisions are NOT a step (the effective one is linked); only a legacy ambiguity asks", () => {
    expect(afterSessionSteps(flow({ ambiguousDecisions: true }))).toEqual(["status", "plan", "activity", "effort", "signal"]);
  });

  it("partial / replaced: what changed", () => {
    expect(afterSessionSteps(flow({ showChangeReason: true }))).toEqual(["status", "activity", "reason", "effort", "signal"]);
  });

  it("E — skipped with the session known from the link: status → reason (then send)", () => {
    expect(afterSessionSteps(flow({ form: skipped(), showChangeReason: true, hideDurationRpe: true, skippedTypeLocked: true }))).toEqual(["status", "reason"]);
  });

  it("skipped with no plan linked: which session first", () => {
    expect(afterSessionSteps(flow({ form: skipped(), showChangeReason: true, hideDurationRpe: true }))).toEqual(["status", "activity", "reason"]);
  });

  it("a rest performed: no effort", () => {
    expect(afterSessionSteps(flow({ hideDurationRpe: true }))).toEqual(["status", "activity", "signal"]);
  });
});

describe("A11 — isStepAnswered", () => {
  it("each step is answered only when its own fields are valid", () => {
    for (const step of ["status", "activity", "effort", "signal"] as const) expect(isStepAnswered(step, flow())).toBe(true);
    expect(isStepAnswered("activity", flow({ fieldErrors: { actual_duration_min: "Requis." } }))).toBe(false);
    expect(isStepAnswered("effort", flow({ fieldErrors: { rpe: "Requis." } }))).toBe(false);
    expect(isStepAnswered("signal", flow({ fieldErrors: { new_pain_note: "Décris brièvement la douleur." } }))).toBe(false);
  });

  it("plan needs an explicit choice; the technical task and the reason need an answer when shown", () => {
    expect(isStepAnswered("plan", flow({ decisionLinkResolved: false }))).toBe(false);
    expect(isStepAnswered("activity", flow({ showTechnicalOutcome: true }))).toBe(false);
    expect(isStepAnswered("reason", flow({ showChangeReason: true }))).toBe(false);
    expect(isStepAnswered("reason", flow({ showChangeReason: true, form: { ...emptyCompletedSessionForm(), change_reason: "weather_terrain" } }))).toBe(true);
  });

  it("a skipped pain day asks « nouvelle douleur ? » inside the reason step; fatigue inside it stays optional", () => {
    const pain = skipped({ change_reason: "pain", new_pain: null });
    expect(isStepAnswered("reason", flow({ form: pain, showChangeReason: true, showPainInReason: true }))).toBe(false);
    expect(isStepAnswered("reason", flow({ form: { ...pain, new_pain: false }, showChangeReason: true, showPainInReason: true }))).toBe(true);
    expect(isStepAnswered("reason", flow({ form: skipped({ change_reason: "fatigue_control", new_pain: false }), showChangeReason: true, showBodyInReason: true }))).toBe(true);
    expect(isStepAnswered("reason", flow({ form: skipped({ change_reason: "fatigue_control", new_pain: false }), showChangeReason: true, showBodyInReason: true, fieldErrors: { post_leg_fatigue: "Doit être entre 0 et 10." } }))).toBe(false);
  });
});
