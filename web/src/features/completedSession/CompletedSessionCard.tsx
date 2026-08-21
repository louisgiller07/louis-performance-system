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
  recordToFormState,
  type CompletedSessionFormState,
  type CompletedSessionRecord,
  type LiveDecisionContext,
} from "./completedSessionTypes";
import type { CompletedSessionError } from "./completedSessionErrors";

type LoadState = "loading" | "loaded" | "error";
type SaveState = "idle" | "saving" | "error";

interface CompletedSessionCardProps {
  date: string;
  /**
   * The exact decisionId + coarse session_type from the current in-memory
   * Today UI lifecycle — i.e. DailyPlanPanel's last successful daily-run
   * result for this same `date`, or null. Never a "latest"/"nearest"
   * decision looked up from history, never persisted across reloads (see
   * DailyPlanPanel's onLiveContextChange doc). Only used to preselect a
   * brand-new (no existing row) form — an existing row's own decision_id
   * AND session_type always win over this.
   */
  liveContext: LiveDecisionContext | null;
}

// M5_003 — post-session logging card, rendered below the DailyPlan section.
// No JSON editor: intervention/main_content are carried opaquely through
// the form (see completedSessionTypes.ts) and never displayed/edited here.
export function CompletedSessionCard({ date, liveContext }: CompletedSessionCardProps) {
  const { signOut } = useAuth();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<CompletedSessionError | null>(null);
  const [record, setRecord] = useState<CompletedSessionRecord | null>(null);
  const [mode, setMode] = useState<"view" | "editing">("view");
  const [form, setForm] = useState<CompletedSessionFormState | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<CompletedSessionError | null>(null);

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
        // Mirrors DailyPlanPanel's existing convention: a session_issue
        // error is the app's one established signal that the JWT is no
        // longer valid, and signOut() is the existing mechanism that
        // clears AuthContext's session and lets RequireAuth redirect to
        // /login — not a second, invented auth system.
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

  function startEdit() {
    setForm(record ? recordToFormState(record) : emptyCompletedSessionForm(liveContext));
    setSaveState("idle");
    setSaveError(null);
    setMode("editing");
  }

  function cancelEdit() {
    setMode("view");
    setSaveState("idle");
    setSaveError(null);
  }

  function updateField<K extends keyof CompletedSessionFormState>(key: K, value: CompletedSessionFormState[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
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
      // Form state is deliberately preserved on error — never cleared,
      // never reverted to view mode, so the user can retry without
      // re-entering everything.
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
  const canSave = validation !== null && validation.ok && saveState !== "saving";
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
          <p className="text-sm text-gray-500">How did today go?</p>
          <button
            type="button"
            onClick={startEdit}
            className="min-h-11 rounded bg-gray-900 px-4 py-3 text-sm font-medium text-white"
          >
            Log session
          </button>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
          <dt className="text-gray-400">Statut</dt>
          <dd className="text-gray-900">{COMPLETION_STATUS_LABELS[record.completion_status]}</dd>

          <dt className="text-gray-400">Type</dt>
          <dd className="text-gray-900">{SESSION_TYPE_LABELS[record.session_type]}</dd>

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
          // Deliberately neutral, not a warning: this is informational
          // only — M5_003 persists the raw fact, nothing more. It never
          // creates a health_flag, never runs Safety, never implies the
          // plan/coach already reacted to it. Same visual language as the
          // rest of the app (gray, not red/border-red/bg-red).
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
          onClick={startEdit}
          className="min-h-11 self-start rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
        >
          Edit
        </button>
      </div>
    );
  }

  // mode === "editing"
  if (!form) return null;

  const isSkipped = form.completion_status === "skipped";
  // REST never requires an invented duration/RPE (see completedSessionValidation.ts) —
  // deliberately not generalized to any other session_type.
  const isRest = form.session_type === "REST";
  const hideDurationRpe = isSkipped || isRest;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm text-gray-700">
        Statut
        <select
          value={form.completion_status}
          onChange={(event) => updateField("completion_status", event.target.value as CompletedSessionFormState["completion_status"])}
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

      <label className="flex flex-col gap-1 text-sm text-gray-700">
        Type de séance
        <select
          value={form.session_type}
          onChange={(event) => updateField("session_type", event.target.value as CompletedSessionFormState["session_type"])}
          className="rounded border border-gray-300 px-3 py-3 text-base"
        >
          {/* No session type is ever preselected as a real value unless the
              live DailyPlan (or an existing row) actually provided one —
              this placeholder is the explicit "not yet chosen" state, never
              silently defaulted to RECOVERY or any other real type. */}
          <option value="">—</option>
          {SESSION_TYPES.map((type) => (
            <option key={type} value={type}>
              {SESSION_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
        {fieldErrors.session_type && (
          <span role="alert" className="text-xs text-red-600">
            {fieldErrors.session_type}
          </span>
        )}
      </label>

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
        <RatingSlider label="RPE" value={form.rpe} onChange={(value) => updateField("rpe", value)} error={fieldErrors.rpe} />
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
        label={isSkipped || isRest ? "Any new pain today?" : "New pain during or after the session?"}
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
          {saveState === "saving" ? "Enregistrement…" : "Save"}
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
