import { describe, expect, it } from "vitest";
import { afterSessionSteps, isStepAnswered } from "./afterSessionSteps";
import { emptyCompletedSessionForm, type LinkableDecision } from "../completedSession/completedSessionTypes";

const DECISION: LinkableDecision = { decisionId: "d-a", createdAt: "2026-08-12T10:05:00Z", finalSession: { kind: "DH_TECHNICAL", load_profile: "MODERATE" }, executionTask: null };

function flow(overrides: Partial<Parameters<typeof afterSessionSteps>[0]> = {}) {
  return {
    form: emptyCompletedSessionForm(),
    linkableDecisions: [DECISION],
    decisionLinkResolved: true,
    showChangeReason: false,
    showTechnicalOutcome: false,
    hideDurationRpe: false,
    fieldErrors: {},
    ...overrides,
  };
}

describe("afterSessionSteps — only what the recorded session stores", () => {
  it("a completed session: status → activity (+ duration) → effort → body → signal", () => {
    expect(afterSessionSteps(flow())).toEqual(["status", "activity", "effort", "body", "signal"]);
  });

  it("2+ decisions that day: an explicit plan step", () => {
    expect(afterSessionSteps(flow({ linkableDecisions: [DECISION, { ...DECISION, decisionId: "d-b" }] }))).toEqual(["status", "plan", "activity", "effort", "body", "signal"]);
  });

  it("partial / replaced: what changed", () => {
    expect(afterSessionSteps(flow({ showChangeReason: true }))).toEqual(["status", "activity", "reason", "effort", "body", "signal"]);
  });

  it("skipped or rest: never duration or effort", () => {
    expect(afterSessionSteps(flow({ showChangeReason: true, hideDurationRpe: true }))).toEqual(["status", "activity", "reason", "body", "signal"]);
    expect(afterSessionSteps(flow({ hideDurationRpe: true }))).toEqual(["status", "activity", "body", "signal"]);
  });
});

describe("isStepAnswered", () => {
  it("each step is answered only when its own fields are valid", () => {
    const answered = flow({ fieldErrors: {} });
    for (const step of ["status", "activity", "effort", "body", "signal"] as const) expect(isStepAnswered(step, answered)).toBe(true);
    expect(isStepAnswered("activity", flow({ fieldErrors: { actual_duration_min: "Requis." } }))).toBe(false);
    expect(isStepAnswered("effort", flow({ fieldErrors: { rpe: "Requis." } }))).toBe(false);
    expect(isStepAnswered("body", flow({ fieldErrors: { post_grip_fatigue: "Requis." } }))).toBe(false);
    expect(isStepAnswered("signal", flow({ fieldErrors: { new_pain_note: "Décris brièvement la douleur." } }))).toBe(false);
  });

  it("plan needs an explicit choice; the technical task and the reason need an answer when shown", () => {
    expect(isStepAnswered("plan", flow({ decisionLinkResolved: false }))).toBe(false);
    expect(isStepAnswered("activity", flow({ showTechnicalOutcome: true }))).toBe(false);
    expect(isStepAnswered("reason", flow({ showChangeReason: true }))).toBe(false);
    expect(isStepAnswered("reason", flow({ showChangeReason: true, form: { ...emptyCompletedSessionForm(), change_reason: "weather_terrain" } }))).toBe(true);
  });
});
