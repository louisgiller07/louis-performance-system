/**
 * SupabaseLongitudinalSourceAdapter integration suite — runs against a
 * real local Supabase stack (`npx supabase start` + `npx supabase db
 * reset`). See testDb.ts for the required SUPABASE_SECRET_KEY env var.
 *
 * Range used throughout: 2026-08-10 .. 2026-08-15 inclusive.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseLongitudinalSourceAdapter } from "../../src/supabase/adapter.js";
import type { DateRange } from "../../src/types/index.js";
import {
  countRowsForAthlete,
  createTestAthlete,
  createTestClient,
  deleteTestAthlete,
  insertCheckin,
  insertCompletedSession,
  insertDecision,
  insertDecisionOutcome,
  insertHealthFlag,
  type TestAthlete,
} from "./testDb.js";

const RANGE: DateRange = { fromDate: "2026-08-10", toDate: "2026-08-15" };

describe("SupabaseLongitudinalSourceAdapter — integration", () => {
  let client: SupabaseClient;
  let adapter: SupabaseLongitudinalSourceAdapter;
  let athleteA: TestAthlete;
  let athleteB: TestAthlete;

  // Athlete A fixtures, referenced across multiple assertions below.
  let decisionInsideBoundaryStart: string; // decision_date = fromDate (08-10)
  let decisionInsideBoundaryEnd: string; // decision_date = toDate (08-15), reused for relationships
  let completedSessionId: string;
  let decisionOutcomeInsideId: string; // decision inside range, calculated_at far outside
  let decisionOutcomeOutsideId: string; // decision outside range, calculated_at inside — must be excluded

  beforeAll(async () => {
    client = createTestClient();
    adapter = new SupabaseLongitudinalSourceAdapter(client);

    athleteA = await createTestAthlete(client, "Longitudinal Test Athlete A");
    athleteB = await createTestAthlete(client, "Longitudinal Test Athlete B");

    // --- daily_checkins: dates inside and outside RANGE ---
    await insertCheckin(client, athleteA.athleteId, "2026-08-09"); // outside, before
    await insertCheckin(client, athleteA.athleteId, "2026-08-10", { free_comment: "boundary-start" });
    await insertCheckin(client, athleteA.athleteId, "2026-08-12", {
      free_comment: null,
      pain: true,
      pain_intensity: 5,
      pain_traumatic: false,
      pain_function_loss: false,
      pain_getting_worse: true,
      pain_location_code: "knee_L",
    });
    await insertCheckin(client, athleteA.athleteId, "2026-08-15", { free_comment: "boundary-end" });
    await insertCheckin(client, athleteA.athleteId, "2026-08-16"); // outside, after

    // --- decisions: dates inside and outside RANGE, plus two same-date rows to prove tie-break ordering ---
    await insertDecision(client, athleteA.athleteId, "2026-08-09"); // outside
    decisionInsideBoundaryStart = await insertDecision(client, athleteA.athleteId, "2026-08-10", {
      computed_at: "2026-08-10T09:00:00Z",
    });
    // Second decision on the SAME decision_date (append-only — no unique constraint), earlier computed_at,
    // to prove ordering falls back to computed_at ASC then id ASC, not insertion order.
    await insertDecision(client, athleteA.athleteId, "2026-08-10", { computed_at: "2026-08-10T08:00:00Z" });
    decisionInsideBoundaryEnd = await insertDecision(client, athleteA.athleteId, "2026-08-15", {
      daily_plan: { decision: "KEEP", nested: { note: "unicode: éà, \"quotes\"" } },
      active_mode: "IN_SEASON",
      confidence_level: "HIGH",
    });
    await insertDecision(client, athleteA.athleteId, "2026-08-16"); // outside

    // --- completed_sessions: relationship to decisionInsideBoundaryEnd ---
    completedSessionId = await insertCompletedSession(client, athleteA.athleteId, "2026-08-15", {
      decision_id: decisionInsideBoundaryEnd,
      intervention: { kind: "RECOVERY", load_profile: "LIGHT" },
    });

    // --- decision_outcomes: the decisive two-sided proof that range membership
    // follows decisions.decision_date, not calculated_at ---
    decisionOutcomeInsideId = await insertDecisionOutcome(
      client,
      athleteA.athleteId,
      decisionInsideBoundaryEnd, // decision_date 08-15 — INSIDE range
      { energy_before: 6 },
      { energy_delta: 2 },
      { calculated_at: "2026-09-01T00:00:00Z" } // far OUTSIDE range — must still be returned
    );
    const decisionOutsideRangeForOutcome = await insertDecision(client, athleteA.athleteId, "2026-08-20"); // OUTSIDE range
    decisionOutcomeOutsideId = await insertDecisionOutcome(
      client,
      athleteA.athleteId,
      decisionOutsideRangeForOutcome,
      { energy_before: 5 },
      { energy_delta: -1 },
      { calculated_at: "2026-08-12T00:00:00Z" } // INSIDE range by calculated_at — must still be excluded
    );

    // --- health_flags: lifecycle-overlap decisive cases ---
    // Distinct flag_type per row: health_flags_open_unique allows only one
    // OPEN (active/monitoring) flag per (athlete_id, flag_type) at a time.
    //
    // F1: started long before range, still unresolved -> must be INCLUDED (flag_date-only would miss it).
    await insertHealthFlag(client, athleteA.athleteId, "2026-08-01", {
      flag_type: "injury_suspect",
      status: "monitoring",
      description: "lifecycle-overlap-open",
    });
    // F2: resolved before range starts -> must be EXCLUDED (true-negative control).
    await insertHealthFlag(client, athleteA.athleteId, "2026-07-01", {
      flag_type: "illness",
      status: "resolved",
      resolved_at: "2026-08-05",
      description: "resolved-before-range",
    });
    // F3: flag_date squarely inside range, still open -> trivially INCLUDED.
    await insertHealthFlag(client, athleteA.athleteId, "2026-08-12", {
      flag_type: "pain_persistent",
      description: "inside-range-open",
    });
    // F4: flag_date after range -> must be EXCLUDED (hadn't started yet).
    await insertHealthFlag(client, athleteA.athleteId, "2026-08-20", {
      flag_type: "other",
      description: "after-range",
    });

    // --- athlete B: parallel dataset inside the same RANGE, to prove isolation ---
    await insertCheckin(client, athleteB.athleteId, "2026-08-12", { free_comment: "ATHLETE_B_MARKER" });
    const decisionB = await insertDecision(client, athleteB.athleteId, "2026-08-12");
    await insertCompletedSession(client, athleteB.athleteId, "2026-08-12", { decision_id: decisionB });
    await insertDecisionOutcome(client, athleteB.athleteId, decisionB, { x: 1 }, { y: 2 });
    await insertHealthFlag(client, athleteB.athleteId, "2026-08-12", { description: "ATHLETE_B_FLAG" });
  }, 60_000);

  afterAll(async () => {
    await deleteTestAthlete(client, athleteA);
    await deleteTestAthlete(client, athleteB);
  }, 30_000);

  describe("athlete isolation", () => {
    it("getDailyCheckins never returns another athlete's rows", async () => {
      const a = await adapter.getDailyCheckins(athleteA.athleteId, RANGE);
      expect(a.every((row) => row.athleteId === athleteA.athleteId)).toBe(true);
      expect(a.some((row) => row.freeComment === "ATHLETE_B_MARKER")).toBe(false);

      const b = await adapter.getDailyCheckins(athleteB.athleteId, RANGE);
      expect(b.every((row) => row.athleteId === athleteB.athleteId)).toBe(true);
      expect(b.some((row) => row.freeComment === "boundary-start")).toBe(false);
    });

    it("getDecisions, getCompletedSessions, getDecisionOutcomes, getHealthFlags all scope strictly to athleteId", async () => {
      const [decisions, sessions, outcomes, flags] = await Promise.all([
        adapter.getDecisions(athleteA.athleteId, RANGE),
        adapter.getCompletedSessions(athleteA.athleteId, RANGE),
        adapter.getDecisionOutcomes(athleteA.athleteId, RANGE),
        adapter.getHealthFlags(athleteA.athleteId, RANGE),
      ]);
      expect(decisions.every((r) => r.athleteId === athleteA.athleteId)).toBe(true);
      expect(sessions.every((r) => r.athleteId === athleteA.athleteId)).toBe(true);
      expect(outcomes.every((r) => r.athleteId === athleteA.athleteId)).toBe(true);
      expect(flags.every((r) => r.athleteId === athleteA.athleteId)).toBe(true);
      expect(flags.some((r) => r.description === "ATHLETE_B_FLAG")).toBe(false);
    });
  });

  describe("inclusive date-range boundaries", () => {
    it("getDailyCheckins includes both fromDate and toDate, excludes the day before/after", async () => {
      const rows = await adapter.getDailyCheckins(athleteA.athleteId, RANGE);
      const dates = rows.map((r) => r.checkinDate);
      expect(dates).toContain("2026-08-10");
      expect(dates).toContain("2026-08-15");
      expect(dates).not.toContain("2026-08-09");
      expect(dates).not.toContain("2026-08-16");
    });
  });

  describe("deterministic ordering", () => {
    it("getDailyCheckins returns rows in checkin_date ascending order", async () => {
      const rows = await adapter.getDailyCheckins(athleteA.athleteId, RANGE);
      const dates = rows.map((r) => r.checkinDate);
      expect(dates).toEqual([...dates].sort());
    });

    it("getDecisions breaks same-date ties by computed_at ASC, not insertion order", async () => {
      const rows = await adapter.getDecisions(athleteA.athleteId, RANGE);
      const sameDayRows = rows.filter((r) => r.decisionDate === "2026-08-10");
      expect(sameDayRows).toHaveLength(2);
      // Inserted 09:00 first, then 08:00 — a stable computed_at ASC sort must reverse insertion order.
      expect(sameDayRows[0]?.computedAt).toBe("2026-08-10T08:00:00+00:00");
      expect(sameDayRows[1]?.computedAt).toBe("2026-08-10T09:00:00+00:00");
    });
  });

  describe("nullable and JSON preservation", () => {
    it("preserves a null free_comment and a populated pain_location_code exactly", async () => {
      const rows = await adapter.getDailyCheckins(athleteA.athleteId, RANGE);
      const row = rows.find((r) => r.checkinDate === "2026-08-12");
      expect(row).toBeDefined();
      expect(row?.freeComment).toBeNull();
      expect(row?.pain).toBe(true);
      expect(row?.painLocationCode).toBe("knee_L");
      expect(row?.painGettingWorse).toBe(true);
    });

    it("preserves decisions.daily_plan JSON verbatim, including unicode and nesting", async () => {
      const rows = await adapter.getDecisions(athleteA.athleteId, RANGE);
      const row = rows.find((r) => r.id === decisionInsideBoundaryEnd);
      expect(row?.dailyPlan).toEqual({ decision: "KEEP", nested: { note: 'unicode: éà, "quotes"' } });
      expect(row?.activeMode).toBe("IN_SEASON");
      expect(row?.confidenceLevel).toBe("HIGH");
    });
  });

  describe("relationship preservation", () => {
    it("completed_sessions.decisionId round-trips to the exact decision it was recorded against", async () => {
      const rows = await adapter.getCompletedSessions(athleteA.athleteId, RANGE);
      const row = rows.find((r) => r.id === completedSessionId);
      expect(row?.decisionId).toBe(decisionInsideBoundaryEnd);
      expect(row?.intervention).toEqual({ kind: "RECOVERY", load_profile: "LIGHT" });
    });

    it("decision_outcomes.decisionId round-trips to the exact decision it observes", async () => {
      const rows = await adapter.getDecisionOutcomes(athleteA.athleteId, RANGE);
      const row = rows.find((r) => r.id === decisionOutcomeInsideId);
      expect(row?.decisionId).toBe(decisionInsideBoundaryEnd);
      expect(row?.inputSnapshot).toEqual({ energy_before: 6 });
      expect(row?.outcomeSignals).toEqual({ energy_delta: 2 });
    });
  });

  describe("decision_outcomes range semantics — anchored to decisions.decision_date, not calculated_at", () => {
    it("includes an outcome whose decision is inside range even though calculated_at is far outside it", async () => {
      const rows = await adapter.getDecisionOutcomes(athleteA.athleteId, RANGE);
      expect(rows.map((r) => r.id)).toContain(decisionOutcomeInsideId);
    });

    it("excludes an outcome whose decision is outside range even though calculated_at falls inside it", async () => {
      const rows = await adapter.getDecisionOutcomes(athleteA.athleteId, RANGE);
      expect(rows.map((r) => r.id)).not.toContain(decisionOutcomeOutsideId);
    });
  });

  describe("health_flags range semantics — lifecycle overlap, not flag_date alone", () => {
    it("includes a flag opened before range that is still unresolved during range", async () => {
      const rows = await adapter.getHealthFlags(athleteA.athleteId, RANGE);
      expect(rows.some((r) => r.description === "lifecycle-overlap-open")).toBe(true);
    });

    it("excludes a flag resolved before range starts", async () => {
      const rows = await adapter.getHealthFlags(athleteA.athleteId, RANGE);
      expect(rows.some((r) => r.description === "resolved-before-range")).toBe(false);
    });

    it("includes a flag whose flag_date falls squarely inside range", async () => {
      const rows = await adapter.getHealthFlags(athleteA.athleteId, RANGE);
      expect(rows.some((r) => r.description === "inside-range-open")).toBe(true);
    });

    it("excludes a flag whose flag_date is after range", async () => {
      const rows = await adapter.getHealthFlags(athleteA.athleteId, RANGE);
      expect(rows.some((r) => r.description === "after-range")).toBe(false);
    });
  });

  describe("cleanup", () => {
    it("leaves zero rows behind for both test athletes once deleted", async () => {
      // Run in a dedicated pair of scratch athletes so this assertion doesn't
      // depend on afterAll's ordering relative to the rest of this suite.
      const scratchA = await createTestAthlete(client, "Cleanup Scratch A");
      await insertCheckin(client, scratchA.athleteId, "2026-08-12");
      const scratchDecision = await insertDecision(client, scratchA.athleteId, "2026-08-12");
      await insertCompletedSession(client, scratchA.athleteId, "2026-08-12", { decision_id: scratchDecision });
      await insertDecisionOutcome(client, scratchA.athleteId, scratchDecision, { a: 1 }, { b: 2 });
      await insertHealthFlag(client, scratchA.athleteId, "2026-08-12");

      const before = await countRowsForAthlete(client, scratchA.athleteId);
      expect(Object.values(before).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);

      await deleteTestAthlete(client, scratchA);

      const after = await countRowsForAthlete(client, scratchA.athleteId);
      expect(after).toEqual({
        daily_checkins: 0,
        decisions: 0,
        completed_sessions: 0,
        decision_outcomes: 0,
        health_flags: 0,
      });
    }, 30_000);
  });
});
