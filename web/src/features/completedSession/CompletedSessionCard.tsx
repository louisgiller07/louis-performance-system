import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../../auth/AuthContext";
import { RatingSlider } from "../../components/RatingSlider";
import { YesNoChoice } from "../../components/YesNoChoice";
import { getCompletedSession, putCompletedSession } from "./completedSessionRepo";
import { validateCompletedSessionForm } from "./completedSessionValidation";
import {
  COMPLETION_STATUSES,
  COMPLETION_STATUS_LABELS,
  SESSION_TYPES,
  SESSION_TYPE_LABELS,
  emptyCompletedSessionForm,
  formatLinkableDecisionOption,
  prefillFromPrescription,
  recordToFormState,
  type CompletedSessionFormState,
  type CompletedSessionRecord,
  type CompletionStatus,
  type LinkableDecision,
} from "./completedSessionTypes";
import { PERFORMED_KIND_GROUPS } from "./performedKindGroups";
import { isPerformedLoadVariableKind } from "./performedInterventionTypes";
import { TRAINING_KIND_LABELS, LOAD_PROFILE_LABELS } from "../dailyPlan/dailyPlanLabels";
import type { LoadProfile, TrainingInterventionKind } from "../dailyPlan/dailyPlanTypes";
import { loadValidDecisionsForDate } from "../history/historyRepo";
import { summarizeDecision } from "../history/historySummary";
import type { CompletedSessionError } from "./completedSessionErrors";

type LoadState = "loading" | "loaded" | "error";
type SaveState = "idle" | "saving" | "error";
type DecisionResolutionState = "loading" | "ready" | "error";

/** Sentinel `<select>` value for the explicit "no plan / free session" choice — distinct from "" (native unselected placeholder), see startEdit's own doc. */
const NONE_DECISION_OPTION = "__none__";

const LOAD_CHOICES: readonly LoadProfile[] = ["HEAVY", "MODERATE", "LIGHT"];

interface CompletedSessionCardProps {
  date: string;
  athleteId: string;
}

// M5_003 — post-session logging card, rendered below the DailyPlan section.
//
// V0.3_007B — the performed activity is now RICH (the same
// TrainingIntervention vocabulary Planning/the coach prescription already
// use, plus RACE_ACTIVITY — see performedInterventionTypes.ts), the ONE
// authoritative athlete-authored fact for done/partial/replaced;
// session_type is always derived from it, never independently chosen (see
// completedSessionValidation.ts). Which decision this session corresponds
// to is resolved by an explicit lookup of every VALID same-day decision
// (loadValidDecisionsForDate) — never "whatever Today currently shows".
// The link stays athlete-visible and correctable whenever at least one
// same-day decision exists (1 -> pre-selected, no forced extra tap; 2+ ->
// explicit choice required), because even a single same-day decision is
// not proof it was actually followed (V0.3_007B final review, Issue A —
// docs/11_DECISION_LOG.md V0.3_007B). No JSON editor: main_content is
// carried opaquely through the form and never displayed/edited here.
export function CompletedSessionCard({ date, athleteId }: CompletedSessionCardProps) {
  const { signOut } = useAuth();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<CompletedSessionError | null>(null);
  const [record, setRecord] = useState<CompletedSessionRecord | null>(null);
  const [mode, setMode] = useState<"view" | "editing">("view");
  const [form, setForm] = useState<CompletedSessionFormState | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<CompletedSessionError | null>(null);

  const [decisionResolution, setDecisionResolution] = useState<DecisionResolutionState>("loading");
  const [linkableDecisions, setLinkableDecisions] = useState<LinkableDecision[]>([]);
  // True once the athlete has made an explicit choice (or none was needed —
  // 0/1 same-day decisions, or editing an existing row's already-persisted
  // link). False only for a brand-new row with 2+ same-day decisions and no
  // choice made yet — Save stays disabled until then (§20: "No preselected
  // decision. Require an explicit athlete choice.").
  const [decisionLinkResolved, setDecisionLinkResolved] = useState(true);

  useEffect(() => {
    let active = true;
    setLoadState("loading");
    setLoadError(null);
    setMode("view");
    setSaveState("idle");
    setSaveError(null);
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
    });
    return () => {
      active = false;
    };
  }, [date, signOut]);

  async function startEdit() {
    setSaveState("idle");
    setSaveError(null);
    setMode("editing");
    setDecisionResolution("loading");

    let linkable: LinkableDecision[] = [];
    try {
      const rows = await loadValidDecisionsForDate(athleteId, date);
      linkable = rows
        .map((row) => {
          const summary = summarizeDecision(row);
          return summary.valid ? { decisionId: row.id, createdAt: row.createdAt, finalSession: summary.dailyPlan.final_session } : null;
        })
        .filter((d): d is LinkableDecision => d !== null);
      setLinkableDecisions(linkable);
      setDecisionResolution("ready");
    } catch {
      // A failed lookup must never block logging a session — it only means
      // decision-linking degrades to "no link" for this edit; the athlete
      // can still record everything else. Never silently guessed either.
      setLinkableDecisions([]);
      setDecisionResolution("error");
    }

    if (record) {
      // Editing an existing row: its persisted decision_id is preserved by
      // default, never silently relinked to a newer decision (§21) — the
      // selector (if shown) starts on that persisted value, already resolved.
      setForm(recordToFormState(record));
      setDecisionLinkResolved(true);
      return;
    }

    // New row.
    if (linkable.length === 1) {
      const only = linkable[0]!;
      const base = emptyCompletedSessionForm();
      setForm({ ...base, decision_id: only.decisionId, ...prefillFromPrescription(base.completion_status, only.finalSession) });
      setDecisionLinkResolved(true);
    } else if (linkable.length === 0) {
      setForm(emptyCompletedSessionForm());
      setDecisionLinkResolved(true);
    } else {
      // 2+ — no preselection, explicit choice required.
      setForm(emptyCompletedSessionForm());
      setDecisionLinkResolved(false);
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
    return linkableDecisions.find((d) => d.decisionId === decisionId)?.finalSession ?? null;
  }

  function handleStatusChange(status: CompletionStatus) {
    setForm((prev) => {
      if (!prev) return prev;
      // Every status change re-derives the prefill from the CURRENTLY
      // resolved decision (never a stale one) — switching to `replaced`
      // always clears any prior selection rather than silently keeping it
      // (§6): prefillFromPrescription itself returns unselected for `replaced`.
      const prefill = prefillFromPrescription(status, resolvedFinalSession(prev.decision_id));
      return { ...prev, completion_status: status, ...prefill };
    });
  }

  function handleDecisionChange(rawValue: string) {
    const newDecisionId = rawValue === "" || rawValue === NONE_DECISION_OPTION ? null : rawValue;
    setDecisionLinkResolved(rawValue !== "");
    setForm((prev) => {
      if (!prev) return prev;
      // A linked SKIPPED's coarse session_type is NOT independent
      // athlete-observed truth — it is a pure derived projection of the
      // link itself (V0.3_007B final semantic proof, Issue B: "I did not
      // perform the session prescribed by THIS linked plan"). Unlike
      // performed intervention (done/partial/replaced, protected below), it
      // always re-derives from whichever decision is currently linked, for
      // both a brand-new row AND an existing one — there is no independently
      // recorded fact to protect. Unlinking clears it (forces an explicit
      // fresh manual choice) rather than silently keeping a stale derived
      // value.
      if (prev.completion_status === "skipped") {
        return { ...prev, decision_id: newDecisionId, ...prefillFromPrescription("skipped", resolvedFinalSession(newDecisionId)) };
      }
      // Performed intervention (done/partial/replaced) IS independent
      // athlete-observed truth — correcting an EXISTING row's link must
      // never retroactively alter it (§21) — prefill only applies when
      // creating a brand-new row. And within a new row, clearing TO "Aucun
      // de ces plans / séance libre" must never erase whatever the athlete
      // already entered (Issue A: a free session logged after the fact is
      // not "no data", it's "no plan followed") — prefill only fires when
      // actively selecting an actual decision to follow, never when
      // explicitly unlinking.
      const prefill = record || newDecisionId === null ? {} : prefillFromPrescription(prev.completion_status, resolvedFinalSession(newDecisionId));
      return { ...prev, decision_id: newDecisionId, ...prefill };
    });
  }

  function handlePerformedKindChange(kind: TrainingInterventionKind | "") {
    updateField("performed_kind", kind);
    // Stale-load invariant, same reasoning as Planning's own picker: any
    // kind change clears a previously chosen load.
    updateField("performed_load", null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    const validation = validateCompletedSessionForm(form, date);
    if (!validation.ok) return; // Save is disabled until valid — this is a defensive no-op, not the primary guard.

    setSaveState("saving");
    setSaveError(null);
    const result = await putCompletedSession(validation.values);
    if (!result.ok) {
      setSaveState("error");
      setSaveError(result.error);
      if (result.error.action === "session_issue") void signOut();
      return;
    }

    setRecord(result.data.completedSession);
    setSaveState("idle");
    setMode("view");
  }

  const validation = form ? validateCompletedSessionForm(form, date) : null;
  const canSave = validation !== null && validation.ok && saveState !== "saving" && decisionLinkResolved;
  const fieldErrors = validation && !validation.ok ? validation.errors : {};

  if (loadState === "loading") {
    return <p className="text-sm text-gray-400">Chargement…</p>;
  }
  if (loadState === "error") {
    return <p className="text-sm text-red-600">{loadError?.message ?? "Impossible de charger ta séance. Réessaie dans un instant."}</p>;
  }

  if (mode === "view") {
    if (record === null) {
      return (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-500">Comment s'est passée ta séance ?</p>
          <button
            type="button"
            onClick={() => void startEdit()}
            className="min-h-11 rounded bg-gray-900 px-4 py-3 text-sm font-medium text-white"
          >
            Enregistrer la séance
          </button>
        </div>
      );
    }

    const performedLabel =
      record.intervention &&
      (TRAINING_KIND_LABELS[record.intervention.kind] ?? record.intervention.kind) +
        (record.intervention.load_profile ? ` · ${LOAD_PROFILE_LABELS[record.intervention.load_profile]}` : "");

    return (
      <div className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
          <dt className="text-gray-400">Statut</dt>
          <dd className="text-gray-900">{COMPLETION_STATUS_LABELS[record.completion_status]}</dd>

          <dt className="text-gray-400">Activité</dt>
          <dd className="text-gray-900">{performedLabel ?? SESSION_TYPE_LABELS[record.session_type]}</dd>

          {record.actual_duration_min !== null && (
            <>
              <dt className="text-gray-400">Durée</dt>
              <dd className="text-gray-900">{record.actual_duration_min} min</dd>
            </>
          )}

          {record.rpe !== null && (
            <>
              <dt className="text-gray-400">RPE</dt>
              <dd className="text-gray-900">{record.rpe}/10</dd>
            </>
          )}

          {record.post_leg_fatigue !== null && (
            <>
              <dt className="text-gray-400">Fatigue jambes</dt>
              <dd className="text-gray-900">{record.post_leg_fatigue}/10</dd>
            </>
          )}

          {record.post_grip_fatigue !== null && (
            <>
              <dt className="text-gray-400">Fatigue grip</dt>
              <dd className="text-gray-900">{record.post_grip_fatigue}/10</dd>
            </>
          )}

          {record.session_load !== null && (
            <>
              <dt className="text-gray-400">Charge</dt>
              <dd className="text-gray-900">{record.session_load}</dd>
            </>
          )}
        </dl>

        {record.new_pain && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-sm font-medium text-gray-900">Tu as indiqué une nouvelle douleur.</p>
            {record.new_pain_note && <p className="mt-1 text-sm text-gray-700">{record.new_pain_note}</p>}
            <p className="mt-2 text-xs text-gray-500">
              Pense à la mentionner dans ton prochain check-in afin qu'elle fasse partie des informations de readiness.
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={() => void startEdit()}
          className="min-h-11 self-start rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
        >
          Modifier
        </button>
      </div>
    );
  }

  // mode === "editing"
  if (!form) return null;

  const isSkipped = form.completion_status === "skipped";
  // V0.3_007B final review, Issue A: even with exactly one same-day
  // decision, auto-linking it is not always correct (e.g. a free session
  // performed before any plan existed, only linked-by-coincidence to a
  // plan generated later the same day) — the association must stay
  // athlete-visible and correctable, never silently inferred and hidden.
  // The common (1-decision) case stays low-friction: no forced extra tap
  // (decisionLinkResolved is already true from startEdit), just a visible,
  // pre-selected, editable row. 0 decisions has nothing to show or choose.
  const showDecisionSelector = decisionResolution === "ready" && linkableDecisions.length >= 1;
  // V0.3_007B final semantic proof, Issue B: while a SKIPPED row stays
  // linked to a resolvable decision, its coarse type is DERIVED from that
  // decision's prescription, never an independent athlete choice — locked
  // (not just defaulted) so it can't silently drift out of sync with the
  // link while the server-side coherence check (index.ts's decision
  // preflight) still authoritatively rejects any mismatch either way. To
  // record a different skipped activity, the athlete must first unlink via
  // "Aucun de ces plans / séance libre", which clears the field for an
  // explicit fresh manual choice.
  const skippedTypeLocked = isSkipped && form.decision_id !== null && resolvedFinalSession(form.decision_id) !== null;
  const isVariablePerformedKind = form.performed_kind !== "" && isPerformedLoadVariableKind(form.performed_kind);
  // REST never requires an invented duration/RPE (see completedSessionValidation.ts) —
  // deliberately not generalized to any other kind.
  const isRestPerformed = (isSkipped ? form.skipped_session_type : form.performed_kind) === "REST";
  const hideDurationRpe = isSkipped || isRestPerformed;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm text-gray-700">
        Statut
        <select
          value={form.completion_status}
          onChange={(event) => handleStatusChange(event.target.value as CompletionStatus)}
          className="rounded border border-gray-300 px-3 py-3 text-base"
        >
          {COMPLETION_STATUSES.map((status) => (
            <option key={status} value={status}>
              {COMPLETION_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        {fieldErrors.completion_status && (
          <span role="alert" className="text-xs text-red-600">
            {fieldErrors.completion_status}
          </span>
        )}
      </label>

      {/*
       * V0.3_007B (final review, Issue A) — which decision this session
       * corresponds to. Hidden entirely only for 0 same-day valid decisions
       * (nothing to choose from). Shown for 1 (pre-selected, auto-linked —
       * no forced extra tap, but visible and correctable to "Aucun de ces
       * plans / séance libre": a single same-day decision is not proof it
       * was actually followed) and for 2+ (no preselection, explicit choice
       * required — the "regenerated after already riding" case).
       */}
      {decisionResolution === "error" && (
        <p className="text-xs text-gray-400">Impossible de vérifier les plans du jour — la séance peut toujours être enregistrée sans lien.</p>
      )}
      {showDecisionSelector && (
        <label className="flex flex-col gap-1 text-sm text-gray-700">
          Quel plan as-tu suivi ?
          <select
            value={decisionLinkResolved ? (form.decision_id ?? NONE_DECISION_OPTION) : ""}
            onChange={(event) => handleDecisionChange(event.target.value)}
            className="rounded border border-gray-300 px-3 py-3 text-base"
          >
            <option value="" disabled>
              — Choisir —
            </option>
            {linkableDecisions.map((decision) => (
              <option key={decision.decisionId} value={decision.decisionId}>
                {formatLinkableDecisionOption(decision)}
              </option>
            ))}
            <option value={NONE_DECISION_OPTION}>Aucun de ces plans / séance libre</option>
          </select>
        </label>
      )}

      {isSkipped ? (
        <label className="flex flex-col gap-1 text-sm text-gray-700">
          Type de séance non faite
          <select
            value={form.skipped_session_type}
            onChange={(event) => updateField("skipped_session_type", event.target.value as CompletedSessionFormState["skipped_session_type"])}
            disabled={skippedTypeLocked}
            className="rounded border border-gray-300 px-3 py-3 text-base disabled:bg-gray-100 disabled:text-gray-500"
          >
            <option value="" disabled>
              — Choisir —
            </option>
            {SESSION_TYPES.map((type) => (
              <option key={type} value={type}>
                {SESSION_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          {skippedTypeLocked && (
            <span className="text-xs text-gray-400">
              Dérivé du plan lié — choisis « Aucun de ces plans / séance libre » ci-dessus pour modifier.
            </span>
          )}
          {fieldErrors.skipped_session_type && (
            <span role="alert" className="text-xs text-red-600">
              {fieldErrors.skipped_session_type}
            </span>
          )}
        </label>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-sm text-gray-700">
            Activité réellement effectuée
            <select
              value={form.performed_kind}
              onChange={(event) => handlePerformedKindChange(event.target.value as TrainingInterventionKind | "")}
              className="rounded border border-gray-300 px-3 py-3 text-base"
            >
              <option value="" disabled>
                — Choisir —
              </option>
              {PERFORMED_KIND_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.kinds.map((kind) => (
                    <option key={kind} value={kind}>
                      {TRAINING_KIND_LABELS[kind]}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {fieldErrors.performed_kind && (
              <span role="alert" className="text-xs text-red-600">
                {fieldErrors.performed_kind}
              </span>
            )}
          </label>

          {isVariablePerformedKind && (
            <div role="group" aria-label="Intensité" className="flex gap-2">
              {LOAD_CHOICES.map((load) => (
                <button
                  key={load}
                  type="button"
                  aria-pressed={form.performed_load === load}
                  onClick={() => updateField("performed_load", load)}
                  className={`min-h-11 flex-1 rounded border px-2 py-2 text-xs font-medium ${
                    form.performed_load === load ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-700"
                  }`}
                >
                  {LOAD_PROFILE_LABELS[load]}
                </button>
              ))}
            </div>
          )}
          {fieldErrors.performed_load && (
            <span role="alert" className="text-xs text-red-600">
              {fieldErrors.performed_load}
            </span>
          )}
        </>
      )}

      {!hideDurationRpe && (
        <label className="flex flex-col gap-1 text-sm text-gray-700">
          Durée (minutes)
          <input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={form.actual_duration_min}
            onChange={(event) => updateField("actual_duration_min", event.target.value === "" ? "" : Number(event.target.value))}
            className="rounded border border-gray-300 px-3 py-3 text-base"
          />
          {fieldErrors.actual_duration_min && (
            <span role="alert" className="text-xs text-red-600">
              {fieldErrors.actual_duration_min}
            </span>
          )}
        </label>
      )}

      {!hideDurationRpe && (
        <RatingSlider
          label="Effort global ressenti"
          value={form.rpe}
          onChange={(value) => updateField("rpe", value)}
          error={fieldErrors.rpe}
          helper="À quel point cette séance t'a sollicité globalement ?"
        />
      )}

      <RatingSlider
        label="Fatigue jambes"
        value={form.post_leg_fatigue}
        onChange={(value) => updateField("post_leg_fatigue", value)}
        error={fieldErrors.post_leg_fatigue}
      />
      <RatingSlider
        label="Fatigue grip"
        value={form.post_grip_fatigue}
        onChange={(value) => updateField("post_grip_fatigue", value)}
        error={fieldErrors.post_grip_fatigue}
      />

      <YesNoChoice
        label={isSkipped ? "Une nouvelle douleur aujourd'hui ?" : "Une nouvelle douleur pendant ou après la séance ?"}
        value={form.new_pain}
        onChange={(value) => updateField("new_pain", value)}
        error={fieldErrors.new_pain}
      />

      {form.new_pain === true && (
        <label className="flex flex-col gap-1 text-sm text-gray-700">
          Décris la douleur
          <textarea
            aria-label="Décris la douleur"
            value={form.new_pain_note}
            onChange={(event) => updateField("new_pain_note", event.target.value)}
            rows={2}
            className="rounded border border-gray-300 px-3 py-3 text-base"
          />
          {fieldErrors.new_pain_note && (
            <span role="alert" className="text-xs text-red-600">
              {fieldErrors.new_pain_note}
            </span>
          )}
        </label>
      )}

      {saveState === "error" && saveError && (
        <p role="alert" className="text-sm text-red-600">
          {saveError.message}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!canSave}
          className="min-h-11 flex-1 rounded bg-gray-900 px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
        >
          {saveState === "saving" ? "Enregistrement…" : "Enregistrer"}
        </button>
        <button
          type="button"
          onClick={cancelEdit}
          disabled={saveState === "saving"}
          className="min-h-11 rounded border border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 disabled:opacity-50"
        >
          Annuler
        </button>
      </div>
    </form>
  );
}
