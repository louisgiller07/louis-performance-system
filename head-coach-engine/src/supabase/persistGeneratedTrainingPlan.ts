/**
 * persistGeneratedTrainingPlan — the full branch: runGenerationEngine() ->
 * generationResultToPersistencePayload() -> generateTrainingPlanVersionRpc()
 * (V0.4_148). Orchestration only: each of the three steps already owns its
 * own responsibility (planning+prescription assembly / domain->payload
 * mapping / the one Supabase call) — this file adds none of its own.
 *
 * Placement: src/supabase/, not src/generation/ (the ticket's own
 * suggestion) — this orchestrator calls Supabase (via the RPC wrapper), so
 * it belongs with the established precedent for exactly this shape of
 * function: acceptTrainingPlanVersion.ts, which likewise orchestrates one
 * RPC call plus a second step, and lives in src/supabase/, not in a
 * domain-named folder.
 *
 * versionMetadata deliberately excludes inputSnapshot — it would otherwise
 * have to be supplied twice (once for generation.planInputSnapshot, once
 * for the version row), risking a caller passing two different snapshots
 * for the same generation. This function derives
 * VersionPersistenceContext.inputSnapshot from generation.planInputSnapshot
 * itself — the exact object planning-engine/prescription-engine already
 * ran against — never a second, independently-supplied copy.
 *
 * No randomUUID, no Date.now, no direct Supabase access, no client.rpc call
 * — the only persistence this file performs is calling
 * generateTrainingPlanVersionRpc(), imported, never reimplemented. No
 * try/catch anywhere: an error from planning-engine or prescription-engine
 * (via runGenerationEngine), from the mapper, or from the RPC wrapper all
 * propagate unchanged — a failure at any step means the next step is never
 * reached, and nothing is ever silently defaulted.
 */
import { runGenerationEngine, type GenerationEngineInput } from "../generation/generationEngine.js";
import {
  generationResultToPersistencePayload,
  type VersionPersistenceContext,
} from "./mapping/generationResultToPersistencePayload.js";
import { generateTrainingPlanVersionRpc, type GenerateTrainingPlanVersionResult } from "./rpc/generateTrainingPlanVersionRpc.js";

/**
 * The Supabase client type, without importing "@supabase/supabase-js"
 * directly in this file — deliberately derived from
 * generateTrainingPlanVersionRpc's own first parameter instead. Keeps this
 * orchestrator's boundary literal (no "@supabase" string anywhere here,
 * verified by its own test) while staying fully typed: this is exactly the
 * same client type the RPC wrapper itself expects, never `any`.
 */
type SupabaseClientParam = Parameters<typeof generateTrainingPlanVersionRpc>[0];

/** Everything VersionPersistenceContext needs, minus inputSnapshot — derived from `generation.planInputSnapshot` instead of being supplied a second time. */
export type VersionMetadataInput = Omit<VersionPersistenceContext, "inputSnapshot">;

export interface PersistGeneratedTrainingPlanInput {
  client: SupabaseClientParam;
  generation: GenerationEngineInput;
  versionMetadata: VersionMetadataInput;
}

export async function persistGeneratedTrainingPlan(
  input: PersistGeneratedTrainingPlanInput
): Promise<GenerateTrainingPlanVersionResult> {
  const generationResult = runGenerationEngine(input.generation);

  const context: VersionPersistenceContext = {
    ...input.versionMetadata,
    inputSnapshot: input.generation.planInputSnapshot,
  };

  const payload = generationResultToPersistencePayload(generationResult, input.generation.block, context);

  return generateTrainingPlanVersionRpc(input.client, payload);
}
