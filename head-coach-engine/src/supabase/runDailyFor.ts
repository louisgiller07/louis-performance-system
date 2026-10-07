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
 *   2b. V0.5_047/048 — best-effort executable-prescription lookup (see
 *      `resolveExecutablePrescriptionBestEffort` below): ONLY when
 *      `computed.dailyPlan.decision === "KEEP"`, resolves today's
 *      canonical `PlannedPrescription` via `planned_sessions.
 *      source_generated_session_id → training_plan_planned_prescriptions`.
 *      Never written to any table, never fed back into M1 — purely
 *      additive enrichment on the returned result. Never throws, only ever
 *      contributes a warning. UX-11A.5b.1: a prescription whose format this
 *      reader does not implement (anything but v1) is never cast into v1 —
 *      `executablePrescription` stays null, `executablePrescriptionStatus`
 *      says "unsupported_schema_version" and a stable
 *      "prescription_schema_unsupported" warning is added; M1's decision is
 *      untouched.
 *   3. `mapDailyPlanToDecisionRow` (M2_002 shape, unchanged) — DailyPlan → decision row.
 *   4. `DailyPlan.health_flag_to_create` (the real M1 field name — not
 *      assumed) present? → `mapHealthFlagToCreatePayload`. Absent → `null`.
 *   5. `persistDailyRun` — called exactly once. The RPC performs the
 *      health-flag-ensure-open + decision-insert atomically on the
 *      PostgreSQL side (M2_006); this module never issues a second write
 *      to reproduce that transaction client-side.
 *
 * UX-11A.5c.3 — V2 daily path. Before M1, the daily path is chosen once from
 * the current plan version's `prescription_schema_version`
 * (`resolveDailyPrescriptionModel`: none / v1 → the flow above, unchanged;
 * v2 → V2; anything else → fail-closed, nothing computed or written). On the
 * V2 path, after M1 (unchanged, nothing V2 injected), the integration layer
 * mints the decision id, reconciles the final prescription from the
 * planned_sessions observation M1 consumed (no second planned_sessions read,
 * no legacy executable-prescription lookup), personalizes `reasoning` as in
 * V1, and calls `persist_daily_run_v2` exactly once (never
 * `persist_daily_run`). MODIFY / REPLACE produce no final prescription yet
 * (durable blocked status). The V2 reconciliation module is loaded lazily so
 * the V1 path's static import graph has no bare runtime import (the
 * daily-run Edge Function loads this file directly under Deno).
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
import type { PlannedPrescription } from "planning-engine";
import type { DailyPlan } from "../types/index.js";
import { computeDailyFor, type ComputeDailyForResult } from "./computeDailyFor.js";
import { mapDailyPlanToDecisionRow } from "./mapping/dailyPlanToDecisionRow.js";
import { mapHealthFlagToCreatePayload } from "./mapping/healthFlagToCreatePayload.js";
import { persistDailyRun, type PersistDailyRunResult } from "./persistDailyRun.js";
import { getAthleteCoachingContext } from "./repositories/athleteCoachingContextRepo.js";
import { getDailyRunInputVersions, getProjectedGeneratedSessionIdForDate } from "./repositories/plannedSessionsRepo.js";
import { getPlannedPrescriptionForGeneratedSession } from "./repositories/trainingPlanPlannedPrescriptionsRepo.js";
import { PRESCRIPTION_SCHEMA_UNSUPPORTED } from "./prescriptionRead.js";
import { resolveDailyPrescriptionModel } from "./dailyV2/dailyPrescriptionModel.js";
import { toFinalPrescriptionOutcome } from "./dailyV2/finalPrescriptionOutcome.js";
import { persistDailyRunV2, type FinalPrescriptionStatus } from "./dailyV2/persistDailyRunV2.js";
import { applyV2SystemicFloor } from "./dailyV2/applyV2SystemicFloor.js";
import { applyV2EffectiveSession } from "./dailyV2/applyV2EffectiveSession.js";
import type { FinalPrescriptionV2, FinalPrescriptionV2Result, ReconcileFinalPrescriptionV2Input } from "./dailyV2/reconcileFinalPrescriptionV2.js";
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
  /**
   * V0.5_047/048 — the canonical `PlannedPrescription` for today's session,
   * ONLY when Head Coach's `decision` is exactly `"KEEP"` (never for
   * MODIFY/REPLACE/REST — their session parameters may no longer match the
   * canonical prescription's sets/reps/intensity, even when MODIFY leaves
   * `kind` unchanged) and only when the session actually traces back to a
   * generated, accepted plan (`source_generated_session_id`). `null` for
   * every other case, including a manual/legacy session, an aerobic session
   * (which never has a PlannedPrescription), or any lookup failure —
   * always best-effort, never able to fail the daily run itself. Never
   * injected into `DailyPlan`/`RawContext`/`TrainingIntervention` — those
   * stay entirely frozen and coarse; this is enrichment layered on top,
   * after M1's decision is already final.
   */
  executablePrescription: PlannedPrescription | null;
  /**
   * UX-11A.5b.1 — why `executablePrescription` is (or is not) present:
   * "delivered" when attached; "unsupported_schema_version" when today's
   * canonical prescription exists but its format is not implemented by
   * this reader (never cast, never hidden); "none" for every other case
   * (not KEEP, no lineage, no row, lookup failure — the last two also
   * carry a warning, unchanged).
   */
  executablePrescriptionStatus: ExecutablePrescriptionStatus;
  /**
   * UX-11A.5c.3 — V2 daily path only (absent on the V1 path): the durable
   * final prescription status persisted with the decision. created →
   * `finalPrescription` present; not_required (REST) → absent; blocked →
   * absent, with `finalPrescriptionStatusCode` / `finalPrescriptionStatusDetail`.
   * Not rendered by the web yet (5c.4): on this path `executablePrescription`
   * stays null and `executablePrescriptionStatus` is "unsupported_schema_version"
   * when a final prescription exists, "none" otherwise.
   */
  finalPrescriptionStatus?: FinalPrescriptionStatus;
  finalPrescriptionStatusCode?: string;
  finalPrescriptionStatusDetail?: Readonly<Record<string, unknown>>;
  finalPrescription?: FinalPrescriptionV2;
}

export type ExecutablePrescriptionStatus = "delivered" | "none" | "unsupported_schema_version";

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
  /** V0.5_047/048 — injectable so the executable-prescription lookup can be unit-tested with plain mocks, same reasoning as the other deps. */
  getProjectedGeneratedSessionIdForDate: typeof getProjectedGeneratedSessionIdForDate;
  getPlannedPrescriptionForGeneratedSession: typeof getPlannedPrescriptionForGeneratedSession;
  /** PILOT_022 — injectable so the input-provenance capture can be unit-tested with plain mocks, same reasoning as the other deps. */
  getDailyRunInputVersions: typeof getDailyRunInputVersions;
  /** UX-11A.5c.3 — the daily V1 / V2 discriminant (current plan version's prescription schema). */
  resolveDailyPrescriptionModel: typeof resolveDailyPrescriptionModel;
  /** UX-11A.5c.3 — V2 reconciliation (pure 5c.1 decision + plan reads in the current version). */
  reconcileFinalPrescriptionV2: (input: ReconcileFinalPrescriptionV2Input) => Promise<FinalPrescriptionV2Result>;
  /** UX-11A.5c.3 — the single V2 write (persist_daily_run_v2). */
  persistDailyRunV2: typeof persistDailyRunV2;
  /** UX-11A.5c.3 — ids minted after M1 (decision, final prescription). */
  mintId: () => string;
}

/**
 * The production dependencies. Exported (UX-11A.5c.3.1) so the daily-run Edge
 * Function can keep every one of them and replace only the lazy V2
 * reconciliation loader by its Deno bundle.
 */
export const DEFAULT_RUN_DAILY_FOR_DEPS: RunDailyForDeps = {
  computeDailyFor,
  persistDailyRun,
  getAthleteCoachingContext,
  getProjectedGeneratedSessionIdForDate,
  getPlannedPrescriptionForGeneratedSession,
  projectTrainingPlan,
  resolveTrainingPlanProjectionWindow,
  getDailyRunInputVersions,
  resolveDailyPrescriptionModel,
  // Lazy: the only daily module with a runtime import of the Session Model V2 package entry.
  reconcileFinalPrescriptionV2: async (input) => (await import("./dailyV2/reconcileFinalPrescriptionV2.js")).reconcileFinalPrescriptionV2(input),
  persistDailyRunV2,
  mintId: () => globalThis.crypto.randomUUID(),
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
 * V0.5_047/048 — best-effort lookup of the canonical `PlannedPrescription`
 * for today's session, gated STRICTLY on `decision === "KEEP"` (checked
 * here, backend-side — never only in the frontend). MODIFY/REPLACE/REST
 * never even attempt the lookup: under MODIFY the session's kind is
 * (almost) always unchanged, but its load/duration may have shifted, so the
 * canonical prescription's volumes/intensities can no longer be trusted;
 * under REPLACE the domain itself may differ entirely; REST has no session
 * to prescribe at all. Every failure mode (no lineage, no prescription row,
 * a thrown error) degrades to `null` plus, where noted, a warning — never
 * thrown, matching `runProjectionBestEffort`'s own discipline exactly. A
 * missing lineage (`no_canonical_plan` — a manual/legacy session, or no
 * accepted plan for this date) is NOT warning-worthy: it is a real,
 * legitimate state, not a failure.
 */
async function resolveExecutablePrescriptionBestEffort(
  client: SupabaseClient,
  athleteId: string,
  today: string,
  decision: DailyPlan["decision"],
  getLineage: typeof getProjectedGeneratedSessionIdForDate,
  getPrescription: typeof getPlannedPrescriptionForGeneratedSession
): Promise<{ executablePrescription: PlannedPrescription | null; executablePrescriptionStatus: ExecutablePrescriptionStatus; warnings: string[] }> {
  if (decision !== "KEEP") {
    return { executablePrescription: null, executablePrescriptionStatus: "none", warnings: [] };
  }

  try {
    const generatedPlanSessionId = await getLineage(client, athleteId, today);
    if (!generatedPlanSessionId) {
      return { executablePrescription: null, executablePrescriptionStatus: "none", warnings: [] };
    }

    const read = await getPrescription(client, generatedPlanSessionId);
    if (!read) {
      return {
        executablePrescription: null,
        executablePrescriptionStatus: "none",
        warnings: [`V0.5_048: no canonical prescription found for today's KEEP session (generatedPlanSessionId=${generatedPlanSessionId}).`],
      };
    }

    if (read.status !== "supported") {
      return {
        executablePrescription: null,
        executablePrescriptionStatus: "unsupported_schema_version",
        warnings: [
          `${PRESCRIPTION_SCHEMA_UNSUPPORTED}: planned prescription ${read.prescriptionId} has schema_version "${read.schemaVersion}", not supported by this reader (generatedPlanSessionId=${generatedPlanSessionId}).`,
        ],
      };
    }

    return { executablePrescription: read.prescription, executablePrescriptionStatus: "delivered", warnings: [] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { executablePrescription: null, executablePrescriptionStatus: "none", warnings: [`V0.5_048 executable prescription lookup skipped: ${message}`] };
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
  deps: RunDailyForDeps = DEFAULT_RUN_DAILY_FOR_DEPS
): Promise<RunDailyForResult> {
  const projectionWarnings = await runProjectionBestEffort(
    client,
    athleteId,
    today,
    deps.resolveTrainingPlanProjectionWindow,
    deps.projectTrainingPlan
  );

  // PILOT_022 (REV-01) — read the inputs' versions after projection (which may
  // rewrite today's planned session) and before computing: if either input is
  // written while the decision is being computed, the recorded version is the
  // older one and the decision is correctly reported stale afterwards.
  const inputVersions = await deps.getDailyRunInputVersions(client, athleteId, today);

  // UX-11A.5c.3 — chosen once, before M1; an unknown schema fails closed here
  // (UnsupportedPlanPrescriptionSchemaError): nothing computed, nothing written.
  const prescriptionModel = await deps.resolveDailyPrescriptionModel(client, athleteId);

  const { plannedSessionObservation, ...computed } = await deps.computeDailyFor(client, athleteId, today);

  // Defensive invariant, not a data-driven check: buildDailyPlan (M1,
  // frozen) sets `date: ctx.today` verbatim in every branch (SAFETY and
  // normal), so this is provably unreachable today — kept as an explicit
  // rejection rather than silently persisting under a different date if
  // that invariant were ever to drift.
  if (computed.dailyPlan.date !== today) {
    throw new DailyPlanDateMismatchError(today, computed.dailyPlan.date);
  }

  if (prescriptionModel.model === "v2") {
    // M1 is done; the only V2 change to its decision is the explicit, traced
    // systemic floor (A04: a LIGHT Force session on a C3.3 day → active recovery).
    const dailyPlanV2 = applyV2SystemicFloor(computed.dailyPlan);
    const decisionId = deps.mintId();
    const reconciliation = await deps.reconcileFinalPrescriptionV2({
      client,
      currentPlanVersionId: prescriptionModel.planVersionId,
      decisionId,
      finalPrescriptionId: deps.mintId(),
      dailyPlan: dailyPlanV2,
      observation: plannedSessionObservation ?? null,
      mintId: deps.mintId,
    });

    // A07 — the persisted plan describes the effective session (the final prescription's duration).
    const effectivePlanV2 = applyV2EffectiveSession(dailyPlanV2, reconciliation);
    const { dailyPlan: personalizedPlanV2, warnings: personalizationWarningsV2 } = await personalizeReasoning(client, athleteId, effectivePlanV2, deps.getAthleteCoachingContext);

    const decisionRowV2 = {
      id: decisionId,
      ...mapDailyPlanToDecisionRow(personalizedPlanV2, athleteId),
      source_checkin_id: inputVersions.checkin?.id ?? null,
      source_checkin_updated_at: inputVersions.checkin?.updated_at ?? null,
      source_planned_session_id: inputVersions.plannedSession?.id ?? null,
      source_planned_session_updated_at: inputVersions.plannedSession?.updated_at ?? null,
    };
    const healthFlagV2 = personalizedPlanV2.health_flag_to_create ? mapHealthFlagToCreatePayload(personalizedPlanV2.health_flag_to_create, today) : null;

    const persisted = await deps.persistDailyRunV2(client, athleteId, healthFlagV2, decisionRowV2, toFinalPrescriptionOutcome(reconciliation, athleteId));

    return {
      ...computed,
      dailyPlan: personalizedPlanV2,
      warnings: [...projectionWarnings, ...computed.warnings, ...personalizationWarningsV2],
      persistence: { decision_id: persisted.decision_id, health_flag_id: persisted.health_flag_id },
      executablePrescription: null,
      executablePrescriptionStatus: reconciliation.status === "created" ? "unsupported_schema_version" : "none",
      finalPrescriptionStatus: persisted.final_prescription_status,
      ...(reconciliation.status === "blocked"
        ? { finalPrescriptionStatusCode: reconciliation.code, ...(Object.keys(reconciliation.detail).length > 0 ? { finalPrescriptionStatusDetail: reconciliation.detail } : {}) }
        : {}),
      ...(reconciliation.status === "created" ? { finalPrescription: reconciliation.finalPrescription } : {}),
    };
  }

  // V0.5_047/048 — decided from computed.dailyPlan.decision (M1's own,
  // frozen output — never re-derived), before personalization runs.
  // personalizeReasoning only ever touches `reasoning`, never `decision`,
  // so reading it here vs. after makes no difference to correctness; doing
  // it here keeps this step visually grouped with the other read-only,
  // best-effort enrichments in this function.
  const { executablePrescription, executablePrescriptionStatus, warnings: executablePrescriptionWarnings } = await resolveExecutablePrescriptionBestEffort(
    client,
    athleteId,
    today,
    computed.dailyPlan.decision,
    deps.getProjectedGeneratedSessionIdForDate,
    deps.getPlannedPrescriptionForGeneratedSession
  );

  const { dailyPlan: personalizedPlan, warnings: personalizationWarnings } = await personalizeReasoning(
    client,
    athleteId,
    computed.dailyPlan,
    deps.getAthleteCoachingContext
  );

  const decisionRow = {
    ...mapDailyPlanToDecisionRow(personalizedPlan, athleteId),
    source_checkin_id: inputVersions.checkin?.id ?? null,
    source_checkin_updated_at: inputVersions.checkin?.updated_at ?? null,
    source_planned_session_id: inputVersions.plannedSession?.id ?? null,
    source_planned_session_updated_at: inputVersions.plannedSession?.updated_at ?? null,
  };

  const healthFlag = personalizedPlan.health_flag_to_create
    ? mapHealthFlagToCreatePayload(personalizedPlan.health_flag_to_create, today)
    : null;

  const persistence = await deps.persistDailyRun(client, athleteId, healthFlag, decisionRow);

  return {
    ...computed,
    dailyPlan: personalizedPlan,
    warnings: [...projectionWarnings, ...computed.warnings, ...executablePrescriptionWarnings, ...personalizationWarnings],
    persistence,
    executablePrescription,
    executablePrescriptionStatus,
  };
}
