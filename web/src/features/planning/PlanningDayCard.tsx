import { useEffect, useState } from "react";
import { formatCalendarDate } from "../../lib/date";
import { LOAD_PROFILE_LABELS, TRAINING_KIND_LABELS } from "../dailyPlan/dailyPlanLabels";
import { Badge } from "../../components/Badge";
import { PrimaryButton } from "../../components/PrimaryButton";
import { SecondaryButton } from "../../components/SecondaryButton";
// Coarse DbSessionType → French label — the canonical existing home for
// this mapping (already used by useCompletedSessionFlow (UX-08)). Reused here, never
// duplicated, for the one legacy case a Planning row can be in: a pre-M2_003
// row with intervention=NULL, where only the coarse session_type is known.
import { SESSION_TYPE_LABELS } from "../completedSession/completedSessionTypes";
import { deletePlannedSession, InvalidPlannedInterventionError, PlanningDeleteError, PlanningSaveError, savePlannedSession } from "./planningRepo";
import { PLANNING_KIND_GROUPS } from "./planningKindGroups";
import { isPlannableFixedLoadKind, isPlannableLoadVariableKind, PLANNABLE_KINDS } from "./planningTypes";
import type { LoadProfile, PlannedSessionRow, TrainingInterventionKind } from "./planningTypes";
import type { RaceOverlayEvent, RacePriority } from "./raceOverlayRepo";
import { getPlannedDurationHelper, isDhFamilyPlannableKind, PLANNED_DURATION_PRESETS_MIN } from "./plannedDurationPolicy";
import { DAY, dayBadge, dayState, EDITOR, formatDuration, kindLabel, loadLabel } from "./weekPresentation";
import type { PlanDaySession } from "./weekPresentation";

// NAL-007 — compact, only for the two priorities worth flagging at a glance
// (A_PLUS/A) — B/C races still show their name, just no badge.
const RACE_PRIORITY_BADGE: Partial<Record<RacePriority, string>> = {
  A_PLUS: "A+",
  A: "A",
};

// Only ever surfaces the known, already-curated (never-raw-PostgREST)
// Planning error messages. Any other exception (e.g. a rejected fetch from
// a genuine network failure, which planningRepo.ts does not itself catch)
// falls back to a generic message instead of showing error.message verbatim.
function safeErrorMessage(error: unknown): string {
  if (error instanceof PlanningSaveError || error instanceof PlanningDeleteError || error instanceof InvalidPlannedInterventionError) {
    return error.message;
  }
  return EDITOR.genericError;
}

const WEEKDAY_FORMAT = new Intl.DateTimeFormat("fr-CH", { weekday: "short" });

function weekdayLabel(dateISO: string): string {
  const [year, month, day] = dateISO.split("-").map(Number);
  return WEEKDAY_FORMAT.format(new Date(year, month - 1, day));
}

const LOAD_CHOICES: readonly LoadProfile[] = ["HEAVY", "MODERATE", "LIGHT"];
const MIN_DURATION = PLANNED_DURATION_PRESETS_MIN[0];
const MAX_DURATION = PLANNED_DURATION_PRESETS_MIN[PLANNED_DURATION_PRESETS_MIN.length - 1];
const DURATION_STEP = 30;

function asPlannableKind(kind: string | undefined): TrainingInterventionKind | "" {
  return kind && (PLANNABLE_KINDS as readonly string[]).includes(kind) ? (kind as TrainingInterventionKind) : "";
}

interface PlanningDayCardProps {
  athleteId: string;
  date: string;
  /** Canonical persisted row for this date, owned by PlanPage — this component never keeps its own copy of "what's persisted". */
  row: PlannedSessionRow | null;
  /** UX-10B-2B — the active plan's session for this date (read-only), `null` when the plan has none. */
  planSession?: PlanDaySession | null;
  /** UX-10B-2B — false when the active plan could not be read: no "Libre" / "Revenir au plan" claim is made then. */
  planKnown?: boolean;
  /** UX-10B-2B — one-line confirmation of the last action on this day (owned by PlanPage). */
  notice?: string | null;
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
  /** Called only after a successful save/delete, with the new persisted row (or null after a delete) and an optional confirmation — PlanPage updates its canonical state and collapses the editor. */
  onRowChange: (date: string, row: PlannedSessionRow | null, notice?: string) => void;
}

/**
 * One day of "Modifier ma semaine" (UX-10B-2B). Owns only its own draft
 * state — the persisted `row` and the plan's session always come from
 * PlanPage. The editor mirrors "Après ta séance": session chips, three
 * intensity buttons, a − / + duration for DH-family kinds, a "Séance
 * engagée" switch. The secondary action depends on where the day stands:
 * "Passer en repos" (plan day), "Revenir au plan" (athlete's change of a
 * plan day), "Retirer cette séance" (athlete's own session on a free day).
 */
export function PlanningDayCard({
  athleteId,
  date,
  row,
  planSession = null,
  planKnown = true,
  notice = null,
  races,
  isToday,
  isExpanded,
  onToggleExpand,
  onRowChange,
}: PlanningDayCardProps) {
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
  // in-progress, unsaved draft. Prefilled from the persisted row, else from
  // the plan's own session for this day (real data, never a fabricated
  // default), else empty.
  useEffect(() => {
    if (!isExpanded) return;
    if (row) {
      setDraftKind(row.intervention?.kind ?? "");
      setDraftLoad(row.intervention?.load_profile ?? null);
      setDraftDurationMin(row.intervention?.duration_min ?? null);
    } else if (planSession) {
      const kind = asPlannableKind(planSession.kind);
      setDraftKind(kind);
      setDraftLoad(kind !== "" && isPlannableLoadVariableKind(kind) ? ((planSession.loadProfile as LoadProfile | null) ?? null) : null);
      setDraftDurationMin(isDhFamilyPlannableKind(kind) && PLANNED_DURATION_PRESETS_MIN.includes(planSession.durationMin ?? -1) ? planSession.durationMin : null);
    } else {
      setDraftKind("");
      setDraftLoad(null);
      setDraftDurationMin(null);
    }
    // Preserved across unrelated edits (kind/load changes) within the same
    // editing session — only an explicit toggle by the athlete changes it.
    setDraftCommitted(row?.is_committed ?? false);
    setSaveState("idle");
    setSaveError(null);
    // Intentionally omits `row`/`planSession` from deps — see comment above.
  }, [isExpanded]);

  const isVariableKind = draftKind !== "" && isPlannableLoadVariableKind(draftKind);
  const isFixedKind = draftKind !== "" && isPlannableFixedLoadKind(draftKind);
  const canSave = draftKind !== "" && (isFixedKind || (isVariableKind && draftLoad !== null));
  const showDuration = isDhFamilyPlannableKind(draftKind);

  function handleKindChange(kind: TrainingInterventionKind) {
    setDraftKind(kind);
    // Stale-load invariant: any kind change clears a previously chosen
    // load — never silently carried over to a different intervention.
    setDraftLoad(null);
    // V0.3_006C2 — stale-duration invariant, same reasoning: a duration
    // chosen for a DH kind must never survive a change to a different kind.
    setDraftDurationMin(null);
    setSaveState("idle");
    setSaveError(null);
  }

  function stepDuration(delta: number) {
    setDraftDurationMin((current) => {
      if (current === null) return delta > 0 ? MIN_DURATION : null;
      return Math.min(MAX_DURATION, Math.max(MIN_DURATION, current + delta));
    });
  }

  async function run(action: () => Promise<PlannedSessionRow | null>, confirmation?: string) {
    setSaveState("saving");
    setSaveError(null);
    try {
      const next = await action();
      onRowChange(date, next, confirmation);
    } catch (error) {
      setSaveState("error");
      setSaveError(safeErrorMessage(error));
    }
  }

  function handleSave() {
    // canSave already encodes draftKind !== "" (see its definition above).
    if (!canSave) return;
    void run(() =>
      savePlannedSession(
        athleteId,
        date,
        draftKind,
        isVariableKind ? draftLoad : null,
        draftCommitted,
        showDuration && draftDurationMin !== null ? String(draftDurationMin) : null
      )
    );
  }

  const state = dayState(row, planSession, planKnown);

  // A legacy row (written before M2_003, or by any other pre-Planning path)
  // can have intervention=NULL — only the coarse session_type is known.
  // Never reverse-inferred into a fabricated rich TrainingIntervention, and
  // never the raw DbSessionType enum on screen.
  const isLegacyRow = row !== null && row.intervention === null;
  const legacyLabel = row ? (SESSION_TYPE_LABELS[row.session_type] ?? DAY.legacyFallback) : null;

  const shown = row
    ? { title: row.intervention ? kindLabel(row.intervention.kind) : legacyLabel, load: row.intervention?.load_profile ?? null, duration: row.intervention?.duration_min }
    : planSession
      ? { title: kindLabel(planSession.kind), load: planSession.loadProfile, duration: planSession.durationMin }
      : null;
  const emptyLabel = races.length > 0 ? DAY.noSessionOnRaceDay : state === "unknown" ? DAY.unknown : DAY.free;
  const badge = dayBadge(state, row);
  const load = loadLabel(shown?.load);
  const duration = formatDuration(shown?.duration);
  const isCommitted = row?.is_committed === true;
  const planIsRest = (row?.intervention?.kind ?? planSession?.kind) === "REST";

  const remove = async () => {
    await deletePlannedSession(athleteId, date);
    return null;
  };
  const secondary =
    state === "plan" && !planIsRest
      ? { label: EDITOR.toRest, hint: EDITOR.toRestHint, act: () => run(() => savePlannedSession(athleteId, date, "REST", null, false, null), EDITOR.toRestHint) }
      : state === "modified"
        ? { label: EDITOR.backToPlan, hint: EDITOR.backToPlanHint, act: () => run(remove, EDITOR.backToPlanHint) }
        : state === "added" || state === "manual-unknown"
          ? {
              label: EDITOR.remove,
              hint: state === "added" ? EDITOR.removeHint : null,
              act: () => run(remove, state === "added" ? EDITOR.removeHint : undefined),
            }
          : null;

  return (
    <div className={`overflow-hidden rounded-2xl border bg-card ${isToday ? "border-gold/70" : "border-line"}`}>
      {races.length > 0 && (
        <div className="flex flex-col gap-1 border-b border-gold/25 bg-gold/10 px-4 py-2">
          {races.map((race) => (
            <p key={`${race.eventName}-${race.startDate}`} className="flex flex-wrap items-center gap-1.5 text-xs text-gold-light">
              <span aria-hidden="true">🏁</span>
              <span className="font-semibold">{race.eventName}</span>
              {RACE_PRIORITY_BADGE[race.priority] && (
                <span className="rounded bg-gold px-1 text-xs font-bold text-bg">{RACE_PRIORITY_BADGE[race.priority]}</span>
              )}
              <span className="text-muted">· {DAY.race}</span>
            </p>
          ))}
        </div>
      )}
      <button type="button" onClick={onToggleExpand} aria-expanded={isExpanded} className="ux-press min-h-11 w-full px-4 py-3 text-left">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
          {isToday ? (
            <p className="whitespace-nowrap text-xs font-semibold uppercase tracking-[0.2em] text-gold">{DAY.today}</p>
          ) : (
            <p className="whitespace-nowrap text-xs font-medium uppercase tracking-wide text-muted">
              {weekdayLabel(date)} {formatCalendarDate(date)}
            </p>
          )}
          {badge && (
            <span className="whitespace-nowrap">
              <Badge tone={state === "plan" ? "muted" : "gold"}>{badge}</Badge>
            </span>
          )}
        </div>
        <p className={`mt-1.5 font-display text-xl font-extrabold uppercase leading-tight ${shown ? "text-ink" : "text-muted"}`}>
          {shown ? shown.title : emptyLabel}
        </p>
        {(load || duration || isCommitted) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {load && <Badge tone="gold">{load}</Badge>}
            {duration && <span className="text-xs text-ink/80">{duration}</span>}
            {isCommitted && <Badge tone="green">{DAY.committed}</Badge>}
          </div>
        )}
        {!shown && state === "free" && !isExpanded && <p className="mt-1 text-sm font-medium text-gold">{DAY.addSession}</p>}
        {notice && !isExpanded && <p className="mt-2 text-xs text-ink/70">{notice}</p>}
      </button>

      {isExpanded && (
        <div className="flex flex-col gap-4 border-t border-line px-4 py-4">
          {isLegacyRow && legacyLabel && <p className="text-xs text-muted">{DAY.legacy(legacyLabel)}</p>}

          <div role="group" aria-label={EDITOR.session} className="flex flex-col gap-3">
            <p className="text-sm font-medium text-ink">{EDITOR.session}</p>
            {PLANNING_KIND_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="text-xs uppercase tracking-[0.16em] text-muted">{group.label}</p>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {group.kinds.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      aria-pressed={draftKind === kind}
                      onClick={() => handleKindChange(kind)}
                      className={`ux-press min-h-11 rounded-full border px-3.5 text-sm ${draftKind === kind ? "border-gold bg-gold text-bg" : "border-line text-ink/80 hover:border-gold/50"}`}
                    >
                      {TRAINING_KIND_LABELS[kind]}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {isVariableKind && (
            <div role="group" aria-label={EDITOR.intensity} className="flex gap-2">
              {LOAD_CHOICES.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  aria-pressed={draftLoad === choice}
                  onClick={() => setDraftLoad(choice)}
                  className={`ux-press min-h-11 flex-1 rounded border px-2 text-xs font-medium ${draftLoad === choice ? "border-gold bg-gold text-bg" : "border-line text-ink/70"}`}
                >
                  {LOAD_PROFILE_LABELS[choice]}
                </button>
              ))}
            </div>
          )}

          {/*
           * V0.3_006C2 — DH-only planned duration (athlete-authored session
           * window, exact on KEEP, an upper bound after adaptation). Same 15
           * values as before (1 h to 8 h, 30 min steps), now a − / + stepper;
           * reset to "Pas de durée" on every kind change.
           */}
          {showDuration && (
            <div role="group" aria-label={EDITOR.duration} className="flex flex-col gap-2">
              <p className="text-sm font-medium text-ink">{EDITOR.duration}</p>
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  aria-label={EDITOR.shorter}
                  onClick={() => stepDuration(-DURATION_STEP)}
                  disabled={draftDurationMin === null || draftDurationMin <= MIN_DURATION}
                  className="ux-press flex h-12 w-12 items-center justify-center rounded-full border border-line text-2xl text-ink disabled:opacity-30"
                >
                  −
                </button>
                <output aria-live="polite" className={`font-display font-extrabold uppercase ${draftDurationMin === null ? "text-xl text-muted" : "text-4xl text-ink"}`}>
                  {draftDurationMin === null ? EDITOR.noDuration : formatDuration(draftDurationMin)}
                </output>
                <button
                  type="button"
                  aria-label={EDITOR.longer}
                  onClick={() => stepDuration(DURATION_STEP)}
                  disabled={draftDurationMin !== null && draftDurationMin >= MAX_DURATION}
                  className="ux-press flex h-12 w-12 items-center justify-center rounded-full border border-line text-2xl text-ink disabled:opacity-30"
                >
                  +
                </button>
              </div>
              <button
                type="button"
                aria-pressed={draftDurationMin === null}
                onClick={() => setDraftDurationMin(null)}
                className={`ux-press min-h-11 self-center rounded-full border px-4 text-sm ${draftDurationMin === null ? "border-gold/60 text-gold" : "border-line text-ink/70"}`}
              >
                {EDITOR.noDuration}
              </button>
              <p className="text-xs text-muted">{getPlannedDurationHelper(draftKind)}</p>
            </div>
          )}

          <button
            type="button"
            role="switch"
            aria-checked={draftCommitted}
            onClick={() => setDraftCommitted((value) => !value)}
            className="ux-press flex items-start gap-3 rounded-xl border border-line p-3 text-left"
          >
            <span aria-hidden="true" className={`mt-0.5 flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors ${draftCommitted ? "bg-gold" : "bg-line"}`}>
              <span className={`h-5 w-5 rounded-full bg-ink transition-transform ${draftCommitted ? "translate-x-4" : ""}`} />
            </span>
            <span>
              <span className="block text-sm font-medium text-ink">{EDITOR.committed}</span>
              <span className="block text-xs text-muted">{EDITOR.committedHint}</span>
            </span>
          </button>

          {saveState === "error" && saveError && (
            <p role="alert" className="rounded-lg border border-red-400/40 px-3 py-2 text-sm text-red-400">
              {saveError}
            </p>
          )}

          <PrimaryButton onClick={handleSave} disabled={!canSave || saveState === "saving"} className="w-full">
            {saveState === "saving" ? EDITOR.saving : EDITOR.save}
          </PrimaryButton>

          {secondary && (
            <div className="flex flex-col gap-1.5">
              <SecondaryButton onClick={() => void secondary.act()} disabled={saveState === "saving"} className="w-full">
                {secondary.label}
              </SecondaryButton>
              {secondary.hint && <p className="text-center text-xs text-muted">{secondary.hint}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
