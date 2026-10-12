/**
 * P0 FIRST GENERATION — the 9 October 2026 review, end to end on the LOCAL Supabase:
 * a brand-new DH rider's onboarding data (performance profile, terrains, priorities, typed
 * availability) → buildPlanInputSnapshotV2 → V2 planner → persisted plan → read back.
 * Never production, never the public Edge Function.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, setAthleteDiscipline } from "./testDb.js";
import { localIntegrationRequested } from "./localDb.js";
import { upsertPerformanceProfileFor, type AthletePerformanceProfileWriteFields } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow, type AthleteAvailabilityWindowInsert } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";

const INTEGRATION_ENABLED = localIntegrationRequested();
const TODAY = "2026-10-09"; // the review day (Friday)

/** The review rider: DH only, intermediate riding, beginner strength, dumbbells + bench + bands, priorities cornering then braking. */
export const REVIEW_PROFILE = (terrains: string[], priorityAreas: string[]): AthletePerformanceProfileWriteFields => ({
  strength_experience_tier: "beginner",
  equipment: ["dumbbells", "bench", "resistance_bands"],
  terrain_access: terrains,
  declared_limitations: [],
  technical_priorities: { strengths: [], weaknesses: [], priorityAreas },
  dh_technical_tier: "intermediate",
});

/** Physical Mon 45 min, Tue 60, Thu 60, Fri 45; riding Sat 3 h, Sun 2 h (day_of_week: 0 = Sunday, 1 = Monday…). */
export const REVIEW_WINDOWS: AthleteAvailabilityWindowInsert[] = [
  { day_of_week: 1, start_time: "18:00", end_time: "18:45", activity: "physical" },
  { day_of_week: 2, start_time: "18:00", end_time: "19:00", activity: "physical" },
  { day_of_week: 4, start_time: "18:00", end_time: "19:00", activity: "physical" },
  { day_of_week: 5, start_time: "18:00", end_time: "18:45", activity: "physical" },
  { day_of_week: 6, start_time: "09:00", end_time: "12:00", activity: "riding" },
  { day_of_week: 0, start_time: "09:00", end_time: "11:00", activity: "riding" },
];

const DECLARED = ["technical_trail", "root_rock_trail", "full_dh_track"];

describe.skipIf(!INTEGRATION_ENABLED)("P0 first generation — the 9 October review profile (local DB)", { timeout: 120_000 }, () => {
  let admin: SupabaseClient;
  beforeAll(() => {
    admin = createTestClient();
  });

  async function firstGeneration(terrains: string[], priorities: string[]) {
    const athlete = await createTestAthlete(admin, `P0 first gen ${randomUUID().slice(0, 6)}`);
    await setAthleteDiscipline(admin, athlete.athleteId, "Downhill");
    await upsertPerformanceProfileFor(admin, athlete.athleteId, REVIEW_PROFILE(terrains, priorities));
    for (const w of REVIEW_WINDOWS) await insertAvailabilityWindow(admin, athlete.athleteId, w);
    const result = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId: athlete.athleteId, generationRequestId: randomUUID(), durationWeeks: 6, today: TODAY });
    return { athleteId: athlete.athleteId, result };
  }

  it("reproduction of the four review attempts (outcome only — the content is checked by the P0 suite)", async () => {
    const attempts: [string, string[], string[]][] = [
      ["1 — declared terrains, cornering + braking", DECLARED, ["cornering", "braking"]],
      ["2 — + bermed trail", [...DECLARED, "bermed_trail"], ["cornering", "braking"]],
      ["3 — braking only", DECLARED, ["braking"]],
      ["4 — every terrain", ["any_groomed_trail", "flow_trail", "bermed_trail", "technical_trail", "rock_garden", "steep_technical_trail", "root_rock_trail", "bike_park_jump_line", "full_dh_track"], ["cornering", "braking"]],
    ];
    const outcomes: Record<string, string> = {};
    for (const [label, terrains, priorities] of attempts) {
      const { result } = await firstGeneration(terrains, priorities);
      outcomes[label] = result.status === "persisted" ? "persisted" : `blocked:${result.code}:${JSON.stringify(result.detail)}`;
    }
    console.info(JSON.stringify(outcomes, null, 2));
    expect(outcomes["4 — every terrain"]).toBe("persisted");
  });
});
