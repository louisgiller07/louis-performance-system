/**
 * PILOT_022 — decision freshness (REV-01), prescription provenance (REV-02) and
 * plan-replacement reconciliation (REV-03), against a real local Supabase with the
 * real generation, acceptance/projection, daily-run and persistence code (no mocks).
 * Athlete-side writes (check-in edits, manual planned sessions) go through the
 * athlete's own authenticated client under RLS, exactly like the web app.
 *
 * OPT-IN ONLY, hard-bound to loopback — see testDb.ts's createTestClient().
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createTestClient,
  createTestAthlete,
  deleteTestAthlete,
  getAthleteAuthClient,
  insertCheckin,
  insertCompletedSession,
  insertDecision,
  isLoopbackSupabaseUrl,
  resolveTestSupabaseUrl,
  setAthleteDiscipline,
  type TestAthlete,
} from "./testDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlan } from "../../src/supabase/generateAndPersistTrainingPlan.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { runDailyFor } from "../../src/supabase/runDailyFor.js";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
const INTEGRATION_ENABLED =
  process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && !!PUBLISHABLE_KEY && isLoopbackSupabaseUrl(resolveTestSupabaseUrl());

const TODAY = "2026-10-05"; // Monday
const WINDOW_END = "2026-10-19"; // accept-training-plan fallback window (14 days)
const DURATION_WEEKS = 2;
// day_of_week: 0 = Sunday … 6 = Saturday (same convention as the web availability UI).
const PLAN_A_DAYS = [1, 2, 3, 5, 6]; // Mon Tue Wed Fri Sat
const PLAN_B_DAYS = [2]; // Tuesday only

async function seedProfile(admin: SupabaseClient, athleteId: string): Promise<void> {
  await setAthleteDiscipline(admin, athleteId, "Downhill");
  await upsertPerformanceProfileFor(admin, athleteId, {
    strength_experience_tier: "intermediate",
    equipment: ["barbell", "squat_rack", "dumbbells", "bench", "pull_up_bar", "cable_machine", "resistance_bands"],
    terrain_access: ["flow_trail", "bermed_trail", "technical_trail", "rock_garden", "root_rock_trail", "bike_park_jump_line", "full_dh_track", "steep_technical_trail", "any_groomed_trail"],
    declared_limitations: [],
    technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering"] },
  });
}

/** Replaces the athlete's availability: the delete runs as the athlete (RLS), like the web availability section. */
async function setAvailability(admin: SupabaseClient, own: SupabaseClient, athleteId: string, days: number[]): Promise<void> {
  const { error } = await own.from("athlete_availability_windows").delete().eq("athlete_id", athleteId);
  if (error) throw new Error(`availability reset failed: ${error.message}`);
  for (const day of days) {
    await insertAvailabilityWindow(admin, athleteId, { day_of_week: day, start_time: "16:00:00", end_time: "20:00:00" });
  }
}

async function generateAndAccept(admin: SupabaseClient, athleteId: string, requestId: string): Promise<string> {
  const generated = await generateAndPersistTrainingPlan({ client: admin, athleteId, generationRequestId: requestId, durationWeeks: DURATION_WEEKS, today: TODAY });
  const outcome = await acceptTrainingPlanVersion(admin, athleteId, generated.planVersionId, TODAY, WINDOW_END);
  expect(outcome.warnings).toEqual([]);
  return generated.planVersionId;
}

interface PlannedRow {
  id: string;
  planned_date: string;
  source: string;
  session_type: string;
  source_plan_version_id: string | null;
  source_generated_session_id: string | null;
  updated_at: string;
}

async function plannedRows(admin: SupabaseClient, athleteId: string): Promise<PlannedRow[]> {
  const { data, error } = await admin
    .from("planned_sessions")
    .select("id, planned_date, source, session_type, source_plan_version_id, source_generated_session_id, updated_at")
    .eq("athlete_id", athleteId)
    .order("planned_date", { ascending: true });
  if (error) throw new Error(`planned_sessions query failed: ${error.message}`);
  return data as PlannedRow[];
}

/** Same payload as web savePlannedSession (source 'manual', lineage columns omitted), through the athlete's own RLS client. */
async function saveManualSession(athleteClient: SupabaseClient, athleteId: string, date: string, kind: string, sessionType: string, loadProfile: string): Promise<void> {
  const { error } = await athleteClient.from("planned_sessions").upsert(
    {
      athlete_id: athleteId,
      planned_date: date,
      session_type: sessionType,
      intervention: { kind, load_profile: loadProfile },
      planned_intent: null,
      source: "manual",
      is_committed: false,
    },
    { onConflict: "athlete_id,planned_date" }
  );
  if (error) throw new Error(`manual planned session upsert failed: ${error.message}`);
}

async function currency(athleteClient: SupabaseClient, decisionId: string): Promise<{ is_current: boolean; stale_reason: string | null }> {
  const { data, error } = await athleteClient.from("daily_decision_currency").select("is_current, stale_reason").eq("decision_id", decisionId).single();
  if (error) throw new Error(`daily_decision_currency query failed: ${error.message}`);
  return data as { is_current: boolean; stale_reason: string | null };
}

async function firstStrengthDateWithPrescription(admin: SupabaseClient, athleteId: string, planVersionId: string): Promise<string> {
  const rows = (await plannedRows(admin, athleteId)).filter(
    (r) => r.source === "generated" && r.source_plan_version_id === planVersionId && r.session_type.startsWith("STRENGTH")
  );
  for (const row of rows) {
    const { data } = await admin.from("training_plan_planned_prescriptions").select("id").eq("generated_plan_session_id", row.source_generated_session_id!).maybeSingle();
    if (data) return row.planned_date;
  }
  throw new Error("no projected strength session with a canonical prescription");
}

describe.skipIf(!INTEGRATION_ENABLED)("PILOT_022 — consistency & provenance (real local Supabase)", () => {
  let admin: SupabaseClient;

  beforeAll(() => {
    admin = createTestClient();
  });

  async function withAthlete<T>(name: string, run: (athlete: TestAthlete, own: SupabaseClient) => Promise<T>): Promise<T> {
    const athlete = await createTestAthlete(admin, name);
    try {
      return await run(athlete, await getAthleteAuthClient(athlete.athleteId));
    } finally {
      await deleteTestAthlete(admin, athlete);
    }
  }

  it("REV-01 — a decision stays current only while its check-in and planned session are unchanged", async () => {
    await withAthlete("PILOT_022 REV-01", async (athlete, own) => {
      await seedProfile(admin, athlete.athleteId);
      await setAvailability(admin, own, athlete.athleteId, PLAN_A_DAYS);
      await generateAndAccept(admin, athlete.athleteId, "22022022-0220-4220-8220-220220220101");
      await insertCheckin(admin, athlete.athleteId, TODAY, { sleep_hours: 8, sleep_quality: 8, energy: 8, work_stress: 2, motivation: 8, leg_fatigue: 2, grip_fatigue: 2 });

      const first = await runDailyFor(admin, athlete.athleteId, TODAY);
      const firstId = first.persistence.decision_id;
      const { data: provenance } = await admin
        .from("decisions")
        .select("source_checkin_id, source_checkin_updated_at, source_planned_session_id, source_planned_session_updated_at")
        .eq("id", firstId)
        .single();
      expect(provenance!.source_checkin_id).not.toBeNull();
      expect(provenance!.source_checkin_updated_at).not.toBeNull();

      // B — nothing relevant changed: still current (survives any number of re-reads/mounts).
      expect(await currency(own, firstId)).toEqual({ is_current: true, stale_reason: null });
      expect(await currency(own, firstId)).toEqual({ is_current: true, stale_reason: null });

      // A — check-in edited without recalculation: the old decision is stale.
      const { error: editError } = await own
        .from("daily_checkins")
        .update({ sleep_hours: 5, leg_fatigue: 8, grip_fatigue: 8 })
        .eq("athlete_id", athlete.athleteId)
        .eq("checkin_date", TODAY);
      expect(editError).toBeNull();
      expect(await currency(own, firstId)).toEqual({ is_current: false, stale_reason: "checkin_changed" });

      // Explicit recalculation: the new decision is current, the old one stays in history and stale.
      const second = await runDailyFor(admin, athlete.athleteId, TODAY);
      expect(await currency(own, second.persistence.decision_id)).toEqual({ is_current: true, stale_reason: null });
      expect(await currency(own, firstId)).toEqual({ is_current: false, stale_reason: "checkin_changed" });
      const { count } = await admin.from("decisions").select("id", { count: "exact", head: true }).eq("athlete_id", athlete.athleteId);
      expect(count).toBe(2);

      // C — planned session changed after the decision: stale.
      await saveManualSession(own, athlete.athleteId, TODAY, "RECOVERY_ACTIVE", "RECOVERY", "LIGHT");
      expect(await currency(own, second.persistence.decision_id)).toEqual({ is_current: false, stale_reason: "planned_session_changed" });
    });
  });

  it("REV-01 — a pre-PILOT_022 decision (no recorded versions) uses the conservative timestamp fallback", async () => {
    await withAthlete("PILOT_022 REV-01 legacy", async (athlete, own) => {
      await insertCheckin(admin, athlete.athleteId, TODAY);
      const legacyId = await insertDecision(admin, athlete.athleteId, TODAY);
      expect(await currency(own, legacyId)).toEqual({ is_current: true, stale_reason: null });

      const { error } = await own.from("daily_checkins").update({ energy: 3 }).eq("athlete_id", athlete.athleteId).eq("checkin_date", TODAY);
      expect(error).toBeNull();
      expect(await currency(own, legacyId)).toEqual({ is_current: false, stale_reason: "checkin_changed" });
    });
  });

  it("REV-01 — RLS: an athlete never sees another athlete's decision currency, and provenance cannot reference another athlete's check-in", async () => {
    await withAthlete("PILOT_022 RLS A", async (a) => {
      await withAthlete("PILOT_022 RLS B", async (b, ownB) => {
        await insertCheckin(admin, a.athleteId, TODAY);
        const decisionA = await insertDecision(admin, a.athleteId, TODAY);
        const { data } = await ownB.from("daily_decision_currency").select("decision_id").eq("decision_id", decisionA);
        expect(data).toEqual([]);

        const { data: checkinA } = await admin.from("daily_checkins").select("id, updated_at").eq("athlete_id", a.athleteId).single();
        const { error } = await admin.rpc("persist_daily_run", {
          p_athlete_id: b.athleteId,
          p_health_flag: null,
          p_decision_row: {
            decision_date: TODAY,
            final_session: "REST",
            reason: "x",
            engine_version: "test",
            daily_plan: { decision: "REST" },
            active_mode: "IN_SEASON",
            confidence_level: "LOW",
            source_checkin_id: checkinA!.id,
            source_checkin_updated_at: checkinA!.updated_at,
          },
        });
        expect(error?.message).toMatch(/is not this athlete's check-in/);
      });
    });
  });

  it("REV-02 — a generated strength session manually changed to aerobic never keeps the old strength prescription", async () => {
    await withAthlete("PILOT_022 REV-02", async (athlete, own) => {
      await seedProfile(admin, athlete.athleteId);
      await setAvailability(admin, own, athlete.athleteId, PLAN_A_DAYS);
      const planA = await generateAndAccept(admin, athlete.athleteId, "22022022-0220-4220-8220-220220220201");
      const date = await firstStrengthDateWithPrescription(admin, athlete.athleteId, planA);
      await insertCheckin(admin, athlete.athleteId, date);

      // Control: KEEP on the generated strength session delivers its canonical prescription.
      const keep = await runDailyFor(admin, athlete.athleteId, date);
      expect(keep.dailyPlan.decision).toBe("KEEP");
      expect(keep.executablePrescription?.structure.domain).toBe("strength");

      // Manual concept change (web savePlannedSession), then recalculation.
      await saveManualSession(own, athlete.athleteId, date, "AEROBIC_BASE", "AEROBIC_BASE", "MODERATE");
      const afterEdit = await runDailyFor(admin, athlete.athleteId, date);
      expect(afterEdit.dailyPlan.final_session.kind).toBe("AEROBIC_BASE");
      expect(afterEdit.executablePrescription).toBeNull();

      // Same concept, load change, still manual: the canonical (moderate) prescription is not served either —
      // a manual session has no canonical prescription (V0.5_047/048 contract).
      await saveManualSession(own, athlete.athleteId, date, "STRENGTH_LOWER", "STRENGTH_B", "LIGHT");
      const loadChange = await runDailyFor(admin, athlete.athleteId, date);
      expect(loadChange.executablePrescription).toBeNull();
    });
  });

  it("REV-03 — accepting a replacement plan reconciles superseded projections, preserving manual and completed sessions, idempotently", async () => {
    await withAthlete("PILOT_022 REV-03", async (athlete, own) => {
      await seedProfile(admin, athlete.athleteId);
      await setAvailability(admin, own, athlete.athleteId, PLAN_A_DAYS);
      const planA = await generateAndAccept(admin, athlete.athleteId, "22022022-0220-4220-8220-220220220301");
      const afterA = await plannedRows(admin, athlete.athleteId);
      const aDates = afterA.filter((r) => r.source === "generated" && r.source_plan_version_id === planA).map((r) => r.planned_date);
      expect(aDates.length).toBeGreaterThan(2);

      // Plan B: Tuesday only.
      await setAvailability(admin, own, athlete.athleteId, PLAN_B_DAYS);
      const generatedB = await generateAndPersistTrainingPlan({
        client: admin,
        athleteId: athlete.athleteId,
        generationRequestId: "22022022-0220-4220-8220-220220220302",
        durationWeeks: DURATION_WEEKS,
        today: TODAY,
      });
      const { data: bSessions } = await admin
        .from("training_plan_generated_sessions")
        .select("date")
        .eq("plan_version_id", generatedB.planVersionId)
        .gte("date", TODAY)
        .lte("date", WINDOW_END);
      const bDates = new Set((bSessions ?? []).map((s) => s.date as string));
      const aOnly = aDates.filter((d) => !bDates.has(d));
      expect(aOnly.length).toBeGreaterThanOrEqual(2);
      const [manualDate, completedDate] = aOnly as [string, string];

      // B — a manual edit on an A-only date; C — a completed session on another A-only date.
      await saveManualSession(own, athlete.athleteId, manualDate, "MOBILITY", "RECOVERY", "LIGHT");
      await insertCompletedSession(admin, athlete.athleteId, completedDate, "RECOVERY", { kind: "RECOVERY_ACTIVE", load_profile: "LIGHT" });

      const acceptB = await acceptTrainingPlanVersion(admin, athlete.athleteId, generatedB.planVersionId, TODAY, WINDOW_END);
      expect(acceptB.warnings).toEqual([]);
      const removed = acceptB.projection!.plannedSessions.filter((s) => s.outcome === "removed_superseded").map((s) => s.date);

      const afterB = await plannedRows(admin, athlete.athleteId);
      const byDate = new Map(afterB.map((r) => [r.planned_date, r]));
      // A — every generated row is B's; A-only dates are gone.
      for (const row of afterB.filter((r) => r.source === "generated")) {
        expect(row.source_plan_version_id === generatedB.planVersionId || row.planned_date === completedDate).toBe(true);
      }
      for (const date of aOnly.filter((d) => d !== manualDate && d !== completedDate)) {
        expect(byDate.has(date)).toBe(false);
        expect(removed).toContain(date);
      }
      // B — manual preserved.
      expect(byDate.get(manualDate)?.source).toBe("manual");
      // C — completed history preserved (and its day's row kept).
      const { count: completedCount } = await admin
        .from("completed_sessions")
        .select("id", { count: "exact", head: true })
        .eq("athlete_id", athlete.athleteId)
        .eq("session_date", completedDate);
      expect(completedCount).toBe(1);
      expect(byDate.has(completedDate)).toBe(true);
      // B's own dates are projected.
      for (const date of bDates) expect(byDate.get(date)?.source_plan_version_id).toBe(generatedB.planVersionId);

      // D — idempotent replay: same rows, no duplicates, nothing stale comes back.
      const replay = await acceptTrainingPlanVersion(admin, athlete.athleteId, generatedB.planVersionId, TODAY, WINDOW_END);
      expect(replay.acceptance.idempotentReplay).toBe(true);
      expect(replay.projection!.plannedSessions.some((s) => s.outcome === "removed_superseded" || s.outcome === "projected")).toBe(false);
      const afterReplay = await plannedRows(admin, athlete.athleteId);
      expect(afterReplay).toEqual(afterB);
      expect(new Set(afterReplay.map((r) => r.planned_date)).size).toBe(afterReplay.length);
    });
  });

  it("combined — plan A decision, replacement by B, manual concept change on a B session, daily-run", async () => {
    await withAthlete("PILOT_022 combined", async (athlete, own) => {
      await seedProfile(admin, athlete.athleteId);
      await setAvailability(admin, own, athlete.athleteId, PLAN_A_DAYS);
      const planA = await generateAndAccept(admin, athlete.athleteId, "22022022-0220-4220-8220-220220220401");
      const aRows = (await plannedRows(admin, athlete.athleteId)).filter((r) => r.source_plan_version_id === planA);

      await setAvailability(admin, own, athlete.athleteId, PLAN_B_DAYS);
      const generatedB = await generateAndPersistTrainingPlan({
        client: admin,
        athleteId: athlete.athleteId,
        generationRequestId: "22022022-0220-4220-8220-220220220402",
        durationWeeks: DURATION_WEEKS,
        today: TODAY,
      });
      const { data: bSessions } = await admin
        .from("training_plan_generated_sessions")
        .select("date")
        .eq("plan_version_id", generatedB.planVersionId)
        .gte("date", TODAY)
        .lte("date", WINDOW_END)
        .order("date", { ascending: true });
      const bDates = (bSessions ?? []).map((s) => s.date as string);
      const aOnlyDate = aRows.map((r) => r.planned_date).find((d) => !bDates.includes(d))!;
      const bDate = bDates[0]!;

      // Decision under plan A on a date plan B will not use.
      await insertCheckin(admin, athlete.athleteId, aOnlyDate);
      const decisionA = await runDailyFor(admin, athlete.athleteId, aOnlyDate);
      expect(await currency(own, decisionA.persistence.decision_id)).toEqual({ is_current: true, stale_reason: null });

      // Replace A with B: the A projection is reconciled away, the A decision becomes stale.
      await acceptTrainingPlanVersion(admin, athlete.athleteId, generatedB.planVersionId, TODAY, WINDOW_END);
      const afterB = await plannedRows(admin, athlete.athleteId);
      expect(afterB.some((r) => r.source === "generated" && r.source_plan_version_id === planA)).toBe(false);
      expect(await currency(own, decisionA.persistence.decision_id)).toEqual({ is_current: false, stale_reason: "planned_session_changed" });

      // Manual concept change on B's session, then daily-run.
      await saveManualSession(own, athlete.athleteId, bDate, "AEROBIC_BASE", "AEROBIC_BASE", "MODERATE");
      await insertCheckin(admin, athlete.athleteId, bDate);
      const onB = await runDailyFor(admin, athlete.athleteId, bDate);
      expect(onB.dailyPlan.final_session.kind).toBe("AEROBIC_BASE");
      expect(onB.executablePrescription).toBeNull();
      expect(await currency(own, onB.persistence.decision_id)).toEqual({ is_current: true, stale_reason: null });
    });
  });
});
