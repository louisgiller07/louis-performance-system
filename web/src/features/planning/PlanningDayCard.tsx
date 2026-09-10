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
import type { RaceOverlayEvent, RacePriority } from "./raceOverlayRepo";
import {
  formatPlannedDuration,
  getPlannedDurationHelper,
  isDhFamilyPlannableKind,
  PLANNED_DURATION_LABEL,
  PLANNED_DURATION_NONE_LABEL,
  PLANNED_DURATION_PRESETS_MIN,
} from "./plannedDurationPolicy";

// NAL-007 — compact, French, only for the two priorities worth flagging at
// a glance (A_PLUS/A) — B/C races still show their name, just no badge, to
// avoid cluttering every lower-priority local ride with a chip.
const RACE_PRIORITY_BADGE: Partial<Record<RacePriority, string>> = {
  A_PLUS: "A+",
  A: "A",
};

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
  /**
   * NAL-007 — read-only race/event context for this date, from
   * race_calendar (the canonical source, never duplicated into
   * planned_sessions). Empty array when no race overlaps this date, or
   * when the race overlay failed to load — this component never treats
   * the two differently, and never writes anything derived from this prop.
   */
  races: RaceOverlayEvent[];
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
export function PlanningDayCard({ athleteId, date, row, races, isToday, isExpanded, onToggleExpand, onRowChange }: PlanningDayCardProps) {
  const [draftKind, setDraftKind] = useState<TrainingInterventionKind | "">("");
  const [draftLoad, setDraftLoad] = useState<LoadProfile | null>(null);
  // V0.3_006C2 — DH-only planned duration, source of truth intervention.duration_min.
  const [draftDurationMin, setDraftDurationMin] = useState<number | null>(null);
  const [draftCommitted, setDraftCommitted] = useState(false);
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
    // V0.3_006C2 — prefills the exact persisted value (§10 EDIT), never a
    // fabricated/generic value (§14 — Planning expresses athlete intent
    // only, the Head Coach's own generic session window is never mirrored
    // back here).
    setDraftDurationMin(row?.intervention?.duration_min ?? null);
    // Preserved across unrelated edits (kind/load changes) within the same
    // editing session — only an explicit toggle by the athlete changes it.
    setDraftCommitted(row?.is_committed ?? false);
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
    // V0.3_006C2 — stale-duration invariant, same reasoning: a duration
    // chosen for a DH kind must never survive a change to a different kind
    // (DH or not) — the athlete re-selects it explicitly if still relevant.
    // This is also what guarantees a DH → non-DH change never persists a
    // stale duration_min (§12): by the time handleSave runs, the draft is
    // already null for any kind other than the one it was set for.
    setDraftDurationMin(null);
    setSaveState("idle");
    setSaveError(null);
  }

  const showDuration = isDhFamilyPlannableKind(draftKind);

  async function handleSave() {
    // canSave already encodes draftKind !== "" (see its definition above).
    if (!canSave) return;
    setSaveState("saving");
    setSaveError(null);
    try {
      const saved = await savePlannedSession(
        athleteId,
        date,
        draftKind,
        isVariableKind ? draftLoad : null,
        draftCommitted,
        showDuration && draftDurationMin !== null ? String(draftDurationMin) : null
      );
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
  // NAL-007 — "Non planifié" would misleadingly suggest nothing is known
  // about this day when a race actually is; "Aucune séance ajoutée" is used
  // instead specifically when a race overlay is present but no
  // planned_session exists — the ordinary empty-day copy is unchanged.
  const noPlanLabel = races.length > 0 ? "Aucune séance ajoutée" : "Non planifié";
  const displayLabel = row ? (row.intervention ? formatIntervention(row.intervention) : legacyLabel) : noPlanLabel;

  return (
    <div className={`rounded-lg border bg-white ${isToday ? "border-gray-900" : "border-gray-200"}`}>
      {races.length > 0 && (
        <div className="flex flex-col gap-1 rounded-t-lg border-b border-amber-100 bg-amber-50 px-3 py-2">
          {races.map((race) => (
            <p key={`${race.eventName}-${race.startDate}`} className="flex items-center gap-1.5 text-xs text-amber-900">
              <span aria-hidden="true">🏁</span>
              <span className="font-medium">{race.eventName}</span>
              {RACE_PRIORITY_BADGE[race.priority] && (
                <span className="rounded bg-amber-200 px-1 text-[10px] font-semibold text-amber-900">
                  {RACE_PRIORITY_BADGE[race.priority]}
                </span>
              )}
              <span className="text-amber-700">· Course / événement</span>
            </p>
          ))}
        </div>
      )}
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

          {/*
           * V0.3_006C2 — DH-only planned duration. Athlete-authored session
           * window, exact on KEEP, an upper bound after Head Coach
           * adaptation (V0.3_006B semantics, unchanged) — never presented as
           * a pure availability ceiling. Hidden entirely for non-DH kinds
           * (§4 — non-DH duration arbitration is undefined in the engine
           * today) and reset to "no duration" on every kind change
           * (handleKindChange), so it can never leak a stale value into a
           * different/non-DH kind.
           */}
          {showDuration && (
            <div className="flex flex-col gap-1">
              <label className="flex flex-col gap-1 text-sm text-gray-700">
                {PLANNED_DURATION_LABEL}
                <select
                  value={draftDurationMin ?? ""}
                  onChange={(event) => setDraftDurationMin(event.target.value === "" ? null : Number(event.target.value))}
                  className="rounded border border-gray-300 px-3 py-3 text-base"
                >
                  <option value="">{PLANNED_DURATION_NONE_LABEL}</option>
                  {PLANNED_DURATION_PRESETS_MIN.map((min) => (
                    <option key={min} value={min}>
                      {formatPlannedDuration(min)}
                    </option>
                  ))}
                </select>
              </label>
              {/* Sibling of the label, not nested inside it — an implicit
                  <label> match resolves by the label's own accessible text
                  (with the nested control's content stripped), so extra
                  descendant text here would otherwise corrupt that match. */}
              <span className="text-xs text-gray-500">{getPlannedDurationHelper(draftKind)}</span>
            </div>
          )}

          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={draftCommitted}
              onChange={(event) => setDraftCommitted(event.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0"
            />
            <span>
              <span className="font-medium text-gray-900">Activité engagée</span>
              <br />
              <span className="text-xs text-gray-500">
                Je compte réellement faire cette activité. Le coach peut l'alléger ou l'adapter, mais évitera de la
                remplacer sauf raison importante.
              </span>
            </span>
          </label>

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
