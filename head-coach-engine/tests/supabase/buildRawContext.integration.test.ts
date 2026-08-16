import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildRawContext, NoCurrentCheckinError } from "../../src/supabase/buildRawContext.js";
import { IncompleteDailyCheckinError } from "../../src/supabase/mapping/dailyCheckinRow.js";
import { IncompleteCheckinPainCriteriaError } from "../../src/supabase/mapping/dailyCheckinPainCriteria.js";
import {
  createTestClient,
  createTestAthlete,
  deleteTestAthlete,
  insertCheckin,
  insertTrainingBlock,
  insertPlannedSession,
  insertHealthFlag,
  type TestAthlete,
} from "./testDb.js";

const TODAY = "2026-08-16";

describe("M2 read path — buildRawContext (integration, local Supabase)", () => {
  let client: SupabaseClient;
  let athlete: TestAthlete;

  beforeEach(async () => {
    client = createTestClient();
    athlete = await createTestAthlete(client, "buildRawContext integration test athlete");
  });

  afterEach(async () => {
    await deleteTestAthlete(client, athlete);
  });

  it("builds a correct RawContext from a complete M2 checkin + current training block", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY, { sleep_hours: 6.5, leg_fatigue: 5 });
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");

    const { rawContext, warnings } = await buildRawContext(client, athlete.athleteId, TODAY);

    expect(rawContext.today).toBe(TODAY);
    expect(rawContext.checkin.sleep_hours).toBe(6.5);
    expect(rawContext.checkin.leg_fatigue).toBe(5);
    expect(rawContext.active_mode).toBe("IN_SEASON");
    expect(rawContext.active_experiments).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("rejects a current checkin with a NULL enriched pain criterion (M2_001 boundary)", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY, { pain_traumatic: null });
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");

    await expect(buildRawContext(client, athlete.athleteId, TODAY)).rejects.toThrow(
      IncompleteCheckinPainCriteriaError
    );
  });

  it("rejects a current checkin with a NULL required scalar field (sleep_hours)", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY, { sleep_hours: null });
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");

    await expect(buildRawContext(client, athlete.athleteId, TODAY)).rejects.toThrow(IncompleteDailyCheckinError);
  });

  it("rejects when no daily_checkins row exists for today", async () => {
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");

    await expect(buildRawContext(client, athlete.athleteId, TODAY)).rejects.toThrow(NoCurrentCheckinError);
  });

  it("includes an active health flag in active_health_flags", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    await insertHealthFlag(client, athlete.athleteId, "concussion_suspect", "active");

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);

    expect(rawContext.active_health_flags).toEqual([{ type: "concussion_suspect", status: "active" }]);
  });

  it("includes a monitoring health flag in active_health_flags", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    await insertHealthFlag(client, athlete.athleteId, "concussion_suspect", "monitoring");

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);

    expect(rawContext.active_health_flags).toEqual([{ type: "concussion_suspect", status: "monitoring" }]);
  });

  it("excludes a resolved health flag from active_health_flags", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    await insertHealthFlag(client, athlete.athleteId, "concussion_suspect", "resolved");

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);

    expect(rawContext.active_health_flags).toEqual([]);
  });

  it("uses the rich intervention JSONB as source of truth for planned_session", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    await insertPlannedSession(client, athlete.athleteId, TODAY, {
      session_type: "STRENGTH_A",
      intervention: { kind: "STRENGTH_UPPER", load_profile: "HEAVY" },
    });

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);

    expect(rawContext.planned_session).toEqual({ kind: "STRENGTH_UPPER", load_profile: "HEAVY" });
  });

  it("falls back to the deterministic inversion for a legacy REST row with no intervention", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    await insertPlannedSession(client, athlete.athleteId, TODAY, { session_type: "REST" });

    const { rawContext, warnings } = await buildRawContext(client, athlete.athleteId, TODAY);

    expect(rawContext.planned_session).toEqual({ kind: "REST" });
    expect(warnings).toEqual([]);
  });

  it("never fabricates a rich intervention for a legacy ambiguous session_type, and surfaces a warning", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    await insertPlannedSession(client, athlete.athleteId, TODAY, { session_type: "STRENGTH_A" });

    const { rawContext, warnings } = await buildRawContext(client, athlete.athleteId, TODAY);

    expect(rawContext.planned_session).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("STRENGTH_A");
  });

  it("never derives planned_intent from primary_objective — only the explicit planned_intent column is used", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
    // primary_objective is intentionally not settable via insertPlannedSession's
    // typed fixture helper — there is structurally no path for it to leak into
    // RawContext.planned_intent through this boundary.
    await insertPlannedSession(client, athlete.athleteId, TODAY, {
      session_type: "REST",
      planned_intent: "Explicit intent from planned_intent column",
    });

    const { rawContext } = await buildRawContext(client, athlete.athleteId, TODAY);

    expect(rawContext.planned_intent).toBe("Explicit intent from planned_intent column");
  });

  it("leaves planned_session null and planned_intent undefined when no planned_sessions row exists for today", async () => {
    await insertCheckin(client, athlete.athleteId, TODAY);
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");

    const { rawContext, warnings } = await buildRawContext(client, athlete.athleteId, TODAY);

    expect(rawContext.planned_session).toBeNull();
    expect(rawContext.planned_intent).toBeUndefined();
    expect(warnings).toEqual([]);
  });
});
