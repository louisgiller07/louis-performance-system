/**
 * V2-DH-SPORT-GATE-01 (HPM 2026-10-26) — the four sports validations U / C / D / S on the real V2 path (local database):
 * generation (V2 ON) and the daily (V2 ON: unit required). Sign-offs are TEST fixtures routed through the REAL gate
 * (planning-engine dhSportGateV2): not sports decisions; the production table stays empty.
 *
 * - A unit alone, three decisions of four, or a complete sign-off of a text that is not the one served: the plan is
 *   refused, nothing is written.
 * - A complete sign-off: a persisted plan with SECTION counts. When the sign-off becomes partial, the DH day of that
 *   plan gets no executable count (characterised: the daily run raises the contract error, nothing is written for the
 *   day); a Force day of the same plan is unaffected; the complete sign-off restored, the same DH day is served again.
 * Local stack only.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, insertCheckin, setAthleteDiscipline, type TestAthlete } from "./testDb.js";
import { assertLocalDbReady, execLocalSql, localIntegrationRequested, sqlLiteral } from "./localDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { runDailyFor, DEFAULT_RUN_DAILY_FOR_DEPS } from "../../src/supabase/runDailyFor.js";
import { generateTrainingPlanForAthlete } from "../../src/generation/generateTrainingPlanForAthlete.js";
import { dhServedCommonContentV2, dhServedSportContentV2 } from "../../../planning-engine/dist/sessionModelV2/dhSportGateV2.js";
import { SESSION_DRILL_CATALOG_V2_ENTRIES } from "../../../planning-engine/dist/catalog/sessionDrillCatalogV2.js";

const INTEGRATION_ENABLED = localIntegrationRequested({ requirePublishableKey: true });
const TODAY = "2026-11-08";
const WEEK = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];

const fixture = vi.hoisted(() => ({ signoffs: {} as Record<string, unknown>, common: null as unknown }));
vi.mock("../../../planning-engine/dist/sessionModelV2/dhSportGateV2.js", async (importOriginal) => {
  const real = await importOriginal<{ dhRepetitionUnitAttributionFromSignoffV2: (drillId: string, signoff: unknown, common: unknown) => unknown }>();
  return { ...real, dhRepetitionUnitAttributionV2: (drillId: string) => real.dhRepetitionUnitAttributionFromSignoffV2(drillId, fixture.signoffs[drillId], fixture.common) };
});

type Decision = "unit" | "cue" | "dose" | "safety";
const ALL: readonly Decision[] = ["unit", "cue", "dose", "safety"];
const TEST_DECISION = "TEST fixture V2-DH-SPORT-GATE-01 (not a sports decision)";
function signoff(drillId: string, signed: readonly Decision[]): Record<string, unknown> {
  const served = dhServedSportContentV2(drillId)!;
  const full: Record<Decision, unknown> = {
    unit: { decision: TEST_DECISION, unit: "SECTION" },
    cue: { decision: TEST_DECISION, drillName: served.drillName, cueText: served.cueText, criterionText: served.criterionText },
    dose: { decision: TEST_DECISION, doseTerms: served.doseTerms },
    safety: { decision: TEST_DECISION, vigilanceTexts: [...served.vigilanceTexts], regressesTo: served.regressesTo, terrains: [...served.terrains] },
  };
  return Object.fromEntries(signed.map((d) => [d, full[d]]));
}
// V2-DH-SPORT-GATE-01B — the common DH validation (frame, objectives) is a TEST fixture too, signed with every drill.
const signAll = (signed: readonly Decision[]) => {
  fixture.signoffs = Object.fromEntries(SESSION_DRILL_CATALOG_V2_ENTRIES.map((d) => [d.drillId, signoff(d.drillId, signed)]));
  fixture.common = { decision: TEST_DECISION, ...dhServedCommonContentV2()! };
};

describe.skipIf(!INTEGRATION_ENABLED)("V2-DH-SPORT-GATE-01 — the four sports validations on the real V2 path (local Supabase)", () => {
  let admin: SupabaseClient;

  async function v2Rider(label: string): Promise<TestAthlete> {
    const athlete = await createTestAthlete(admin, `DH sport gate ${label}`);
    await setAthleteDiscipline(admin, athlete.athleteId, "Downhill");
    await upsertPerformanceProfileFor(admin, athlete.athleteId, {
      strength_experience_tier: "intermediate",
      equipment: ["dumbbells", "bench"],
      terrain_access: ["flow_trail", "bermed_trail", "root_rock_trail", "technical_trail"],
      declared_limitations: [],
      technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["roots_rocks"] },
      dh_technical_tier: "intermediate",
    });
    for (const d of [0, 1, 2, 3, 4, 5, 6]) await insertAvailabilityWindow(admin, athlete.athleteId, { day_of_week: d, start_time: "08:00:00", end_time: "20:00:00" });
    execLocalSql(`insert into public.training_plan_model_assignments (athlete_id, planning_model, note) values (${sqlLiteral(athlete.athleteId)}, 'v2', 'V2-DH-SPORT-GATE-01 test');`);
    return athlete;
  }
  const generateV2 = (athleteId: string) => generateTrainingPlanForAthlete({ client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 2, today: TODAY, globalV2Enabled: true });
  const versions = (athleteId: string) => execLocalSql(`select count(*) from public.training_plan_versions where athlete_id = ${sqlLiteral(athleteId)};`).trim();
  const decisionsOn = (athleteId: string, day: string) => execLocalSql(`select count(*) from public.decisions where athlete_id = ${sqlLiteral(athleteId)} and decision_date = ${sqlLiteral(day)};`).trim();
  const firstDayOf = (planVersionId: string, kind: string) =>
    execLocalSql(`select min(date)::text from public.training_plan_generated_sessions where plan_version_id = ${sqlLiteral(planVersionId)} and kind = ${sqlLiteral(kind)} and date between '${WEEK[0]}' and '${WEEK[6]}';`).trim();
  const daily = (athleteId: string, day: string) => runDailyFor(admin, athleteId, day, { ...DEFAULT_RUN_DAILY_FOR_DEPS, dhUnit: "required" });

  beforeAll(() => {
    assertLocalDbReady();
    admin = createTestClient();
  });
  beforeEach(() => {
    fixture.signoffs = {};
    fixture.common = null;
  });

  it("a unit alone, or three decisions of four: V2 ON refuses the plan for the unsigned drill, writes nothing", async () => {
    for (const signed of [["unit"], ["unit", "cue", "safety"]] as Decision[][]) {
      signAll(signed);
      const rider = await v2Rider(signed.join("+"));
      expect(await generateV2(rider.athleteId), signed.join("+")).toMatchObject({ planningModel: "v2", status: "blocked", code: "dh_repetition_unit_unknown", detail: { skill: "roots_rocks", dhTechnicalTier: "intermediate", drillId: "roots_rocks_unweighted_line" } });
      expect(versions(rider.athleteId)).toBe("0");
    }
  }, 180_000);

  it("a complete sign-off of a cue that is not the one served: refused, nothing written", async () => {
    signAll(ALL);
    const stale = fixture.signoffs.roots_rocks_unweighted_line as { cue: { cueText: string } };
    fixture.signoffs.roots_rocks_unweighted_line = { ...stale, cue: { ...stale.cue, cueText: `${stale.cue.cueText} (version signée)` } };
    const rider = await v2Rider("stale");
    expect(await generateV2(rider.athleteId)).toMatchObject({ planningModel: "v2", status: "blocked", code: "dh_repetition_unit_unknown", detail: { drillId: "roots_rocks_unweighted_line" } });
    expect(versions(rider.athleteId)).toBe("0");
  }, 120_000);

  it("complete → SECTION plan; sign-off partial → the DH day gets no executable count, a Force day is unaffected; complete again → the DH day is served", async () => {
    signAll(ALL);
    const rider = await v2Rider("lifecycle");
    const r = await generateV2(rider.athleteId);
    if (r.status !== "persisted") throw new Error(`expected a persisted V2 plan, got ${JSON.stringify(r)}`);
    await acceptTrainingPlanVersion(admin, rider.athleteId, r.planVersionId, TODAY, "2026-11-22");
    const dhDay = firstDayOf(r.planVersionId, "DH_TECHNICAL");
    const forceDay = firstDayOf(r.planVersionId, "STRENGTH_LOWER");
    expect(WEEK).toContain(dhDay);
    expect(WEEK).toContain(forceDay);

    signAll(["unit", "cue", "dose"]);
    await insertCheckin(admin, rider.athleteId, dhDay);
    await expect(daily(rider.athleteId, dhDay)).rejects.toThrow(/dh_unit_not_attributed/);
    expect(decisionsOn(rider.athleteId, dhDay)).toBe("0");
    await insertCheckin(admin, rider.athleteId, forceDay);
    const force = await daily(rider.athleteId, forceDay);
    expect(force.finalPrescriptionStatus).toBe("created");

    signAll(ALL);
    const served = await daily(rider.athleteId, dhDay);
    expect(served.finalPrescriptionStatus).toBe("created");
    const { data: fp } = await admin.from("decision_final_prescriptions").select("structure").eq("decision_id", served.persistence.decision_id).single();
    const structure = fp!.structure as { family: string; blocks: { items: { kind: string; measure: Record<string, unknown> }[] }[] };
    expect(structure.family).toBe("dh_technical");
    expect(structure.blocks.flatMap((b) => b.items).find((i) => i.kind === "drill")!.measure).toMatchObject({ type: "pass", unit: "SECTION" });
  }, 240_000);
});
