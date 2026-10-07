/**
 * UX-11R.2 — the single server-side entry of a NEW training plan generation
 * (public `generate-training-plan` Edge Function, tests, internal tools).
 *
 * Resolves the planning model on the server (planningModelRollout.ts) AFTER
 * the caller resolved the athlete from its own identity, then calls EXACTLY
 * the existing validated path:
 *   v1 → generateAndPersistTrainingPlan (unchanged responses / errors / side effects);
 *   v2 → generateAndPersistTrainingPlanV2 (snapshot V2, in-memory orchestration,
 *        plan dose policy, builders, the same transactional RPC).
 * No second V2 pipeline. No fallback: an assigned athlete whose V2
 * generation is blocked or fails gets that outcome, never a V1 plan.
 * A09 — the assignment is read whatever the switch: an athlete assigned V2
 * while the switch is off is refused (`v2_disabled`), nothing generated.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateAndPersistTrainingPlan } from "../supabase/generateAndPersistTrainingPlan.js";
import { generateAndPersistTrainingPlanV2 } from "./v2/generateAndPersistTrainingPlanV2.js";
import { getPlanningModelAssignment, resolvePlanningModelForAthlete, type PlanningModelResolution } from "./planningModelRollout.js";

export interface GenerateTrainingPlanForAthleteInput {
  /** Service-role client; athleteId must come from the caller's authenticated identity, never from client input. */
  client: SupabaseClient;
  athleteId: string;
  generationRequestId: string;
  durationWeeks: number;
  today: string;
  /** Parsed global switch (parseV2PlanGenerationFlag). */
  globalV2Enabled: boolean;
}

// Derived from the V2 path itself, so this dispatcher stays outside the Session Model V2 import boundary.
type V2BlockedOutcome = Extract<Awaited<ReturnType<typeof generateAndPersistTrainingPlanV2>>, { status: "blocked" }>;

export type GenerateTrainingPlanForAthleteResult = PlanningModelResolution &
  (
    | { status: "persisted"; planVersionId: string; idempotentReplay: boolean }
    | { status: "blocked"; code: V2BlockedOutcome["code"]; detail: V2BlockedOutcome["detail"] }
    | { status: "v2_disabled" }
  );

export interface GenerateTrainingPlanForAthleteDeps {
  getPlanningModelAssignment: typeof getPlanningModelAssignment;
  generateAndPersistTrainingPlan: typeof generateAndPersistTrainingPlan;
  generateAndPersistTrainingPlanV2: typeof generateAndPersistTrainingPlanV2;
}

const DEFAULT_DEPS: GenerateTrainingPlanForAthleteDeps = { getPlanningModelAssignment, generateAndPersistTrainingPlan, generateAndPersistTrainingPlanV2 };

export async function generateTrainingPlanForAthlete(
  input: GenerateTrainingPlanForAthleteInput,
  deps: GenerateTrainingPlanForAthleteDeps = DEFAULT_DEPS
): Promise<GenerateTrainingPlanForAthleteResult> {
  const assignment = await deps.getPlanningModelAssignment(input.client, input.athleteId);
  const resolution = resolvePlanningModelForAthlete({ globalV2Enabled: input.globalV2Enabled, assignment });
  if (resolution.reason === "assigned_v2_disabled") return { ...resolution, status: "v2_disabled" };
  const common = { client: input.client, athleteId: input.athleteId, generationRequestId: input.generationRequestId, durationWeeks: input.durationWeeks, today: input.today };

  try {
    if (resolution.planningModel === "v1") {
      const v1 = await deps.generateAndPersistTrainingPlan(common);
      return { ...resolution, status: "persisted", planVersionId: v1.planVersionId, idempotentReplay: v1.idempotentReplay };
    }
    const v2 = await deps.generateAndPersistTrainingPlanV2({ planningModel: "v2", ...common });
    if (v2.status === "blocked") return { ...resolution, status: "blocked", code: v2.code, detail: v2.detail };
    return { ...resolution, status: "persisted", planVersionId: v2.planVersionId, idempotentReplay: v2.idempotentReplay };
  } catch (error) {
    // The error is rethrown unchanged (same class, same instanceof mapping); only the resolution is
    // attached, so the caller can tell which model failed (observability), never to retry another model.
    if (error !== null && typeof error === "object") (error as { planningResolution?: PlanningModelResolution }).planningResolution = resolution;
    throw error;
  }
}

/** The planning model resolution attached to an error thrown by a generation (absent when it failed before resolving). */
export function planningResolutionOf(error: unknown): PlanningModelResolution | undefined {
  return error !== null && typeof error === "object" ? (error as { planningResolution?: PlanningModelResolution }).planningResolution : undefined;
}
