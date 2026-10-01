// UX-11C.3 — the DH pass entry in progress (module UI state) and the
// completion rule of the DH module. Pure: no React.
import type { SetResultRow } from "../executionState";
import type { SetResultInput } from "../sessionExecutionClient";
import type { ModuleCompletion, ModuleContext } from "../sessionModules";
import { entryStillOpen } from "../results/activeResults";
import { choiceOf, dhProgress, mainDrill, successOf, type SuccessChoice } from "./dhPasses";
import { DH_COPY } from "./dhCopy";

export interface DhOpenForm {
  itemId: string;
  ordinal: number;
  /** The original being corrected (null → a new pass result). */
  supersedes: SetResultRow | null;
  /** Generated once when the entry opens; reused by every send of this entry (idempotent replays). */
  id: string;
  /** Frozen at the first send attempt. */
  occurredAt: string | null;
  choice: SuccessChoice;
  /** A new pass is only "typed" once the rider chose something (never sent by merely opening it). */
  touched: boolean;
}

export interface DhUiState {
  form: DhOpenForm | null;
}

const asState = (u: unknown): DhUiState => (u !== null && typeof u === "object" && "form" in u ? (u as DhUiState) : { form: null });

export function liveDhForm(uiState: unknown, rows: readonly SetResultRow[]): DhOpenForm | null {
  const form = asState(uiState).form;
  if (!form) return null;
  return entryStillOpen({ id: form.id, prescriptionItemId: form.itemId, ordinal: form.ordinal, supersedesId: form.supersedes?.id ?? null }, rows) ? form : null;
}

/** The pass result this entry would send, or null when there is nothing new to send. */
export function dhDraftSet(form: DhOpenForm | null, executionId: string | null, now: () => string): SetResultInput | null {
  if (!form || !executionId) return null;
  if (form.supersedes ? choiceOf(form.supersedes.success) === form.choice : !form.touched) return null;
  return {
    id: form.id,
    execution_id: executionId,
    prescription_item_id: form.itemId,
    set_number: form.ordinal,
    done: true,
    measure_type: "pass",
    measure_value: null,
    success: successOf(form.choice),
    supersedes_id: form.supersedes?.id ?? null,
    occurred_at: form.occurredAt ?? now(),
  };
}

const asRow = (set: SetResultInput): SetResultRow => ({ load_kg: null, rpe_actual: null, success: null, ...set, other_exercise_name: null, recorded_at: "9999-12-31T23:59:59Z" });

/** Locked completion rule (UX-11C.3): ≥ 1 pass recorded (success irrelevant); partial passes need a confirmation. */
export function dhCompletion(context: ModuleContext, now: () => string): ModuleCompletion {
  if (!mainDrill(context.prescription)) {
    return { canComplete: false, completionNeedsConfirmation: false, hint: DH_COPY.invalid, confirmationMessage: DH_COPY.partialCompletion, pendingSets: [] };
  }
  const draft = dhDraftSet(liveDhForm(context.uiState, context.setResults), context.executionId, now);
  const pendingSets = draft ? [draft] : [];
  const progress = dhProgress(context.prescription, context.setResults, pendingSets.map(asRow))!;
  return {
    canComplete: progress.canComplete,
    completionNeedsConfirmation: progress.completionNeedsConfirmation,
    hint: DH_COPY.needOnePass,
    confirmationMessage: DH_COPY.partialCompletion,
    pendingSets,
  };
}
