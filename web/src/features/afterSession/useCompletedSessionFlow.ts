import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
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
import { TRAINING_KIND_LABELS } from "../dailyPlan/dailyPlanLabels";
import { loadValidDecisionsForDate } from "../history/historyRepo";
import { summarizeDecision } from "../history/historySummary";
import type { CompletedSessionError } from "../completedSession/completedSessionErrors";
import type { DecisionHistoryRow } from "../history/historyTypes";

// UX-08 — the after-session flow's state: loading, validation and writing
// only (the athlete-facing text lives in afterSessionPresentation.ts). The
// behaviour is the one CompletedSessionCard had (M5_003, V0.3_007B/C), moved
// unchanged:
// - the same-day decisions are looked up explicitly (loadValidDecisionsForDate).
//   A11: the debrief is about the day's effective session (A07) — the most
//   recent valid decision (append-only: the latest one is current) — linked
//   automatically and correctable ("Ce n'était pas ce plan"). An explicit
//   choice is asked only when that decision cannot be told apart (two
//   decisions recorded at the same instant: legacy data), and then says why;
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

/**
 * A11 — the day's effective decision (A07: the latest valid one is current).
 * null when there is none, or when the latest instant is shared by two
 * decisions (legacy ambiguity: never guessed).
 */
export function effectiveLinkableDecision(linkable: readonly LinkableDecision[]): { decision: LinkableDecision | null; ambiguous: boolean } {
  if (linkable.length === 0) return { decision: null, ambiguous: false };
  const latest = [...linkable].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (latest.length > 1 && latest[0]!.createdAt === latest[1]!.createdAt) return { decision: null, ambiguous: true };
  return { decision: latest[0]!, ambiguous: false };
}

/** A11 — where the rider was in the steps, kept with the draft (closing the sheet or a failed send never loses it). */
export interface AfterSessionProgress {
  index: number;
  statusChosen: boolean;
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
  /** A11 — legacy ambiguity only: the explicit « plan » choice is shown (with why). */
  ambiguousDecisions: boolean;
  /** A11 — the session the debrief is about (the linked decision's final session), for the « Bilan — … » title. */
  sessionLabel: string;
  progress: AfterSessionProgress;
  setProgress: Dispatch<SetStateAction<AfterSessionProgress>>;
  /** A11 — answers the rider asked for: fatigue only for a fatigue_control day, « nouvelle douleur ? » for a skipped pain day. */
  showBodyInReason: boolean;
  showPainInReason: boolean;
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
  /** A11 — reads the day's record again after a load failure (never an endless skeleton). */
  reload: () => void;
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
  const [ambiguousDecisions, setAmbiguousDecisions] = useState(false);
  const [progress, setProgress] = useState<AfterSessionProgress>({ index: 0, statusChosen: false });
  const [reloadKey, setReloadKey] = useState(0);
  // A11 — one send at a time: a double tap (or a tap during a retry) reuses the send in flight.
  const inFlight = useRef<Promise<boolean> | null>(null);
  // A11 — the unsent answers of a NEW debrief survive closing the sheet and a failed send (memory only:
  // a pain note is health data, never written to browser storage).
  const draft = useRef<{ date: string; form: CompletedSessionFormState; progress: AfterSessionProgress } | null>(null);
  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

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
  }, [date, athleteId, signOut, reloadKey]);

  // The draft follows every answer of a new debrief.
  useEffect(() => {
    if (mode === "editing" && form && !record) draft.current = { date, form, progress };
  }, [mode, form, record, date, progress]);

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
      setAmbiguousDecisions(false);
      setProgress({ index: 0, statusChosen: true });
      return;
    }
    const effective = effectiveLinkableDecision(linkable);
    setAmbiguousDecisions(effective.ambiguous);
    if (draft.current && draft.current.date === date) {
      // A11 — back to the unsent answers, where the rider left them.
      setForm(draft.current.form);
      setProgress(draft.current.progress);
      setDecisionLinkResolved(!effective.ambiguous || draft.current.form.decision_id !== null);
      return;
    }
    const base = emptyCompletedSessionForm();
    setProgress({ index: 0, statusChosen: false });
    if (effective.decision) {
      setForm({ ...base, decision_id: effective.decision.decisionId, ...prefillFromPrescription(base.completion_status, effective.decision.finalSession) });
      setDecisionLinkResolved(true);
    } else {
      setForm(base);
      setDecisionLinkResolved(!effective.ambiguous);
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
      const reason = clearReason ? "" : prev.change_reason;
      // A11 — nothing is asked that the session cannot carry: no session, no « new pain from the session »
      // (unless the rider skipped it for pain: then it is asked), no fatigue unless the day was about fatigue.
      const skippedPain = status === "skipped" ? (reason === "pain" ? { new_pain: null, new_pain_note: "" } : { new_pain: false, new_pain_note: "" }) : prev.completion_status === "skipped" ? { new_pain: null, new_pain_note: "" } : {};
      return {
        ...prev,
        completion_status: status,
        ...prefill,
        technical_outcome: "",
        ...(clearReason ? { change_reason: "", change_reason_note: "" } : {}),
        ...(reason === "fatigue_control" ? {} : { post_leg_fatigue: "", post_grip_fatigue: "" }),
        ...skippedPain,
      };
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
    // The note belongs to the reason it explains: switching reason clears it. A11 — fatigue is asked only
    // for a fatigue_control day (M1's D-1 recovery continuity), a skipped pain day asks « nouvelle douleur ? ».
    setForm((prev) => {
      if (!prev) return prev;
      const fatigue = reason === "fatigue_control" ? {} : { post_leg_fatigue: "" as const, post_grip_fatigue: "" as const };
      const pain = prev.completion_status === "skipped" ? (reason === "pain" ? { new_pain: null, new_pain_note: "" } : { new_pain: false, new_pain_note: "" }) : {};
      return { ...prev, change_reason: reason, change_reason_note: "", ...fatigue, ...pain };
    });
  }

  // A11 — idempotent by construction: the server upserts the day's ONE debrief (unique (athlete, date)),
  // so a retry after a lost answer or a second tap rewrites the same row; one send in flight at a time.
  function submit(): Promise<boolean> {
    if (inFlight.current) return inFlight.current;
    if (!form) return Promise.resolve(false);
    const result = validateCompletedSessionForm(form, date);
    if (!result.ok) return Promise.resolve(false);
    setSaveState("saving");
    setSaveError(null);
    const send = (async () => {
      const response = await putCompletedSession(result.values);
      if (!response.ok) {
        setSaveState("error");
        setSaveError(response.error);
        if (response.error.action === "session_issue") void signOut();
        return false;
      }
      const saved = response.data.completedSession;
      draft.current = null;
      setRecord(saved);
      setRecordPlanned(resolvedFinalSession(saved.decision_id));
      setSaveState("idle");
      setMode("view");
      return true;
    })().finally(() => {
      inFlight.current = null;
    });
    inFlight.current = send;
    return send;
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
  const showBodyInReason = showChangeReason && form?.change_reason === "fatigue_control";
  const showPainInReason = form?.completion_status === "skipped" && form.change_reason === "pain";
  const linkedSession = form ? resolvedFinalSession(form.decision_id) : null;
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
    ambiguousDecisions,
    sessionLabel: linkedSession ? (TRAINING_KIND_LABELS[linkedSession.kind] ?? "Séance") : "Séance libre",
    progress,
    setProgress,
    showBodyInReason,
    showPainInReason,
    linkedFinalSession: linkedSession,
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
    reload,
    setStatus,
    setDecision,
    setPerformedKind,
    setChangeReason,
    updateField,
    submit,
  };
}
