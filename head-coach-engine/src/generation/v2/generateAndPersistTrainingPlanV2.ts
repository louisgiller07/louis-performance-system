/**
 * UX-11A.5b.5b — explicit LOCAL persistence of a complete V2 plan.
 *
 * Only reached by an explicit `planningModel: "v2"` call (tests / internal
 * code). The public `generate-training-plan` Edge Function and every V1 path
 * are untouched; V2 is not reachable by a user.
 *
 * Order (no partial write):
 * 1. snapshot V2 (profile read once, then never again);
 * 2-5. whole plan generated in memory, every prescription built, identified
 *      and validated (`generatePlanV2InMemory`);
 * 6. whole-plan invariants (`assertPlanV2Invariants`);
 * 7. payload (`planV2ToPersistencePayload`, no sport logic);
 * 8. ONE call to the existing transactional RPC `generate_training_plan_version`.
 * A blocked plan or any invalid prescription stops before step 8: zero write.
 *
 * Idempotence is the RPC's own: same (athlete, generationRequestId) with the
 * same snapshot hash and versions → the existing version is returned
 * (`idempotentReplay`), the freshly minted ids of this attempt are discarded;
 * same request id with another environment (e.g. a V1 plan) → refused.
 */
import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GenerationTrigger } from "planning-engine";
import { generatePlanV2InMemory, type PlanInputSnapshotV2, type PlanV2InMemory, type SessionModelV2GenerationBlockCode } from "planning-engine/session-model-v2";
import { buildPlanInputSnapshotV2 } from "../../supabase/buildPlanInputSnapshotV2.js";
import { deriveTrainingPlanBlock, RATIONALE_FOR_TRIGGER } from "../../supabase/generateAndPersistTrainingPlan.js";
import { parseGenerateTrainingPlanVersionResult, GenerateTrainingPlanVersionRpcError } from "../../supabase/rpc/generateTrainingPlanVersionRpc.js";
import { planV2ToPersistencePayload, type GenerateTrainingPlanVersionPayloadV2 } from "./planV2PersistencePayload.js";

export interface GenerateAndPersistTrainingPlanV2Input {
  /** Must be spelled out: the V2 path is never implicit. */
  planningModel: "v2";
  client: SupabaseClient;
  athleteId: string;
  generationRequestId: string;
  durationWeeks: number;
  today: string;
  generationTrigger?: GenerationTrigger;
  baseVersionId?: string;
}

export type GenerateAndPersistTrainingPlanV2Result =
  | { status: "persisted"; planVersionId: string; idempotentReplay: boolean; plan: PlanV2InMemory }
  | { status: "blocked"; code: SessionModelV2GenerationBlockCode; detail: Readonly<Record<string, unknown>> };

export interface GenerateAndPersistTrainingPlanV2Deps {
  buildPlanInputSnapshotV2: typeof buildPlanInputSnapshotV2;
  callRpc: (client: SupabaseClient, payload: GenerateTrainingPlanVersionPayloadV2) => Promise<{ planVersionId: string; idempotentReplay: boolean }>;
  mintId: () => string;
}

/** The same RPC as V1, with the V2 payload (no change to the RPC or to the V1 wrapper). */
export async function generateTrainingPlanVersionRpcV2(
  client: SupabaseClient,
  payload: GenerateTrainingPlanVersionPayloadV2
): Promise<{ planVersionId: string; idempotentReplay: boolean }> {
  const { data, error } = await client.rpc("generate_training_plan_version", {
    p_athlete_id: payload.athleteId,
    p_generation_request_id: payload.generationRequestId,
    p_version: payload.version,
    p_blocks: payload.blocks,
    p_weeks: payload.weeks,
    p_sessions: payload.sessions,
    p_planned_prescriptions: payload.plannedPrescriptions,
  });
  if (error) throw new GenerateTrainingPlanVersionRpcError(error.message);
  return parseGenerateTrainingPlanVersionResult(data);
}

const DEFAULT_DEPS: GenerateAndPersistTrainingPlanV2Deps = {
  buildPlanInputSnapshotV2,
  callRpc: generateTrainingPlanVersionRpcV2,
  mintId: () => randomUUID(),
};

/** Same hashing technique as the V1 path (SHA-256 of the snapshot's JSON). */
export function hashPlanInputSnapshotV2(snapshot: PlanInputSnapshotV2): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

export async function generateAndPersistTrainingPlanV2(
  input: GenerateAndPersistTrainingPlanV2Input,
  deps: GenerateAndPersistTrainingPlanV2Deps = DEFAULT_DEPS
): Promise<GenerateAndPersistTrainingPlanV2Result> {
  if (input.planningModel !== "v2") throw new Error(`generateAndPersistTrainingPlanV2 requires planningModel "v2", got ${String(input.planningModel)}`);

  const block = deriveTrainingPlanBlock(input.today, input.durationWeeks);
  const snapshot = await deps.buildPlanInputSnapshotV2(input.client, input.athleteId, input.today, { startDate: block.startDate, endDate: block.endDate });

  const generated = generatePlanV2InMemory({ block, snapshot, mintId: deps.mintId });
  if (generated.status === "blocked") return generated;

  const generationTrigger = input.generationTrigger ?? "initial";
  const payload = planV2ToPersistencePayload(generated.plan, {
    athleteId: input.athleteId,
    generationRequestId: input.generationRequestId,
    snapshot,
    inputSnapshotHash: hashPlanInputSnapshotV2(snapshot),
    generationTrigger,
    rationale: RATIONALE_FOR_TRIGGER[generationTrigger],
    ...(input.baseVersionId !== undefined ? { baseVersionId: input.baseVersionId } : {}),
  });

  const persisted = await deps.callRpc(input.client, payload);
  return { status: "persisted", planVersionId: persisted.planVersionId, idempotentReplay: persisted.idempotentReplay, plan: generated.plan };
}
