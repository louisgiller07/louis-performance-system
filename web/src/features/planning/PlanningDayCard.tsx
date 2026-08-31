import { useEffect, useState } from "react";
import { formatCalendarDate } from "../../lib/date";
import { formatIntervention, LOAD_PROFILE_LABELS, TRAINING_KIND_LABELS } from "../dailyPlan/dailyPlanLabels";
// Coarse DbSessionType → French label — the canonical existing home for
// this mapping (already used by CompletedSessionCard). Reused here, never
// duplicated, for the one legacy case a Planning row can be in: a pre-M2_003
// row with intervention=NULL, where only the coarse session_type is known.
import { SESSION_TYPE_LABELS } from "../completedSession/completedSessionTypes";
import { deletePlannedSession, InvalidPlannedInterventionError, PlanningDeleteError, PlanningSaveError, savePlannedSession } from "./planningRepo";
import { PLANNING_KIND_GROUPS } from "./planningKindGroups";
import { isPlannableFixedLoadKind, isPlannableLoadVariableKind } from "./planningTypes";
import type { LoadProfile, PlannedSessionRow, TrainingInterventionKind } from "./planningTypes";

const GENERIC_ERROR_MESSAGE = "Une erreur est survenue. Réessaie dans un instant.";

// Only ever surfaces the known, already-curated (never-raw-PostgREST)
// Planning error messages. Any other exception (e.g. a rejected fetch from
// a genuine network failure, which planningRepo.ts does not itself catch)
// falls back to a generic message instead of showing error.message verbatim.
function safeErrorMessage(error: unknown): string {
  if (error instanceof PlanningSaveError || error instanceof PlanningDeleteError || error instanceof InvalidPlannedInterventionError) {
    return error.message;
  }
  return GENERIC_ERROR_MESSAGE;
}

const WEEKDAY_FORMAT = new Intl.DateTimeFormat("fr-CH", { weekday: "short" });

function weekdayLabel(dateISO: string): string {
  const [year, month, day] = dateISO.split("-").map(Number);
  return WEEKDAY_FORMAT.format(new Date(year, month - 1, day));
}

const LOAD_CHOICES: readonly LoadProfile[] = ["HEAVY", "MODERATE", "LIGHT"];

interface PlanningDayCardProps {
  athleteId: string;
  date: string;
  /** Canonical persisted row for this date, owned by PlanPage — this component never keeps its own copy of "what's persisted". */
  row: PlannedSessionRow | null;
  isToday: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  /** Called only after a successful save/delete, with the new persisted row (or null after a delete) — PlanPage updates its canonical state and collapses the editor. */
  onRowChange: (date: string, row: PlannedSessionRow | null) => void;
}

/**
 * One day of the /plan weekly view. Owns only its own draft/editor state
 * (draft kind, draft load, save/error state) — the persisted `row` always
 * comes from PlanPage as a prop. REST is not a special case here: it is
 * just another selectable kind, saved through the normal savePlannedSession
 * path, and formatIntervention already renders it as "Repos".
 */
export function PlanningDayCard({ athleteId, date, row, isToday, isExpanded, onToggleExpand, onRowChange }: PlanningDayCardProps) {
  const [draftKind, setDraftKind] = useState<TrainingInterventionKind | "">("");
  const [draftLoad, setDraftLoad] = useState<LoadProfile | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  // Re-initializes the draft only at the collapsed→expanded transition —
  // deliberately keyed on `isExpanded` alone (not `row`), so a parent
  // re-render while the editor stays open can never clobber an
  // in-progress, unsaved draft.
  useEffect(() => {
    if (!isExpanded) return;
    setDraftKind(row?.intervention?.kind ?? "");
    setDraftLoad(row?.intervention?.load_profile ?? null);
    setSaveState("idle");
    setSaveError(null);
    // Intentionally omits `row` from deps — see comment above.
  }, [isExpanded]);

  const isVariableKind = draftKind !== "" && isPlannableLoadVariableKind(draftKind);
  const isFixedKind = draftKind !== "" && isPlannableFixedLoadKind(draftKind);
  const canSave = draftKind !== "" && (isFixedKind || (isVariableKind && draftLoad !== null));

  function handleKindChange(value: string) {
    setDraftKind(value as TrainingInterventionKind | "");
    // Stale-load invariant: any kind change clears a previously chosen
    // load — never silently carried over to a different intervention.
    setDraftLoad(null);
    setSaveState("idle");
    setSaveError(null);
  }

  async function handleSave() {
    // canSave already encodes draftKind !== "" (see its definition above).
    if (!canSave) return;
    setSaveState("saving");
    setSaveError(null);
    try {
      const saved = await savePlannedSession(athleteId, date, draftKind, isVariableKind ? draftLoad : null);
      onRowChange(date, saved);
    } catch (error) {
      setSaveState("error");
      setSaveError(safeErrorMessage(error));
    }
  }

  async function handleDelete() {
    setSaveState("saving");
    setSaveError(null);
    try {
      await deletePlannedSession(athleteId, date);
      onRowChange(date, null);
    } catch (error) {
      setSaveState("error");
      setSaveError(safeErrorMessage(error));
    }
  }

  // A legacy row (written before M2_003, or by any other pre-Planning path)
  // can have intervention=NULL — only the coarse session_type is known.
  // Never reverse-inferred into a fabricated rich TrainingIntervention: the
  // coarse label is displayed as-is, and the picker below always starts
  // unselected for this case (draftKind initializes from
  // row?.intervention?.kind, which is undefined here).
  const isLegacyRow = row !== null && row.intervention === null;
  // Never falls back to the raw row.session_type value — an internal
  // DbSessionType enum must never reach the athlete-facing UI, even for a
  // legacy row whose coarse type somehow isn't in SESSION_TYPE_LABELS
  // despite the typed contract (same discipline as TodayPlanningSummary.tsx).
  const legacyLabel = row ? (SESSION_TYPE_LABELS[row.session_type] ?? "Séance planifiée (ancienne)") : null;
  const displayLabel = row ? (row.intervention ? formatIntervention(row.intervention) : legacyLabel) : "Non planifié";

  return (
    <div className={`rounded-lg border bg-white ${isToday ? "border-gray-900" : "border-gray-200"}`}>
      <button type="button" onClick={onToggleExpand} className="min-h-11 w-full p-3 text-left active:bg-gray-50">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
          {isToday && <span className="text-gray-900">Aujourd'hui · </span>}
          {weekdayLabel(date)} {formatCalendarDate(date)}
        </p>
        <p className={`mt-1 font-medium ${row ? "text-gray-900" : "text-gray-400"}`}>{displayLabel}</p>
      </button>

      {isExpanded && (
        <div className="flex flex-col gap-3 border-t border-gray-100 p-3">
          {isLegacyRow && (
            <p className="text-xs text-gray-500">
              Ancienne séance planifiée : {legacyLabel}. Choisis une séance pour la modifier.
            </p>
          )}

          <label className="flex flex-col gap-1 text-sm text-gray-700">
            Séance
            <select
              value={draftKind}
              onChange={(event) => handleKindChange(event.target.value)}
              className="rounded border border-gray-300 px-3 py-3 text-base"
            >
              <option value="" disabled>
                — Choisir —
              </option>
              {PLANNING_KIND_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.kinds.map((kind) => (
                    <option key={kind} value={kind}>
                      {TRAINING_KIND_LABELS[kind]}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          {isVariableKind && (
            <div role="group" aria-label="Intensité" className="flex gap-2">
              {LOAD_CHOICES.map((load) => (
                <button
                  key={load}
                  type="button"
                  aria-pressed={draftLoad === load}
                  onClick={() => setDraftLoad(load)}
                  className={`min-h-11 flex-1 rounded border px-2 py-2 text-xs font-medium ${
                    draftLoad === load ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-700"
                  }`}
                >
                  {LOAD_PROFILE_LABELS[load]}
                </button>
              ))}
            </div>
          )}

          {saveState === "error" && saveError && (
            <p role="alert" className="text-sm text-red-600">
              {saveError}
            </p>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!canSave || saveState === "saving"}
              className="min-h-11 rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 sm:flex-1"
            >
              {saveState === "saving" ? "Enregistrement…" : "Enregistrer"}
            </button>
            {row && (
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={saveState === "saving"}
                className="min-h-11 rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 disabled:opacity-50"
              >
                Retirer du planning
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
