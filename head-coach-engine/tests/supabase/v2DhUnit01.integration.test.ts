// V2-DH-UNIT-01 (HPM 2026-10-26) — the stated unit of a DH count through the real database, without any migration:
// a frozen final prescription keeps `unit` through JSONB; record_session_execution bounds the passes by `count`
// whatever the unit (results carry no unit: it is the frozen item's); a terminal execution is frozen; a frozen
// prescription can be neither updated nor deleted. A historical unit-less count behaves exactly the same.
// Local stack only (RUN_LOCAL_SUPABASE_INTEGRATION=1).
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, insertCheckin } from "./testDb.js";
import { assertLocalDbReady, execLocalSql, localIntegrationRequested, sqlLiteral } from "./localDb.js";

const INTEGRATION_ENABLED = localIntegrationRequested();
const DAYS = { section: "2026-12-01", legacy: "2026-12-02" } as const;

type Outcome = { status: "ok" } | { status: "rejected"; code: string; target: string };

describe.skipIf(!INTEGRATION_ENABLED)("V2-DH-UNIT-01 — a DH count's unit through persistence and execution (local Supabase)", () => {
  let admin: SupabaseClient;
  let athleteId: string;
  const fp = { section: randomUUID(), legacy: randomUUID() };
  const item = { section: randomUUID(), legacy: randomUUID() };
  const structure = (itemId: string, measure: Record<string, unknown>) => ({
    schemaVersion: "v2",
    family: "dh_technical",
    sessionKind: "DH_TECHNICAL",
    blocks: [{ blockId: "main", role: "main", instructionIds: [], items: [{ kind: "drill", prescriptionItemId: itemId, drillId: "braking_late_entry", measure }] }],
  });
  const STRUCTURES = { section: structure(item.section, { type: "pass", count: 4, unit: "SECTION" }), legacy: structure(item.legacy, { type: "pass", count: 4 }) };

  async function record(payload: unknown): Promise<Outcome> {
    const { data, error } = await admin.rpc("record_session_execution", { p_athlete_id: athleteId, p_payload: payload });
    if (error) throw new Error(`record_session_execution raised: ${error.message}`);
    return data as Outcome;
  }
  const at = (day: string, minute: number) => `${day}T17:${String(minute).padStart(2, "0")}:00Z`;
  const pass = (kind: keyof typeof DAYS, executionId: string, set_number: number, extra: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    execution_id: executionId,
    prescription_item_id: item[kind],
    set_number,
    done: true,
    measure_type: "pass",
    measure_value: null,
    success: true,
    occurred_at: at(DAYS[kind], 10 + set_number),
    ...extra,
  });

  beforeAll(async () => {
    assertLocalDbReady();
    admin = createTestClient();
    athleteId = (await createTestAthlete(admin, "V2-DH-UNIT-01")).athleteId;
    await Promise.all(Object.values(DAYS).map((day) => insertCheckin(admin, athleteId, day)));
    const fixture = (kind: keyof typeof DAYS) => {
      const decisionId = randomUUID();
      return `insert into public.decisions (id, athlete_id, decision_date, final_session, reason, engine_version, final_prescription_status, source_checkin_id, source_checkin_updated_at)
  select ${sqlLiteral(decisionId)}, ${sqlLiteral(athleteId)}, ${sqlLiteral(DAYS[kind])}, 'DH_TECHNICAL', 'test fixture', 'test', 'created', c.id, c.updated_at
    from public.daily_checkins c where c.athlete_id = ${sqlLiteral(athleteId)} and c.checkin_date = ${sqlLiteral(DAYS[kind])};
insert into public.decision_final_prescriptions (id, decision_id, athlete_id, active_session_origin, reconciliation_action, adaptation_rule_ids, schema_version, catalog_version, structure)
  values (${sqlLiteral(fp[kind])}, ${sqlLiteral(decisionId)}, ${sqlLiteral(athleteId)}, 'no_canonical_plan', 'keep', '[]'::jsonb, 'v2', 'test', ${sqlLiteral(JSON.stringify(STRUCTURES[kind]))}::jsonb);`;
    };
    execLocalSql([fixture("section"), fixture("legacy")].join("\n"));
  }, 60_000);

  it("the frozen prescription keeps its stated unit through JSONB; the historical count keeps exactly { type, count }", async () => {
    const { data, error } = await admin.from("decision_final_prescriptions").select("id, structure").in("id", [fp.section, fp.legacy]);
    expect(error).toBeNull();
    const measureOf = (id: string) => (data!.find((r) => r.id === id)!.structure as typeof STRUCTURES.section).blocks[0]!.items[0]!.measure;
    expect(measureOf(fp.section)).toEqual({ type: "pass", count: 4, unit: "SECTION" });
    expect(measureOf(fp.legacy)).toEqual({ type: "pass", count: 4 });
  });

  it.each(["section", "legacy"] as const)("%s: passes 1..count accepted, count + 1 refused, completion freezes the results (no new pass, no correction)", async (kind) => {
    const e = randomUUID();
    const day = DAYS[kind];
    expect(await record({ execution: { id: e, session_date: day, started_at: at(day, 0), final_prescription_id: fp[kind] }, events: [{ id: randomUUID(), execution_id: e, event_type: "started", occurred_at: at(day, 0) }] })).toMatchObject({ status: "ok" });
    expect(await record({ events: [], sets: [pass(kind, e, 5)] })).toMatchObject({ status: "rejected", code: "result_slot_out_of_range" });
    const first = pass(kind, e, 1);
    expect(await record({ events: [], sets: [first, pass(kind, e, 2), pass(kind, e, 3), pass(kind, e, 4)] })).toMatchObject({ status: "ok" });
    expect(await record({ events: [{ id: randomUUID(), execution_id: e, event_type: "completed", occurred_at: at(day, 50) }], sets: [] })).toMatchObject({ status: "ok" });
    expect(await record({ events: [], sets: [pass(kind, e, 4, { id: randomUUID(), supersedes_id: first.id, set_number: 1 })] })).toMatchObject({ status: "rejected", code: "execution_terminal" });
    const { count } = await admin.from("exercise_set_results").select("id", { count: "exact", head: true }).eq("execution_id", e);
    expect(count).toBe(4);
  });

  it("a frozen prescription can be neither updated nor deleted, even by the database owner: its unit is never rewritten", () => {
    expect(() => execLocalSql(`update public.decision_final_prescriptions set structure = jsonb_set(structure, '{blocks,0,items,0,measure,unit}', '"FULL_RUN"') where id = ${sqlLiteral(fp.section)};`)).toThrow();
    expect(() => execLocalSql(`delete from public.decision_final_prescriptions where id = ${sqlLiteral(fp.legacy)};`)).toThrow();
    expect(execLocalSql(`select structure #>> '{blocks,0,items,0,measure,unit}' from public.decision_final_prescriptions where id = ${sqlLiteral(fp.section)};`).trim()).toBe("SECTION");
  });
});
