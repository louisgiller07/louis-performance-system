import type { CompletedSessionFlow } from "./useCompletedSessionFlow";

// UX-08 — which short steps the after-session moment needs, and when each one
// is answered. Pure: derived from the flow state only. Nothing is asked that
// the recorded session does not store, nothing required is skipped:
// - "plan" only when the day had 2+ decisions (explicit choice, V0.3_007B);
// - "reason" for every non-completed status (V0.3_007C UI gate);
// - "activity" carries the duration; "effort" never for a skipped session or a rest;
// - "body" and "signal" always (body optional when skipped / rest).

export type AfterSessionStepId = "status" | "plan" | "activity" | "reason" | "effort" | "body" | "signal";

type FlowState = Pick<
  CompletedSessionFlow,
  "form" | "linkableDecisions" | "decisionLinkResolved" | "showChangeReason" | "showTechnicalOutcome" | "hideDurationRpe" | "fieldErrors"
>;

export function afterSessionSteps(flow: FlowState): AfterSessionStepId[] {
  const steps: AfterSessionStepId[] = ["status"];
  if (flow.linkableDecisions.length >= 2) steps.push("plan");
  steps.push("activity");
  if (flow.showChangeReason) steps.push("reason");
  if (!flow.hideDurationRpe) steps.push("effort");
  steps.push("body", "signal");
  return steps;
}

export function isStepAnswered(step: AfterSessionStepId, flow: FlowState): boolean {
  const { form, fieldErrors: errors } = flow;
  if (!form) return false;
  switch (step) {
    case "status":
      return true;
    case "plan":
      return flow.decisionLinkResolved;
    case "activity":
      return (
        !errors.performed_kind &&
        !errors.performed_load &&
        !errors.skipped_session_type &&
        !errors.completion_status &&
        !errors.actual_duration_min &&
        (!flow.showTechnicalOutcome || form.technical_outcome !== "")
      );
    case "reason":
      return form.change_reason !== "" && !errors.change_reason && !errors.change_reason_note;
    case "effort":
      return !errors.rpe;
    case "body":
      return !errors.post_leg_fatigue && !errors.post_grip_fatigue;
    case "signal":
      return !errors.new_pain && !errors.new_pain_note;
  }
}
