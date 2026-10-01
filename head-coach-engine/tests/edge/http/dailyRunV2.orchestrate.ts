/**
 * UX-11A.5c.3.1 — daily-run V2 on the REAL Deno Edge Runtime (local only).
 * Run via `npm run test:daily-run:v2:http` (builds dist and the Edge bundles
 * first). Requires the local stack (`supabase start`) and, in the
 * environment, SUPABASE_SECRET_KEY / SUPABASE_PUBLISHABLE_KEY from
 * `npx supabase status -o env` (never hardcoded, never logged).
 *
 * Starts `supabase functions serve` (same as test:m3:http) and drives the real
 * daily-run function over HTTP: V2 plan → KEEP created (document compared to
 * the stored planned prescription, ids and Node fingerprint), KEEP without
 * planned session → blocked no_lineage, REST → not_required, unknown plan
 * schema → 409, no plan → historical V1 path. Nothing is mocked: the V2
 * module is resolved by the Deno runtime from the bundle. Scratch athletes
 * stay in the local database (their append-only rows cannot be deleted).
 */
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sportFingerprint } from "planning-engine/session-model-v2";
import { createTestAthlete, createTestClient, insertCheckin, setAthleteDiscipline } from "../../supabase/testDb.js";
import { upsertPerformanceProfileFor } from "../../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { buildPlanInputSnapshotV2 } from "../../../src/supabase/buildPlanInputSnapshotV2.js";
import { generateAndPersistTrainingPlanV2, generateTrainingPlanVersionRpcV2 } from "../../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import type { GenerateTrainingPlanVersionPayloadV2 } from "../../../src/generation/v2/planV2PersistencePayload.js";
import { acceptTrainingPlanVersion } from "../../../src/supabase/acceptTrainingPlanVersion.js";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, "$1");
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1/daily-run`;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
if (!ANON_KEY) throw new Error("Set SUPABASE_PUBLISHABLE_KEY (npx supabase status -o env). No key is hardcoded here.");
const EDGE_CONTAINER = "supabase_edge_runtime_louis-performance-system";
const TODAY = "2026-10-05";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function record(name: string, pass: boolean, detail?: string): void {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}${detail && !pass ? ` (${detail})` : ""}`);
}
const deepEqual = (a: unknown, b: unknown) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === "object") return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
  return v;
}

async function post(token: string, date: string): Promise<{ status: number; json: Record<string, any> | null }> {
  const res = await fetch(FUNCTIONS_URL, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ date }) });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    return { status: res.status, json: null };
  }
}

const containerRunning = () => execSync(`docker ps --filter "name=${EDGE_CONTAINER}" --format "{{.Names}}"`).toString().trim() !== "";

function startFunctionsServer(): ChildProcess {
  return spawn("npx supabase functions serve", [], { cwd: REPO_ROOT, stdio: ["ignore", "ignore", "ignore"], shell: true });
}

async function waitForFunctionsReady(timeoutMs = 60000): Promise<void> {
  const start = Date.now();
  let ok = 0;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(FUNCTIONS_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      ok = [502, 503, 504].includes(res.status) ? 0 : ok + 1;
      if (ok >= 3) return;
    } catch {
      ok = 0;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("daily-run did not become ready");
}

function stopFunctionsServer(child: ChildProcess, wasRunningBefore: boolean): void {
  if (child.pid != null && child.exitCode === null) {
    try {
      if (process.platform === "win32") execSync(`taskkill /T /PID ${child.pid}`, { stdio: "ignore" });
      else child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
  // Leave the stack as found: the edge-runtime container is stopped only if it was not running before.
  if (!wasRunningBefore && containerRunning()) execSync(`docker stop ${EDGE_CONTAINER}`, { stdio: "ignore" });
}

async function scratchToken(admin: SupabaseClient, userId: string): Promise<string> {
  const { data } = await admin.auth.admin.getUserById(userId);
  const password = `Sc${randomUUID().replace(/-/g, "").slice(0, 20)}Aa1!`;
  await admin.auth.admin.updateUserById(userId, { password });
  const anon = createClient(SUPABASE_URL, ANON_KEY as string, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: signedIn, error } = await anon.auth.signInWithPassword({ email: data.user!.email!, password });
  if (error || !signedIn.session) throw new Error("scratch sign-in failed");
  return signedIn.session.access_token;
}

async function seedAthlete(admin: SupabaseClient, label: string): Promise<{ athleteId: string; token: string }> {
  const athlete = await createTestAthlete(admin, `5c.3.1 Deno — ${label}`);
  await setAthleteDiscipline(admin, athlete.athleteId, "Downhill");
  await upsertPerformanceProfileFor(admin, athlete.athleteId, {
    strength_experience_tier: "intermediate",
    equipment: ["dumbbells", "bench"],
    terrain_access: ["flow_trail", "bermed_trail"],
    declared_limitations: [],
    technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
    dh_technical_tier: "intermediate",
  });
  for (const d of [0, 1, 2, 3, 4, 5, 6]) await insertAvailabilityWindow(admin, athlete.athleteId, { day_of_week: d, start_time: "08:00:00", end_time: "20:00:00" });
  return { athleteId: athlete.athleteId, token: await scratchToken(admin, athlete.userId) };
}

async function withV2Plan(admin: SupabaseClient, athleteId: string, tamper?: (p: GenerateTrainingPlanVersionPayloadV2) => GenerateTrainingPlanVersionPayloadV2): Promise<string> {
  const persisted = await generateAndPersistTrainingPlanV2(
    { planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 2, today: TODAY },
    { buildPlanInputSnapshotV2, callRpc: (c, p) => generateTrainingPlanVersionRpcV2(c, tamper ? tamper(p) : p), mintId: () => randomUUID() }
  );
  if (persisted.status !== "persisted") throw new Error("V2 plan not persisted");
  await acceptTrainingPlanVersion(admin, athleteId, persisted.planVersionId, TODAY, "2026-10-18");
  return persisted.planVersionId;
}

async function main(): Promise<void> {
  const admin = createTestClient();
  await admin.auth.admin.listUsers({ perPage: 1 }); // the local stack must be up
  const wasRunning = containerRunning();
  const server = startFunctionsServer();
  try {
    await waitForFunctionsReady();

    // --- V2 plan: KEEP created, then a day without planned session ---
    const a = await seedAthlete(admin, "V2 KEEP");
    const planVersionId = await withV2Plan(admin, a.athleteId);
    await insertCheckin(admin, a.athleteId, "2026-10-07");
    const keep = await post(a.token, "2026-10-07");
    const { data: session } = await admin.from("training_plan_generated_sessions").select("id").eq("plan_version_id", planVersionId).eq("date", "2026-10-07").single();
    const { data: planned } = await admin.from("training_plan_planned_prescriptions").select("id, structure").eq("generated_plan_session_id", session!.id).single();
    const fp = keep.json?.finalPrescription;
    record("V2 KEEP → 200, decision KEEP, finalPrescriptionStatus created", keep.status === 200 && keep.json?.dailyPlan?.decision === "KEEP" && keep.json?.finalPrescriptionStatus === "created", JSON.stringify(keep.json).slice(0, 300));
    record("V2 KEEP → finalPrescription returned, structure identical to the stored planned prescription (ids preserved)", fp && fp.plannedPrescriptionId === planned!.id && deepEqual(fp.structure, planned!.structure));
    record("V2 KEEP → Node fingerprint of the Deno document = fingerprint of the planned prescription", fp && sportFingerprint(fp.structure) === sportFingerprint(planned!.structure));
    record("V2 KEEP → reader stays closed (executablePrescription null, unsupported_schema_version)", keep.json?.executablePrescription === null && keep.json?.executablePrescriptionStatus === "unsupported_schema_version");
    const { data: stored } = await admin.from("decision_final_prescriptions").select("id, decision_id, structure").eq("decision_id", keep.json?.decisionId);
    const { data: decisionRow } = await admin.from("decisions").select("final_prescription_status").eq("id", keep.json?.decisionId).single();
    record("V2 KEEP → persisted by persist_daily_run_v2: status created + exactly the returned final prescription", decisionRow?.final_prescription_status === "created" && stored?.length === 1 && stored[0]!.id === fp?.id && deepEqual(stored[0]!.structure, fp?.structure));

    await insertCheckin(admin, a.athleteId, "2026-10-10");
    const noLineage = await post(a.token, "2026-10-10");
    record(
      "V2 KEEP without planned session → blocked final_prescription_no_lineage, no final prescription",
      noLineage.status === 200 &&
        noLineage.json?.dailyPlan?.decision === "KEEP" &&
        noLineage.json?.finalPrescriptionStatus === "blocked" &&
        noLineage.json?.finalPrescriptionStatusCode === "final_prescription_no_lineage" &&
        noLineage.json?.finalPrescription === undefined,
      JSON.stringify(noLineage.json).slice(0, 300)
    );

    // --- V2 plan: REST ---
    const b = await seedAthlete(admin, "V2 REST");
    await withV2Plan(admin, b.athleteId);
    await insertCheckin(admin, b.athleteId, "2026-10-06", { suspected_concussion: true });
    const rest = await post(b.token, "2026-10-06");
    record(
      "V2 REST → not_required, no final prescription, health flag",
      rest.status === 200 && rest.json?.dailyPlan?.decision === "REST" && rest.json?.finalPrescriptionStatus === "not_required" && rest.json?.finalPrescription === undefined && typeof rest.json?.healthFlagId === "string",
      JSON.stringify(rest.json).slice(0, 300)
    );

    // --- unknown plan schema: fail-closed ---
    const c = await seedAthlete(admin, "v999");
    await withV2Plan(admin, c.athleteId, (p) => ({ ...p, version: { ...p.version, prescriptionSchemaVersion: "v999" as "v2" } }));
    await insertCheckin(admin, c.athleteId, "2026-10-07");
    const unknown = await post(c.token, "2026-10-07");
    const { data: noDecision } = await admin.from("decisions").select("id").eq("athlete_id", c.athleteId);
    record("unknown plan schema → 409 unsupported_plan_prescription_schema, no decision written", unknown.status === 409 && unknown.json?.error?.code === "unsupported_plan_prescription_schema" && noDecision?.length === 0);

    // --- no plan: historical V1 path ---
    const v1 = await seedAthlete(admin, "V1 no plan");
    await insertCheckin(admin, v1.athleteId, "2026-10-07");
    const legacy = await post(v1.token, "2026-10-07");
    const { data: v1Row } = await admin.from("decisions").select("final_prescription_status").eq("id", legacy.json?.decisionId).single();
    record(
      "no plan → V1 path: 200, no V2 field, decision written by persist_daily_run (status NULL)",
      legacy.status === 200 && !("finalPrescriptionStatus" in (legacy.json ?? {})) && !("finalPrescription" in (legacy.json ?? {})) && v1Row?.final_prescription_status === null,
      JSON.stringify(legacy.json).slice(0, 200)
    );
  } finally {
    stopFunctionsServer(server, wasRunning);
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} scenarios passed.`);
  if (failed.length > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("HARNESS ERROR:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
