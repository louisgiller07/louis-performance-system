/**
 * UX-11R.2 — server-side choice of the planning model of a NEW training
 * plan generation. The client never chooses: the global switch (Edge
 * secret) and the athlete's server-side assignment
 * (`training_plan_model_assignments`, service_role only) decide.
 *
 * BETA-V2-TECH-01 B (candidate, ADR pending approval) — the assignment IS the authorization to generate:
 *   assignment 'v2', switch on       → v2 (assigned_v2)
 *   assignment 'v2', switch off      → refused 503 (assigned_v2_disabled): A09, never a V1 plan
 *   assignment 'v1', either switch   → v1 (assigned_v1): the explicit exemption, for test accounts only
 *   no assignment, either switch     → refused 403 (not_assigned): never V1 by default
 * No conversion between V1 and V2 in either direction; an unreadable assignment throws (refused, nothing generated).
 *
 * Generation only: daily-run, final prescriptions, guided sessions and
 * executions follow the data already persisted, never this choice. The
 * reason code is operational (logs / pilot events), never a sport rule.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanningModel } from "./v2/runInMemoryPlanGenerationV2.js";

/** Name of the Edge secret; only the exact value "true" enables V2 eligibility. */
export const V2_PLAN_GENERATION_FLAG = "NALYNT_V2_PLAN_GENERATION_ENABLED";

export type PlanningModelReason = "assigned_v1" | "assigned_v2" | "assigned_v2_disabled";

export interface PlanningModelResolution {
  planningModel: PlanningModel;
  reason: PlanningModelReason;
}

/** BETA-V2-TECH-01 B — no assignment: no model at all (refused 403), never V1 by default. */
export interface PlanningModelNotAssigned {
  planningModel: null;
  reason: "not_assigned";
}

/** Absent, empty, "TRUE", "1", "yes"… → off. Only "true" turns V2 eligibility on. */
export function parseV2PlanGenerationFlag(raw: string | undefined | null): boolean {
  return raw === "true";
}

/**
 * PHYS-02 — name of the Edge secret placing the intervals session in the overload weeks of a V2 plan
 * (ENDURANCE_INTERVALS_PLAN_POLICY_V2). Same parsing: only "true" turns it on; absent = the previous plans exactly.
 * Read on the server only, never from the request.
 */
export const V2_ENDURANCE_INTERVALS_FLAG = "NALYNT_V2_ENDURANCE_INTERVALS_ENABLED";

/** PHYS-03 — name of the Edge secret placing the power session in build weeks of a V2 plan (POWER_PLAN_POLICY_V2). Same parsing; absent = the previous plans. */
export const V2_POWER_SESSIONS_FLAG = "NALYNT_V2_POWER_ENABLED";

/** PHYS-04 — name of the Edge secret adding a mobility session to consolidation weeks of a V2 plan (MOBILITY_PLAN_POLICY_V2). Same parsing; absent = the previous plans. */
export const V2_MOBILITY_SESSIONS_FLAG = "NALYNT_V2_MOBILITY_ENABLED";

export function resolvePlanningModelForAthlete(input: { globalV2Enabled: boolean; assignment: PlanningModel | null }): PlanningModelResolution | PlanningModelNotAssigned {
  // BETA-V2-TECH-01 B — no assignment, no generation: the beta access is never granted by default.
  if (input.assignment === null) return { planningModel: null, reason: "not_assigned" };
  // The explicit V1 exemption does not depend on the V2 switch.
  if (input.assignment === "v1") return { planningModel: "v1", reason: "assigned_v1" };
  // A09 — the switch stays a real V2 kill switch, and an athlete assigned V2 is refused, never served V1.
  return input.globalV2Enabled ? { planningModel: "v2", reason: "assigned_v2" } : { planningModel: "v2", reason: "assigned_v2_disabled" };
}

export class PlanningModelAssignmentReadError extends Error {
  constructor(detail: string) {
    super(`planning model assignment read failed: ${detail}`);
    this.name = "PlanningModelAssignmentReadError";
  }
}

/** The athlete's server-side assignment (service-role client only; the table is invisible to the browser). */
export async function getPlanningModelAssignment(serviceClient: SupabaseClient, athleteId: string): Promise<PlanningModel | null> {
  const { data, error } = await serviceClient.from("training_plan_model_assignments").select("planning_model").eq("athlete_id", athleteId).maybeSingle();
  if (error) throw new PlanningModelAssignmentReadError(error.code ?? "query_failed");
  if (!data) return null;
  const model = (data as { planning_model: unknown }).planning_model;
  if (model !== "v1" && model !== "v2") throw new PlanningModelAssignmentReadError("unexpected planning_model");
  return model;
}
