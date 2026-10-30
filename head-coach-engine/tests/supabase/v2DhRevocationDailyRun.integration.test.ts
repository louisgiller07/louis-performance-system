/**
 * V2-DH-REVOCATION (PR2-DH-REVOCATION-PREP, HPM 2026-10-27) — the daily run (V2 path) and a DH drill revoked in the
 * DATABASE (dh_drill_revocations, migration 20261027120000), on a DISPOSABLE local database only. Opt-in:
 * RUN_LOCAL_DH_REVOCATION=1, alone, on a FRESH throw-away stack (the migration applied, no revocation recorded yet: the
 * revocations below are permanent, and v2DhRevocation.integration.test.ts revokes drills of this plan). Real generation,
 * acceptance, M1, reconciliation and persist_daily_run_v2.
 *
 * Two V2 riders:
 *  - production (V2 OFF, as in production today): sign-off tables EMPTY, a V2 plan whose DH counts state no unit (as
 *    plans generated before V2-DH-UNIT-01), the daily run without dhUnit (flag off);
 *  - signed (V2 ON conditions): the daily run requires the signed DH unit (dhUnit "required"); sign-offs and the common
 *    validation are TEST fixtures routed through the REAL gate (planning-engine dist), not sports decisions — the
 *    code-level sign-off stays OPEN for every drill, so the refusals below come from the database revocation alone.
 *
 *  - Before any revocation: KEEP, MODIFY, REPLACE and a manual DH are served to both riders.
 *  - A revocation being written while a run persists: the run waits for it, then refuses; nothing written.
 *  - After the revocation: KEEP, MODIFY, REPLACE and manual are each refused for both riders (DhDrillRevokedError — the
 *    daily-run Edge Function answers 409 dh_validation_not_current), nothing written, never a REST in their place; the
 *    earlier decision of the day stays, and its execution is refused (unit-less documents included).
 *  - Unaffected: a Force day; a REST stays a REST; a V1 rider (the V1 path never reaches the revocation table).
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCheckin, setAthleteDiscipline, type CheckinFixture } from "./testDb.js";
import { assertLocalDbReady, execLocalSql, localDbContainer, localIntegrationRequested, sqlLiteral } from "./localDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { runDailyFor, DEFAULT_RUN_DAILY_FOR_DEPS } from "../../src/supabase/runDailyFor.js";
import { DhDrillRevokedError } from "../../src/supabase/dailyV2/persistDailyRunV2.js";
import { resolveHealthFlag } from "../../../supabase/functions/health-flag-resolution/resolveHealthFlag.js";
import { generateTrainingPlanForAthlete } from "../../src/generation/generateTrainingPlanForAthlete.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { dhServedCommonContentV2, dhServedSportContentV2 } from "../../../planning-engine/dist/sessionModelV2/dhSportGateV2.js";
import { SESSION_DRILL_CATALOG_V2_ENTRIES } from "../../../planning-engine/dist/catalog/sessionDrillCatalogV2.js";

const ENABLED = localIntegrationRequested({ requirePublishableKey: true }) && process.env.RUN_LOCAL_DH_REVOCATION === "1";
// Plan generated the eve of 2026-10-05 (all-day windows, no history): week 1 introduction (LIGHT) DH 10-05/06, LOWER
// 10-07, UPPER 10-08; week 2 build (MODERATE) DH 10-12/13, LOWER 10-14, UPPER 10-15 (as in A04).
const GENERATED_ON = "2026-10-04";
const SYSTEMIC_RED: CheckinFixture = { sleep_hours: 4, sleep_quality: 2, sleep_wake_ups: 4, energy: 2 };
const GRIP_RED: CheckinFixture = { grip_fatigue: 9 };
const UNSAFE: CheckinFixture = { fever_or_illness: true };

const fixture = vi.hoisted(() => ({ signoffs: {} as Record<string, unknown>, common: null as unknown }));
vi.mock("../../../planning-engine/dist/sessionModelV2/dhSportGateV2.js", async (importOriginal) => {
  const real = await importOriginal<{ dhRepetitionUnitAttributionFromSignoffV2: (drillId: string, signoff: unknown, common: unknown) => unknown }>();
  return { ...real, dhRepetitionUnitAttributionV2: (drillId: string) => real.dhRepetitionUnitAttributionFromSignoffV2(drillId, fixture.signoffs[drillId], fixture.common) };
});
const TEST_DECISION = "TEST fixture V2-DH-REVOCATION (not a sports decision)";
/** The production sign-off tables: empty (no DH unit attributed anywhere). */
function productionSignoffs() {
  fixture.signoffs = {};
  fixture.common = null;
}
function testSignoffs() {
  fixture.signoffs = Object.fromEntries(
    SESSION_DRILL_CATALOG_V2_ENTRIES.map((d) => {
      const served = dhServedSportContentV2(d.drillId)!;
      return [
        d.drillId,
        {
          unit: { decision: TEST_DECISION, unit: "SECTION" },
          cue: { decision: TEST_DECISION, drillName: served.drillName, cueText: served.cueText, criterionText: served.criterionText },
          dose: { decision: TEST_DECISION, doseTerms: served.doseTerms },
          safety: { decision: TEST_DECISION, vigilanceTexts: [...served.vigilanceTexts], regressesTo: served.regressesTo, terrains: [...served.terrains] },
        },
      ];
    })
  );
  fixture.common = { decision: TEST_DECISION, ...dhServedCommonContentV2()! };
}

type Item = { kind: string; drillId?: string; measure?: Record<string, unknown> };
type Structure = { family: string; sessionKind: string; blocks: { role: string; items: Item[] }[] };
type Served = { day: string; decisionId: string; finalPrescriptionId: string; drills: string[] };
type Key = "keep" | "modify" | "replace" | "manual";
type RiderKind = "production" | "signed";

describe.skipIf(!ENABLED)("V2-DH-REVOCATION — the V2 daily run and a DH drill revoked in the database (disposable local Supabase)", { timeout: 300_000 }, () => {
  let admin: SupabaseClient;
  const riders = {} as Record<RiderKind, string>;
  const served = { production: {}, signed: {} } as Record<RiderKind, Partial<Record<Key | "concurrent", Served>>>;

  /** The rider's daily run: production = V2 OFF (no dhUnit, empty sign-offs); signed = V2 ON conditions. */
  const daily = (kind: RiderKind, day: string) => {
    if (kind === "production") productionSignoffs();
    else testSignoffs();
    return runDailyFor(admin, riders[kind], day, kind === "production" ? DEFAULT_RUN_DAILY_FOR_DEPS : { ...DEFAULT_RUN_DAILY_FOR_DEPS, dhUnit: "required" });
  };
  const failureOf = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: unknown) => e
    );
  const count = (sql: string) => execLocalSql(sql).trim();
  const decisionsOn = (athleteId: string, day: string) => count(`select count(*) from public.decisions where athlete_id = ${sqlLiteral(athleteId)} and decision_date = ${sqlLiteral(day)};`);
  const latestDecisionOn = (athleteId: string, day: string) => count(`select id from public.decisions where athlete_id = ${sqlLiteral(athleteId)} and decision_date = ${sqlLiteral(day)} order by created_at desc, id desc limit 1;`);
  const finalPrescriptions = () => count(`select count(*) from public.decision_final_prescriptions where athlete_id in (${sqlLiteral(riders.production)}, ${sqlLiteral(riders.signed)});`);
  const revokeAsOperator = (drills: readonly string[]) =>
    `set role service_role;\ninsert into public.dh_drill_revocations (drill_id, reason, decided_by) values ${drills.map((d) => `(${sqlLiteral(d)}, 'TEST fixture: safety revocation (not a sports decision)', 'TEST operator')`).join(", ")};`;
  async function finalOf(decisionId: string) {
    const { data } = await admin.from("decision_final_prescriptions").select("id, reconciliation_action, active_session_origin, structure").eq("decision_id", decisionId).single();
    const structure = data!.structure as Structure;
    const drillItems = structure.blocks.flatMap((b) => b.items).filter((i) => i.kind === "drill");
    return {
      id: data!.id as string,
      action: data!.reconciliation_action as string,
      origin: data!.active_session_origin as string,
      structure,
      drills: [...new Set(drillItems.map((i) => i.drillId!))].sort(),
      units: [...new Set(drillItems.map((i) => String(i.measure?.unit ?? "none")))].sort(),
    };
  }
  async function manualDh(athleteId: string, day: string) {
    const rider = await getAthleteAuthClient(athleteId);
    const { error } = await rider
      .from("planned_sessions")
      .upsert({ athlete_id: athleteId, planned_date: day, session_type: "DH_TECHNICAL", intervention: { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 90 }, planned_intent: null, source: "manual", is_committed: false, source_plan_version_id: null, source_generated_session_id: null }, { onConflict: "athlete_id,planned_date" });
    if (error) throw new Error(error.message);
  }
  async function start(athleteId: string, executionId: string, fpId: string, day: string) {
    const { data, error } = await admin.rpc("record_session_execution", {
      p_athlete_id: athleteId,
      p_payload: { execution: { id: executionId, session_date: day, started_at: `${day}T17:00:00Z`, final_prescription_id: fpId }, events: [{ id: randomUUID(), execution_id: executionId, event_type: "started", occurred_at: `${day}T17:00:00Z` }] },
    });
    if (error) throw new Error(error.message);
    return data as { status: string; code?: string };
  }
  async function rider(label: string) {
    const { athleteId } = await createTestAthlete(admin, `V2-DH-REVOCATION daily run ${label}`);
    await setAthleteDiscipline(admin, athleteId, "Downhill");
    await upsertPerformanceProfileFor(admin, athleteId, {
      strength_experience_tier: "intermediate",
      equipment: ["dumbbells", "bench"],
      terrain_access: ["flow_trail", "bermed_trail"],
      declared_limitations: [],
      technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
      dh_technical_tier: "intermediate",
    });
    for (const d of [0, 1, 2, 3, 4, 5, 6]) await insertAvailabilityWindow(admin, athleteId, { day_of_week: d, start_time: "08:00:00", end_time: "20:00:00" });
    execLocalSql(`insert into public.training_plan_model_assignments (athlete_id, planning_model, note) values (${sqlLiteral(athleteId)}, 'v2', 'V2-DH-REVOCATION test');`);
    return athleteId;
  }

  beforeAll(async () => {
    assertLocalDbReady();
    if (execLocalSql("select to_regclass('public.dh_drill_revocations') is null;").trim() === "t" || !execLocalSql("select prosrc from pg_proc where oid = 'public.persist_daily_run_v2(uuid, jsonb, jsonb, jsonb)'::regprocedure;").includes("NX302")) {
      throw new Error("migration 20261027120000 is not applied on this stack: start a fresh stack from this checkout");
    }
    if (execLocalSql("select count(*) from public.dh_drill_revocations;").trim() !== "0") {
      throw new Error("revocations are already recorded on this stack: this suite needs a fresh disposable stack");
    }
    admin = createTestClient();

    // Production: a V2 plan as generated before V2-DH-UNIT-01 — no sign-off, no unit required, counts without a unit.
    productionSignoffs();
    riders.production = await rider("production (V2 OFF)");
    const legacy = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId: riders.production, generationRequestId: randomUUID(), durationWeeks: 2, today: GENERATED_ON });
    if (legacy.status !== "persisted") throw new Error(`expected a persisted V2 plan, got ${JSON.stringify(legacy)}`);
    await acceptTrainingPlanVersion(admin, riders.production, legacy.planVersionId, "2026-10-05", "2026-10-18");

    // Signed: the V2 ON generation path, test sign-offs.
    testSignoffs();
    riders.signed = await rider("signed (V2 ON conditions)");
    const generated = await generateTrainingPlanForAthlete({ client: admin, athleteId: riders.signed, generationRequestId: randomUUID(), durationWeeks: 2, today: GENERATED_ON, globalV2Enabled: true });
    if (generated.status !== "persisted") throw new Error(`expected a persisted V2 plan, got ${JSON.stringify(generated)}`);
    await acceptTrainingPlanVersion(admin, riders.signed, generated.planVersionId, "2026-10-05", "2026-10-18");
  }, 240_000);

  it("before any revocation: KEEP, MODIFY, REPLACE and a manual DH are served to both riders — unit-less counts with V2 OFF, signed units under V2 ON conditions", async () => {
    const scenarios: [Key | "concurrent", string, CheckinFixture | undefined, string, string, string][] = [
      ["keep", "2026-10-12", undefined, "KEEP", "keep", "generated"],
      ["modify", "2026-10-13", SYSTEMIC_RED, "MODIFY", "modify", "generated"],
      ["replace", "2026-10-06", GRIP_RED, "REPLACE", "replace", "generated"],
      ["manual", "2026-10-07", undefined, "KEEP", "keep", "manual_override_new_kind"],
      ["concurrent", "2026-10-05", undefined, "KEEP", "keep", "generated"],
    ];
    for (const kind of ["production", "signed"] as const) {
      for (const [key, day, checkin, decision, action, origin] of scenarios) {
        if (key === "concurrent" && kind === "production") continue;
        const label = `${kind} ${key}`;
        if (key === "manual") await manualDh(riders[kind], day);
        await insertCheckin(admin, riders[kind], day, checkin);
        const r = await daily(kind, day);
        expect([r.dailyPlan.decision, r.finalPrescriptionStatus], label).toEqual([decision, "created"]);
        const f = await finalOf(r.persistence.decision_id);
        expect([f.action, f.origin, f.structure.family], label).toEqual([action, origin, "dh_technical"]);
        expect(f.drills.length, label).toBeGreaterThan(0);
        expect(f.units, label).toEqual(kind === "production" ? ["none"] : ["SECTION"]);
        served[kind][key] = { day, decisionId: r.persistence.decision_id, finalPrescriptionId: f.id, drills: f.drills };
      }
    }
  });

  it("a revocation being written while a V2 run persists: the run waits for it, then refuses (DhDrillRevokedError); nothing written", async () => {
    const { day, decisionId, drills } = served.signed.concurrent!;
    const revocation = spawn("docker", ["exec", "-i", localDbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    revocation.stdout.on("data", (d) => (out += String(d)));
    revocation.stderr.on("data", (d) => (out += String(d)));
    revocation.stdin.write(`begin;\n${revokeAsOperator(drills)}\nselect 'HELD';\n`);
    for (let i = 0; i < 100 && !out.includes("HELD"); i += 1) await new Promise((r) => setTimeout(r, 100));
    expect(out).toContain("HELD");

    const run = failureOf(daily("signed", day));
    let queued = "0";
    for (let i = 0; i < 300 && queued === "0"; i += 1) {
      queued = count("select count(*) from pg_locks where relation = 'public.dh_drill_revocations'::regclass and not granted;");
      if (queued === "0") await new Promise((r) => setTimeout(r, 100));
    }
    expect(queued).toBe("1"); // the run's persist_daily_run_v2, waiting for the revocation being written
    revocation.stdin.end("commit;\n");
    await once(revocation, "exit");

    const failure = await run;
    expect(failure).toBeInstanceOf(DhDrillRevokedError);
    expect((failure as DhDrillRevokedError).drillIds).toEqual(drills);
    expect([decisionsOn(riders.signed, day), latestDecisionOn(riders.signed, day)]).toEqual(["1", decisionId]);
  });

  it("after the revocation: KEEP, MODIFY, REPLACE and manual are each refused for both riders, nothing written, never a REST; the earlier decision of the day stays and its execution is refused", async () => {
    const keys = ["keep", "modify", "replace", "manual"] as const;
    const all = [...new Set((["production", "signed"] as const).flatMap((kind) => keys.flatMap((k) => served[kind][k]!.drills)))].sort();
    execLocalSql(revokeAsOperator(all));
    const fpsBefore = finalPrescriptions();
    for (const kind of ["production", "signed"] as const) {
      for (const key of keys) {
        const label = `${kind} ${key}`;
        const { day, decisionId, finalPrescriptionId, drills } = served[kind][key]!;
        const failure = await failureOf(daily(kind, day));
        expect(failure, label).toBeInstanceOf(DhDrillRevokedError);
        expect((failure as DhDrillRevokedError).drillIds, label).toEqual(drills);
        expect([decisionsOn(riders[kind], day), latestDecisionOn(riders[kind], day)], label).toEqual(["1", decisionId]);
        // The frozen document of the day — unit-less with V2 OFF — cannot be started any more.
        expect(await start(riders[kind], randomUUID(), finalPrescriptionId, day), label).toMatchObject({ status: "rejected", code: "dh_validation_not_current" });
      }
      // A day never analysed: a manual DH there is refused too, no decision at all.
      const fresh = "2026-10-15";
      await manualDh(riders[kind], fresh);
      await insertCheckin(admin, riders[kind], fresh);
      expect(await failureOf(daily(kind, fresh)), kind).toBeInstanceOf(DhDrillRevokedError);
      expect(decisionsOn(riders[kind], fresh), kind).toBe("0");
    }
    expect(finalPrescriptions()).toBe(fpsBefore);
  });

  it("unaffected by the revocation: a Force day is served (both riders); a REST stays a REST (persisted, no final prescription); a V1 rider is served (V1 path)", async () => {
    const force = "2026-10-08";
    for (const kind of ["production", "signed"] as const) {
      await insertCheckin(admin, riders[kind], force);
      const f = await daily(kind, force);
      expect([f.dailyPlan.decision, f.dailyPlan.final_session.kind, f.finalPrescriptionStatus], kind).toEqual(["KEEP", "STRENGTH_UPPER", "created"]);
    }

    const rest = "2026-10-14";
    await manualDh(riders.signed, rest);
    await insertCheckin(admin, riders.signed, rest, UNSAFE);
    const r = await daily("signed", rest);
    expect([r.dailyPlan.decision, r.finalPrescriptionStatus]).toEqual(["REST", "not_required"]);
    expect(count(`select count(*) from public.decision_final_prescriptions where decision_id = ${sqlLiteral(r.persistence.decision_id)};`)).toBe("0");
    const { data: open } = await admin.from("health_flags").select("id").eq("athlete_id", riders.signed).in("status", ["active", "monitoring"]);
    for (const flag of (open ?? []) as { id: string }[]) await resolveHealthFlag(admin, riders.signed, flag.id, { resolvedAt: rest });

    const v1 = (await createTestAthlete(admin, "V2-DH-REVOCATION V1 rider")).athleteId;
    await insertCheckin(admin, v1, "2026-10-12");
    const one = await runDailyFor(admin, v1, "2026-10-12");
    expect(one.persistence.decision_id).toEqual(expect.any(String));
    expect(one).not.toHaveProperty("finalPrescriptionStatus");
  });
});
