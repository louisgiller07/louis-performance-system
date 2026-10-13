/**
 * P0-3 (HPM 2026-10-13, option P1) — the persist_daily_run_v2 contract of a manual KEEP, on the production schema
 * plus migration 20261013120000. A real payload is produced by runDailyFor (persistence intercepted, nothing
 * written), then sent to the RPC as is (accepted) and with each forged variant (refused, nothing written).
 * The manual origin is never accepted on the caller's word.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCheckin, isLoopbackSupabaseUrl, resolveTestSupabaseUrl, setAthleteDiscipline } from "./testDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { DEFAULT_RUN_DAILY_FOR_DEPS, runDailyFor } from "../../src/supabase/runDailyFor.js";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const ENABLED = process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && isLoopbackSupabaseUrl(resolveTestSupabaseUrl());

type Json = Record<string, any>;
interface Captured { athleteId: string; healthFlag: unknown; decisionRow: Json; outcome: Json }
interface Rider { athleteId: string; planVersionId: string; client: SupabaseClient; dhDays: string[]; genDays: string[] }

describe.skipIf(!ENABLED)("P0-3 — persist_daily_run_v2: manual KEEP contract (local, production schema + candidate migration)", { timeout: 240_000 }, () => {
  let admin: SupabaseClient;
  let a: Rider;
  let b: Rider;

  async function rider(name: string): Promise<Rider> {
    const { athleteId } = await createTestAthlete(admin, `P0-3 contract ${name} ${randomUUID().slice(0, 6)}`);
    await setAthleteDiscipline(admin, athleteId, "Downhill");
    await upsertPerformanceProfileFor(admin, athleteId, {
      strength_experience_tier: "intermediate",
      equipment: ["dumbbells", "bench"],
      terrain_access: ["flow_trail", "bermed_trail", "full_dh_track"],
      declared_limitations: [],
      technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering"] },
      dh_technical_tier: "intermediate",
    });
    for (const d of [0, 1, 2, 3, 4, 5, 6]) await insertAvailabilityWindow(admin, athleteId, { day_of_week: d, start_time: "08:00:00", end_time: "20:00:00" });
    const r = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 2, today: "2026-10-04" });
    if (r.status !== "persisted") throw new Error("plan");
    await acceptTrainingPlanVersion(admin, athleteId, r.planVersionId, "2026-10-05", "2026-10-18");
    const { data } = await admin.from("planned_sessions").select("planned_date, intervention").eq("athlete_id", athleteId).order("planned_date");
    const rows = data as { planned_date: string; intervention: { kind: string } | null }[];
    return {
      athleteId,
      planVersionId: r.planVersionId,
      client: await getAthleteAuthClient(athleteId),
      dhDays: rows.filter((x) => x.intervention?.kind === "DH_TECHNICAL").map((x) => x.planned_date),
      genDays: rows.filter((x) => x.intervention !== null && x.intervention.kind !== "REST").map((x) => x.planned_date),
    };
  }
  async function manual(r: Rider, date: string) {
    const { error } = await r.client
      .from("planned_sessions")
      .upsert({ athlete_id: r.athleteId, planned_date: date, session_type: "STRENGTH_B", intervention: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" }, planned_intent: null, source: "manual", is_committed: false, source_plan_version_id: null, source_generated_session_id: null }, { onConflict: "athlete_id,planned_date" });
    if (error) throw new Error(error.message);
  }
  /** The exact RPC arguments runDailyFor would send — nothing persisted. */
  async function capture(r: Rider, date: string): Promise<Captured> {
    let captured: Captured | null = null;
    await runDailyFor(admin, r.athleteId, date, {
      ...DEFAULT_RUN_DAILY_FOR_DEPS,
      persistDailyRunV2: async (_c, athleteId, healthFlag, decisionRow, outcome) => {
        captured = JSON.parse(JSON.stringify({ athleteId, healthFlag, decisionRow, outcome }));
        throw new Error("captured");
      },
    }).catch((e) => {
      if ((e as Error).message !== "captured") throw e;
    });
    return captured!;
  }
  /** Fresh ids (decision and prescription) on a deep copy, so every attempt is a new write. */
  function fresh(c: Captured, mutate: (row: Json, fp: Json | null, outcome: Json) => void = () => {}) {
    const copy: Captured = JSON.parse(JSON.stringify(c));
    const decisionId = randomUUID();
    copy.decisionRow.id = decisionId;
    const fp = copy.outcome.final_prescription ?? null;
    if (fp) {
      fp.id = randomUUID();
      fp.decision_id = decisionId;
    }
    mutate(copy.decisionRow, fp, copy.outcome);
    return copy;
  }
  async function send(c: Captured, athleteId = c.athleteId) {
    const { data, error } = await admin.rpc("persist_daily_run_v2", { p_athlete_id: athleteId, p_health_flag: c.healthFlag, p_decision_row: c.decisionRow, p_final_prescription_outcome: c.outcome });
    return error ? { ok: false as const, message: error.message } : { ok: true as const, data: data as Json };
  }
  const decisionCount = async (athleteId: string) => (await admin.from("decisions").select("id", { count: "exact", head: true }).eq("athlete_id", athleteId)).count ?? 0;

  let manualKeep: Captured;
  let bPlannedSession: { id: string; updated_at: string };

  beforeAll(async () => {
    admin = createTestClient();
    a = await rider("A");
    b = await rider("B");
    const day = a.dhDays[0]!;
    await manual(a, day);
    await insertCheckin(admin, a.athleteId, day);
    manualKeep = await capture(a, day);
    await manual(b, b.dhDays[0]!);
    const { data } = await admin.from("planned_sessions").select("id, updated_at").eq("athlete_id", b.athleteId).eq("planned_date", b.dhDays[0]!).single();
    bPlannedSession = data as { id: string; updated_at: string };
  }, 180_000);

  it("the captured payload is a manual KEEP: origin manual_override_new_kind, action keep, no planned prescription, no rule", () => {
    const fp = manualKeep.outcome.final_prescription;
    expect([manualKeep.decisionRow.daily_plan.decision, fp.active_session_origin, fp.reconciliation_action, fp.planned_prescription_id, fp.adaptation_rule_ids]).toEqual(["KEEP", "manual_override_new_kind", "keep", null, []]);
  });

  it("accepted as is: the decision and its final prescription are written", async () => {
    const before = await decisionCount(a.athleteId);
    const r = await send(fresh(manualKeep));
    expect(r.ok, r.ok ? "" : r.message).toBe(true);
    expect(await decisionCount(a.athleteId)).toBe(before + 1);
  });

  const forged: [string, (row: Json, fp: Json | null, outcome: Json) => void, RegExp, ((c: Captured) => string)?][] = [
    ["origin declared generated (keep without planned prescription)", (_r, fp) => { fp!.active_session_origin = "generated"; }, /requires planned_prescription_id/],
    ["origin manual_override_same_kind (keep without planned prescription)", (_r, fp) => { fp!.active_session_origin = "manual_override_same_kind"; }, /requires planned_prescription_id/],
    ["a keep with an adaptation rule", (_r, fp) => { fp!.adaptation_rule_ids = ["v2.manual.session"]; }, /carries no adaptation rule/],
    ["action replace on a KEEP decision", (_r, fp) => { fp!.reconciliation_action = "replace"; fp!.adaptation_rule_ids = ["v2.manual.session"]; }, /does not match decision/],
    ["no source planned session on the decision", (row) => { row.source_planned_session_id = null; row.source_planned_session_updated_at = null; }, /requires the decision's source planned session/],
    ["another athlete's manual session", (row) => { row.source_planned_session_id = bPlannedSession.id; row.source_planned_session_updated_at = bPlannedSession.updated_at; }, /not this athlete's current manual session/],
    ["a stale version of the manual session", (row) => { row.source_planned_session_updated_at = "2000-01-01T00:00:00+00:00"; }, /not this athlete's current manual session/],
    ["another athlete's plan version", (_r, fp) => { fp!.plan_version_id = b.planVersionId; }, /requires the athlete's current plan version/],
    ["no plan version", (_r, fp) => { fp!.plan_version_id = null; }, /requires the athlete's current plan version/],
  ];
  for (const [name, mutate, message] of forged) {
    it(`refused, nothing written — ${name}`, async () => {
      const before = await decisionCount(a.athleteId);
      const r = await send(fresh(manualKeep, mutate));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(message);
      expect(await decisionCount(a.athleteId)).toBe(before);
    });
  }

  it("refused, nothing written — the payload sent for another athlete", async () => {
    const before = await decisionCount(b.athleteId);
    const r = await send(fresh(manualKeep), b.athleteId);
    expect(r.ok).toBe(false);
    expect(await decisionCount(b.athleteId)).toBe(before);
  });

  it("refused — a manual origin on a GENERATED planned session (origin incoherent with the data)", async () => {
    const day = a.genDays.find((d) => d !== a.dhDays[0])!;
    await insertCheckin(admin, a.athleteId, day);
    const generated = await capture(a, day);
    const r = await send(
      fresh(generated, (_row, fp) => {
        fp!.active_session_origin = "manual_override_new_kind";
        fp!.planned_prescription_id = null;
        if (fp!.reconciliation_action === "keep") fp!.adaptation_rule_ids = [];
      })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/not this athlete's current manual session|never references a planned prescription/);
  });

  it("generated KEEP unchanged: accepted with its planned prescription, refused without it", async () => {
    const day = a.genDays.find((d) => d !== a.dhDays[0])!;
    const generated = await capture(a, day);
    const fp = generated.outcome.final_prescription;
    expect([fp.active_session_origin, fp.reconciliation_action, fp.planned_prescription_id !== null]).toEqual(["generated", "keep", true]);
    expect((await send(fresh(generated))).ok).toBe(true);
    const without = await send(fresh(generated, (_r, f) => { f!.planned_prescription_id = null; }));
    expect(without.ok).toBe(false);
    if (!without.ok) expect(without.message).toMatch(/requires planned_prescription_id/);
  });
});
