import type { CompletedSessionFlow } from "./useCompletedSessionFlow";

// UX-08 / A11 — which short steps the after-session moment needs, and when
// each one is answered. Pure: derived from the flow state only. Only what is
// used is asked (A11 audit):
// - "plan" only for a legacy ambiguity (two decisions at the same instant);
//   otherwise the day's effective decision (A07) is linked automatically;
// - "activity" (what was done + duration: M1's recent load) — for a skipped
//   session only when the skipped session is not already known from the link;
// - "reason" for every non-completed status (M1: fatigue_control → D-1
//   recovery continuity, with the fatigue asked inline; a skipped pain day
//   asks « nouvelle douleur ? » inline);
// - "effort" for a performed session that is not a rest (session load);
// - "signal" (new pain from the session) for a performed session only.
// A skipped session is then: status → reason → send.

export type AfterSessionStepId = "status" | "plan" | "activity" | "reason" | "effort" | "signal";

type FlowState = Pick<
  CompletedSessionFlow,
  | "form"
  | "ambiguousDecisions"
  | "decisionLinkResolved"
  | "showChangeReason"
  | "showTechnicalOutcome"
  | "hideDurationRpe"
  | "skippedTypeLocked"
  | "showBodyInReason"
  | "showPainInReason"
  | "fieldErrors"
>;

export function afterSessionSteps(flow: FlowState): AfterSessionStepId[] {
  const steps: AfterSessionStepId[] = ["status"];
  const skipped = flow.form?.completion_status === "skipped";
  if (flow.ambiguousDecisions) steps.push("plan");
  if (!skipped || !flow.skippedTypeLocked) steps.push("activity");
  if (flow.showChangeReason) steps.push("reason");
  if (!flow.hideDurationRpe) steps.push("effort");
  if (!skipped) steps.push("signal");
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
      return (
        form.change_reason !== "" &&
        !errors.change_reason &&
        !errors.change_reason_note &&
        (!flow.showBodyInReason || (!errors.post_leg_fatigue && !errors.post_grip_fatigue)) &&
        (!flow.showPainInReason || (form.new_pain !== null && !errors.new_pain_note))
      );
    case "effort":
      return !errors.rpe;
    case "signal":
      return !errors.new_pain && !errors.new_pain_note;
  }
}
