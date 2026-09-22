import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { globSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrchestratedWeek, PlanInputSnapshot, TrainingPlanBlock, WeekDoseSummary } from "planning-engine";
import * as planningEngineModule from "planning-engine";
import type { PrescriptionRequest, PrescriptionResult } from "prescription-engine";
import * as prescriptionEngineModule from "prescription-engine";
import { runGenerationEngine, type GenerationEngineInput } from "../src/generation/generationEngine.js";

type BlockInput = GenerationEngineInput["block"];

function block(overrides: Partial<BlockInput> = {}): BlockInput {
  const full: TrainingPlanBlock = {
    id: "unused-in-input",
    planVersionId: "unused-in-input",
    sequenceNumber: 1,
    name: "Test block",
    mode: "IN_SEASON",
    primaryFocus: "test",
    startDate: "2026-10-19",
    endDate: "2026-10-25",
  };
  const { id: _id, planVersionId: _planVersionId, ...withoutIdentity } = full;
  return { ...withoutIdentity, ...overrides };
}

function planInputSnapshot(overrides: Partial<PlanInputSnapshot> = {}): PlanInputSnapshot {
  return {
    discipline: "Downhill",
    competitionLevel: "Amateur racer",
    races: [],
    availability: {
      windows: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
        dayOfWeek: dayOfWeek as PlanInputSnapshot["availability"]["windows"][number]["dayOfWeek"],
        startTime: "16:00",
        endTime: "20:00",
      })),
      exceptions: [],
    },
    equipment: ["barbell", "squat_rack", "dumbbells", "bench", "pull_up_bar", "cable_machine", "resistance_bands"],
    terrainAccess: ["flow_trail", "bermed_trail", "technical_trail", "rock_garden", "root_rock_trail", "bike_park_jump_line", "full_dh_track"],
    strengthExperienceTier: "beginner",
    declaredLimitations: [],
    technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering"] },
    lockedDates: [],
    recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 300 },
    ...overrides,
  };
}

const DOSE_SUMMARY: WeekDoseSummary = {
  plannedStrengthSessionCount: 0,
  plannedDhTechnicalSessionCount: 0,
  plannedAerobicSessionCount: 0,
  plannedRestOrRecoveryDayCount: 7,
  totalPlannedMinutes: 0,
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runGenerationEngine — GenerationContext identities", () => {
  it("produces a planVersionId, generationRequestId, and blockId, each a distinct UUID", () => {
    const result = runGenerationEngine({ block: block(), planInputSnapshot: planInputSnapshot() });

    expect(result.context.planVersionId).toMatch(UUID_PATTERN);
    expect(result.context.generationRequestId).toMatch(UUID_PATTERN);
    expect(result.context.blockId).toMatch(UUID_PATTERN);
    expect(new Set([result.context.planVersionId, result.context.generationRequestId, result.context.blockId]).size).toBe(3);
  });

  it("reuses a caller-supplied generationRequestId instead of minting a new one (retry support, V0.4_144 §5)", () => {
    const result = runGenerationEngine({
      block: block(),
      planInputSnapshot: planInputSnapshot(),
      generationRequestId: "caller-supplied-request-id",
    });

    expect(result.context.generationRequestId).toBe("caller-supplied-request-id");
  });

  it("mints a fresh planVersionId/blockId on every call, even with the same generationRequestId", () => {
    const a = runGenerationEngine({ block: block(), planInputSnapshot: planInputSnapshot(), generationRequestId: "same-request-id" });
    const b = runGenerationEngine({ block: block(), planInputSnapshot: planInputSnapshot(), generationRequestId: "same-request-id" });

    expect(a.context.planVersionId).not.toBe(b.context.planVersionId);
    expect(a.context.blockId).not.toBe(b.context.blockId);
  });
});

describe("runGenerationEngine — week identities", () => {
  it("every week has a unique id and blockId matching the generation context", () => {
    const mockWeeks: OrchestratedWeek[] = [
      { weekNumber: 1, startDate: "2026-10-19", endDate: "2026-10-25", weekType: "development", rationale: "w1", doseSummary: DOSE_SUMMARY, relaxedConstraints: [], sessions: [] },
      { weekNumber: 2, startDate: "2026-10-26", endDate: "2026-11-01", weekType: "development", rationale: "w2", doseSummary: DOSE_SUMMARY, relaxedConstraints: [], sessions: [] },
    ];
    vi.spyOn(planningEngineModule, "runPlanningPipeline").mockReturnValue({ weeks: mockWeeks });

    const result = runGenerationEngine({ block: block(), planInputSnapshot: planInputSnapshot() });

    expect(result.weeks).toHaveLength(2);
    for (const week of result.weeks) {
      expect(week.id).toMatch(UUID_PATTERN);
      expect(week.blockId).toBe(result.context.blockId);
    }
    expect(result.weeks[0]!.id).not.toBe(result.weeks[1]!.id);
  });
});

describe("runGenerationEngine — session identities", () => {
  it("every session has a unique generatedPlanSessionId and a weekId matching the week it belongs to", () => {
    const mockWeeks: OrchestratedWeek[] = [
      {
        weekNumber: 1,
        startDate: "2026-10-19",
        endDate: "2026-10-25",
        weekType: "development",
        rationale: "w1",
        doseSummary: DOSE_SUMMARY,
        relaxedConstraints: [],
        sessions: [
          { date: "2026-10-19", domain: "aerobic", kind: "AEROBIC_BASE", durationMin: 45, doseTarget: { domain: "aerobic", intensityZone: "easy" }, rationale: "s1" },
          { date: "2026-10-20", domain: "aerobic", kind: "AEROBIC_BASE", durationMin: 45, doseTarget: { domain: "aerobic", intensityZone: "moderate" }, rationale: "s2" },
        ],
      },
    ];
    vi.spyOn(planningEngineModule, "runPlanningPipeline").mockReturnValue({ weeks: mockWeeks });

    const result = runGenerationEngine({ block: block(), planInputSnapshot: planInputSnapshot() });

    const week = result.weeks[0]!;
    expect(week.sessions).toHaveLength(2);
    for (const session of week.sessions) {
      expect(session.generatedPlanSessionId).toMatch(UUID_PATTERN);
      expect(session.weekId).toBe(week.id);
    }
    expect(week.sessions[0]!.generatedPlanSessionId).not.toBe(week.sessions[1]!.generatedPlanSessionId);
  });
});

describe("runGenerationEngine — prescription identities", () => {
  it("each prescribable session's plannedPrescriptionId is unique and references the correct session", () => {
    const result = runGenerationEngine({ block: block(), planInputSnapshot: planInputSnapshot() });

    const prescribedSessions = result.weeks.flatMap((w) => w.sessions).filter((s) => s.prescription !== undefined);
    expect(prescribedSessions.length).toBeGreaterThan(0);

    const plannedPrescriptionIds = prescribedSessions.map((s) => s.prescription!.prescription.id);
    expect(new Set(plannedPrescriptionIds).size).toBe(plannedPrescriptionIds.length); // all unique

    for (const session of prescribedSessions) {
      expect(session.prescription!.prescription.generatedPlanSessionId).toBe(session.generatedPlanSessionId);
    }
  });
});

describe("runGenerationEngine — no UUID generation in planning-engine or prescription-engine", () => {
  function sourceFilesOf(packageName: string): string[] {
    const srcDir = fileURLToPath(new URL(`../node_modules/${packageName}/dist`, import.meta.url));
    return globSync("**/*.js", { cwd: srcDir }).map((f) => `${srcDir}/${f}`);
  }

  it("planning-engine's built output never calls randomUUID/Math.random", () => {
    for (const file of sourceFilesOf("planning-engine")) {
      const code = readFileSync(file, "utf-8");
      expect(code, `${file} references randomUUID`).not.toMatch(/randomUUID\s*\(/);
      expect(code, `${file} references Math.random`).not.toContain("Math.random(");
    }
  });

  it("prescription-engine's built output never calls randomUUID/Math.random", () => {
    for (const file of sourceFilesOf("prescription-engine")) {
      const code = readFileSync(file, "utf-8");
      expect(code, `${file} references randomUUID`).not.toMatch(/randomUUID\s*\(/);
      expect(code, `${file} references Math.random`).not.toContain("Math.random(");
    }
  });
});

describe("runGenerationEngine — planning-engine -> head-coach-engine", () => {
  it("traverses every session across every week", () => {
    const mockWeeks: OrchestratedWeek[] = [
      {
        weekNumber: 1,
        startDate: "2026-10-19",
        endDate: "2026-10-25",
        weekType: "development",
        rationale: "week 1",
        doseSummary: DOSE_SUMMARY,
        relaxedConstraints: [],
        sessions: [
          { date: "2026-10-19", domain: "aerobic", kind: "AEROBIC_BASE", durationMin: 45, doseTarget: { domain: "aerobic", intensityZone: "easy" }, rationale: "s1" },
          { date: "2026-10-20", domain: "aerobic", kind: "AEROBIC_BASE", durationMin: 45, doseTarget: { domain: "aerobic", intensityZone: "moderate" }, rationale: "s2" },
        ],
      },
      {
        weekNumber: 2,
        startDate: "2026-10-26",
        endDate: "2026-11-01",
        weekType: "development",
        rationale: "week 2",
        doseSummary: DOSE_SUMMARY,
        relaxedConstraints: [],
        sessions: [
          { date: "2026-10-26", domain: "aerobic", kind: "AEROBIC_BASE", durationMin: 45, doseTarget: { domain: "aerobic", intensityZone: "easy" }, rationale: "s3" },
        ],
      },
    ];
    vi.spyOn(planningEngineModule, "runPlanningPipeline").mockReturnValue({ weeks: mockWeeks });

    const result = runGenerationEngine({ block: block(), planInputSnapshot: planInputSnapshot() });

    expect(result.weeks).toHaveLength(2);
    expect(result.weeks[0]!.sessions).toHaveLength(2);
    expect(result.weeks[1]!.sessions).toHaveLength(1);
  });

  it("forwards block content and planInputSnapshot fields to runPlanningPipeline, with minted id/planVersionId — never recomputes them", () => {
    const spy = vi.spyOn(planningEngineModule, "runPlanningPipeline").mockReturnValue({ weeks: [] });
    const blockInput = block({ startDate: "2026-11-02", endDate: "2026-11-08" });
    const snapshot = planInputSnapshot({ strengthExperienceTier: "advanced" });

    const result = runGenerationEngine({ block: blockInput, planInputSnapshot: snapshot });

    expect(spy).toHaveBeenCalledWith({
      block: { ...blockInput, id: result.context.blockId, planVersionId: result.context.planVersionId },
      races: snapshot.races,
      availability: snapshot.availability,
      terrainAccess: snapshot.terrainAccess,
      lockedDates: snapshot.lockedDates,
      strengthExperienceTier: "advanced",
      recentHistory: snapshot.recentHistory,
    });
  });
});

describe("runGenerationEngine — head-coach-engine -> prescription-engine", () => {
  it("calls prescriptionEngine once per strength/DH session, passing the exact minted generatedPlanSessionId", () => {
    const mockWeeks: OrchestratedWeek[] = [
      {
        weekNumber: 1,
        startDate: "2026-10-19",
        endDate: "2026-10-25",
        weekType: "development",
        rationale: "week 1",
        doseSummary: DOSE_SUMMARY,
        relaxedConstraints: [],
        sessions: [
          { date: "2026-10-19", domain: "strength", kind: "STRENGTH_LOWER", loadProfile: "MODERATE", durationMin: 60, doseTarget: { domain: "strength", setVolume: 12, targetRpeOrRir: 7 }, rationale: "strength" },
          { date: "2026-10-20", domain: "dh_technical", kind: "DH_TECHNICAL", durationMin: 90, doseTarget: { domain: "dh_technical", skillTargets: [], focusedRunsCount: 6 }, rationale: "dh" },
          { date: "2026-10-21", domain: "aerobic", kind: "AEROBIC_BASE", durationMin: 45, doseTarget: { domain: "aerobic", intensityZone: "easy" }, rationale: "aerobic" },
        ],
      },
    ];
    vi.spyOn(planningEngineModule, "runPlanningPipeline").mockReturnValue({ weeks: mockWeeks });

    const fakeResult: PrescriptionResult = {
      prescription: {
        id: "fake-planned-prescription-id",
        generatedPlanSessionId: "will-be-overwritten-by-assertion-check",
        schemaVersion: "v1",
        catalogVersion: "v1",
        structure: { domain: "strength", schemaVersion: "v1", blocks: [] },
      },
      relaxedConstraints: [],
    };
    const prescriptionSpy = vi.spyOn(prescriptionEngineModule, "prescriptionEngine").mockReturnValue(fakeResult);

    const result = runGenerationEngine({ block: block(), planInputSnapshot: planInputSnapshot() });

    expect(prescriptionSpy).toHaveBeenCalledTimes(2);

    const strengthSession = result.weeks[0]!.sessions.find((s) => s.kind === "STRENGTH_LOWER")!;
    const dhSession = result.weeks[0]!.sessions.find((s) => s.kind === "DH_TECHNICAL")!;
    const aerobicSession = result.weeks[0]!.sessions.find((s) => s.kind === "AEROBIC_BASE")!;

    const strengthRequest = prescriptionSpy.mock.calls.find((call) => (call[0] as PrescriptionRequest).kind === "STRENGTH_LOWER")![0] as PrescriptionRequest;
    const dhRequest = prescriptionSpy.mock.calls.find((call) => (call[0] as PrescriptionRequest).kind === "DH_TECHNICAL")![0] as PrescriptionRequest;

    expect(strengthRequest.generatedPlanSessionId).toBe(strengthSession.generatedPlanSessionId);
    expect(dhRequest.generatedPlanSessionId).toBe(dhSession.generatedPlanSessionId);
    expect(aerobicSession.prescription).toBeUndefined();
  });

  it("never calls prescriptionEngine when the plan has no prescribable session", () => {
    const mockWeeks: OrchestratedWeek[] = [
      { weekNumber: 1, startDate: "2026-10-19", endDate: "2026-10-25", weekType: "race", rationale: "race week", doseSummary: DOSE_SUMMARY, relaxedConstraints: [], sessions: [] },
    ];
    vi.spyOn(planningEngineModule, "runPlanningPipeline").mockReturnValue({ weeks: mockWeeks });
    const prescriptionSpy = vi.spyOn(prescriptionEngineModule, "prescriptionEngine");

    runGenerationEngine({ block: block(), planInputSnapshot: planInputSnapshot() });

    expect(prescriptionSpy).not.toHaveBeenCalled();
  });
});

describe("runGenerationEngine — final assembly, end to end with real engines", () => {
  it("produces an assembled session carrying date/kind/duration/dose/rationale", () => {
    const result = runGenerationEngine({ block: block(), planInputSnapshot: planInputSnapshot() });

    expect(result.weeks).toHaveLength(1);
    const week = result.weeks[0]!;
    expect(week.weekType).toBe("development");

    for (const session of week.sessions) {
      expect(session.date.length).toBeGreaterThan(0);
      expect(session.kind.length).toBeGreaterThan(0);
      expect(session.durationMin).toBeGreaterThan(0);
      expect(session.doseTarget).toBeDefined();
      expect(session.rationale.length).toBeGreaterThan(0);
      expect(session.generatedPlanSessionId).toMatch(UUID_PATTERN);
      expect(session.weekId).toBe(week.id);
    }
  });

  it("a PlannedPrescription correctly references the session it belongs to", () => {
    const result = runGenerationEngine({ block: block(), planInputSnapshot: planInputSnapshot() });

    const strengthSession = result.weeks[0]!.sessions.find((s) => s.kind === "STRENGTH_LOWER" || s.kind === "STRENGTH_UPPER");
    expect(strengthSession).toBeDefined();
    expect(strengthSession!.prescription).toBeDefined();
    expect(strengthSession!.prescription!.prescription.generatedPlanSessionId).toBe(strengthSession!.generatedPlanSessionId);
    expect(strengthSession!.prescription!.prescription.id).not.toBe(strengthSession!.generatedPlanSessionId);

    const aerobicSession = result.weeks[0]!.sessions.find((s) => s.kind === "AEROBIC_BASE");
    expect(aerobicSession).toBeDefined();
    expect(aerobicSession!.prescription).toBeUndefined();
  });
});
