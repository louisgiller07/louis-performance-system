/**
 * Typed wrapper around the `project_training_plan` RPC (M2.7 / ADR
 * V0.4_012). See supabase/migrations/..._v0_4_003a_project_training_plan_rpc.sql.
 *
 * One RPC call per invocation — the whole candidate batch (planned_sessions
 * candidates + the single training_blocks candidate) is guarded and written
 * atomically on the PostgreSQL side; this wrapper does not and must not
 * split it into separate client-side calls. Same style as persistDailyRun.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlannedSessionCandidate } from "./mapping/generatedSessionToPlannedSessionCandidate.js";

export type PlannedSessionProjectionOutcome =
  | "projected"
  | "unchanged"
  | "skipped_completed"
  | "skipped_manual_override"
  | "skipped_stale_version";

export type TrainingBlockProjectionOutcome =
  | "updated"
  | "unchanged"
  | "skipped_not_owned"
  | "skipped_stale_version"
  | "no_candidate";

export interface TrainingBlockCandidate {
  name: string;
  mode: string;
  primaryFocus: string;
  startDate: string;
  endDate: string;
  sourcePlanBlockId: string;
}

export interface ProjectTrainingPlanResult {
  plannedSessions: Array<{ date: string; outcome: PlannedSessionProjectionOutcome }>;
  trainingBlock: { outcome: TrainingBlockProjectionOutcome };
}

export class ProjectTrainingPlanRpcError extends Error {
  constructor(message: string) {
    super(`project_training_plan RPC call failed: ${message}`);
    this.name = "ProjectTrainingPlanRpcError";
  }
}

export class InvalidProjectTrainingPlanResultError extends Error {
  constructor(reason: string, value: unknown) {
    super(`project_training_plan returned an invalid result: ${reason} (${JSON.stringify(value)})`);
    this.name = "InvalidProjectTrainingPlanResultError";
  }
}

const PLANNED_SESSION_OUTCOMES: readonly string[] = [
  "projected",
  "unchanged",
  "skipped_completed",
  "skipped_manual_override",
  "skipped_stale_version",
];
const TRAINING_BLOCK_OUTCOMES: readonly string[] = [
  "updated",
  "unchanged",
  "skipped_not_owned",
  "skipped_stale_version",
  "no_candidate",
];

/**
 * Validates the RPC's raw JSON result at runtime. Never casts blindly —
 * every field and every outcome value is checked explicitly against the
 * closed vocabularies above.
 */
export function parseProjectTrainingPlanResult(data: unknown): ProjectTrainingPlanResult {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new InvalidProjectTrainingPlanResultError("expected a JSON object", data);
  }
  const obj = data as Record<string, unknown>;

  if (!Array.isArray(obj.plannedSessions)) {
    throw new InvalidProjectTrainingPlanResultError("plannedSessions is missing or not an array", data);
  }
  const plannedSessions = obj.plannedSessions.map((entry, index) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new InvalidProjectTrainingPlanResultError(`plannedSessions[${index}] is not an object`, data);
    }
    const row = entry as Record<string, unknown>;
    if (typeof row.date !== "string") {
      throw new InvalidProjectTrainingPlanResultError(`plannedSessions[${index}].date is missing or not a string`, data);
    }
    if (typeof row.outcome !== "string" || !PLANNED_SESSION_OUTCOMES.includes(row.outcome)) {
      throw new InvalidProjectTrainingPlanResultError(`plannedSessions[${index}].outcome is missing or unrecognized`, data);
    }
    return { date: row.date, outcome: row.outcome as PlannedSessionProjectionOutcome };
  });

  if (obj.trainingBlock === null || typeof obj.trainingBlock !== "object" || Array.isArray(obj.trainingBlock)) {
    throw new InvalidProjectTrainingPlanResultError("trainingBlock is missing or not an object", data);
  }
  const trainingBlockObj = obj.trainingBlock as Record<string, unknown>;
  if (typeof trainingBlockObj.outcome !== "string" || !TRAINING_BLOCK_OUTCOMES.includes(trainingBlockObj.outcome)) {
    throw new InvalidProjectTrainingPlanResultError("trainingBlock.outcome is missing or unrecognized", data);
  }

  return {
    plannedSessions,
    trainingBlock: { outcome: trainingBlockObj.outcome as TrainingBlockProjectionOutcome },
  };
}

/**
 * Invokes `project_training_plan` exactly once. `planVersionId` is the
 * version the caller resolved as currently accepted — the RPC independently
 * re-checks it against `training_plan_current_version` at write time (M2.7 /
 * ADR V0.4_012) rather than trusting it blindly, so a race against a
 * concurrent acceptance/regeneration degrades to a safe, reported no-op
 * rather than writing stale content.
 */
export async function projectTrainingPlanRpc(
  client: SupabaseClient,
  athleteId: string,
  planVersionId: string,
  plannedSessionCandidates: PlannedSessionCandidate[],
  trainingBlockCandidate: TrainingBlockCandidate | null
): Promise<ProjectTrainingPlanResult> {
  const { data, error } = await client.rpc("project_training_plan", {
    p_athlete_id: athleteId,
    p_plan_version_id: planVersionId,
    p_planned_session_candidates: plannedSessionCandidates,
    p_training_block_candidate: trainingBlockCandidate,
  });

  if (error) throw new ProjectTrainingPlanRpcError(error.message);

  return parseProjectTrainingPlanResult(data);
}
