/**
 * UX-11R.9 — the three Edge Functions on the local runtime (`npx supabase functions serve`, local stack
 * with the UX-11R.9 migrations): stable public codes, mapped by code (never by message text).
 * - session-execution: dh_pass_required → 422, session_already_completed → 409;
 * - completed-session (PUT): completed_session_v2_exists → 409 (precheck before the RPC), event session_completion_failed;
 * - accept-training-plan: stale_plan_version → 409, event plan_acceptance_failed with that code.
 * Requested but runtime not serving → the file fails with the fix (never silently skipped).
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, generateAndAcceptTrainingPlan, generateTrainingPlan, getAthleteAuthClient, insertCheckin, resolveTestSupabaseUrl } from "./testDb.js";
import { assertLocalDbReady, execLocalSql, localIntegrationRequested, sqlLiteral } from "./localDb.js";

const INTEGRATION_ENABLED = localIntegrationRequested({ requirePublishableKey: true });
const DAY = "2027-02-01";
const ITEM = randomUUID();
const DH = {
  schemaVersion: "v2",
  family: "dh_technical",
  sessionKind: "DH_TECHNICAL",
  blocks: [{ blockId: "main", role: "main", items: [{ kind: "drill", prescriptionItemId: ITEM, drillId: "cornering_off_camber", measure: { type: "pass", count: 4 } }] }],
};

/** A valid legacy debrief body (completed-session PUT contract); session_date set per test. */
const DEBRIEF = {
  decision_id: null,
  session_type: "RECOVERY",
  completion_status: "done",
  actual_duration_min: 42,
  rpe: 6,
  post_leg_fatigue: 3,
  post_grip_fatigue: 3,
  new_pain: false,
  new_pain_note: null,
  intervention: { kind: "RECOVERY_ACTIVE" },
  main_content: null,
};

async function assertServing(fn: string): Promise<void> {
  const url = `${resolveTestSupabaseUrl()}/functions/v1/${fn}`;
  let last: number | string = "no answer";
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      last = res.status;
      if (![502, 503, 504].includes(res.status)) return;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Local Edge runtime is not serving ${fn} (last answer: ${last}). Start it from the repository root: \`npx supabase functions serve\`.`);
}

async function invoke(client: SupabaseClient, fn: string, body: unknown, method: "POST" | "PUT" = "POST"): Promise<{ status: number; body: { error?: { code?: string } } & Record<string, unknown> }> {
  const { data, error } = await client.functions.invoke(fn, { body: body as Record<string, unknown>, method });
  if (!error) return { status: 200, body: data as Record<string, unknown> };
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response;
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }
  throw error;
}

describe.skipIf(!INTEGRATION_ENABLED)("UX-11R.9 — Edge Functions error contract (local runtime)", () => {
  let admin: SupabaseClient;
  let rider: SupabaseClient;
  let athleteId: string;
  let fpId: string;

  const failureCodes = (eventType: string, planVersionId?: string) =>
    execLocalSql(
      `select metadata->>'errorCode' from public.pilot_observability_events where athlete_id = ${sqlLiteral(athleteId)} and event_type = ${sqlLiteral(eventType)}${planVersionId ? ` and plan_version_id = ${sqlLiteral(planVersionId)}` : ""};`
    )
      .split(String.fromCharCode(10))
      .map((line) => line.trim())
      .filter(Boolean);

  beforeAll(async () => {
    assertLocalDbReady();
    await Promise.all(["session-execution", "completed-session", "accept-training-plan"].map(assertServing));
    admin = createTestClient();
    athleteId = (await createTestAthlete(admin, "UX-11R.9 edge contract")).athleteId;
    rider = await getAthleteAuthClient(athleteId);
    await insertCheckin(admin, athleteId, DAY);
    const decisionId = randomUUID();
    fpId = randomUUID();
    execLocalSql(`insert into public.decisions (id, athlete_id, decision_date, final_session, reason, engine_version, final_prescription_status, source_checkin_id, source_checkin_updated_at)
  select ${sqlLiteral(decisionId)}, ${sqlLiteral(athleteId)}, ${sqlLiteral(DAY)}, 'DH_TECHNICAL', 'test fixture', 'test', 'created', c.id, c.updated_at
    from public.daily_checkins c where c.athlete_id = ${sqlLiteral(athleteId)} and c.checkin_date = ${sqlLiteral(DAY)};
insert into public.decision_final_prescriptions (id, decision_id, athlete_id, active_session_origin, reconciliation_action, adaptation_rule_ids, schema_version, catalog_version, structure)
  values (${sqlLiteral(fpId)}, ${sqlLiteral(decisionId)}, ${sqlLiteral(athleteId)}, 'no_canonical_plan', 'keep', '[]'::jsonb, 'v2', 'test', ${sqlLiteral(JSON.stringify(DH))}::jsonb);`);
  }, 90_000);

  it("session-execution: 422 dh_pass_required, then 409 session_already_completed after a real completion; legacy debrief → 409 completed_session_v2_exists", async () => {
    const id = randomUUID();
    const at = (minute: number) => `${DAY}T17:${String(minute).padStart(2, "0")}:00Z`;
    expect(
      (await invoke(rider, "session-execution", { execution: { id, session_date: DAY, started_at: at(0), final_prescription_id: fpId, comment: null }, events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: at(0) }] })).status
    ).toBe(200);

    const noPass = await invoke(rider, "session-execution", { events: [{ id: randomUUID(), execution_id: id, event_type: "completed", occurred_at: at(40) }] });
    expect(noPass.status).toBe(422);
    expect(noPass.body.error?.code).toBe("dh_pass_required");

    const pass = { id: randomUUID(), execution_id: id, prescription_item_id: ITEM, set_number: 1, done: true, measure_type: "pass", measure_value: null, success: true, supersedes_id: null, occurred_at: at(20) };
    expect((await invoke(rider, "session-execution", { sets: [pass], events: [{ id: randomUUID(), execution_id: id, event_type: "completed", occurred_at: at(41) }] })).status).toBe(200);

    const again = randomUUID();
    const second = await invoke(rider, "session-execution", { execution: { id: again, session_date: DAY, started_at: at(45), final_prescription_id: fpId, comment: null }, events: [{ id: randomUUID(), execution_id: again, event_type: "started", occurred_at: at(45) }] });
    expect(second.status).toBe(409);
    expect(second.body.error?.code).toBe("session_already_completed");

    const debrief = { ...DEBRIEF, session_date: DAY };
    const legacy = await invoke(rider, "completed-session", debrief, "PUT");
    expect(legacy.status).toBe(409);
    expect(legacy.body.error?.code).toBe("completed_session_v2_exists");
    const { data: rows } = await admin.from("completed_sessions").select("id").eq("athlete_id", athleteId).eq("session_date", DAY);
    expect(rows).toEqual([]);
    // pilot_observability_events is not readable through the API roles: read as the local database owner.
    expect(failureCodes("session_completion_failed")).toContain("completed_session_v2_exists");

    // Another date: the legacy debrief is unchanged.
    expect((await invoke(rider, "completed-session", { ...debrief, session_date: "2027-02-02" }, "PUT")).status).toBe(200);
  });

  it("completed-session during an OPEN guided session (started, paused, resumed) → 409 completed_session_v2_exists; abandoned → accepted", async () => {
    const days = ["2027-02-10", "2027-02-11", "2027-02-12", "2027-02-13"];
    const lifecycles: string[][] = [[], ["paused"], ["paused", "resumed"], ["abandoned"]];
    for (const [i, day] of days.entries()) {
      await insertCheckin(admin, athleteId, day);
      const decisionId = randomUUID();
      const dayFp = randomUUID();
      execLocalSql(`insert into public.decisions (id, athlete_id, decision_date, final_session, reason, engine_version, final_prescription_status, source_checkin_id, source_checkin_updated_at)
  select ${sqlLiteral(decisionId)}, ${sqlLiteral(athleteId)}, ${sqlLiteral(day)}, 'DH_TECHNICAL', 'test fixture', 'test', 'created', c.id, c.updated_at
    from public.daily_checkins c where c.athlete_id = ${sqlLiteral(athleteId)} and c.checkin_date = ${sqlLiteral(day)};
insert into public.decision_final_prescriptions (id, decision_id, athlete_id, active_session_origin, reconciliation_action, adaptation_rule_ids, schema_version, catalog_version, structure)
  values (${sqlLiteral(dayFp)}, ${sqlLiteral(decisionId)}, ${sqlLiteral(athleteId)}, 'no_canonical_plan', 'keep', '[]'::jsonb, 'v2', 'test', ${sqlLiteral(JSON.stringify(DH))}::jsonb);`);
      const id = randomUUID();
      const at = (minute: number) => `${day}T17:${String(minute).padStart(2, "0")}:00Z`;
      expect((await invoke(rider, "session-execution", { execution: { id, session_date: day, started_at: at(0), final_prescription_id: dayFp, comment: null }, events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: at(0) }] })).status).toBe(200);
      for (const [j, event] of lifecycles[i]!.entries()) {
        expect((await invoke(rider, "session-execution", { events: [{ id: randomUUID(), execution_id: id, event_type: event, occurred_at: at(10 + j) }] })).status).toBe(200);
      }
      const legacy = await invoke(rider, "completed-session", { ...DEBRIEF, session_date: day }, "PUT");
      if (lifecycles[i]!.includes("abandoned")) {
        expect(legacy.status).toBe(200);
      } else {
        expect(legacy.status).toBe(409);
        expect(legacy.body.error?.code).toBe("completed_session_v2_exists");
        const { data: rows } = await admin.from("completed_sessions").select("id").eq("athlete_id", athleteId).eq("session_date", day);
        expect(rows).toEqual([]);
      }
    }
  });

  it("accept-training-plan: an older draft → 409 stale_plan_version, plan_acceptance_failed carries the code; nothing changes", async () => {
    const window = { horizonStartDate: "2027-03-01", horizonEndDate: "2027-03-07", sessions: [{ date: "2027-03-02", kind: "REST" }] };
    const older = await generateTrainingPlan(admin, athleteId, window);
    const current = await generateAndAcceptTrainingPlan(admin, athleteId, window);
    const stale = await invoke(rider, "accept-training-plan", { planVersionId: older.planVersionId });
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe("stale_plan_version");
    const { data: pointer } = await admin.from("training_plan_current_version").select("plan_version_id").eq("athlete_id", athleteId).single();
    expect(pointer!.plan_version_id).toBe(current.planVersionId);
    expect(failureCodes("plan_acceptance_failed", older.planVersionId)).toContain("stale_plan_version");

    // A newer draft is still accepted normally.
    const newer = await generateTrainingPlan(admin, athleteId, window);
    expect((await invoke(rider, "accept-training-plan", { planVersionId: newer.planVersionId })).status).toBe(200);
  });
});
