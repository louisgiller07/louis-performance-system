import { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { getCompletedSession, putCompletedSession } from "../completedSession/completedSessionRepo";
import { validateCompletedSessionForm, type CompletedSessionFieldErrors, type ValidateCompletedSessionResult } from "../completedSession/completedSessionValidation";
import {
  emptyCompletedSessionForm,
  prefillFromPrescription,
  recordToFormState,
  type ChangeReason,
  type CompletedSessionFormState,
  type CompletedSessionRecord,
  type CompletionStatus,
  type LinkableDecision,
} from "../completedSession/completedSessionTypes";
import { isPerformedLoadVariableKind } from "../completedSession/performedInterventionTypes";
import { isDhFamilyKind } from "../completedSession/dhFamilyKind";
import type { TrainingIntervention, TrainingInterventionKind } from "../dailyPlan/dailyPlanTypes";
import { loadValidDecisionsForDate } from "../history/historyRepo";
import { summarizeDecision } from "../history/historySummary";
import type { CompletedSessionError } from "../completedSession/completedSessionErrors";
import type { DecisionHistoryRow } from "../history/historyTypes";

// UX-08 — the after-session flow's state: loading, validation and writing
// only (the athlete-facing text lives in afterSessionPresentation.ts). The
// behaviour is the one CompletedSessionCard had (M5_003, V0.3_007B/C), moved
// unchanged:
// - the same-day decisions are looked up explicitly (loadValidDecisionsForDate):
//   1 → linked by default and correctable, 2+ → explicit choice required, never
//   "whatever Today shows";
// - the prescription only ever prefills an EMPTY performed activity, never
//   for "replaced", and relinking never rewrites what the athlete entered;
// - technical_outcome is cleared on any link or status change; change_reason
//   survives a relink except "coach_criterion" when the link is cleared;
// - the payload is exactly validateCompletedSessionForm's output, sent to the
//   completed-session Edge Function (no value is invented or converted).

export type LoadState = "loading" | "loaded" | "error";
export type SaveState = "idle" | "saving" | "error";
export type DecisionResolutionState = "loading" | "ready" | "error";

function toLinkable(rows: DecisionHistoryRow[]): LinkableDecision[] {
  return rows
    .map((row) => {
      const summary = summarizeDecision(row);
      if (!summary.valid) return null;
      // V0.3_007C — the exact prescribed technical task, never re-derived.
      const executionTask = summary.dailyPlan.dh_or_technical.execution_task ?? null;
      return { decisionId: row.id, createdAt: row.createdAt, finalSession: summary.dailyPlan.final_session, executionTask };
    })
    .filter((decision): decision is LinkableDecision => decision !== null);
}

export interface CompletedSessionFlow {
  loadState: LoadState;
  loadError: CompletedSessionError | null;
  record: CompletedSessionRecord | null;
  /** What the linked decision asked for (its final session), when the record is linked to a known decision. */
  recordPlanned: TrainingIntervention | null;
  mode: "view" | "editing";
  form: CompletedSessionFormState | null;
  saveState: SaveState;
  saveError: CompletedSessionError | null;
  decisionResolution: DecisionResolutionState;
  linkableDecisions: LinkableDecision[];
  decisionLinkResolved: boolean;
  /** The currently linked decision's final session / technical task (null when unlinked). */
  linkedFinalSession: TrainingIntervention | null;
  linkedExecutionTask: string | null;
  showTechnicalOutcome: boolean;
  showChangeReason: boolean;
  isRestPerformed: boolean;
  hideDurationRpe: boolean;
  skippedTypeLocked: boolean;
  isVariablePerformedKind: boolean;
  validation: ValidateCompletedSessionResult | null;
  fieldErrors: CompletedSessionFieldErrors;
  canSave: boolean;
  startEdit: () => Promise<void>;
  cancelEdit: () => void;
  setStatus: (status: CompletionStatus) => void;
  /** null = explicitly "none of these plans / free session". */
  setDecision: (decisionId: string | null) => void;
  setPerformedKind: (kind: TrainingInterventionKind | "") => void;
  setChangeReason: (reason: ChangeReason | "") => void;
  updateField: <K extends keyof CompletedSessionFormState>(key: K, value: CompletedSessionFormState[K]) => void;
  submit: () => Promise<boolean>;
}

export function useCompletedSessionFlow(date: string, athleteId: string): CompletedSessionFlow {
  const { signOut } = useAuth();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<CompletedSessionError | null>(null);
  const [record, setRecord] = useState<CompletedSessionRecord | null>(null);
  const [recordPlanned, setRecordPlanned] = useState<TrainingIntervention | null>(null);
  const [mode, setMode] = useState<"view" | "editing">("view");
  const [form, setForm] = useState<CompletedSessionFormState | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<CompletedSessionError | null>(null);
  const [decisionResolution, setDecisionResolution] = useState<DecisionResolutionState>("loading");
  const [linkableDecisions, setLinkableDecisions] = useState<LinkableDecision[]>([]);
  // False only for a brand-new row with 2+ same-day decisions and no choice
  // made yet (§20: no preselection, explicit athlete choice required).
  const [decisionLinkResolved, setDecisionLinkResolved] = useState(true);

  useEffect(() => {
    let active = true;
    setLoadState("loading");
    setLoadError(null);
    setMode("view");
    setSaveState("idle");
    setSaveError(null);
    setRecordPlanned(null);
    getCompletedSession(date).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setLoadState("error");
        setLoadError(result.error);
        if (result.error.action === "session_issue") void signOut();
        return;
      }
      setRecord(result.data);
      setLoadState("loaded");
      // UX-08 — read-only: what the linked decision asked for, for the
      // "Prévu → Réalisé" summary. Best-effort: a failure only hides "Prévu".
      const linkedId = result.data?.decision_id ?? null;
      if (linkedId) {
        loadValidDecisionsForDate(athleteId, date)
          .then((rows) => {
            if (active) setRecordPlanned(toLinkable(rows).find((decision) => decision.decisionId === linkedId)?.finalSession ?? null);
          })
          .catch(() => {});
      }
    });
    return () => {
      active = false;
    };
  }, [date, athleteId, signOut]);

  async function startEdit() {
    setSaveState("idle");
    setSaveError(null);
    setMode("editing");
    setForm(null); // never show a previous edit's answers while the day's decisions load
    setDecisionResolution("loading");

    let linkable: LinkableDecision[] = [];
    try {
      linkable = toLinkable(await loadValidDecisionsForDate(athleteId, date));
      setLinkableDecisions(linkable);
      setDecisionResolution("ready");
    } catch {
      // A failed lookup never blocks logging a session: the link degrades to
      // "none" for this edit, never guessed.
      setLinkableDecisions([]);
      setDecisionResolution("error");
    }

    if (record) {
      // Editing: the persisted decision_id is kept, never silently relinked (§21).
      setForm(recordToFormState(record));
      setDecisionLinkResolved(true);
      return;
    }
    if (linkable.length === 1) {
      const only = linkable[0]!;
      const base = emptyCompletedSessionForm();
      setForm({ ...base, decision_id: only.decisionId, ...prefillFromPrescription(base.completion_status, only.finalSession) });
      setDecisionLinkResolved(true);
    } else {
      setForm(emptyCompletedSessionForm());
      setDecisionLinkResolved(linkable.length === 0);
    }
  }

  function cancelEdit() {
    setMode("view");
    setSaveState("idle");
    setSaveError(null);
  }

  function updateField<K extends keyof CompletedSessionFormState>(key: K, value: CompletedSessionFormState[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function resolvedFinalSession(decisionId: string | null) {
    return linkableDecisions.find((decision) => decision.decisionId === decisionId)?.finalSession ?? null;
  }

  function resolvedExecutionTask(decisionId: string | null) {
    return linkableDecisions.find((decision) => decision.decisionId === decisionId)?.executionTask ?? null;
  }

  function setStatus(status: CompletionStatus) {
    setForm((prev) => {
      if (!prev) return prev;
      // Re-derives the prefill from the currently linked decision ("replaced"
      // never prefills); technical_outcome always cleared; reason cleared only
      // when the new or old status is "done".
      const prefill = prefillFromPrescription(status, resolvedFinalSession(prev.decision_id));
      const clearReason = status === "done" || prev.completion_status === "done";
      return { ...prev, completion_status: status, ...prefill, technical_outcome: "", ...(clearReason ? { change_reason: "", change_reason_note: "" } : {}) };
    });
  }

  function setDecision(decisionId: string | null) {
    setDecisionLinkResolved(true);
    setForm((prev) => {
      if (!prev) return prev;
      const clearCoachCriterion = decisionId === null && prev.change_reason === "coach_criterion";
      const reasonClear = clearCoachCriterion ? { change_reason: "" as const, change_reason_note: "" } : {};
      // A linked "skipped" session type is a projection of the link itself:
      // it always re-derives (and unlinking clears it for a fresh choice).
      if (prev.completion_status === "skipped") {
        return { ...prev, decision_id: decisionId, ...prefillFromPrescription("skipped", resolvedFinalSession(decisionId)), technical_outcome: "", ...reasonClear };
      }
      // The performed activity is the athlete's fact: only an EMPTY one on a
      // new row is prefilled, a relink never rewrites it (§21, V0.3_007B hotfix).
      const shouldPrefillPerformed = !record && decisionId !== null && prev.performed_kind === "";
      const prefill = shouldPrefillPerformed ? prefillFromPrescription(prev.completion_status, resolvedFinalSession(decisionId)) : {};
      return { ...prev, decision_id: decisionId, ...prefill, technical_outcome: "", ...reasonClear };
    });
  }

  function setPerformedKind(kind: TrainingInterventionKind | "") {
    // Any kind change clears a previously chosen load (stale-load invariant).
    setForm((prev) => (prev ? { ...prev, performed_kind: kind, performed_load: null } : prev));
  }

  function setChangeReason(reason: ChangeReason | "") {
    // The note belongs to the reason it explains: switching reason clears it.
    setForm((prev) => (prev ? { ...prev, change_reason: reason, change_reason_note: "" } : prev));
  }

  async function submit(): Promise<boolean> {
    if (!form) return false;
    const result = validateCompletedSessionForm(form, date);
    if (!result.ok) return false;
    setSaveState("saving");
    setSaveError(null);
    const response = await putCompletedSession(result.values);
    if (!response.ok) {
      setSaveState("error");
      setSaveError(response.error);
      if (response.error.action === "session_issue") void signOut();
      return false;
    }
    const saved = response.data.completedSession;
    setRecord(saved);
    setRecordPlanned(resolvedFinalSession(saved.decision_id));
    setSaveState("idle");
    setMode("view");
    return true;
  }

  // V0.3_007C — technical_outcome only for done/partial, a linked decision
  // with a real prescribed task, and a DH-family performed activity;
  // change_reason for every non-done status. Both required only when shown
  // (UI-only gate, the server never hard-requires them).
  const linkedExecutionTask = form ? resolvedExecutionTask(form.decision_id) : null;
  const showTechnicalOutcome =
    form !== null &&
    (form.completion_status === "done" || form.completion_status === "partial") &&
    form.decision_id !== null &&
    linkedExecutionTask !== null &&
    form.performed_kind !== "" &&
    isDhFamilyKind(form.performed_kind);
  const showChangeReason = form !== null && form.completion_status !== "done";
  const technicalOutcomeAnswered = !showTechnicalOutcome || form?.technical_outcome !== "";
  const changeReasonAnswered = !showChangeReason || form?.change_reason !== "";
  const isSkipped = form?.completion_status === "skipped";
  const isRestPerformed = form !== null && (isSkipped ? form.skipped_session_type : form.performed_kind) === "REST";
  const validation = form ? validateCompletedSessionForm(form, date) : null;

  return {
    loadState,
    loadError,
    record,
    recordPlanned,
    mode,
    form,
    saveState,
    saveError,
    decisionResolution,
    linkableDecisions,
    decisionLinkResolved,
    linkedFinalSession: form ? resolvedFinalSession(form.decision_id) : null,
    linkedExecutionTask,
    showTechnicalOutcome,
    showChangeReason,
    isRestPerformed,
    hideDurationRpe: isSkipped || isRestPerformed,
    skippedTypeLocked: isSkipped && form !== null && form.decision_id !== null && resolvedFinalSession(form.decision_id) !== null,
    isVariablePerformedKind: form !== null && form.performed_kind !== "" && isPerformedLoadVariableKind(form.performed_kind),
    validation,
    fieldErrors: validation && !validation.ok ? validation.errors : {},
    canSave: validation !== null && validation.ok && saveState !== "saving" && decisionLinkResolved && technicalOutcomeAnswered && changeReasonAnswered,
    startEdit,
    cancelEdit,
    setStatus,
    setDecision,
    setPerformedKind,
    setChangeReason,
    updateField,
    submit,
  };
}
