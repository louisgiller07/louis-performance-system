/**
 * UX-11R.9 (R9-OPS-01) — rollout write suspension on the local Edge runtime.
 *
 * The runtime decides the mode (the flag is an Edge secret, read by the handlers, never by this test):
 *   absent: `npx supabase functions serve`                         (default mode of this file)
 *   false:  `npx supabase functions serve --env-file <file with NALYNT_WRITES_SUSPENDED=false>`
 *   true:   `npx supabase functions serve --env-file <file with NALYNT_WRITES_SUSPENDED=true>`
 * and NALYNT_TEST_WRITES_SUSPENDED_MODE=absent|false|true tells this file what to expect.
 *
 * Suspended ("true"): session-execution POST, completed-session PUT and accept-training-plan answer
 * 503 `writes_suspended` and nothing is written (no execution, event, set, completed_sessions row,
 * lifecycle transition, current-plan change, nor session_completion_failed / plan_acceptance_* event).
 * Reads (completed-session GET) and daily-run are never suspended.
 * Otherwise ("absent" / "false"): the historical behaviour, unchanged.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, generateAndAcceptTrainingPlan, generateTrainingPlan, getAthleteAuthClient, insertCheckin, resolveTestSupabaseUrl } from "./testDb.js";
import { assertLocalDbReady, execLocalSql, localIntegrationRequested, sqlLiteral } from "./localDb.js";

const INTEGRATION_ENABLED = localIntegrationRequested({ requirePublishableKey: true });
const MODE = (process.env.NALYNT_TEST_WRITES_SUSPENDED_MODE ?? "absent") as "absent" | "false" | "true";
const SUSPENDED = MODE === "true";
if (!["absent", "false", "true"].includes(MODE)) throw new Error(`NALYNT_TEST_WRITES_SUSPENDED_MODE must be absent, false or true (got ${MODE})`);

const DAY = "2027-04-05";
const DEBRIEF_DAY = "2027-04-06";
const DAILY_DAY = "2027-04-07";
const ITEM = randomUUID();
const DH = {
  schemaVersion: "v2",
  family: "dh_technical",
  sessionKind: "DH_TECHNICAL",
  blocks: [{ blockId: "main", role: "main", items: [{ kind: "drill", prescriptionItemId: ITEM, drillId: "cornering_off_camber", measure: { type: "pass", count: 4 } }] }],
};
const DEBRIEF = {
  session_date: DEBRIEF_DAY,
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

async function invoke(client: SupabaseClient, fn: string, body: unknown, method: "POST" | "PUT" | "GET" = "POST", query = "") {
  const { data, error } = await client.functions.invoke(`${fn}${query}`, { method, ...(method === "GET" ? {} : { body: body as Record<string, unknown> }) });
  if (!error) return { status: 200, body: data as Record<string, unknown> & { error?: { code?: string; message?: string } } };
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response;
    return { status: response.status, body: (await response.json()) as Record<string, unknown> & { error?: { code?: string; message?: string } } };
  }
  throw error;
}

describe.skipIf(!INTEGRATION_ENABLED)(`UX-11R.9 R9-OPS-01 — write suspension (runtime mode: ${MODE})`, () => {
  let admin: SupabaseClient;
  let rider: SupabaseClient;
  let athleteId: string;
  let fpId: string;
  const count = (sql: string) => Number(execLocalSql(sql).trim().split("\n").filter(Boolean).at(-1));
  const events = (types: string) =>
    count(`select count(*) from public.pilot_observability_events where athlete_id = ${sqlLiteral(athleteId)} and event_type like ${sqlLiteral(types)};`);

  beforeAll(async () => {
    assertLocalDbReady();
    await Promise.all(["session-execution", "completed-session", "accept-training-plan", "daily-run"].map(assertServing));
    admin = createTestClient();
    athleteId = (await createTestAthlete(admin, `R9-OPS-01 suspension ${MODE}`)).athleteId;
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

  it("session-execution: a normal Start", async () => {
    const id = randomUUID();
    const at = `${DAY}T17:00:00Z`;
    const start = await invoke(rider, "session-execution", { execution: { id, session_date: DAY, started_at: at, final_prescription_id: fpId, comment: null }, events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: at }] });
    if (SUSPENDED) {
      expect(start.status).toBe(503);
      expect(start.body.error?.code).toBe("writes_suspended");
      expect(count(`select count(*) from public.session_executions where athlete_id = ${sqlLiteral(athleteId)};`)).toBe(0);
      expect(count(`select count(*) from public.execution_events where athlete_id = ${sqlLiteral(athleteId)};`)).toBe(0);
      // Every lifecycle action goes through the same handler: a pause / complete of that id is refused the same way.
      const pause = await invoke(rider, "session-execution", { events: [{ id: randomUUID(), execution_id: id, event_type: "paused", occurred_at: `${DAY}T17:05:00Z` }] });
      expect(pause.status).toBe(503);
      expect(pause.body.error?.code).toBe("writes_suspended");
    } else {
      expect(start.status).toBe(200);
      expect(count(`select count(*) from public.session_executions where id = ${sqlLiteral(id)};`)).toBe(1);
      expect(count(`select count(*) from public.execution_events where execution_id = ${sqlLiteral(id)} and event_type = 'started';`)).toBe(1);
    }
  });

  it("completed-session: PUT (and GET stays a read in every mode)", async () => {
    const put = await invoke(rider, "completed-session", DEBRIEF, "PUT");
    const rows = count(`select count(*) from public.completed_sessions where athlete_id = ${sqlLiteral(athleteId)} and session_date = ${sqlLiteral(DEBRIEF_DAY)};`);
    if (SUSPENDED) {
      expect(put.status).toBe(503);
      expect(put.body.error?.code).toBe("writes_suspended");
      expect(rows).toBe(0);
      expect(events("session_completion_%")).toBe(0);
    } else {
      expect(put.status).toBe(200);
      expect(rows).toBe(1);
    }
    const get = await invoke(rider, "completed-session", null, "GET", `?date=${DEBRIEF_DAY}`);
    expect(get.status).toBe(200);
  });

  it("accept-training-plan: accepting a newer draft", async () => {
    const window = { horizonStartDate: "2027-05-03", horizonEndDate: "2027-05-09", sessions: [{ date: "2027-05-04", kind: "REST" }] };
    const current = await generateAndAcceptTrainingPlan(admin, athleteId, window);
    const newer = await generateTrainingPlan(admin, athleteId, window);
    const accept = await invoke(rider, "accept-training-plan", { planVersionId: newer.planVersionId });
    const pointer = execLocalSql(`select plan_version_id from public.training_plan_current_version where athlete_id = ${sqlLiteral(athleteId)};`).trim().split("\n").at(-1)!.trim();
    const newerTransitions = count(`select count(*) from public.training_plan_version_lifecycle_transitions where plan_version_id = ${sqlLiteral(newer.planVersionId)};`);
    const currentTransitions = count(`select count(*) from public.training_plan_version_lifecycle_transitions where plan_version_id = ${sqlLiteral(current.planVersionId)};`);
    if (SUSPENDED) {
      expect(accept.status).toBe(503);
      expect(accept.body.error?.code).toBe("writes_suspended");
      expect(pointer).toBe(current.planVersionId);
      expect(newerTransitions).toBe(1); // draft only
      expect(currentTransitions).toBe(2); // draft, accepted — not superseded
      expect(events("plan_acceptance_%")).toBe(0);
    } else {
      expect(accept.status).toBe(200);
      expect(pointer).toBe(newer.planVersionId);
      expect(newerTransitions).toBe(2);
      expect(currentTransitions).toBe(3);
    }
  });

  it("daily-run is never suspended", async () => {
    await insertCheckin(admin, athleteId, DAILY_DAY);
    const daily = await invoke(rider, "daily-run", { date: DAILY_DAY });
    expect(daily.status).toBe(200);
    expect(count(`select count(*) from public.decisions where athlete_id = ${sqlLiteral(athleteId)} and decision_date = ${sqlLiteral(DAILY_DAY)};`)).toBe(1);
  });
});
