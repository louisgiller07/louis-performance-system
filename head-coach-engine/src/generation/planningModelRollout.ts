/**
 * UX-11R.2 — server-side choice of the planning model of a NEW training
 * plan generation. The client never chooses: the global switch (Edge
 * secret) and the athlete's server-side assignment
 * (`training_plan_model_assignments`, service_role only) decide.
 *
 *   switch not exactly "true", assignment 'v2' → refused (assigned_v2_disabled): A09 paid-beta guard,
 *                                      an athlete assigned V2 never silently falls back to V1
 *   switch not exactly "true", otherwise → v1 (global_v2_disabled)
 *   switch on, no assignment         → v1 (default_v1)
 *   switch on, assignment 'v1'       → v1 (assigned_v1)
 *   switch on, assignment 'v2'       → v2 (assigned_v2)
 *
 * Generation only: daily-run, final prescriptions, guided sessions and
 * executions follow the data already persisted, never this choice. The
 * reason code is operational (logs / pilot events), never a sport rule.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanningModel } from "./v2/runInMemoryPlanGenerationV2.js";

/** Name of the Edge secret; only the exact value "true" enables V2 eligibility. */
export const V2_PLAN_GENERATION_FLAG = "NALYNT_V2_PLAN_GENERATION_ENABLED";

export type PlanningModelReason = "global_v2_disabled" | "default_v1" | "assigned_v1" | "assigned_v2" | "assigned_v2_disabled";

export interface PlanningModelResolution {
  planningModel: PlanningModel;
  reason: PlanningModelReason;
}

/** Absent, empty, "TRUE", "1", "yes"… → off. Only "true" turns V2 eligibility on. */
export function parseV2PlanGenerationFlag(raw: string | undefined | null): boolean {
  return raw === "true";
}

export function resolvePlanningModelForAthlete(input: { globalV2Enabled: boolean; assignment: PlanningModel | null }): PlanningModelResolution {
  // A09 — the switch stays a real V2 kill switch, and an athlete assigned V2 is refused, never served V1.
  if (!input.globalV2Enabled) return input.assignment === "v2" ? { planningModel: "v2", reason: "assigned_v2_disabled" } : { planningModel: "v1", reason: "global_v2_disabled" };
  if (input.assignment === "v2") return { planningModel: "v2", reason: "assigned_v2" };
  if (input.assignment === "v1") return { planningModel: "v1", reason: "assigned_v1" };
  return { planningModel: "v1", reason: "default_v1" };
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
