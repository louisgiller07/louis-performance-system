import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  acceptTrainingPlanVersion,
  type AcceptTrainingPlanVersionDeps,
} from "../../src/supabase/acceptTrainingPlanVersion.js";
import { AcceptTrainingPlanVersionRpcError, type AcceptTrainingPlanVersionResult } from "../../src/supabase/acceptTrainingPlanVersionRpc.js";
import type { ProjectionReport } from "../../src/supabase/projectTrainingPlan.js";

const FAKE_CLIENT = {} as SupabaseClient;
const ATHLETE_ID = "athlete-1";
const PLAN_VERSION_ID = "version-1";
const WINDOW_START = "2026-10-19";
const WINDOW_END = "2026-11-01";

const ACCEPT_SUCCESS: AcceptTrainingPlanVersionResult = {
  planVersionId: PLAN_VERSION_ID,
  idempotentReplay: false,
  acceptedTransitionId: "transition-1",
};

const PROJECTION_SUCCESS: ProjectionReport = {
  plannedSessions: [{ date: "2026-10-20", outcome: "projected" }],
  trainingBlock: { outcome: "updated" },
};

function buildDeps(overrides: {
  acceptResult?: AcceptTrainingPlanVersionResult;
  acceptError?: Error;
  projectionResult?: ProjectionReport;
  projectionError?: Error;
} = {}) {
  const acceptTrainingPlanVersionRpcMock = vi.fn(async () => {
    if (overrides.acceptError) throw overrides.acceptError;
    return overrides.acceptResult ?? ACCEPT_SUCCESS;
  });
  const projectTrainingPlanMock = vi.fn(async () => {
    if (overrides.projectionError) throw overrides.projectionError;
    return overrides.projectionResult ?? PROJECTION_SUCCESS;
  });

  const deps = {
    acceptTrainingPlanVersionRpc: acceptTrainingPlanVersionRpcMock,
    projectTrainingPlan: projectTrainingPlanMock,
  } as unknown as AcceptTrainingPlanVersionDeps;

  return { deps, acceptTrainingPlanVersionRpcMock, projectTrainingPlanMock };
}

describe("acceptTrainingPlanVersion — orchestration (mocked deps, no live DB)", () => {
  it("accept success triggers projection: projectTrainingPlan is called exactly once after acceptance resolves", async () => {
    const { deps, acceptTrainingPlanVersionRpcMock, projectTrainingPlanMock } = buildDeps();

    const outcome = await acceptTrainingPlanVersion(FAKE_CLIENT, ATHLETE_ID, PLAN_VERSION_ID, WINDOW_START, WINDOW_END, deps);

    expect(acceptTrainingPlanVersionRpcMock).toHaveBeenCalledTimes(1);
    expect(projectTrainingPlanMock).toHaveBeenCalledTimes(1);
    expect(outcome.acceptance).toEqual(ACCEPT_SUCCESS);
    expect(outcome.projection).toEqual(PROJECTION_SUCCESS);
    expect(outcome.warnings).toEqual([]);
  });

  it("projection failure does not fail acceptance: the function resolves (never rejects), acceptance is still reported, projection is undefined with a warning", async () => {
    const projectionError = new Error("project_training_plan RPC call failed: connection reset");
    const { deps } = buildDeps({ projectionError });

    const outcome = await acceptTrainingPlanVersion(FAKE_CLIENT, ATHLETE_ID, PLAN_VERSION_ID, WINDOW_START, WINDOW_END, deps);

    expect(outcome.acceptance).toEqual(ACCEPT_SUCCESS);
    expect(outcome.projection).toBeUndefined();
    expect(outcome.warnings).toHaveLength(1);
    expect(outcome.warnings[0]).toContain("connection reset");
  });

  it("accept failure does not trigger projection: the function rejects, projectTrainingPlan is never called", async () => {
    const acceptError = new AcceptTrainingPlanVersionRpcError("plan_version_id does not exist");
    const { deps, projectTrainingPlanMock } = buildDeps({ acceptError });

    await expect(acceptTrainingPlanVersion(FAKE_CLIENT, ATHLETE_ID, PLAN_VERSION_ID, WINDOW_START, WINDOW_END, deps)).rejects.toThrow(
      AcceptTrainingPlanVersionRpcError
    );
    expect(projectTrainingPlanMock).not.toHaveBeenCalled();
  });

  it("passes athlete id and window parameters through to projectTrainingPlan exactly as given", async () => {
    const { deps, projectTrainingPlanMock } = buildDeps();

    await acceptTrainingPlanVersion(FAKE_CLIENT, ATHLETE_ID, PLAN_VERSION_ID, WINDOW_START, WINDOW_END, deps);

    expect(projectTrainingPlanMock).toHaveBeenCalledWith(FAKE_CLIENT, ATHLETE_ID, WINDOW_START, WINDOW_END);
  });

  it("passes athlete id and plan version id through to the accept RPC exactly as given", async () => {
    const { deps, acceptTrainingPlanVersionRpcMock } = buildDeps();

    await acceptTrainingPlanVersion(FAKE_CLIENT, ATHLETE_ID, PLAN_VERSION_ID, WINDOW_START, WINDOW_END, deps);

    expect(acceptTrainingPlanVersionRpcMock).toHaveBeenCalledWith(FAKE_CLIENT, ATHLETE_ID, PLAN_VERSION_ID);
  });
});
