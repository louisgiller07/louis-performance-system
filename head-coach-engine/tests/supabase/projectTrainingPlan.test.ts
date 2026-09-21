import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  mapGeneratedSessionToPlannedSessionCandidate,
  InvalidGeneratedSessionRowError,
} from "../../src/supabase/mapping/generatedSessionToPlannedSessionCandidate.js";
import type { GeneratedSessionRawRow } from "../../src/supabase/repositories/trainingPlanGeneratedSessionsRepo.js";
import type { CurrentGeneratedBlockRow } from "../../src/supabase/repositories/trainingPlanBlocksRepo.js";
import type { CurrentPlanVersionRow } from "../../src/supabase/repositories/trainingPlanCurrentVersionRepo.js";
import {
  projectTrainingPlan,
  NO_CURRENT_VERSION_REPORT,
  type ProjectTrainingPlanDeps,
} from "../../src/supabase/projectTrainingPlan.js";
import type { ProjectTrainingPlanResult } from "../../src/supabase/projectTrainingPlanRpc.js";

const FAKE_CLIENT = {} as SupabaseClient;
const ATHLETE_ID = "athlete-1";
const WINDOW_START = "2026-10-19";
const WINDOW_END = "2026-10-25";

function rawSession(overrides: Partial<GeneratedSessionRawRow> = {}): GeneratedSessionRawRow {
  return {
    id: "session-1",
    date: "2026-10-20",
    kind: "STRENGTH_LOWER",
    load_profile: "MODERATE",
    duration_min: 60,
    focus: null,
    ...overrides,
  };
}

describe("mapGeneratedSessionToPlannedSessionCandidate — pure mapping, no I/O", () => {
  it("maps a load-variable kind to an intervention carrying load_profile and the derived session_type", () => {
    const candidate = mapGeneratedSessionToPlannedSessionCandidate(rawSession());
    expect(candidate).toEqual({
      date: "2026-10-20",
      sessionType: "STRENGTH_A",
      intervention: { kind: "STRENGTH_LOWER", load_profile: "MODERATE", duration_min: 60 },
      sourceGeneratedSessionId: "session-1",
    });
  });

  it("maps a fixed-load kind to an intervention with no load_profile field at all", () => {
    const candidate = mapGeneratedSessionToPlannedSessionCandidate(
      rawSession({ kind: "REST", load_profile: null, duration_min: null })
    );
    expect(candidate.intervention).toEqual({ kind: "REST" });
    expect(candidate.sessionType).toBe("REST");
  });

  it("omits duration_min/focus from the intervention when the row carries null for them", () => {
    const candidate = mapGeneratedSessionToPlannedSessionCandidate(
      rawSession({ duration_min: null, focus: null })
    );
    expect(candidate.intervention).not.toHaveProperty("duration_min");
    expect(candidate.intervention).not.toHaveProperty("focus");
  });

  it("includes focus when the row carries one", () => {
    const candidate = mapGeneratedSessionToPlannedSessionCandidate(rawSession({ focus: "Braking technique" }));
    expect(candidate.intervention).toMatchObject({ focus: "Braking technique" });
  });

  it("throws InvalidGeneratedSessionRowError for a load-variable kind with a null load_profile — should be unreachable given the canonical CHECK constraint, but never silently coerced", () => {
    expect(() =>
      mapGeneratedSessionToPlannedSessionCandidate(rawSession({ kind: "STRENGTH_LOWER", load_profile: null }))
    ).toThrow(InvalidGeneratedSessionRowError);
  });

  it("derives the correct session_type per M1's frozen mapping for a representative spread of kinds", () => {
    expect(mapGeneratedSessionToPlannedSessionCandidate(rawSession({ kind: "DH_TECHNICAL", load_profile: "MODERATE" })).sessionType).toBe(
      "DH_TECHNICAL"
    );
    expect(
      mapGeneratedSessionToPlannedSessionCandidate(rawSession({ kind: "RACE_ACTIVITY", load_profile: null })).sessionType
    ).toBe("RACE_PREP");
    expect(
      mapGeneratedSessionToPlannedSessionCandidate(rawSession({ kind: "STRENGTH_UPPER", load_profile: "HEAVY" })).sessionType
    ).toBe("STRENGTH_A");
  });
});

function buildDeps(overrides: Partial<{
  currentVersion: CurrentPlanVersionRow | null;
  generatedSessions: GeneratedSessionRawRow[];
  currentBlock: CurrentGeneratedBlockRow | null;
  rpcResult: ProjectTrainingPlanResult;
}> = {}) {
  // `??` would be wrong here: an explicitly-passed `currentVersion: null`
  // must mean "no current version", not fall through to the default —
  // distinct from omitting the field entirely.
  const currentVersion: CurrentPlanVersionRow | null =
    overrides.currentVersion !== undefined ? overrides.currentVersion : { plan_version_id: "version-1" };
  const generatedSessions = overrides.generatedSessions ?? [];
  const currentBlock = overrides.currentBlock ?? null;
  const rpcResult: ProjectTrainingPlanResult = overrides.rpcResult ?? {
    plannedSessions: [],
    trainingBlock: { outcome: "no_candidate" },
  };

  const getCurrentPlanVersionMock = vi.fn(async () => currentVersion);
  const getGeneratedSessionsInWindowMock = vi.fn(async () => generatedSessions);
  const getCurrentGeneratedBlockMock = vi.fn(async () => currentBlock);
  const projectTrainingPlanRpcMock = vi.fn(async () => rpcResult);

  const deps = {
    getCurrentPlanVersion: getCurrentPlanVersionMock,
    getGeneratedSessionsInWindow: getGeneratedSessionsInWindowMock,
    getCurrentGeneratedBlock: getCurrentGeneratedBlockMock,
    projectTrainingPlanRpc: projectTrainingPlanRpcMock,
  } as unknown as ProjectTrainingPlanDeps;

  return {
    deps,
    getCurrentPlanVersionMock,
    getGeneratedSessionsInWindowMock,
    getCurrentGeneratedBlockMock,
    projectTrainingPlanRpcMock,
  };
}

describe("projectTrainingPlan — orchestration (mocked deps, no live DB)", () => {
  it("missing plan: returns NO_CURRENT_VERSION_REPORT and never calls the RPC or any other repository", async () => {
    const { deps, getGeneratedSessionsInWindowMock, getCurrentGeneratedBlockMock, projectTrainingPlanRpcMock } = buildDeps({
      currentVersion: null,
    });

    const report = await projectTrainingPlan(FAKE_CLIENT, ATHLETE_ID, WINDOW_START, WINDOW_END, deps);

    expect(report).toEqual(NO_CURRENT_VERSION_REPORT);
    expect(getGeneratedSessionsInWindowMock).not.toHaveBeenCalled();
    expect(getCurrentGeneratedBlockMock).not.toHaveBeenCalled();
    expect(projectTrainingPlanRpcMock).not.toHaveBeenCalled();
  });

  it("empty window: a resolved version with zero generated sessions and no current block still calls the RPC, with empty candidates and a null block candidate", async () => {
    const { deps, projectTrainingPlanRpcMock } = buildDeps({
      generatedSessions: [],
      currentBlock: null,
    });

    await projectTrainingPlan(FAKE_CLIENT, ATHLETE_ID, WINDOW_START, WINDOW_END, deps);

    expect(projectTrainingPlanRpcMock).toHaveBeenCalledTimes(1);
    expect(projectTrainingPlanRpcMock).toHaveBeenCalledWith(FAKE_CLIENT, ATHLETE_ID, "version-1", [], null);
  });

  it("block resolution: a resolved current block is translated into a TrainingBlockCandidate with the right field names", async () => {
    const { deps, projectTrainingPlanRpcMock } = buildDeps({
      currentBlock: {
        id: "block-1",
        name: "Development Block 1",
        mode: "IN_SEASON",
        primary_focus: "General development",
        start_date: "2026-10-19",
        end_date: "2026-11-15",
      },
    });

    await projectTrainingPlan(FAKE_CLIENT, ATHLETE_ID, WINDOW_START, WINDOW_END, deps);

    expect(projectTrainingPlanRpcMock).toHaveBeenCalledWith(
      FAKE_CLIENT,
      ATHLETE_ID,
      "version-1",
      [],
      {
        name: "Development Block 1",
        mode: "IN_SEASON",
        primaryFocus: "General development",
        startDate: "2026-10-19",
        endDate: "2026-11-15",
        sourcePlanBlockId: "block-1",
      }
    );
  });

  it("candidate creation: generated sessions in the window are mapped and forwarded to the RPC", async () => {
    const { deps, projectTrainingPlanRpcMock } = buildDeps({
      generatedSessions: [rawSession({ id: "s1", date: "2026-10-20" }), rawSession({ id: "s2", date: "2026-10-21", kind: "REST", load_profile: null })],
    });

    await projectTrainingPlan(FAKE_CLIENT, ATHLETE_ID, WINDOW_START, WINDOW_END, deps);

    const passedCandidates = projectTrainingPlanRpcMock.mock.calls[0]![3];
    expect(passedCandidates).toEqual([
      mapGeneratedSessionToPlannedSessionCandidate(rawSession({ id: "s1", date: "2026-10-20" })),
      mapGeneratedSessionToPlannedSessionCandidate(rawSession({ id: "s2", date: "2026-10-21", kind: "REST", load_profile: null })),
    ]);
  });

  it("resolves the current version exactly once, shared by both the session window read and the block read", async () => {
    const { deps, getCurrentPlanVersionMock, getGeneratedSessionsInWindowMock, getCurrentGeneratedBlockMock } = buildDeps();

    await projectTrainingPlan(FAKE_CLIENT, ATHLETE_ID, WINDOW_START, WINDOW_END, deps);

    expect(getCurrentPlanVersionMock).toHaveBeenCalledTimes(1);
    expect(getGeneratedSessionsInWindowMock).toHaveBeenCalledWith(FAKE_CLIENT, "version-1", WINDOW_START, WINDOW_END);
    expect(getCurrentGeneratedBlockMock).toHaveBeenCalledWith(FAKE_CLIENT, "version-1", WINDOW_START);
  });

  it("returns the RPC's report verbatim", async () => {
    const rpcResult: ProjectTrainingPlanResult = {
      plannedSessions: [{ date: "2026-10-20", outcome: "projected" }],
      trainingBlock: { outcome: "updated" },
    };
    const { deps } = buildDeps({ rpcResult });

    const report = await projectTrainingPlan(FAKE_CLIENT, ATHLETE_ID, WINDOW_START, WINDOW_END, deps);

    expect(report).toEqual(rpcResult);
  });
});
