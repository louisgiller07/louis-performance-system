/**
 * `runDailyFor` — M2 write-path entry point. See docs/06_ARCHITECTURE.md
 * §Découpage ("runDailyFor(client, athleteId, today) → appelle
 * computeDailyFor, invoque la RPC persist_daily_run qui exécute
 * atomiquement l'upsert du health flag éventuel puis l'insert append-only
 * de la décision. Retourne les identifiants.") and §Contraintes canoniques
 * ("computeDailyFor et runDailyFor sont deux opérations distinctes.").
 *
 * Flow, strictly:
 *   1. `computeDailyFor` — called exactly once (read + M1, zero write).
 *   2. `mapDailyPlanToDecisionRow` (M2_002, unchanged) — DailyPlan → decision row.
 *   3. `DailyPlan.health_flag_to_create` (the real M1 field name — not
 *      assumed) present? → `mapHealthFlagToCreatePayload`. Absent → `null`.
 *   4. `persistDailyRun` — called exactly once. The RPC performs the
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
import { computeDailyFor, type ComputeDailyForResult } from "./computeDailyFor.js";
import { mapDailyPlanToDecisionRow } from "./mapping/dailyPlanToDecisionRow.js";
import { mapHealthFlagToCreatePayload } from "./mapping/healthFlagToCreatePayload.js";
import { persistDailyRun, type PersistDailyRunResult } from "./persistDailyRun.js";

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
}

const DEFAULT_DEPS: RunDailyForDeps = { computeDailyFor, persistDailyRun };

/**
 * Computes today's `DailyPlan` for `athleteId` (via `computeDailyFor`,
 * called exactly once) and persists it atomically (via `persistDailyRun`,
 * called exactly once). No other write.
 */
export async function runDailyFor(
  client: SupabaseClient,
  athleteId: string,
  today: string,
  deps: RunDailyForDeps = DEFAULT_DEPS
): Promise<RunDailyForResult> {
  const computed = await deps.computeDailyFor(client, athleteId, today);

  // Defensive invariant, not a data-driven check: buildDailyPlan (M1,
  // frozen) sets `date: ctx.today` verbatim in every branch (SAFETY and
  // normal), so this is provably unreachable today — kept as an explicit
  // rejection rather than silently persisting under a different date if
  // that invariant were ever to drift.
  if (computed.dailyPlan.date !== today) {
    throw new DailyPlanDateMismatchError(today, computed.dailyPlan.date);
  }

  const decisionRow = mapDailyPlanToDecisionRow(computed.dailyPlan, athleteId);

  const healthFlag = computed.dailyPlan.health_flag_to_create
    ? mapHealthFlagToCreatePayload(computed.dailyPlan.health_flag_to_create, today)
    : null;

  const persistence = await deps.persistDailyRun(client, athleteId, healthFlag, decisionRow);

  return { ...computed, persistence };
}
