/**
 * BETA-V2-TECH-01 (T1, T2) — V2 plans for the suites that drive DH sessions through the local Edge runtime.
 *
 * Since T2 the daily run never serves a DH count without its drill's signed unit, whatever the generation switch: a
 * plan generated without units (historical passes) has its DH days blocked. These suites therefore run on the V2 ON
 * runtime with TEST sign-offs (NALYNT_TEST_EDGE_V2_MODE=on_test_signed, tests/edge/http/buildTestSignedEdgeBundle.mjs)
 * and generate with the very bundle that runtime serves (generateTrainingPlanForAthlete: assignment v2, switch on,
 * dhUnit "required"), refused unless it carries the TEST sign-off mark. No unit is invented and no production table
 * is touched.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { generateTrainingPlanForAthlete } from "../../src/generation/generateTrainingPlanForAthlete.js";

const GENERATION_BUNDLE = fileURLToPath(new URL("../../dist/edge/generateTrainingPlan.bundle.js", import.meta.url));
/** The mark tests/edge/http/buildTestSignedEdgeBundle.mjs puts on every TEST sign-off of the bundles it rebuilds. */
const TEST_SIGNOFF_MARK = "TEST fixture V2-DH-RELEASE-GATES-01 (not a sports decision)";

/** True when the harness serves the V2 ON runtime with TEST sign-offs. */
export function signedRuntimeRequested(): boolean {
  return process.env.NALYNT_TEST_EDGE_V2_MODE === "on_test_signed";
}

/** The served runtime's own generation entry; refuses a bundle without the TEST sign-off mark. */
export async function runtimeGeneration(): Promise<typeof generateTrainingPlanForAthlete> {
  if (!readFileSync(GENERATION_BUNDLE, "utf8").includes(TEST_SIGNOFF_MARK)) {
    throw new Error("dist/edge/generateTrainingPlan.bundle.js is not the TEST-signed bundle the V2 ON runtime serves (run buildTestSignedEdgeBundle.mjs)");
  }
  return ((await import(pathToFileURL(GENERATION_BUNDLE).href)) as { generateTrainingPlanForAthlete: typeof generateTrainingPlanForAthlete }).generateTrainingPlanForAthlete;
}

/** A persisted V2 plan generated on `today` by the runtime's bundle; assigns the rider v2 when it has no assignment. */
export async function generateSignedV2Plan(admin: SupabaseClient, athleteId: string, today: string, durationWeeks = 2): Promise<{ status: "persisted"; planVersionId: string }> {
  const generate = await runtimeGeneration();
  const { data, error } = await admin.from("training_plan_model_assignments").select("planning_model").eq("athlete_id", athleteId).maybeSingle();
  if (error) throw new Error(`assignment read: ${error.message}`);
  if (!data) {
    const { error: insertError } = await admin.from("training_plan_model_assignments").insert({ athlete_id: athleteId, planning_model: "v2", note: "TEST-signed runtime fixture" });
    if (insertError) throw new Error(`assignment insert: ${insertError.message}`);
  } else if ((data as { planning_model: string }).planning_model !== "v2") {
    throw new Error("the rider is not assigned v2");
  }
  const r = await generate({ client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks, today, globalV2Enabled: true });
  if (r.status !== "persisted" || r.planningModel !== "v2") throw new Error(`signed V2 plan: ${r.status} ${r.planningModel}`);
  return { status: "persisted", planVersionId: r.planVersionId };
}
