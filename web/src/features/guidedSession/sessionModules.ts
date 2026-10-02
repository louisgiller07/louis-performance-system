// UX-11C.1 / 11C.2 — contract between the guided-session shell and the
// per-family session modules. The shell owns the lifecycle (start, pause,
// resume, abandon, complete) and knows nothing about sets, passes or
// activities: it asks the module whether completion is possible, whether it
// needs a confirmation, and which not-yet-sent results must travel in the
// SAME batch as `completed`. Force (STRENGTH_LOWER / STRENGTH_UPPER) has a
// real module since UX-11C.2, DH technical (main drill passes) since
// UX-11C.3, endurance (the activity performed) since UX-11C.4; every other
// family keeps the read-only module
// (canComplete = false: completion is never forced without the results the
// backend requires, e.g. the activity of an endurance session).
import type { ComponentType } from "react";
import type { FinalPrescriptionV2View } from "../finalPrescriptionV2/finalPrescriptionV2Types";
import type { ActivityResultRow, ExecutionPhase, SetResultRow } from "./executionState";
import type { ActivityResultInput, SessionExecutionBatch, SetResultInput } from "./sessionExecutionClient";
import { ReadOnlySessionModule } from "./ReadOnlySessionModule";
import { StrengthSessionModule } from "./strength/StrengthSessionModule";
import { strengthCompletion } from "./strength/strengthDraft";
import { isGuidedStrengthPrescription } from "./strength/strengthSets";
import { DhSessionModule } from "./dh/DhSessionModule";
import { dhCompletion } from "./dh/dhDraft";
import { isGuidedDhPrescription } from "./dh/dhPasses";
import { EnduranceSessionModule } from "./endurance/EnduranceSessionModule";
import { enduranceCompletion } from "./endurance/enduranceDraft";
import { isGuidedEndurancePrescription } from "./endurance/enduranceActivity";
import { COMPLETION_NOT_READY_MESSAGE } from "./guidedSessionCopy";

/** What the shell reports back after a module write (the state shown is always re-read from the database). */
export type SubmitOutcome = "ok" | "retryable" | "refused" | "ignored";

export interface ModuleContext {
  /** The execution's OWN final prescription (frozen), or the current one before the start. */
  prescription: FinalPrescriptionV2View;
  /** null before the start (read only). */
  executionId: string | null;
  phase: ExecutionPhase;
  /** Every set result of the execution (history included). */
  setResults: readonly SetResultRow[];
  /** Every activity result of the execution (history included, UX-11C.4). */
  activityResults: readonly ActivityResultRow[];
  /** Module-owned UI state kept by the shell (opaque to it), e.g. the set being entered. */
  uiState: unknown;
}

export interface GuidedSessionModuleProps extends ModuleContext {
  /** Results can be entered only on an open execution (active or paused). */
  editable: boolean;
  busy: boolean;
  setUiState: (next: unknown) => void;
  /** One logical write, built ONCE by the module (stable ids) and re-sent as is on retry. */
  submit: (action: string, batch: SessionExecutionBatch) => Promise<SubmitOutcome>;
  newId: () => string;
  now: () => string;
}

export interface ModuleCompletion {
  canComplete: boolean;
  /** Completion is possible but some prescribed work has no result: ask before completing. */
  completionNeedsConfirmation: boolean;
  /** Explanation shown while completion is not possible. */
  hint: string;
  /** The partial-completion question, in the module's own words (sets, passes…). */
  confirmationMessage: string;
  /** Valid results not sent yet: recorded in the same batch as `completed` (atomic). */
  pending: ModulePending;
}

/** Results a module adds to the `completed` batch (never sent on their own when completing). */
export interface ModulePending {
  sets?: SetResultInput[];
  activities?: ActivityResultInput[];
}

export interface GuidedSessionModule {
  /** The prescription family this module handles (strength, dh_technical, endurance, …). */
  kind: string;
  completion: (context: ModuleContext, now: () => string) => ModuleCompletion;
  Content: ComponentType<GuidedSessionModuleProps>;
}

const readOnlyModule = (kind: string): GuidedSessionModule => ({
  kind,
  completion: () => ({ canComplete: false, completionNeedsConfirmation: false, hint: COMPLETION_NOT_READY_MESSAGE, confirmationMessage: "", pending: {} }),
  Content: ReadOnlySessionModule,
});

export function resolveSessionModule(prescription: FinalPrescriptionV2View): GuidedSessionModule {
  if (isGuidedStrengthPrescription(prescription)) return { kind: "strength", completion: strengthCompletion, Content: StrengthSessionModule };
  if (isGuidedDhPrescription(prescription)) return { kind: "dh_technical", completion: dhCompletion, Content: DhSessionModule };
  if (isGuidedEndurancePrescription(prescription)) return { kind: "endurance", completion: enduranceCompletion, Content: EnduranceSessionModule };
  return readOnlyModule(prescription.family);
}
