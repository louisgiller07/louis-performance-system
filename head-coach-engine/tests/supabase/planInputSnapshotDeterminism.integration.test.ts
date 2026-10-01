/**
 * Deterministic generation snapshot (real local Supabase): availability
 * windows inserted in a scrambled order are persisted in their canonical
 * order, and repeated replays of the same generation_request_id stay
 * idempotent, for V1 and V2.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, isLoopbackSupabaseUrl, resolveTestSupabaseUrl, setAthleteDiscipline } from "./testDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { upsertLockedDate } from "../../src/supabase/repositories/athleteLockedDatesRepo.js";
import { generateAndPersistTrainingPlan } from "../../src/supabase/generateAndPersistTrainingPlan.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const INTEGRATION_ENABLED = process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && isLoopbackSupabaseUrl(resolveTestSupabaseUrl());

const TODAY = "2026-10-05";
const SCRAMBLED_DAYS = [5, 1, 3, 0, 6, 2, 4];

describe.skipIf(!INTEGRATION_ENABLED)("deterministic generation snapshot (local Supabase)", () => {
  let admin: SupabaseClient;
  beforeAll(() => {
    admin = createTestClient();
  });

  async function seed(name: string): Promise<string> {
    const { athleteId } = await createTestAthlete(admin, name);
    await setAthleteDiscipline(admin, athleteId, "Downhill");
    await upsertPerformanceProfileFor(admin, athleteId, {
      strength_experience_tier: "intermediate",
      equipment: ["dumbbells", "bench"],
      terrain_access: ["flow_trail", "bermed_trail"],
      declared_limitations: [],
      technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
      dh_technical_tier: "intermediate",
    });
    // Scrambled insertion, plus a second (shorter) window on Monday inserted last.
    for (const d of SCRAMBLED_DAYS) await insertAvailabilityWindow(admin, athleteId, { day_of_week: d, start_time: "08:00:00", end_time: "20:00:00" });
    await insertAvailabilityWindow(admin, athleteId, { day_of_week: 1, start_time: "06:00:00", end_time: "07:00:00" });
    await upsertLockedDate(admin, athleteId, { date: "2026-10-17" });
    await upsertLockedDate(admin, athleteId, { date: "2026-10-10" });
    return athleteId;
  }

  async function storedSnapshots(athleteId: string) {
    const { data } = await admin.from("training_plan_versions").select("id, input_snapshot, input_snapshot_hash").eq("athlete_id", athleteId);
    return data!;
  }

  const windowKeys = (snapshot: any) => snapshot.availability.windows.map((w: any) => `${w.dayOfWeek} ${w.startTime}`);
  const CANONICAL = ["0 08:00:00", "1 06:00:00", "1 08:00:00", "2 08:00:00", "3 08:00:00", "4 08:00:00", "5 08:00:00", "6 08:00:00"];

  it.each([
    ["V1", (athleteId: string, requestId: string) => generateAndPersistTrainingPlan({ client: admin, athleteId, generationRequestId: requestId, durationWeeks: 2, today: TODAY })],
    ["V2", (athleteId: string, requestId: string) => generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId, generationRequestId: requestId, durationWeeks: 2, today: TODAY })],
  ])("%s: canonical snapshot persisted; five replays of the same request id are idempotent", async (_model, generate) => {
    const athleteId = await seed(`deterministic snapshot ${_model}`);
    const requestId = randomUUID();
    const first = (await generate(athleteId, requestId)) as { planVersionId: string };
    for (let i = 0; i < 5; i += 1) {
      expect(await generate(athleteId, requestId)).toMatchObject({ planVersionId: first.planVersionId, idempotentReplay: true });
    }
    const [stored] = await storedSnapshots(athleteId);
    expect(windowKeys(stored!.input_snapshot)).toEqual(CANONICAL);
    expect((stored!.input_snapshot as any).lockedDates.map((l: any) => l.date)).toEqual(["2026-10-10", "2026-10-17"]);
  });
});
