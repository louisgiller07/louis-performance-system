/**
 * `projectTrainingPlan` — M2.7 / ADR V0.4_012 projection runtime
 * orchestrator. Makes the mutable, Head-Coach-facing `planned_sessions` /
 * `training_blocks` tables converge toward the athlete's currently accepted
 * canonical training plan, for a given date window, without ever
 * overwriting a completed or manually-overridden date.
 *
 * Not wired into `runDailyFor.ts` yet — that integration is a separate,
 * later, explicitly-authorized step (ADR V0.4_012). This module is a
 * standalone, independently callable/testable unit.
 *
 * TypeScript owns: resolving canonical content, deriving `session_type`
 * (frozen mapping, never duplicated), building candidates. SQL owns:
 * guard enforcement and the actual write — see projectTrainingPlanRpc.ts
 * and the project_training_plan RPC. No direct write happens in this file.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentPlanVersion } from "./repositories/trainingPlanCurrentVersionRepo.js";
import { getGeneratedSessionsInWindow } from "./repositories/trainingPlanGeneratedSessionsRepo.js";
import { getCurrentGeneratedBlock } from "./repositories/trainingPlanBlocksRepo.js";
import { mapGeneratedSessionToPlannedSessionCandidate } from "./mapping/generatedSessionToPlannedSessionCandidate.js";
import { projectTrainingPlanRpc, type ProjectTrainingPlanResult, type TrainingBlockCandidate } from "./projectTrainingPlanRpc.js";

export type ProjectionReport = ProjectTrainingPlanResult;

/** Returned when the athlete has no currently accepted plan version — a legitimate state, not an error. The RPC is never called in this case. */
export const NO_CURRENT_VERSION_REPORT: ProjectionReport = {
  plannedSessions: [],
  trainingBlock: { outcome: "no_candidate" },
};

/**
 * Injectable seam — same reasoning as RunDailyForDeps: lets orchestration
 * (call counts, exact arguments passed through) be unit-tested with plain
 * mocks, without a live DB. Production callers never need to pass this.
 */
export interface ProjectTrainingPlanDeps {
  getCurrentPlanVersion: typeof getCurrentPlanVersion;
  getGeneratedSessionsInWindow: typeof getGeneratedSessionsInWindow;
  getCurrentGeneratedBlock: typeof getCurrentGeneratedBlock;
  projectTrainingPlanRpc: typeof projectTrainingPlanRpc;
}

const DEFAULT_DEPS: ProjectTrainingPlanDeps = {
  getCurrentPlanVersion,
  getGeneratedSessionsInWindow,
  getCurrentGeneratedBlock,
  projectTrainingPlanRpc,
};

/**
 * Projects the athlete's currently accepted canonical plan onto
 * `planned_sessions`/`training_blocks` for `[windowStart, windowEnd]`
 * (inclusive dates).
 *
 * Responsibilities, in order: resolve the current accepted version once
 * (shared by both target tables — never re-resolved) → if none, return
 * immediately without calling the RPC → read generated sessions in the
 * window and the block covering `windowStart` → build candidates → one RPC
 * call → return its report verbatim.
 */
export async function projectTrainingPlan(
  client: SupabaseClient,
  athleteId: string,
  windowStart: string,
  windowEnd: string,
  deps: ProjectTrainingPlanDeps = DEFAULT_DEPS
): Promise<ProjectionReport> {
  const currentVersion = await deps.getCurrentPlanVersion(client, athleteId);
  if (currentVersion === null) {
    return NO_CURRENT_VERSION_REPORT;
  }
  const planVersionId = currentVersion.plan_version_id;

  const generatedSessionRows = await deps.getGeneratedSessionsInWindow(client, planVersionId, windowStart, windowEnd);
  const plannedSessionCandidates = generatedSessionRows.map(mapGeneratedSessionToPlannedSessionCandidate);

  const currentBlockRow = await deps.getCurrentGeneratedBlock(client, planVersionId, windowStart);
  const trainingBlockCandidate: TrainingBlockCandidate | null = currentBlockRow
    ? {
        name: currentBlockRow.name,
        mode: currentBlockRow.mode,
        primaryFocus: currentBlockRow.primary_focus,
        startDate: currentBlockRow.start_date,
        endDate: currentBlockRow.end_date,
        sourcePlanBlockId: currentBlockRow.id,
      }
    : null;

  return deps.projectTrainingPlanRpc(client, athleteId, planVersionId, plannedSessionCandidates, trainingBlockCandidate);
}
