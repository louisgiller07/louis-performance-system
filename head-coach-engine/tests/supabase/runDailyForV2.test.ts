import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailyPlan, RawContext } from "../../src/types/index.js";
import { runDailyFor, type RunDailyForDeps } from "../../src/supabase/runDailyFor.js";
import type { PlannedSessionObservation } from "../../src/supabase/buildRawContext.js";
import { resolveDailyPrescriptionModel, UnsupportedPlanPrescriptionSchemaError } from "../../src/supabase/dailyV2/dailyPrescriptionModel.js";
import type { FinalPrescriptionV2Result } from "../../src/supabase/dailyV2/reconcileFinalPrescriptionV2.js";

// UX-11A.5c.3 — V2 daily path orchestration (mocked deps, no live DB). The
// real DB behaviour is in tests/supabase/v2DailyIntegration.integration.test.ts.

const ATHLETE_ID = "athlete-v2";
const TODAY = "2026-10-07";
const CLIENT = {} as SupabaseClient;

function dailyPlan(overrides: Partial<DailyPlan> = {}): DailyPlan {
  return {
    date: TODAY,
    active_mode: "UNSPECIFIED",
    training: { active: true, session_type: { kind: "STRENGTH_LOWER", load_profile: "MODERATE" } },
    dh_or_technical: { active: false },
    mental: { active: false },
    recovery: { active: false, actions: [] },
    nutrition: { active: false },
    sleep: { active: false },
    protection: { do_not_do: [] },
    monitoring: { observe: [] },
    reasoning: "M1 reasoning.",
    confidence: "MEDIUM",
    triggered_rules: [],
    planned_session_before: { kind: "STRENGTH_LOWER", load_profile: "MODERATE" },
    final_session: { kind: "STRENGTH_LOWER", load_profile: "MODERATE" },
    decision: "KEEP",
    overrode_race_protocol: false,
    engine_version: "v0.2",
    ...overrides,
  };
}

const OBSERVATION: PlannedSessionObservation = {
  id: "ps-1",
  date: TODAY,
  updatedAt: "2026-10-07T06:00:00Z",
  source: "generated",
  sourcePlanVersionId: "plan-v2",
  sourceGeneratedSessionId: "gen-1",
  plannedSession: { kind: "STRENGTH_LOWER", load_profile: "MODERATE", duration_min: 60 },
};

const CREATED: FinalPrescriptionV2Result = {
  status: "created",
  finalPrescription: {
    id: "fp-1",
    decisionId: "id-1",
    planVersionId: "plan-v2",
    plannedPrescriptionId: "pp-1",
    activeSessionOrigin: "generated",
    reconciliationAction: "keep",
    adaptationRuleIds: [],
    schemaVersion: "v2",
    catalogVersion: "session-model-v2.5",
    structure: { schemaVersion: "v2", catalog: { aggregate: "session-model-v2.5" }, blocks: [] } as never,
  },
};

function deps(plan: DailyPlan, reconciliation: FinalPrescriptionV2Result, model: Awaited<ReturnType<typeof resolveDailyPrescriptionModel>> = { model: "v2", planVersionId: "plan-v2" }) {
  const order: string[] = [];
  let n = 0;
  const d: RunDailyForDeps = {
    computeDailyFor: vi.fn(async () => {
      order.push("compute");
      return { rawContext: {} as RawContext, dailyPlan: plan, warnings: [], plannedSessionObservation: OBSERVATION };
    }),
    persistDailyRun: vi.fn(async () => {
      throw new Error("the V2 daily path must never call persist_daily_run");
    }),
    getAthleteCoachingContext: vi.fn(async () => ({ athlete_id: ATHLETE_ID })),
    projectTrainingPlan: vi.fn(),
    resolveTrainingPlanProjectionWindow: vi.fn(() => ({ enabled: false as const })),
    getProjectedGeneratedSessionIdForDate: vi.fn(async () => {
      throw new Error("the V2 daily path never re-reads planned_sessions for lineage");
    }),
    getPlannedPrescriptionForGeneratedSession: vi.fn(async () => {
      throw new Error("the V2 daily path never uses the legacy executable-prescription lookup");
    }),
    getDailyRunInputVersions: vi.fn(async () => ({ checkin: { id: "c-1", updated_at: "2026-10-07T06:00:00Z" }, plannedSession: { id: "ps-1", updated_at: "2026-10-07T06:00:00Z" } })),
    resolveDailyPrescriptionModel: vi.fn(async () => {
      order.push("model");
      return model;
    }),
    reconcileFinalPrescriptionV2: vi.fn(async () => {
      order.push("reconcile");
      return reconciliation;
    }),
    persistDailyRunV2: vi.fn(async (_c, _a, _h, row, outcome) => {
      order.push("persistV2");
      return { decision_id: row.id, health_flag_id: null, final_prescription_id: outcome.status === "created" ? "fp-1" : null, final_prescription_status: outcome.status };
    }),
    mintId: vi.fn(() => {
      order.push("mint");
      return `id-${++n}`;
    }),
  };
  return { d, order };
}

describe("runDailyFor — V2 daily path", () => {
  it("KEEP created: model before M1, ids minted after M1, reconciliation on the observation M1 consumed, ONE persist_daily_run_v2", async () => {
    const plan = dailyPlan();
    const { d, order } = deps(plan, CREATED);
    const result = await runDailyFor(CLIENT, ATHLETE_ID, TODAY, d);

    expect(order).toEqual(["model", "compute", "mint", "mint", "reconcile", "persistV2"]);
    expect(d.reconcileFinalPrescriptionV2).toHaveBeenCalledWith(
      expect.objectContaining({ currentPlanVersionId: "plan-v2", decisionId: "id-1", finalPrescriptionId: "id-2", dailyPlan: plan, observation: OBSERVATION })
    );
    const [, , , row, outcome] = vi.mocked(d.persistDailyRunV2).mock.calls[0]!;
    expect(row).toMatchObject({ id: "id-1", decision_date: TODAY, source_checkin_id: "c-1", source_planned_session_id: "ps-1" });
    expect(outcome).toMatchObject({ status: "created", final_prescription: { id: "fp-1", decision_id: "id-1", athlete_id: ATHLETE_ID, reconciliation_action: "keep" } });
    expect(d.persistDailyRunV2).toHaveBeenCalledTimes(1);
    expect(d.persistDailyRun).not.toHaveBeenCalled();
    expect(d.getProjectedGeneratedSessionIdForDate).not.toHaveBeenCalled();

    expect(result).toMatchObject({
      persistence: { decision_id: "id-1", health_flag_id: null },
      finalPrescriptionStatus: "created",
      finalPrescription: CREATED.status === "created" ? CREATED.finalPrescription : undefined,
      executablePrescription: null,
      executablePrescriptionStatus: "unsupported_schema_version",
    });
    expect(result.dailyPlan.decision).toBe("KEEP");
    expect(result).not.toHaveProperty("plannedSessionObservation");
  });

  it("REST → not_required, no final prescription in the response", async () => {
    const { d } = deps(dailyPlan({ decision: "REST", final_session: { kind: "REST" } }), { status: "none", reason: "rest" });
    const result = await runDailyFor(CLIENT, ATHLETE_ID, TODAY, d);
    expect(vi.mocked(d.persistDailyRunV2).mock.calls[0]![4]).toEqual({ status: "not_required" });
    expect(result.finalPrescriptionStatus).toBe("not_required");
    expect(result).not.toHaveProperty("finalPrescription");
    expect(result.executablePrescriptionStatus).toBe("none");
  });

  it.each<[string, DailyPlan["decision"], FinalPrescriptionV2Result]>([
    ["MODIFY", "MODIFY", { status: "blocked", code: "final_prescription_adaptation_not_defined", detail: { reason: "modify_not_supported" } }],
    ["REPLACE", "REPLACE", { status: "blocked", code: "final_prescription_adaptation_not_defined", detail: { reason: "replace_not_supported" } }],
    ["KEEP without lineage", "KEEP", { status: "blocked", code: "final_prescription_no_lineage", detail: { reason: "no_planned_session" } }],
  ])("%s → blocked, durable code and detail, M1 decision unchanged", async (_label, decision, reconciliation) => {
    const { d } = deps(dailyPlan({ decision }), reconciliation);
    const result = await runDailyFor(CLIENT, ATHLETE_ID, TODAY, d);
    const outcome = vi.mocked(d.persistDailyRunV2).mock.calls[0]![4];
    expect(outcome).toEqual({ status: "blocked", code: (reconciliation as { code: string }).code, detail: (reconciliation as { detail: object }).detail });
    expect(result.dailyPlan.decision).toBe(decision);
    expect(result).toMatchObject({ finalPrescriptionStatus: "blocked", finalPrescriptionStatusCode: (reconciliation as { code: string }).code });
    expect(result).not.toHaveProperty("finalPrescription");
  });

  it("personalization only changes reasoning, never the decision or the final prescription status", async () => {
    const { d } = deps(dailyPlan(), CREATED);
    vi.mocked(d.getAthleteCoachingContext).mockResolvedValue({ athlete_id: ATHLETE_ID, primary_goal: "race_performance" } as never);
    const result = await runDailyFor(CLIENT, ATHLETE_ID, TODAY, d);
    expect(result.dailyPlan.decision).toBe("KEEP");
    expect(result.finalPrescriptionStatus).toBe("created");
  });

  it("an unknown plan schema fails closed before M1: nothing computed, nothing written", async () => {
    const { d } = deps(dailyPlan(), CREATED);
    vi.mocked(d.resolveDailyPrescriptionModel).mockRejectedValue(new UnsupportedPlanPrescriptionSchemaError("plan-x", "v999"));
    await expect(runDailyFor(CLIENT, ATHLETE_ID, TODAY, d)).rejects.toThrow(UnsupportedPlanPrescriptionSchemaError);
    expect(d.computeDailyFor).not.toHaveBeenCalled();
    expect(d.persistDailyRunV2).not.toHaveBeenCalled();
    expect(d.persistDailyRun).not.toHaveBeenCalled();
  });
});

describe("resolveDailyPrescriptionModel — the current plan version decides", () => {
  it.each<[string, { plan_version_id: string; prescription_schema_version: string } | null, unknown]>([
    ["no current version → V1", null, { model: "v1", planVersionId: null }],
    ["v1 → V1", { plan_version_id: "p1", prescription_schema_version: "v1" }, { model: "v1", planVersionId: "p1" }],
    ["v2 → V2", { plan_version_id: "p2", prescription_schema_version: "v2" }, { model: "v2", planVersionId: "p2" }],
  ])("%s", async (_label, row, expected) => {
    expect(await resolveDailyPrescriptionModel(CLIENT, ATHLETE_ID, vi.fn(async () => row))).toEqual(expected);
  });

  it("any other schema → UnsupportedPlanPrescriptionSchemaError", async () => {
    await expect(resolveDailyPrescriptionModel(CLIENT, ATHLETE_ID, vi.fn(async () => ({ plan_version_id: "p", prescription_schema_version: "v999" })))).rejects.toThrow(
      UnsupportedPlanPrescriptionSchemaError
    );
  });
});

describe("boundaries of the V2 daily integration", () => {
  const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

  /** Runtime (non type-only) static imports reachable from a source file. */
  function staticRuntimeGraph(file: string, seen = new Set<string>(), bare = new Set<string>()): { seen: Set<string>; bare: Set<string> } {
    if (seen.has(file)) return { seen, bare };
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/^(import|export)\s(?!type\s)[^;]*?from\s+"([^"]+)";/gms)) {
      const spec = m[2]!;
      if (spec.startsWith(".")) staticRuntimeGraph(join(dirname(file), spec.replace(/\.js$/, ".ts")), seen, bare);
      else bare.add(spec);
    }
    return { seen, bare };
  }

  it("runDailyFor's static runtime graph has no bare import (the Deno daily-run Edge Function loads it directly); V2 reconciliation is lazy", () => {
    const { seen, bare } = staticRuntimeGraph(join(SRC, "supabase", "runDailyFor.ts"));
    expect(seen.size).toBeGreaterThan(20); // the walk really follows the graph
    expect([...seen].some((f) => f.endsWith("persistDailyRunV2.ts"))).toBe(true);
    expect([...bare]).toEqual([]);
    expect([...seen].some((f) => f.endsWith("reconcileFinalPrescriptionV2.ts"))).toBe(false);
  });

  it("the V2 reconciliation never reads planned_sessions (lineage comes from the observation M1 consumed)", () => {
    for (const f of ["reconcileFinalPrescriptionV2.ts", "finalPrescriptionOutcome.ts", "persistDailyRunV2.ts", "dailyPrescriptionModel.ts"]) {
      expect(readFileSync(join(SRC, "supabase", "dailyV2", f), "utf8"), f).not.toMatch(/planned_sessions"|getPlannedSessionFor|getProjectedGeneratedSessionIdForDate/);
    }
  });

  it("M1 core never imports the daily V2 integration nor the Session Model V2 module", () => {
    const m1Files = ["engine/buildDailyPlan.ts", "domains/training.ts", "rules/safety.ts", "types/index.ts", "mapping/trainingInterventionToDbSessionType.ts"];
    for (const f of m1Files) {
      const { seen, bare } = staticRuntimeGraph(join(SRC, f));
      expect([...bare].filter((b) => b.startsWith("planning-engine")), f).toEqual([]);
      expect([...seen].some((s) => s.includes("dailyV2")), f).toBe(false);
    }
  });
});
