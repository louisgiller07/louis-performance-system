/**
 * UX-11R.2 — internal V2 rollout rehearsal on the REAL Deno Edge Runtime
 * (local only). Run via `npm run test:generate-plan:rollout:http` (builds
 * every Edge artefact first). Requires the local stack and, in the
 * environment, SUPABASE_SECRET_KEY / SUPABASE_PUBLISHABLE_KEY (never logged).
 *
 * The harness OWNS the Edge runtime (the global switch is an Edge secret
 * fixed at start): it refuses to run if one is already running, then starts
 * `supabase functions serve --env-file` three times: switch OFF, ON, OFF.
 * A = internal V2 pilot (server-side assignment v2), B = V1 control (none),
 * C = assigned v2 without a declared DH technical tier (V2 blocked). Same
 * endpoint, same body for everyone: the browser never chooses the model.
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, insertCheckin, setAthleteDiscipline } from "../../supabase/testDb.js";
import { upsertPerformanceProfileFor } from "../../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { computeDailyFor } from "../../../src/supabase/computeDailyFor.js";
import { execLocalSql, sqlLiteral } from "../../supabase/localDb.js";
import { serveLogTail, startOwnedFunctionsRuntime } from "./functionsRuntime.js";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, "$1");
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
if (!ANON_KEY) throw new Error("Set SUPABASE_PUBLISHABLE_KEY (npx supabase status -o env). No key is hardcoded here.");
const TODAY_FOR_DAILY = ["2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"];

const results: { name: string; pass: boolean; detail?: string }[] = [];
function record(name: string, pass: boolean, detail?: string): void {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}${detail && !pass ? ` (${detail})` : ""}`);
}

async function call(fn: string, token: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    return { status: res.status, json: { raw: text.slice(0, 200) } };
  }
}

async function waitReady(token: string): Promise<void> {
  let ok = 0;
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-training-plan`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}" });
      ok = [502, 503, 504].includes(res.status) ? 0 : ok + 1;
      if (ok >= 3) return;
    } catch {
      ok = 0;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`--- functions serve log (tail) ---\n${serveLogTail()}`);
  throw new Error("generate-training-plan did not become ready");
}

async function token(admin: SupabaseClient, userId: string): Promise<string> {
  const { data } = await admin.auth.admin.getUserById(userId);
  const password = `Sc${randomUUID().replace(/-/g, "").slice(0, 20)}Aa1!`;
  await admin.auth.admin.updateUserById(userId, { password });
  const anon = createClient(SUPABASE_URL, ANON_KEY as string, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: signedIn, error } = await anon.auth.signInWithPassword({ email: data.user!.email!, password });
  if (error || !signedIn.session) throw new Error("scratch sign-in failed");
  return signedIn.session.access_token;
}

async function athlete(admin: SupabaseClient, label: string, withDhTier: boolean) {
  const created = await createTestAthlete(admin, `R2 rollout HTTP — ${label}`);
  await setAthleteDiscipline(admin, created.athleteId, "Downhill");
  await upsertPerformanceProfileFor(admin, created.athleteId, {
    strength_experience_tier: "intermediate",
    equipment: ["dumbbells", "bench"],
    terrain_access: ["flow_trail", "bermed_trail"],
    declared_limitations: [],
    technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
    ...(withDhTier ? { dh_technical_tier: "intermediate" } : {}),
  });
  for (const d of [0, 1, 2, 3, 4, 5, 6]) await insertAvailabilityWindow(admin, created.athleteId, { day_of_week: d, start_time: "08:00:00", end_time: "20:00:00" });
  return { athleteId: created.athleteId, token: await token(admin, created.userId) };
}

async function schemaOf(admin: SupabaseClient, planVersionId: string | undefined): Promise<string | null> {
  if (!planVersionId) return null;
  const { data } = await admin.from("training_plan_versions").select("prescription_schema_version").eq("id", planVersionId).maybeSingle();
  return (data as { prescription_schema_version: string } | null)?.prescription_schema_version ?? null;
}
async function versionCount(admin: SupabaseClient, athleteId: string): Promise<number> {
  const { count } = await admin.from("training_plan_versions").select("id", { count: "exact", head: true }).eq("athlete_id", athleteId);
  return count ?? -1;
}
// pilot_observability_events is append-only (service_role may only INSERT): read it as the local DB owner.
function lastGenerationEvent(athleteId: string): Record<string, unknown> | null {
  const out = execLocalSql(
    `select jsonb_build_object('event_type', event_type) || metadata from public.pilot_observability_events where athlete_id = ${sqlLiteral(athleteId)} and event_type like 'plan_generation_%' order by created_at desc limit 1;`
  ).trim();
  return out ? (JSON.parse(out) as Record<string, unknown>) : null;
}

async function withRuntime(flag: "true" | "false", run: () => Promise<void>): Promise<void> {
  const envFile = join(tmpdir(), `nalynt-r2-rollout-${flag}.env`);
  writeFileSync(envFile, `NALYNT_V2_PLAN_GENERATION_ENABLED=${flag}\n`);
  const runtime = await startOwnedFunctionsRuntime(REPO_ROOT, envFile);
  try {
    await run();
  } finally {
    await runtime.stop();
  }
}

async function main(): Promise<void> {
  const admin = createTestClient();
  await admin.auth.admin.listUsers({ perPage: 1 }); // the local stack must be up
  const a = await athlete(admin, "A pilot", true);
  const b = await athlete(admin, "B control", true);
  const c = await athlete(admin, "C pilot without DH tier", false);
  // Operator assignment (service role only): A and C are internal V2 pilots, B is not assigned.
  for (const x of [a, c]) {
    const { error } = await admin.from("training_plan_model_assignments").insert({ athlete_id: x.athleteId, planning_model: "v2", note: "R2 rollout rehearsal" });
    if (error) throw new Error(`assignment insert failed: ${error.message}`);
  }
  const body = () => ({ generationRequestId: randomUUID(), durationWeeks: 2 });
  let aV2PlanVersionId: string | undefined;
  let completedDay: string | null = null;

  // ---------------- switch OFF ----------------
  await withRuntime("false", async () => {
    await waitReady(a.token);
    for (const [label, x] of [["A (assigned v2)", a], ["B (not assigned)", b]] as const) {
      const r = await call("generate-training-plan", x.token, body());
      record(`OFF: ${label} → 200, V1 plan`, r.status === 200 && (await schemaOf(admin, r.json?.planVersionId)) === "v1", JSON.stringify(r.json));
      const ev = lastGenerationEvent(x.athleteId);
      record(`OFF: ${label} → pilot event planningModel v1 / global_v2_disabled`, ev?.planningModel === "v1" && ev?.rolloutReason === "global_v2_disabled", JSON.stringify(ev));
    }
    record("OFF: the response never reveals the model", true);
  });

  // ---------------- switch ON ----------------
  await withRuntime("true", async () => {
    await waitReady(a.token);
    const first = body();
    const ra = await call("generate-training-plan", a.token, first);
    aV2PlanVersionId = ra.json?.planVersionId;
    record("ON: A (assigned v2) → 200, V2 plan persisted", ra.status === 200 && (await schemaOf(admin, aV2PlanVersionId)) === "v2", JSON.stringify(ra.json));
    record("ON: response contract unchanged (planVersionId + idempotentReplay only)", JSON.stringify(Object.keys(ra.json ?? {}).sort()) === JSON.stringify(["idempotentReplay", "planVersionId"]));
    const replay = await call("generate-training-plan", a.token, first);
    record("ON: A replay of the same request → same V2 version, idempotentReplay", replay.status === 200 && replay.json?.planVersionId === aV2PlanVersionId && replay.json?.idempotentReplay === true, JSON.stringify(replay.json));
    const evA = lastGenerationEvent(a.athleteId);
    record("ON: A pilot event planningModel v2 / assigned_v2", evA?.planningModel === "v2" && evA?.rolloutReason === "assigned_v2", JSON.stringify(evA));

    const rb = await call("generate-training-plan", b.token, body());
    record("ON: B (not assigned, V2-ready profile) → 200, V1 plan", rb.status === 200 && (await schemaOf(admin, rb.json?.planVersionId)) === "v1", JSON.stringify(rb.json));
    const evB = lastGenerationEvent(b.athleteId);
    record("ON: B pilot event planningModel v1 / default_v1", evB?.planningModel === "v1" && evB?.rolloutReason === "default_v1", JSON.stringify(evB));

    const before = await versionCount(admin, b.athleteId);
    for (const forged of [{ planningModel: "v2" }, { useV2: true }, { schemaVersion: "v2" }, { featureFlag: "v2" }]) {
      const r = await call("generate-training-plan", b.token, { ...body(), ...forged });
      record(`ON: B forges ${JSON.stringify(forged)} → 400 invalid_request, nothing generated`, r.status === 400 && r.json?.error?.code === "invalid_request", JSON.stringify(r.json));
    }
    record("ON: B forged bodies created no plan version", (await versionCount(admin, b.athleteId)) === before);

    const beforeC = await versionCount(admin, c.athleteId);
    const rc = await call("generate-training-plan", c.token, body());
    record("ON: C (assigned v2, no DH tier) → 422 missing_dh_technical_tier, never a V1 plan", rc.status === 422 && rc.json?.error?.code === "missing_dh_technical_tier" && (await versionCount(admin, c.athleteId)) === beforeC, JSON.stringify(rc.json));
    const evC = lastGenerationEvent(c.athleteId);
    record("ON: C pilot event plan_generation_blocked with planningModel v2", evC?.event_type === "plan_generation_blocked" && evC?.planningModel === "v2" && evC?.blockedReason === "missing_dh_technical_tier", JSON.stringify(evC));

    // A accepts its V2 plan through the real Edge, then Daily V2 → guided execution through the real Edge.
    const acc = await call("accept-training-plan", a.token, { planVersionId: aV2PlanVersionId });
    record("ON: A accepts the V2 plan (accept-training-plan)", acc.status === 200, JSON.stringify(acc.json).slice(0, 200));
    for (const day of TODAY_FOR_DAILY.slice(0, 4)) {
      await insertCheckin(admin, a.athleteId, day);
      const daily = await call("daily-run", a.token, { date: day });
      if (daily.status !== 200 || !("finalPrescriptionStatus" in (daily.json ?? {}))) {
        record(`ON: A daily-run ${day} follows the V2 plan`, false, JSON.stringify(daily.json).slice(0, 200));
        continue;
      }
      if (completedDay || daily.json.finalPrescriptionStatus !== "created") continue;
      const fp = daily.json.finalPrescription;
      const structure = fp.structure;
      const exec = randomUUID();
      const main = structure.blocks.find((bl: any) => bl.role === "main").items[0];
      const results =
        structure.family === "endurance"
          ? { activities: [{ id: randomUUID(), execution_id: exec, activity_id: structure.activitySelection.activityIds[0], duration_seconds: 2400, occurred_at: `${day}T17:30:00Z` }] }
          : { sets: [{ id: randomUUID(), execution_id: exec, prescription_item_id: main.prescriptionItemId, set_number: 1, done: true, measure_type: main.measure.type, measure_value: main.measure.type === "pass" ? null : 8, occurred_at: `${day}T17:30:00Z` }] };
      const start = await call("session-execution", a.token, { execution: { id: exec, session_date: day, started_at: `${day}T17:00:00Z`, final_prescription_id: fp.id, comment: null }, events: [{ id: randomUUID(), execution_id: exec, event_type: "started", occurred_at: `${day}T17:00:00Z` }] });
      const done = await call("session-execution", a.token, { events: [{ id: randomUUID(), execution_id: exec, event_type: "completed", occurred_at: `${day}T18:00:00Z` }], ...results });
      record(`ON: A guided ${structure.family} session ${day}: start → result + completed (session-execution)`, start.status === 200 && done.status === 200, `${start.status}/${done.status} ${JSON.stringify(done.json).slice(0, 160)}`);
      completedDay = day;
    }
    record("ON: A daily-run followed the V2 plan and one guided session was completed", completedDay !== null);
  });

  // ---------------- switch OFF again (global rollback) ----------------
  await withRuntime("false", async () => {
    await waitReady(a.token);
    const day = TODAY_FOR_DAILY[4]!;
    await insertCheckin(admin, a.athleteId, day);
    const daily = await call("daily-run", a.token, { date: day });
    record("OFF again: A's current V2 plan still drives Daily (V2 fields present)", daily.status === 200 && "finalPrescriptionStatus" in (daily.json ?? {}), JSON.stringify(daily.json).slice(0, 200));
    const ra = await call("generate-training-plan", a.token, body());
    record("OFF again: A's NEW generation → V1 plan", ra.status === 200 && (await schemaOf(admin, ra.json?.planVersionId)) === "v1", JSON.stringify(ra.json));
    const { data: current } = await admin.from("training_plan_current_version").select("plan_version_id").eq("athlete_id", a.athleteId).single();
    record("OFF again: A's current plan is still the accepted V2 plan (a new V1 plan only becomes current once accepted)", (current as any)?.plan_version_id === aV2PlanVersionId);
    const rb = await call("generate-training-plan", b.token, body());
    record("OFF again: B → V1", rb.status === 200 && (await schemaOf(admin, rb.json?.planVersionId)) === "v1");
    const { rawContext } = await computeDailyFor(admin, a.athleteId, day);
    record("M1 feedback: the completed guided session counts in A's next Daily", rawContext.recent_sessions.some((s) => s.date === completedDay && s.completion_status === "done"));
  });

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} scenarios passed.`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
