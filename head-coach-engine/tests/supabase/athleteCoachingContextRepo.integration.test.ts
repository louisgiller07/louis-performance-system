/**
 * V0.3_008C — real local Supabase proof for getAthleteCoachingContext:
 * a real round-trip through athletes.discipline + athlete_onboarding_profiles,
 * and cross-athlete isolation with two real athlete rows (the admin/
 * service_role client — the same client this resolver actually runs with in
 * production, matching every other buildRawContext.ts-contributing
 * repository — never a per-user RLS-scoped client here; isolation is
 * proven by WHERE-clause correctness, not by an RLS policy test).
 *
 * OPT-IN ONLY, hard-bound to loopback — see testDb.ts's createTestClient().
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createTestClient,
  createTestAthlete,
  deleteTestAthlete,
  insertOnboardingProfile,
  setAthleteDiscipline,
  isLoopbackSupabaseUrl,
  resolveTestSupabaseUrl,
  type TestAthlete,
} from "./testDb.js";
import { getAthleteCoachingContext } from "../../src/supabase/repositories/athleteCoachingContextRepo.js";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESOLVED_ADMIN_URL = resolveTestSupabaseUrl();
const INTEGRATION_ENABLED =
  process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && isLoopbackSupabaseUrl(RESOLVED_ADMIN_URL);

describe.skipIf(!INTEGRATION_ENABLED)(
  "V0.3_008C — getAthleteCoachingContext (real local Supabase)",
  () => {
    let admin: SupabaseClient;
    let athleteA: TestAthlete;
    let athleteB: TestAthlete;

    beforeAll(() => {
      admin = createTestClient();
    });

    afterEach(async () => {
      if (athleteA) await deleteTestAthlete(admin, athleteA);
      if (athleteB) await deleteTestAthlete(admin, athleteB);
    });

    it("a brand new athlete (bootstrap only, never onboarded) resolves to just athlete_id", async () => {
      athleteA = await createTestAthlete(admin, "Fresh athlete — no onboarding");

      const context = await getAthleteCoachingContext(admin, athleteA.athleteId);

      expect(context).toEqual({ athlete_id: athleteA.athleteId });
    });

    it("a fully onboarded athlete's real data round-trips through the resolver", async () => {
      athleteA = await createTestAthlete(admin, "Fully onboarded athlete");
      await setAthleteDiscipline(admin, athleteA.athleteId, "Downhill");
      await insertOnboardingProfile(admin, athleteA.athleteId, {
        competition_level: "World Cup",
        primary_goal: "Race performance",
        weekly_training_hours: "10-15h",
        preferred_riding_days: ["Saturday", "Sunday"],
      });

      const context = await getAthleteCoachingContext(admin, athleteA.athleteId);

      expect(context).toEqual({
        athlete_id: athleteA.athleteId,
        discipline: "Downhill",
        competition_level: "World Cup",
        primary_goal: "Race performance",
        weekly_training_hours: "10-15h",
        preferred_riding_days: ["Saturday", "Sunday"],
      });
    });

    it("athlete isolation: A's context never contains any of B's onboarding data", async () => {
      athleteA = await createTestAthlete(admin, "Athlete A");
      athleteB = await createTestAthlete(admin, "Athlete B");
      await setAthleteDiscipline(admin, athleteA.athleteId, "Downhill");
      await insertOnboardingProfile(admin, athleteA.athleteId, { primary_goal: "Race performance" });
      await setAthleteDiscipline(admin, athleteB.athleteId, "Enduro");
      await insertOnboardingProfile(admin, athleteB.athleteId, { primary_goal: "Injury prevention" });

      const contextA = await getAthleteCoachingContext(admin, athleteA.athleteId);
      const contextB = await getAthleteCoachingContext(admin, athleteB.athleteId);

      expect(contextA.athlete_id).toBe(athleteA.athleteId);
      expect(contextA.discipline).toBe("Downhill");
      expect(contextA.primary_goal).toBe("Race performance");

      expect(contextB.athlete_id).toBe(athleteB.athleteId);
      expect(contextB.discipline).toBe("Enduro");
      expect(contextB.primary_goal).toBe("Injury prevention");

      // The precise leak this proves against: A's resolved context must
      // never carry B's athlete_id or B's declared values, and vice versa.
      expect(contextA.athlete_id).not.toBe(athleteB.athleteId);
      expect(contextA.primary_goal).not.toBe(contextB.primary_goal);
    });
  }
);
