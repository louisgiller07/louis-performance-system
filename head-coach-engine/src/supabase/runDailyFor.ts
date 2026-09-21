/**
 * `runDailyFor` — M2 write-path entry point. See docs/06_ARCHITECTURE.md
 * §Découpage ("runDailyFor(client, athleteId, today) → appelle
 * computeDailyFor, invoque la RPC persist_daily_run qui exécute
 * atomiquement l'upsert du health flag éventuel puis l'insert append-only
 * de la décision. Retourne les identifiants.") and §Contraintes canoniques
 * ("computeDailyFor et runDailyFor sont deux opérations distinctes.").
 *
 * Flow, strictly:
 *   0. V0.4_015 — best-effort projection pre-compute step (see
 *      `runProjectionBestEffort` below): converges `planned_sessions`/
 *      `training_blocks` toward the athlete's accepted canonical plan for
 *      today's window, before anything reads them. Disabled unless
 *      `TRAINING_PLAN_PROJECTION_WINDOW_DAYS` is set (ADR V0.4_015A); never
 *      throws, only ever contributes a warning.
 *   1. `computeDailyFor` — called exactly once (read + M1, zero write).
 *      `computeDailyFor` itself stays byte-for-byte M1's output, per its
 *      own documented contract ("no coaching post-processing") — untouched
 *      by this task.
 *   2. V0.3_011 — First Personalization Consumer: `applyGoalPersonalization`
 *      appends one fixed, deterministic sentence to `DailyPlan.reasoning`
 *      when the athlete has declared a recognized `primary_goal` (see
 *      goalReasoning.ts, docs/11_DECISION_LOG.md ADR V0.3_011). Strictly
 *      additive to `reasoning` only — every other `DailyPlan` field,
 *      including `final_session`/`active_mode`/`decision`, passes through
 *      unchanged. Resolving the athlete's coaching context is best-effort:
 *      a failure (e.g. a transient DB error) is recorded as a warning and
 *      never fails the daily run — a cosmetic explanation addition must
 *      never be able to block a real coaching decision.
 *   3. `mapDailyPlanToDecisionRow` (M2_002 shape, unchanged) — DailyPlan → decision row.
 *   4. `DailyPlan.health_flag_to_create` (the real M1 field name — not
 *      assumed) present? → `mapHealthFlagToCreatePayload`. Absent → `null`.
 *   5. `persistDailyRun` — called exactly once. The RPC performs the
 *      health-flag-ensure-open + decision-insert atomically on the
 *      PostgreSQL side (M2_006); this module never issues a second write
 *      to reproduce that transaction client-side.
 *
 * `source_checkin_id` is intentionally omitted from the health flag
 * payload: the current read path (`dailyCheckinsRepo.getCheckinFor`,
 * `buildRawContext`) does not select/expose the `daily_checkins.id` of the
 * current checkin anywhere in `ComputeDailyForResult`, and `RawContext`
 * (M1, frozen) has no field for a DB id either. Per the task's own
 * fallback rule, it is omitted rather than plumbed in as new scope on the
 * read path or invented from nothing.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailyPlan } from "../types/index.js";
import { computeDailyFor, type ComputeDailyForResult } from "./computeDailyFor.js";
import { mapDailyPlanToDecisionRow } from "./mapping/dailyPlanToDecisionRow.js";
import { mapHealthFlagToCreatePayload } from "./mapping/healthFlagToCreatePayload.js";
import { persistDailyRun, type PersistDailyRunResult } from "./persistDailyRun.js";
import { getAthleteCoachingContext } from "./repositories/athleteCoachingContextRepo.js";
import { applyGoalPersonalization } from "./goalReasoning.js";
import { projectTrainingPlan } from "./projectTrainingPlan.js";
import { resolveTrainingPlanProjectionWindow } from "./trainingPlanProjectionConfig.js";

export class DailyPlanDateMismatchError extends Error {
  constructor(requestedToday: string, dailyPlanDate: string) {
    super(
      `runDailyFor: DailyPlan.date (${dailyPlanDate}) does not match the requested today ` +
        `(${requestedToday}) — refusing to persist a decision under an inconsistent date. Given M1's ` +
        "current frozen implementation (buildDailyPlan always sets date = RawContext.today), this should " +
        "be unreachable; treat it as a programming error rather than a data issue."
    );
    this.name = "DailyPlanDateMismatchError";
  }
}

export interface RunDailyForResult extends ComputeDailyForResult {
  persistence: PersistDailyRunResult;
}

/**
 * Injectable seam for `computeDailyFor`/`persistDailyRun` — not an IoC
 * framework, just an optional params object defaulting to the real
 * implementations. Lets orchestration (call counts, exact payloads passed
 * through) be unit-tested with plain mocks, without a live DB. Production
 * callers never need to pass this — `runDailyFor(client, athleteId, today)`
 * behaves exactly as documented.
 */
export interface RunDailyForDeps {
  computeDailyFor: typeof computeDailyFor;
  persistDailyRun: typeof persistDailyRun;
  /** V0.3_011 — injectable so orchestration/personalization can be unit-tested with plain mocks, same reasoning as the other two deps. */
  getAthleteCoachingContext: typeof getAthleteCoachingContext;
  /** V0.4_015 — injectable so the pre-compute projection step can be unit-tested with plain mocks, same reasoning as the other deps. */
  projectTrainingPlan: typeof projectTrainingPlan;
  resolveTrainingPlanProjectionWindow: typeof resolveTrainingPlanProjectionWindow;
}

const DEFAULT_DEPS: RunDailyForDeps = {
  computeDailyFor,
  persistDailyRun,
  getAthleteCoachingContext,
  projectTrainingPlan,
  resolveTrainingPlanProjectionWindow,
};

/**
 * ADR V0.4_015A — pure UTC calendar-date math, manual parsing (never
 * `new Date(isoString)`) to avoid the local-timezone ambiguity
 * `head-coach-engine/src/engine/dateUtils.ts` (frozen) already documents
 * for exactly this reason. That file has no `addDays` export, so this is a
 * small, local equivalent — not a duplicate of anything it does provide.
 */
function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const shifted = new Date(Date.UTC(year as number, (month as number) - 1, (day as number) + days));
  const yyyy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * V0.4_015 — best-effort projection pre-compute step, run before
 * `computeDailyFor` so Head Coach reads freshly-converged
 * `planned_sessions`/`training_blocks` for today, never stale content
 * (ADR V0.4_012/V0.4_013). Never throws:
 *  - not configured (`resolveWindow()` -> `enabled: false`, no warning) ->
 *    silent no-op, the intended deployable-dark default (ADR V0.4_015A).
 *  - configured but invalid (`enabled: false` with a `warning`) -> that
 *    warning is surfaced, projection is skipped.
 *  - configured and enabled, but `project(...)` itself throws -> caught
 *    here specifically (never a blanket try/catch around the rest of
 *    `runDailyFor`), turned into a warning. Same discipline as
 *    `personalizeReasoning` below: a compatibility-layer step must never
 *    be able to block a real coaching decision.
 */
async function runProjectionBestEffort(
  client: SupabaseClient,
  athleteId: string,
  today: string,
  resolveWindow: typeof resolveTrainingPlanProjectionWindow,
  project: typeof projectTrainingPlan
): Promise<string[]> {
  const config = resolveWindow();
  if (!config.enabled) {
    return config.warning ? [config.warning] : [];
  }

  try {
    await project(client, athleteId, today, addDays(today, config.windowDays));
    return [];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return [`V0.4_015 projection skipped: ${message}`];
  }
}

/**
 * V0.3_011 — resolves the athlete's declared `primary_goal` and appends its
 * fixed sentence to `dailyPlan.reasoning`. Best-effort: any failure
 * resolving the athlete's coaching context (network, transient DB error)
 * is returned as a warning, never thrown — this is a cosmetic explanation
 * addition, not a coaching decision, and must never be able to block a
 * real daily run.
 */
async function personalizeReasoning(
  client: SupabaseClient,
  athleteId: string,
  dailyPlan: DailyPlan,
  resolveContext: typeof getAthleteCoachingContext
): Promise<{ dailyPlan: DailyPlan; warnings: string[] }> {
  try {
    const context = await resolveContext(client, athleteId);
    return { dailyPlan: applyGoalPersonalization(dailyPlan, context.primary_goal), warnings: [] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { dailyPlan, warnings: [`V0.3_011 personalization skipped: could not resolve athlete coaching context (${message})`] };
  }
}

/**
 * Computes today's `DailyPlan` for `athleteId` (via `computeDailyFor`,
 * called exactly once), applies the V0.3_011 goal-reasoning personalization
 * (additive, `reasoning` only), and persists it atomically (via
 * `persistDailyRun`, called exactly once). No other write.
 */
export async function runDailyFor(
  client: SupabaseClient,
  athleteId: string,
  today: string,
  deps: RunDailyForDeps = DEFAULT_DEPS
): Promise<RunDailyForResult> {
  const projectionWarnings = await runProjectionBestEffort(
    client,
    athleteId,
    today,
    deps.resolveTrainingPlanProjectionWindow,
    deps.projectTrainingPlan
  );

  const computed = await deps.computeDailyFor(client, athleteId, today);

  // Defensive invariant, not a data-driven check: buildDailyPlan (M1,
  // frozen) sets `date: ctx.today` verbatim in every branch (SAFETY and
  // normal), so this is provably unreachable today — kept as an explicit
  // rejection rather than silently persisting under a different date if
  // that invariant were ever to drift.
  if (computed.dailyPlan.date !== today) {
    throw new DailyPlanDateMismatchError(today, computed.dailyPlan.date);
  }

  const { dailyPlan: personalizedPlan, warnings: personalizationWarnings } = await personalizeReasoning(
    client,
    athleteId,
    computed.dailyPlan,
    deps.getAthleteCoachingContext
  );

  const decisionRow = mapDailyPlanToDecisionRow(personalizedPlan, athleteId);

  const healthFlag = personalizedPlan.health_flag_to_create
    ? mapHealthFlagToCreatePayload(personalizedPlan.health_flag_to_create, today)
    : null;

  const persistence = await deps.persistDailyRun(client, athleteId, healthFlag, decisionRow);

  return {
    ...computed,
    dailyPlan: personalizedPlan,
    warnings: [...projectionWarnings, ...computed.warnings, ...personalizationWarnings],
    persistence,
  };
}
