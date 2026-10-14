/**
 * P0 FIRST GENERATION — the five-profile matrix (HPM mandate), on the real first-generation path
 * (local Supabase): onboarding rows → snapshot → V2 planner → persisted plan → read back → replay.
 *
 * For every persisted plan, the CONTENT is checked (not "HTTP 200", not "non-empty"):
 *   - every drill's terrain is declared, its level is not above the rider's;
 *   - every strength exercise's equipment is owned and its level allowed;
 *   - riding sessions only on riding (or any) windows, physical sessions only on physical (or any)
 *     windows, never longer than the window of their day;
 *   - no two sessions of the same kind on one date; a non-empty first week;
 *   - persisted = generated (read back), and a replay of the same request is idempotent.
 * The outcome of each profile is printed for the report.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, setAthleteDiscipline } from "./testDb.js";
import { localIntegrationRequested } from "./localDb.js";
import { upsertPerformanceProfileFor, type AthletePerformanceProfileWriteFields } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow, type AthleteAvailabilityWindowInsert } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { SESSION_DRILL_CATALOG_V2, SESSION_EXERCISE_CATALOG_V2 } from "planning-engine";
import { REVIEW_PROFILE, REVIEW_WINDOWS } from "./p0FirstGeneration.integration.test.js";

const INTEGRATION_ENABLED = localIntegrationRequested();
const TODAY = "2026-10-09";
const TIER_RANK: Record<string, number> = { beginner: 0, intermediate: 1, advanced: 2 };

export interface MatrixProfile {
  name: string;
  profile: AthletePerformanceProfileWriteFields;
  windows: AthleteAvailabilityWindowInsert[];
  weeks: number;
}

const w = (day: number, start: string, end: string, activity: "physical" | "riding"): AthleteAvailabilityWindowInsert => ({ day_of_week: day, start_time: start, end_time: end, activity });

export const MATRIX: MatrixProfile[] = [
  { name: "A — the 9 October review", profile: REVIEW_PROFILE(["technical_trail", "root_rock_trail", "full_dh_track"], ["cornering", "braking"]), windows: REVIEW_WINDOWS, weeks: 6 },
  {
    name: "B — limited beginner (flow trail, bands only)",
    profile: { strength_experience_tier: "beginner", equipment: ["resistance_bands"], terrain_access: ["flow_trail"], declared_limitations: [], technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["braking", "cornering"] }, dh_technical_tier: "beginner" },
    windows: [w(2, "18:00", "18:45", "physical"), w(4, "18:00", "18:45", "physical"), w(6, "09:00", "11:00", "riding")],
    weeks: 4,
  },
  {
    name: "C — national competitor (advanced, many terrains, full gym)",
    profile: {
      strength_experience_tier: "advanced",
      equipment: ["barbell", "squat_rack", "dumbbells", "bench", "pull_up_bar", "resistance_bands"],
      terrain_access: ["bermed_trail", "technical_trail", "rock_garden", "steep_technical_trail", "root_rock_trail", "bike_park_jump_line", "full_dh_track"],
      declared_limitations: [],
      technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["race_execution", "line_choice", "steep_terrain"] },
      dh_technical_tier: "advanced",
    },
    windows: [w(1, "17:00", "18:30", "physical"), w(3, "17:00", "18:30", "physical"), w(5, "17:00", "18:30", "physical"), w(6, "08:00", "13:00", "riding"), w(0, "08:00", "13:00", "riding")],
    weeks: 6,
  },
  {
    name: "D — riding weekends only, two physical evenings",
    profile: { strength_experience_tier: "intermediate", equipment: ["dumbbells", "bench"], terrain_access: ["flow_trail", "bermed_trail"], declared_limitations: [], technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] }, dh_technical_tier: "intermediate" },
    windows: [w(2, "19:00", "19:45", "physical"), w(4, "19:00", "19:45", "physical"), w(6, "09:00", "12:00", "riding"), w(0, "09:00", "12:00", "riding")],
    weeks: 4,
  },
  {
    name: "E — priority impossible on the declared terrain (jumps, no jump line)",
    profile: { strength_experience_tier: "intermediate", equipment: ["dumbbells"], terrain_access: ["technical_trail", "root_rock_trail"], declared_limitations: [], technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["jumps"] }, dh_technical_tier: "intermediate" },
    windows: [w(2, "18:00", "19:00", "physical"), w(4, "18:00", "19:00", "physical"), w(6, "09:00", "12:00", "riding"), w(0, "09:00", "12:00", "riding")],
    weeks: 4,
  },
];

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const dow = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
type Item = { kind: string; drillId?: string; exerciseId?: string };
type Plan = { weeks: { weekNumber: number; sessions: { date: string; kind: string; durationMin: number; plannedPrescription: { structure: { blocks?: { items?: Item[] }[] } } }[] }[] };

/** Every content rule a persisted first plan must respect; returns the violations (empty = compliant). */
export function contentViolations(plan: Plan, p: MatrixProfile): string[] {
  const out: string[] = [];
  const terrains = p.profile.terrain_access as string[];
  const equipment = p.profile.equipment as string[];
  const dhTier = TIER_RANK[p.profile.dh_technical_tier as string]!;
  const strengthTier = p.profile.strength_experience_tier as string;
  const sessions = plan.weeks.flatMap((week) => week.sessions);
  if ((plan.weeks.find((x) => x.weekNumber === 1)?.sessions.length ?? 0) === 0) out.push("empty first week");
  const seen = new Set<string>();
  for (const s of sessions) {
    const key = `${s.date}/${s.kind}`;
    if (seen.has(key)) out.push(`duplicate ${key}`);
    seen.add(key);
    const riding = s.kind === "DH_TECHNICAL";
    const physical = s.kind.startsWith("STRENGTH");
    const fits = p.windows.some((win) => win.day_of_week === dow(s.date) && (!riding || win.activity !== "physical") && (!physical || win.activity !== "riding") && s.durationMin <= minutes(win.end_time) - minutes(win.start_time));
    if (s.kind !== "REST" && !fits) out.push(`${s.kind} ${s.durationMin} min on ${s.date} (day ${dow(s.date)}) fits no declared window`);
    for (const item of (s.plannedPrescription.structure.blocks ?? []).flatMap((b) => b.items ?? [])) {
      if (item.kind === "drill") {
        const d = SESSION_DRILL_CATALOG_V2[item.drillId!]!;
        // Ridden on one of its compatible terrains — or, for a LIGHT regression (ADR P0 adapted session), on a terrain of a drill it regresses from.
        const chainTerrains: string[] = [];
        for (let x: typeof d | undefined = d; x; x = x.progressesTo ? SESSION_DRILL_CATALOG_V2[x.progressesTo] : undefined) chainTerrains.push(...x.compatibleTerrains);
        if (!chainTerrains.some((t) => terrains.includes(t))) out.push(`${item.drillId} has no declared compatible terrain (${d.compatibleTerrains.join(", ")})`);
        if (TIER_RANK[d.technicalTier]! > dhTier) out.push(`${item.drillId} (${d.technicalTier}) above the rider's DH level`);
      }
      if (item.kind === "exercise") {
        const e = SESSION_EXERCISE_CATALOG_V2[item.exerciseId!]!;
        const missing = e.requiredEquipment.filter((x) => !equipment.includes(x));
        if (missing.length) out.push(`${item.exerciseId} needs ${missing.join(", ")}`);
        // Only an exercise HARDER than the declared level is a violation (an easier one is a quality question, out of scope).
        if (Math.min(...e.tiers.map((t) => TIER_RANK[t]!)) > TIER_RANK[strengthTier]!) out.push(`${item.exerciseId} above a ${strengthTier} strength level`);
      }
    }
  }
  return out;
}

describe.skipIf(!INTEGRATION_ENABLED)("P0 first generation — five-profile matrix (local DB)", { timeout: 180_000 }, () => {
  let admin: SupabaseClient;
  beforeAll(() => {
    admin = createTestClient();
  });

  it("every profile: first attempt outcome, content rules on a persisted plan, read back, idempotent replay", async () => {
    const report: Record<string, unknown> = {};
    for (const p of MATRIX) {
      const athlete = await createTestAthlete(admin, `P0 matrix ${randomUUID().slice(0, 6)}`);
      await setAthleteDiscipline(admin, athlete.athleteId, "Downhill");
      await upsertPerformanceProfileFor(admin, athlete.athleteId, p.profile);
      for (const win of p.windows) await insertAvailabilityWindow(admin, athlete.athleteId, win);
      const requestId = randomUUID();
      const first = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId: athlete.athleteId, generationRequestId: requestId, durationWeeks: p.weeks, today: TODAY });
      if (first.status !== "persisted") {
        report[p.name] = { outcome: `blocked:${first.code}`, detail: first.detail };
        continue;
      }
      const violations = contentViolations(first.plan as unknown as Plan, p);
      const { count } = await admin.from("training_plan_generated_sessions").select("id", { count: "exact", head: true }).eq("plan_version_id", first.planVersionId);
      const generated = first.plan.weeks.reduce((n, wk) => n + wk.sessions.length, 0);
      const replay = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId: athlete.athleteId, generationRequestId: requestId, durationWeeks: p.weeks, today: TODAY });
      const drills = [...new Set(first.plan.weeks.flatMap((wk) => wk.sessions.flatMap((s) => ((s.plannedPrescription.structure as unknown as { blocks?: { items?: Item[] }[] }).blocks ?? []).flatMap((b) => b.items ?? []).filter((i) => i.kind === "drill").map((i) => i.drillId))))];
      report[p.name] = {
        outcome: "persisted",
        sessions: generated,
        readBack: count === generated,
        replay: replay.status === "persisted" && replay.idempotentReplay && replay.planVersionId === first.planVersionId,
        drills,
        violations,
        firstWeek: first.plan.weeks[0]!.sessions.map((s) => `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dow(s.date)]} ${s.kind} ${s.durationMin}min${(() => {
          const d = ((s.plannedPrescription.structure as unknown as { blocks?: { items?: Item[] }[] }).blocks ?? []).flatMap((b) => b.items ?? []).find((i) => i.kind === "drill");
          return d ? ` ${d.drillId}` : "";
        })()}`),
      };
    }
    console.info(JSON.stringify(report, null, 2));
    // P0 expectations (HPM 2026-10-12): A — the original incident — is generated at the FIRST attempt with its three real terrains,
    // and its two priorities are worked on them; B — a flow trail counts as a groomed trail (HPM final decision) — is generated with
    // its two beginner drills on the flow trail; E stays refused (jumps need a jump line): no terrain is ever invented.
    const outcome = (name: string) => (report[MATRIX.find((m) => m.name.startsWith(name))!.name] as { outcome: string }).outcome;
    expect([outcome("A"), outcome("B"), outcome("C"), outcome("D"), outcome("E")]).toEqual(["persisted", "persisted", "persisted", "persisted", "blocked:unavailable_dh_drill_terrain"]);
    expect((report[MATRIX[0]!.name] as { drills: string[] }).drills.sort()).toEqual(["braking_late_entry", "cornering_berm_speed"]);
    expect((report[MATRIX[1]!.name] as { drills: string[] }).drills.sort()).toEqual(["braking_progressive_control", "cornering_flat_turn_precision"]);
    expect((report[MATRIX[4]!.name] as { detail: Record<string, unknown> }).detail).toEqual({ skill: "jumps", dhTechnicalTier: "intermediate", drillId: "jumps_linked_tables", requiredTerrain: "bike_park_jump_line", compatibleTerrains: ["bike_park_jump_line"] });
    for (const [name, r] of Object.entries(report) as [string, { outcome: string; violations?: string[]; readBack?: boolean; replay?: boolean }][]) {
      if (r.outcome !== "persisted") continue;
      expect(r.violations, name).toEqual([]);
      expect([r.readBack, r.replay], name).toEqual([true, true]);
    }
  });
});
