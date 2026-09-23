import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockedFrom } = vi.hoisted(() => ({ mockedFrom: vi.fn() }));
vi.mock("../../lib/supabase", () => ({
  supabase: { from: mockedFrom },
}));

import {
  getTrainingPlanDrafts,
  getTrainingPlanReview,
  getLatestDraft,
  getActivePlanVersionId,
  assembleTrainingPlanReview,
  latestStateByVersion,
  TrainingPlanReviewError,
  TrainingPlanVersionNotFoundError,
  type TrainingPlanVersionRawRow,
  type TrainingPlanLifecycleTransitionRawRow,
  type TrainingPlanBlockRawRow,
  type TrainingPlanWeekRawRow,
  type TrainingPlanGeneratedSessionRawRow,
  type TrainingPlanPlannedPrescriptionRawRow,
} from "./trainingPlanReviewRepo";

beforeEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// Chainable Supabase query mock — every method used by the repo (.select/
// .eq/.in/.order) returns the same builder; both `await builder` (thenable)
// and `await builder.maybeSingle()` resolve to the configured result. One
// entry per table name; a table not configured returns { data: [], error: null }.
// ---------------------------------------------------------------------------
type QueryResult = { data: unknown; error: unknown };

/**
 * `maybeSingle()` needs to behave correctly even when the configured `data`
 * is a list shaped for a *different* caller against the same table (e.g.
 * getLatestDraft() composes getTrainingPlanDrafts()'s list query with
 * getTrainingPlanReview()'s own `.eq("id", ...).maybeSingle()` query,  both
 * against training_plan_versions) — `.eq()` is captured so `.maybeSingle()`
 * can filter an array-shaped `data` down to the matching row by id, the same
 * way a real `.eq(...).maybeSingle()` call would.
 */
function makeQueryBuilder(result: QueryResult) {
  let eqValue: unknown;
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (_column: string, value: unknown) => {
      eqValue = value;
      return builder;
    },
    in: () => builder,
    order: () => builder,
    maybeSingle: async () => {
      if (Array.isArray(result.data)) {
        const row = (result.data as { id?: unknown }[]).find((r) => r.id === eqValue) ?? null;
        return { data: row, error: result.error };
      }
      return result;
    },
    then: (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

function mockTables(responses: Partial<Record<string, QueryResult>>) {
  mockedFrom.mockImplementation((table: string) => makeQueryBuilder(responses[table] ?? { data: [], error: null }));
}

const VERSION_1: TrainingPlanVersionRawRow = {
  id: "version-1",
  horizon_start_date: "2026-10-19",
  horizon_end_date: "2026-11-01",
  generation_trigger: "initial",
  rationale: "Initial training plan generation.",
  relaxed_constraints: [],
  generated_at: "2026-09-20T10:00:00Z",
};

const VERSION_2: TrainingPlanVersionRawRow = {
  id: "version-2",
  horizon_start_date: "2026-11-02",
  horizon_end_date: "2026-11-15",
  generation_trigger: "manual_edit",
  rationale: "Regenerated after a manual edit.",
  relaxed_constraints: [{ constraintId: "recovery_spacing", reason: "insufficient rest days" }],
  generated_at: "2026-09-22T10:00:00Z",
};

const DRAFT_TRANSITION_1: TrainingPlanLifecycleTransitionRawRow = { plan_version_id: "version-1", transition_number: 1, state: "draft" };
const DRAFT_TRANSITION_2: TrainingPlanLifecycleTransitionRawRow = { plan_version_id: "version-2", transition_number: 1, state: "draft" };

const BLOCK_1: TrainingPlanBlockRawRow = {
  id: "block-1",
  plan_version_id: "version-1",
  sequence_number: 1,
  name: "Base Phase",
  mode: "IN_SEASON",
  primary_focus: "base building",
  start_date: "2026-10-19",
  end_date: "2026-11-01",
};

const WEEK_1: TrainingPlanWeekRawRow = {
  id: "week-1",
  block_id: "block-1",
  plan_version_id: "version-1",
  week_number: 1,
  start_date: "2026-10-19",
  end_date: "2026-10-25",
  week_type: "development",
  dose_summary: {
    plannedStrengthSessionCount: 2,
    plannedDhTechnicalSessionCount: 1,
    plannedAerobicSessionCount: 1,
    plannedRestOrRecoveryDayCount: 3,
    totalPlannedMinutes: 240,
  },
  rationale: "Standard development week.",
};

const STRENGTH_SESSION: TrainingPlanGeneratedSessionRawRow = {
  id: "session-strength",
  week_id: "week-1",
  plan_version_id: "version-1",
  date: "2026-10-20",
  kind: "STRENGTH_LOWER",
  load_profile: "HEAVY",
  duration_min: 60,
  dose_target: { domain: "strength", setVolume: 12, targetRpeOrRir: 7 },
  rationale: "Standard development week.",
};

const AEROBIC_SESSION: TrainingPlanGeneratedSessionRawRow = {
  id: "session-aerobic",
  week_id: "week-1",
  plan_version_id: "version-1",
  date: "2026-10-21",
  kind: "AEROBIC_BASE",
  load_profile: "MODERATE",
  duration_min: 90,
  dose_target: { domain: "aerobic", intensityZone: "easy" },
  rationale: "Standard development week.",
};

const STRENGTH_PRESCRIPTION: TrainingPlanPlannedPrescriptionRawRow = {
  id: "prescription-1",
  generated_plan_session_id: "session-strength",
  plan_version_id: "version-1",
  structure: { domain: "strength", schemaVersion: "v1", blocks: [] },
};

describe("latestStateByVersion", () => {
  it("picks the transition with the highest transition_number per version", () => {
    const rows: TrainingPlanLifecycleTransitionRawRow[] = [
      { plan_version_id: "v1", transition_number: 1, state: "draft" },
      { plan_version_id: "v1", transition_number: 2, state: "accepted" },
      { plan_version_id: "v2", transition_number: 1, state: "draft" },
    ];

    const result = latestStateByVersion(rows);

    expect(result.get("v1")).toBe("accepted");
    expect(result.get("v2")).toBe("draft");
  });

  it("is order-independent — the highest transition_number wins regardless of array order", () => {
    const rows: TrainingPlanLifecycleTransitionRawRow[] = [
      { plan_version_id: "v1", transition_number: 3, state: "abandoned" },
      { plan_version_id: "v1", transition_number: 1, state: "draft" },
      { plan_version_id: "v1", transition_number: 2, state: "accepted" },
    ];

    expect(latestStateByVersion(rows).get("v1")).toBe("abandoned");
  });

  it("returns an empty map for no rows", () => {
    expect(latestStateByVersion([]).size).toBe(0);
  });
});

describe("assembleTrainingPlanReview", () => {
  it("reconstructs the full version -> block -> week -> session -> prescription tree", () => {
    const review = assembleTrainingPlanReview(VERSION_1, "draft", [BLOCK_1], [WEEK_1], [STRENGTH_SESSION, AEROBIC_SESSION], [STRENGTH_PRESCRIPTION]);

    expect(review.version.id).toBe("version-1");
    expect(review.lifecycleState).toBe("draft");
    expect(review.blocks).toHaveLength(1);
    expect(review.blocks[0]!.weeks).toHaveLength(1);
    expect(review.blocks[0]!.weeks[0]!.sessions).toHaveLength(2);
  });

  it("attaches a prescription only to the session it belongs to — absent (null) for the aerobic session", () => {
    const review = assembleTrainingPlanReview(VERSION_1, "draft", [BLOCK_1], [WEEK_1], [STRENGTH_SESSION, AEROBIC_SESSION], [STRENGTH_PRESCRIPTION]);

    const sessions = review.blocks[0]!.weeks[0]!.sessions;
    const strength = sessions.find((s) => s.id === "session-strength");
    const aerobic = sessions.find((s) => s.id === "session-aerobic");

    expect(strength?.prescription).toEqual({ id: "prescription-1", generatedPlanSessionId: "session-strength", structure: STRENGTH_PRESCRIPTION.structure });
    expect(aerobic?.prescription).toBeNull();
  });

  it("returns an empty blocks array for a version with no children — never an error", () => {
    const review = assembleTrainingPlanReview(VERSION_1, "draft", [], [], [], []);
    expect(review.blocks).toEqual([]);
  });

  it("never mutates any input row", () => {
    const versionSnapshot = JSON.parse(JSON.stringify(VERSION_1));
    const blockSnapshot = JSON.parse(JSON.stringify(BLOCK_1));
    const weekSnapshot = JSON.parse(JSON.stringify(WEEK_1));
    const sessionsSnapshot = JSON.parse(JSON.stringify([STRENGTH_SESSION, AEROBIC_SESSION]));
    const prescriptionsSnapshot = JSON.parse(JSON.stringify([STRENGTH_PRESCRIPTION]));

    assembleTrainingPlanReview(VERSION_1, "draft", [BLOCK_1], [WEEK_1], [STRENGTH_SESSION, AEROBIC_SESSION], [STRENGTH_PRESCRIPTION]);

    expect(VERSION_1).toEqual(versionSnapshot);
    expect(BLOCK_1).toEqual(blockSnapshot);
    expect(WEEK_1).toEqual(weekSnapshot);
    expect([STRENGTH_SESSION, AEROBIC_SESSION]).toEqual(sessionsSnapshot);
    expect([STRENGTH_PRESCRIPTION]).toEqual(prescriptionsSnapshot);
  });

  it("maps doseSummary and relaxedConstraints structurally, without inventing fields", () => {
    const review = assembleTrainingPlanReview(VERSION_2, "draft", [], [], [], []);
    expect(review.version.relaxedConstraints).toEqual([{ constraintId: "recovery_spacing", reason: "insufficient rest days" }]);

    const weekReview = assembleTrainingPlanReview(VERSION_1, "draft", [BLOCK_1], [WEEK_1], [], []);
    expect(weekReview.blocks[0]!.weeks[0]!.doseSummary).toEqual({
      plannedStrengthSessionCount: 2,
      plannedDhTechnicalSessionCount: 1,
      plannedAerobicSessionCount: 1,
      plannedRestOrRecoveryDayCount: 3,
      totalPlannedMinutes: 240,
    });
  });
});

describe("getTrainingPlanDrafts", () => {
  it("returns an empty array when the athlete has no versions at all", async () => {
    mockTables({ training_plan_versions: { data: [], error: null } });

    expect(await getTrainingPlanDrafts()).toEqual([]);
  });

  it("returns one draft summary when exactly one version exists in draft state", async () => {
    mockTables({
      training_plan_versions: { data: [VERSION_1], error: null },
      training_plan_version_lifecycle_transitions: { data: [DRAFT_TRANSITION_1], error: null },
    });

    const drafts = await getTrainingPlanDrafts();

    expect(drafts).toEqual([
      {
        id: "version-1",
        horizonStartDate: "2026-10-19",
        horizonEndDate: "2026-11-01",
        generationTrigger: "initial",
        rationale: "Initial training plan generation.",
        generatedAt: "2026-09-20T10:00:00Z",
      },
    ]);
  });

  it("returns several draft summaries when several versions are all in draft state — never assumes exactly one", async () => {
    mockTables({
      training_plan_versions: { data: [VERSION_2, VERSION_1], error: null }, // already ordered generated_at desc by the query
      training_plan_version_lifecycle_transitions: { data: [DRAFT_TRANSITION_1, DRAFT_TRANSITION_2], error: null },
    });

    const drafts = await getTrainingPlanDrafts();

    expect(drafts).toHaveLength(2);
    expect(drafts.map((d) => d.id)).toEqual(["version-2", "version-1"]);
  });

  it("excludes a version whose current state is not draft (e.g. already accepted)", async () => {
    mockTables({
      training_plan_versions: { data: [VERSION_1, VERSION_2], error: null },
      training_plan_version_lifecycle_transitions: {
        data: [DRAFT_TRANSITION_1, { plan_version_id: "version-2", transition_number: 2, state: "accepted" }],
        error: null,
      },
    });

    const drafts = await getTrainingPlanDrafts();

    expect(drafts.map((d) => d.id)).toEqual(["version-1"]);
  });

  it("throws TrainingPlanReviewError when the version read fails", async () => {
    mockTables({ training_plan_versions: { data: null, error: { code: "500" } } });

    await expect(getTrainingPlanDrafts()).rejects.toBeInstanceOf(TrainingPlanReviewError);
  });
});

describe("getTrainingPlanReview", () => {
  it("assembles the full tree for a real version id", async () => {
    mockTables({
      training_plan_versions: { data: VERSION_1, error: null },
      training_plan_version_lifecycle_transitions: { data: [DRAFT_TRANSITION_1], error: null },
      training_plan_blocks: { data: [BLOCK_1], error: null },
      training_plan_weeks: { data: [WEEK_1], error: null },
      training_plan_generated_sessions: { data: [STRENGTH_SESSION, AEROBIC_SESSION], error: null },
      training_plan_planned_prescriptions: { data: [STRENGTH_PRESCRIPTION], error: null },
    });

    const review = await getTrainingPlanReview("version-1");

    expect(review.lifecycleState).toBe("draft");
    expect(review.blocks[0]!.weeks[0]!.sessions).toHaveLength(2);
  });

  it("throws TrainingPlanVersionNotFoundError when the id does not exist (or is hidden by RLS)", async () => {
    mockTables({ training_plan_versions: { data: null, error: null } });

    await expect(getTrainingPlanReview("unknown-id")).rejects.toBeInstanceOf(TrainingPlanVersionNotFoundError);
  });

  it("throws TrainingPlanReviewError when a child table read fails — never a silent partial result", async () => {
    mockTables({
      training_plan_versions: { data: VERSION_1, error: null },
      training_plan_version_lifecycle_transitions: { data: [DRAFT_TRANSITION_1], error: null },
      training_plan_blocks: { data: null, error: { code: "500" } },
    });

    await expect(getTrainingPlanReview("version-1")).rejects.toBeInstanceOf(TrainingPlanReviewError);
  });

  it("throws TrainingPlanReviewError when the Supabase read for the version itself fails", async () => {
    mockTables({ training_plan_versions: { data: null, error: { code: "500" } } });

    await expect(getTrainingPlanReview("version-1")).rejects.toBeInstanceOf(TrainingPlanReviewError);
  });
});

describe("getLatestDraft", () => {
  it("returns null when there is no draft — never an error", async () => {
    mockTables({ training_plan_versions: { data: [], error: null } });

    expect(await getLatestDraft()).toBeNull();
  });

  it("returns the most recently generated draft's full review when several exist", async () => {
    mockTables({
      training_plan_versions: { data: [VERSION_2, VERSION_1], error: null },
      training_plan_version_lifecycle_transitions: { data: [DRAFT_TRANSITION_1, DRAFT_TRANSITION_2], error: null },
      training_plan_blocks: { data: [], error: null },
      training_plan_weeks: { data: [], error: null },
      training_plan_generated_sessions: { data: [], error: null },
      training_plan_planned_prescriptions: { data: [], error: null },
    });

    const review = await getLatestDraft();

    expect(review?.version.id).toBe("version-2");
  });
});

describe("getActivePlanVersionId", () => {
  it("returns null when the athlete has never accepted a plan", async () => {
    mockTables({ training_plan_current_version: { data: null, error: null } });

    expect(await getActivePlanVersionId()).toBeNull();
  });

  it("returns the current version id when one is active", async () => {
    mockTables({ training_plan_current_version: { data: { plan_version_id: "version-1" }, error: null } });

    expect(await getActivePlanVersionId()).toBe("version-1");
  });

  it("throws TrainingPlanReviewError when the read fails", async () => {
    mockTables({ training_plan_current_version: { data: null, error: { code: "500" } } });

    await expect(getActivePlanVersionId()).rejects.toBeInstanceOf(TrainingPlanReviewError);
  });
});
