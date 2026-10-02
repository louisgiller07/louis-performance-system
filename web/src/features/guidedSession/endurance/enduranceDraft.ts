// UX-11C.4 — the endurance entry in progress (module UI state) and the
// completion rule of the endurance module. Pure: no React.
import type { ActivityResultRow } from "../executionState";
import type { ActivityResultInput } from "../sessionExecutionClient";
import type { ModuleCompletion, ModuleContext } from "../sessionModules";
import { activeActivityResult } from "../results/activeResults";
import { allowedActivities, isEmptyActivityForm, sameActivityValues, validateActivityForm, type ActivityFormErrors, type ActivityFormValues, type ActivityOption } from "./enduranceActivity";
import { ENDURANCE_COPY } from "./enduranceCopy";

export interface EnduranceForm {
  /** Generated once when the entry starts; reused by every send of this entry (idempotent replays). */
  id: string;
  /** Frozen at the first send attempt. */
  occurredAt: string | null;
  /** The original being corrected (null → the first activity result). */
  supersedes: ActivityResultRow | null;
  values: ActivityFormValues;
  errors: ActivityFormErrors;
}

const asState = (u: unknown): { form: EnduranceForm | null } => (u !== null && typeof u === "object" && "form" in u ? (u as { form: EnduranceForm | null }) : { form: null });

/** The entry stays open only while the execution is still as it was when the entry started (another tab may have written meanwhile). */
export function liveEnduranceForm(uiState: unknown, rows: readonly ActivityResultRow[]): EnduranceForm | null {
  const form = asState(uiState).form;
  if (!form) return null;
  if (rows.some((r) => r.id.toLowerCase() === form.id.toLowerCase())) return null;
  if (form.supersedes) return rows.some((r) => r.supersedes_id?.toLowerCase() === form.supersedes!.id.toLowerCase()) ? null : form;
  return activeActivityResult(rows) === null ? form : null;
}

export type EnduranceDraft = { kind: "none" } | { kind: "invalid" } | { kind: "valid"; activity: ActivityResultInput };

export function enduranceDraft(form: EnduranceForm | null, allowed: readonly ActivityOption[], executionId: string | null, now: () => string): EnduranceDraft {
  if (!form || !executionId) return { kind: "none" };
  if (!form.supersedes && isEmptyActivityForm(form.values)) return { kind: "none" };
  const v = validateActivityForm(allowed, form.values);
  if (!v.ok) return { kind: "invalid" };
  if (form.supersedes && sameActivityValues(form.supersedes, v.value)) return { kind: "none" };
  return {
    kind: "valid",
    activity: { id: form.id, execution_id: executionId, ...v.value, comment: null, supersedes_id: form.supersedes?.id ?? null, occurred_at: form.occurredAt ?? now() },
  };
}

/**
 * Locked completion rule (UX-11C.4): completion needs an active activity
 * result (the backend refuses `completed` without it: activity_result_required);
 * a valid entry not sent yet travels with `completed` in the same batch. One
 * main result per session → never a "partial results" confirmation.
 */
export function enduranceCompletion(context: ModuleContext, now: () => string): ModuleCompletion {
  const base = { completionNeedsConfirmation: false, confirmationMessage: "" };
  const allowed = allowedActivities(context.prescription);
  if (!allowed) return { ...base, canComplete: false, hint: ENDURANCE_COPY.invalid, pending: {} };
  const draft = enduranceDraft(liveEnduranceForm(context.uiState, context.activityResults), allowed, context.executionId, now);
  if (draft.kind === "invalid") return { ...base, canComplete: false, hint: ENDURANCE_COPY.needActivity, pending: {} };
  if (draft.kind === "valid") return { ...base, canComplete: true, hint: ENDURANCE_COPY.needActivity, pending: { activities: [draft.activity] } };
  return { ...base, canComplete: activeActivityResult(context.activityResults) !== null, hint: ENDURANCE_COPY.needActivity, pending: {} };
}
