/**
 * UX-11A.5b.5a — explicit, in-memory V2 plan generation (no persistence).
 *
 * The planning model is an EXPLICIT choice: V1 stays the default everywhere
 * (generationEngine, generateAndPersistTrainingPlan, generate-training-plan
 * are untouched and never reach this file). This entry point is only called
 * by tests / internal code that asks for `planningModel: "v2"` — never
 * selected automatically because a DH tier exists, a profile is recent or a
 * V2 catalogue is available.
 *
 * Snapshot (built once, then the live profile is never read again) →
 * `generatePlanV2InMemory` (pure, planning-engine) with `randomUUID` as the
 * identity strategy. Nothing is written: no RPC, no table, no Edge Function.
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generatePlanV2InMemory, type GeneratePlanV2InMemoryResult } from "planning-engine/session-model-v2";
import { buildPlanInputSnapshotV2 } from "../../supabase/buildPlanInputSnapshotV2.js";
import { deriveTrainingPlanBlock } from "../../supabase/generateAndPersistTrainingPlan.js";

/** The planning models; "v1" is the default of every existing path. */
export type PlanningModel = "v1" | "v2";
export const DEFAULT_PLANNING_MODEL: PlanningModel = "v1";

export interface RunInMemoryPlanGenerationV2Input {
  /** Must be spelled out by the caller: the V2 path is never implicit. */
  planningModel: "v2";
  client: SupabaseClient;
  athleteId: string;
  today: string;
  durationWeeks: number;
}

export interface RunInMemoryPlanGenerationV2Deps {
  buildPlanInputSnapshotV2: typeof buildPlanInputSnapshotV2;
  mintId: () => string;
}

const DEFAULT_DEPS: RunInMemoryPlanGenerationV2Deps = { buildPlanInputSnapshotV2, mintId: () => randomUUID() };

export async function runInMemoryPlanGenerationV2(
  input: RunInMemoryPlanGenerationV2Input,
  deps: RunInMemoryPlanGenerationV2Deps = DEFAULT_DEPS
): Promise<GeneratePlanV2InMemoryResult> {
  if (input.planningModel !== "v2") throw new Error(`runInMemoryPlanGenerationV2 requires planningModel "v2", got ${String(input.planningModel)}`);
  const block = deriveTrainingPlanBlock(input.today, input.durationWeeks);
  const snapshot = await deps.buildPlanInputSnapshotV2(input.client, input.athleteId, input.today, { startDate: block.startDate, endDate: block.endDate });
  return generatePlanV2InMemory({ block, snapshot, mintId: deps.mintId });
}
