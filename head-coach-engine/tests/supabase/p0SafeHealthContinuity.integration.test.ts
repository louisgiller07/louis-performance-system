/**
 * P0-SAFE — health continuity in the daily decision, end to end on the LOCAL Supabase
 * (real M1, real V2 reconciliation, real persist_daily_run_v2, real record_session_execution).
 *
 * Incident A (production, Alex Martin Test): a manual 90-min DH day, knee pain 2/10 then 8/10,
 *   not new, no trauma, no function loss, not getting worse → kept as a 90-min light DH, "PRÊT".
 * Incident B (local V2, review 12.10): a traumatic knee pain with function loss (or a fever) creates
 *   an active health_flags row; one or two days later a normal check-in got a full DH "conforme au plan".
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, insertCheckin, insertPlannedSession, setAthleteDiscipline, type CheckinFixture } from "./testDb.js";
import { localIntegrationRequested } from "./localDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { runDailyFor } from "../../src/supabase/runDailyFor.js";
import { resolveHealthFlag } from "../../src/supabase/resolveHealthFlag.js";

const INTEGRATION_ENABLED = localIntegrationRequested();

/** Knee pain as declared in the production incident: everything "no" except the pain itself. */
const KNEE = (intensity: number, extra: CheckinFixture = {}): CheckinFixture => ({
  pain: true,
  pain_intensity: intensity,
  pain_new: false,
  pain_location_code: "knee_R",
  pain_traumatic: false,
  pain_function_loss: false,
  pain_getting_worse: false,
  ...extra,
});

type Rule = { layer: string; rule_id: string; detail: string };
type Plan = { decision: string; final_session: { kind: string; load_profile?: string; duration_min?: number }; triggered_rules: Rule[]; reasoning: string; health_flag_to_create?: { type: string } };

describe.skipIf(!INTEGRATION_ENABLED)("P0-SAFE — health continuity in the daily decision (local Supabase)", { timeout: 120_000 }, () => {
  let admin: SupabaseClient;
  beforeAll(() => {
    admin = createTestClient();
  });

  /** A V2 rider: physical Mon–Thu evenings, riding Sat + Sun; plan accepted from Tue 06.10. */
  async function rider(name: string) {
    const { athleteId } = await createTestAthlete(admin, `P0-SAFE ${name} ${randomUUID().slice(0, 6)}`);
    await setAthleteDiscipline(admin, athleteId, "Downhill");
    await upsertPerformanceProfileFor(admin, athleteId, {
      strength_experience_tier: "intermediate",
      equipment: ["dumbbells", "bench"],
      terrain_access: ["flow_trail", "bermed_trail"],
      declared_limitations: [],
      technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
      dh_technical_tier: "intermediate",
    });
    for (const d of [1, 2, 3, 4]) await insertAvailabilityWindow(admin, athleteId, { day_of_week: d, start_time: "18:00:00", end_time: "19:30:00", activity: "physical" });
    for (const d of [6, 0]) await insertAvailabilityWindow(admin, athleteId, { day_of_week: d, start_time: "08:00:00", end_time: "18:00:00", activity: "riding" });
    const p = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 3, today: "2026-10-05" });
    if (p.status !== "persisted") throw new Error(`plan not persisted: ${JSON.stringify(p)}`);
    await acceptTrainingPlanVersion(admin, athleteId, p.planVersionId, "2026-10-06", "2026-10-26");
    const { data } = await admin.from("training_plan_generated_sessions").select("date, kind").eq("plan_version_id", p.planVersionId).order("date");
    const sessions = (data ?? []) as { date: string; kind: string }[];
    return {
      athleteId,
      dh: sessions.filter((s) => s.kind === "DH_TECHNICAL").map((s) => s.date),
      force: sessions.filter((s) => s.kind.startsWith("STRENGTH")).map((s) => s.date),
    };
  }
  const updateCheckin = async (athleteId: string, date: string, fields: CheckinFixture) => {
    const { error } = await admin.from("daily_checkins").update(fields).eq("athlete_id", athleteId).eq("checkin_date", date);
    if (error) throw new Error(error.message);
  };
  const flags = async (athleteId: string) => {
    const { data } = await admin.from("health_flags").select("id, flag_type, status, flag_date, resolved_at").eq("athlete_id", athleteId).order("created_at");
    return (data ?? []) as { id: string; flag_type: string; status: string; flag_date: string; resolved_at: string | null }[];
  };
  const day = async (athleteId: string, date: string) => {
    const r = await runDailyFor(admin, athleteId, date);
    const plan = r.dailyPlan as unknown as Plan;
    return { plan, status: r.finalPrescriptionStatus, rules: plan.triggered_rules.map((t) => t.rule_id), r };
  };
  const nextDay = (date: string, n = 1) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  it("Incident A — manual 90-min DH, knee 2/10 then 8/10 (not new, no trauma, no function loss, not worse): no DH, rest + professional orientation, a health signal", async () => {
    const r = await rider("incident A");
    const date = "2026-10-09"; // a Friday without any plan session
    await insertPlannedSession(r.athleteId, date, { session_type: "DH_TECHNICAL", intervention: { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 90 } });
    await insertCheckin(admin, r.athleteId, date, KNEE(2));
    const before = await day(r.athleteId, date);
    console.info("A 2/10:", before.plan.decision, before.plan.final_session, before.rules);
    expect(before.plan.final_session.kind.startsWith("DH")).toBe(true); // a light pain stays non-Safety (unchanged)

    await updateCheckin(r.athleteId, date, KNEE(8));
    const after = await day(r.athleteId, date);
    console.info("A 8/10:", after.plan.decision, after.plan.final_session, after.rules, after.status);
    expect([after.plan.decision, after.plan.final_session.kind, after.status]).toEqual(["REST", "REST", "not_required"]);
    expect(after.plan.triggered_rules[0]).toMatchObject({ layer: "A", rule_id: "A6" });
    expect(after.plan.reasoning).toMatch(/professionnel de santé/);
    expect((await flags(r.athleteId)).map((f) => [f.flag_type, f.status])).toEqual([["injury_suspect", "active"]]);
  });

  it("Incident B — traumatic knee pain with function loss (A4), then a normal check-in on D+1 and D+2: the open signal still rules the day (no DH, no Force), explicitly reminded", async () => {
    const r = await rider("incident B injury");
    const d0 = r.dh[0]!;
    await insertCheckin(admin, r.athleteId, d0, KNEE(8, { pain_new: true, pain_traumatic: true, pain_function_loss: true }));
    const first = await day(r.athleteId, d0);
    expect([first.plan.decision, first.rules[0]]).toEqual(["REST", "A2"]);
    for (const n of [1, 2]) {
      const d = nextDay(d0, n);
      await insertCheckin(admin, r.athleteId, d);
      const later = await day(r.athleteId, d);
      console.info(`B injury D+${n}:`, later.plan.decision, later.plan.final_session, later.rules, later.status);
      expect([later.plan.decision, later.plan.final_session.kind, later.status]).toEqual(["REST", "REST", "not_required"]);
      expect(later.plan.triggered_rules[0]).toMatchObject({ layer: "A", rule_id: "A7" });
      expect(later.plan.health_flag_to_create).toBeUndefined(); // no duplicate signal
    }
    expect((await flags(r.athleteId)).map((f) => [f.flag_type, f.status])).toEqual([["injury_suspect", "active"]]);
  });

  it("Incident B — fever (A3), then a normal check-in the next day: still no training while the illness signal is open", async () => {
    const r = await rider("incident B illness");
    const d0 = r.force[0]!;
    await insertCheckin(admin, r.athleteId, d0, { fever_or_illness: true });
    expect((await day(r.athleteId, d0)).rules[0]).toBe("A3");
    const d1 = nextDay(d0);
    await insertCheckin(admin, r.athleteId, d1);
    const later = await day(r.athleteId, d1);
    console.info("B illness D+1:", later.plan.decision, later.plan.final_session, later.rules);
    expect([later.plan.decision, later.rules[0]]).toEqual(["REST", "A7"]);
  });

  it("Severe pain then milder pain the next day: the open signal still protects (A7) — an apparently reassuring answer never erases it silently", async () => {
    const r = await rider("continuity");
    const d0 = r.force[0]!;
    await insertCheckin(admin, r.athleteId, d0, KNEE(8));
    expect((await day(r.athleteId, d0)).rules[0]).toBe("A6");
    const d1 = r.dh[0]!;
    await insertCheckin(admin, r.athleteId, d1, KNEE(2));
    const later = await day(r.athleteId, d1);
    expect([later.plan.decision, later.rules[0], later.status]).toEqual(["REST", "A7", "not_required"]);
    expect(later.plan.reasoning).toMatch(/suspicion de blessure du \d{2}\.\d{2}/);
  });

  it("Resolution: explicit, persisted, audited; then the plan resumes (DH and Force), never before", async () => {
    const r = await rider("resolution");
    const d0 = r.dh[0]!;
    await insertCheckin(admin, r.athleteId, d0, KNEE(8, { pain_new: true, pain_traumatic: true, pain_function_loss: true }));
    await day(r.athleteId, d0);
    const [flag] = await flags(r.athleteId);

    // Before closure: Force day and DH day both protected.
    const force = r.force.find((d) => d > d0)!;
    await insertCheckin(admin, r.athleteId, force);
    expect((await day(r.athleteId, force)).rules[0]).toBe("A7");

    const out = await resolveHealthFlag(admin, r.athleteId, flag!.id, { professionalConsulted: true, resolvedAt: force });
    expect(out).toEqual({ status: "resolved", flagId: flag!.id, flagType: "injury_suspect", resolvedAt: force });
    const { data: row } = await admin.from("health_flags").select("status, resolved_at, resolution_note, professional_consulted, flag_date, description").eq("id", flag!.id).single();
    expect(row).toMatchObject({ status: "resolved", resolved_at: force, professional_consulted: true, flag_date: d0 });
    expect((row as { resolution_note: string }).resolution_note).toMatch(/Clôturé par le rider.*Aucune validation médicale par NALYNT/);
    expect((row as { description: string }).description).toMatch(/^Douleur nouvelle sévère \(8\/10\)/); // the declaration is kept (A2 precedes A4)
    expect(await resolveHealthFlag(admin, r.athleteId, flag!.id, { professionalConsulted: false, resolvedAt: force })).toEqual({ status: "already_resolved" });

    // A new decision on the same day after closure: the plan again (a new decision row, the REST one kept).
    const resumed = await day(r.athleteId, force);
    expect([resumed.plan.decision, resumed.status]).toEqual(["KEEP", "created"]);
    const dh = r.dh.find((d) => d > force)!;
    await insertCheckin(admin, r.athleteId, dh);
    const dhDay = await day(r.athleteId, dh);
    expect([dhDay.plan.final_session.kind, dhDay.status]).toEqual(["DH_TECHNICAL", "created"]);
    const { count } = await admin.from("decisions").select("id", { count: "exact", head: true }).eq("athlete_id", r.athleteId).eq("decision_date", force);
    expect(count).toBe(2);
  });

  it("Closure is scoped and guarded: another rider's signal → not_found; a concussion signal → medical validation required (A5 unchanged)", async () => {
    const a = await rider("owner");
    const b = await rider("stranger");
    await insertCheckin(admin, a.athleteId, a.dh[0]!, { fever_or_illness: true });
    await day(a.athleteId, a.dh[0]!);
    const [illness] = await flags(a.athleteId);
    expect(await resolveHealthFlag(admin, b.athleteId, illness!.id, { professionalConsulted: false, resolvedAt: a.dh[0]! })).toEqual({ status: "not_found" });
    expect((await flags(a.athleteId))[0]!.status).toBe("active");

    await insertCheckin(admin, b.athleteId, b.dh[0]!, { suspected_concussion: true });
    await day(b.athleteId, b.dh[0]!);
    const [concussion] = await flags(b.athleteId);
    expect(await resolveHealthFlag(admin, b.athleteId, concussion!.id, { professionalConsulted: true, resolvedAt: b.dh[0]! })).toEqual({ status: "medical_validation_required" });
  });

  it("Manual replacement cannot bypass: with an open signal, a DH the rider adds by hand on a free day is still a REST", async () => {
    const r = await rider("manual bypass");
    const d0 = r.force[0]!;
    await insertCheckin(admin, r.athleteId, d0, { fever_or_illness: true });
    await day(r.athleteId, d0);
    const free = "2026-10-16"; // Friday, no plan session
    await insertPlannedSession(r.athleteId, free, { session_type: "DH_TECHNICAL", intervention: { kind: "DH_TECHNICAL", load_profile: "HEAVY", duration_min: 240 }, is_committed: true });
    await insertCheckin(admin, r.athleteId, free);
    const out = await day(r.athleteId, free);
    expect([out.plan.decision, out.rules[0], out.status]).toEqual(["REST", "A7", "not_required"]);
  });

  it("Server-side bypass: a prescription created before the pain cannot be started once the day is a Safety REST", async () => {
    const r = await rider("execution bypass");
    const d0 = r.dh[0]!;
    await insertCheckin(admin, r.athleteId, d0);
    const morning = await day(r.athleteId, d0);
    expect(morning.status).toBe("created");
    const { data: fps } = await admin.from("decision_final_prescriptions").select("id").eq("athlete_id", r.athleteId);
    const oldFp = (fps as { id: string }[])[0]!.id;
    await updateCheckin(r.athleteId, d0, KNEE(8));
    expect((await day(r.athleteId, d0)).rules[0]).toBe("A6");
    const id = randomUUID();
    const { data, error } = await admin.rpc("record_session_execution", {
      p_athlete_id: r.athleteId,
      p_payload: { execution: { id, session_date: d0, started_at: `${d0}T09:00:00Z`, final_prescription_id: oldFp }, events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: `${d0}T09:00:00Z` }] },
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ status: "rejected", code: "final_prescription_not_current" });
    const { count } = await admin.from("session_executions").select("id", { count: "exact", head: true }).eq("athlete_id", r.athleteId);
    expect(count).toBe(0);
  });

  it("A light pain (3/10) stays non-Safety and never blocks the next days (no signal created)", async () => {
    const r = await rider("light pain");
    const d0 = r.dh[0]!;
    await insertCheckin(admin, r.athleteId, d0, KNEE(3));
    const sore = await day(r.athleteId, d0);
    expect(sore.rules).toContain("PAIN_NON_SAFETY");
    expect(sore.plan.decision).not.toBe("REST");
    const d1 = nextDay(d0);
    await insertCheckin(admin, r.athleteId, d1);
    expect((await day(r.athleteId, d1)).plan.decision).not.toBe("REST");
    expect(await flags(r.athleteId)).toEqual([]);
  });

  it("No permanent block from non-medical signals: severe fatigue / short night, then a normal day → the plan resumes (no health signal created)", async () => {
    const r = await rider("fatigue only");
    const d0 = r.force[0]!;
    await insertCheckin(admin, r.athleteId, d0, { sleep_hours: 4, sleep_quality: 2, energy: 2, leg_fatigue: 9, grip_fatigue: 8 });
    const tired = await day(r.athleteId, d0);
    expect(tired.plan.health_flag_to_create).toBeUndefined();
    const d1 = r.force[1]!;
    await insertCheckin(admin, r.athleteId, d1);
    const fresh = await day(r.athleteId, d1);
    expect([fresh.plan.decision, fresh.status]).toEqual(["KEEP", "created"]);
    expect(await flags(r.athleteId)).toEqual([]);
  });
});
