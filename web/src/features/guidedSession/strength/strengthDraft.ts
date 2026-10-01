// UX-11C.2 — the Force entry in progress (module UI state) and the
// completion rule of the Force module. Pure: no React.
import type { SetResultRow } from "../executionState";
import type { SetResultInput } from "../sessionExecutionClient";
import type { ModuleCompletion, ModuleContext } from "../sessionModules";
import { isEmptyForm, strengthProgress, validateSetForm, type SetFormErrors, type SetFormValues, type StrengthMeasureType } from "./strengthSets";
import { STRENGTH_COPY } from "./strengthCopy";
import { entryStillOpen } from "../results/activeResults";
import { PARTIAL_COMPLETION_MESSAGE } from "../guidedSessionCopy";

export interface OpenForm {
  key: string;
  itemId: string;
  itemName: string;
  setNumber: number;
  measureType: StrengthMeasureType;
  perSide: boolean;
  /** The original being corrected (null → a new result). */
  supersedes: SetResultRow | null;
  /** Generated once when the entry opens; reused by every send of this entry (idempotent replays). */
  id: string;
  /** Frozen at the first send attempt. */
  occurredAt: string | null;
  values: SetFormValues;
  errors: SetFormErrors;
}

export interface StrengthUiState {
  form: OpenForm | null;
}

export const EMPTY_FORM: SetFormValues = { value: "", rpe: "", load: "" };

const asState = (u: unknown): StrengthUiState => (u !== null && typeof u === "object" && "form" in u ? (u as StrengthUiState) : { form: null });

/** The entry still open: once the server recorded its id, it is closed (the database is the truth). */
export function liveForm(uiState: unknown, rows: readonly SetResultRow[]): OpenForm | null {
  const form = asState(uiState).form;
  if (!form) return null;
  return entryStillOpen({ id: form.id, prescriptionItemId: form.itemId, ordinal: form.setNumber, supersedesId: form.supersedes?.id ?? null }, rows) ? form : null;
}

export type Draft = { kind: "none" } | { kind: "invalid" } | { kind: "valid"; set: SetResultInput };

export function draftOf(form: OpenForm | null, executionId: string | null, now: () => string): Draft {
  if (!form || !executionId) return { kind: "none" };
  if (!form.supersedes && isEmptyForm(form.values)) return { kind: "none" };
  const v = validateSetForm(form.measureType, form.values);
  if (!v.ok) return { kind: "invalid" };
  const s = form.supersedes;
  if (s && s.measure_value === v.value.measure_value && s.rpe_actual === v.value.rpe_actual && s.load_kg === v.value.load_kg) return { kind: "none" };
  return {
    kind: "valid",
    set: {
      id: form.id,
      execution_id: executionId,
      prescription_item_id: form.itemId,
      set_number: form.setNumber,
      done: true,
      measure_type: form.measureType,
      ...v.value,
      supersedes_id: s?.id ?? null,
      occurred_at: form.occurredAt ?? now(),
    },
  };
}

const asRow = (set: SetResultInput): SetResultRow => ({ load_kg: null, rpe_actual: null, success: null, ...set, other_exercise_name: null, recorded_at: "9999-12-31T23:59:59Z" });

/** Locked completion rule (UX-11C.2): ≥ 1 performed work set; partial results need a confirmation. */
export function strengthCompletion(context: ModuleContext, now: () => string): ModuleCompletion {
  const draft = draftOf(liveForm(context.uiState, context.setResults), context.executionId, now);
  if (draft.kind === "invalid") return { canComplete: false, completionNeedsConfirmation: false, hint: STRENGTH_COPY.finishEntryFirst, confirmationMessage: PARTIAL_COMPLETION_MESSAGE, pendingSets: [] };
  const pendingSets = draft.kind === "valid" ? [draft.set] : [];
  const progress = strengthProgress(context.prescription, context.setResults, pendingSets.map(asRow));
  return { canComplete: progress.canComplete, completionNeedsConfirmation: progress.completionNeedsConfirmation, hint: STRENGTH_COPY.needOneWorkSet, confirmationMessage: PARTIAL_COMPLETION_MESSAGE, pendingSets };
}

