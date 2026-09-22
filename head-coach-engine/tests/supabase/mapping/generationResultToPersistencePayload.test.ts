import { describe, expect, it } from "vitest";
import type { PlanInputSnapshot } from "planning-engine";
import { runGenerationEngine, type GenerationEngineInput } from "../../../src/generation/generationEngine.js";
import {
  generationResultToPersistencePayload,
  type VersionPersistenceContext,
} from "../../../src/supabase/mapping/generationResultToPersistencePayload.js";

function block(overrides: Partial<GenerationEngineInput["block"]> = {}): GenerationEngineInput["block"] {
  return {
    sequenceNumber: 1,
    name: "Test block",
    mode: "IN_SEASON",
    primaryFocus: "test",
    startDate: "2026-10-19",
    endDate: "2026-10-25",
    ...overrides,
  };
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

function versionContext(snapshot: PlanInputSnapshot, overrides: Partial<VersionPersistenceContext> = {}): VersionPersistenceContext {
  return {
    athleteId: "athlete-1",
    plannerVersion: "v1",
    rulesetVersion: "v1",
    prescriptionSchemaVersion: "v1",
    generationTrigger: "initial",
    rationale: "Initial development block.",
    inputSnapshot: snapshot,
    inputSnapshotSchemaVersion: "v1",
    inputSnapshotHash: "hash-1",
    ...overrides,
  };
}

function buildFixture() {
  const blockInput = block();
  const snapshot = planInputSnapshot();
  const result = runGenerationEngine({ block: blockInput, planInputSnapshot: snapshot });
  const context = versionContext(snapshot);
  return { blockInput, snapshot, result, context };
}

describe("generationResultToPersistencePayload — complete mapping", () => {
  it("a full GenerationEngineResult produces version, blocks, weeks, sessions, and plannedPrescriptions", () => {
    const { blockInput, result, context } = buildFixture();

    const payload = generationResultToPersistencePayload(result, blockInput, context);

    expect(payload.version).toBeDefined();
    expect(payload.blocks.length).toBeGreaterThan(0);
    expect(payload.weeks.length).toBeGreaterThan(0);
    expect(payload.sessions.length).toBeGreaterThan(0);
    expect(payload.plannedPrescriptions.length).toBeGreaterThan(0);
  });

  it("version carries every field the RPC requires, verbatim from context/result", () => {
    const { blockInput, result, context } = buildFixture();

    const payload = generationResultToPersistencePayload(result, blockInput, context);

    expect(payload.athleteId).toBe("athlete-1");
    expect(payload.generationRequestId).toBe(result.context.generationRequestId);
    expect(payload.version).toMatchObject({
      id: result.context.planVersionId,
      horizonStartDate: blockInput.startDate,
      horizonEndDate: blockInput.endDate,
      inputSnapshotSchemaVersion: "v1",
      inputSnapshotHash: "hash-1",
      plannerVersion: "v1",
      rulesetVersion: "v1",
      prescriptionSchemaVersion: "v1",
      generationTrigger: "initial",
      rationale: "Initial development block.",
    });
    expect(payload.version.inputSnapshot).toBe(context.inputSnapshot);
  });
});

describe("generationResultToPersistencePayload — id conservation", () => {
  it("preserves generatedPlanSessionId as sessions[].id", () => {
    const { blockInput, result, context } = buildFixture();
    const payload = generationResultToPersistencePayload(result, blockInput, context);

    const firstSession = result.weeks[0]!.sessions[0]!;
    const mappedSession = payload.sessions.find((s) => s.id === firstSession.generatedPlanSessionId);
    expect(mappedSession).toBeDefined();
  });

  it("preserves blockId across block and every week", () => {
    const { blockInput, result, context } = buildFixture();
    const payload = generationResultToPersistencePayload(result, blockInput, context);

    expect(payload.blocks[0]!.id).toBe(result.context.blockId);
    for (const week of payload.weeks) {
      expect(week.blockId).toBe(result.context.blockId);
    }
  });

  it("preserves weekId on every session belonging to that week", () => {
    const { blockInput, result, context } = buildFixture();
    const payload = generationResultToPersistencePayload(result, blockInput, context);

    for (const week of result.weeks) {
      for (const session of week.sessions) {
        const mapped = payload.sessions.find((s) => s.id === session.generatedPlanSessionId)!;
        expect(mapped.weekId).toBe(week.id);
      }
    }
  });

  it("preserves plannedPrescriptionId and its generatedPlanSessionId reference", () => {
    const { blockInput, result, context } = buildFixture();
    const payload = generationResultToPersistencePayload(result, blockInput, context);

    const prescribedSession = result.weeks.flatMap((w) => w.sessions).find((s) => s.prescription !== undefined)!;
    const mappedPrescription = payload.plannedPrescriptions.find((p) => p.id === prescribedSession.prescription!.prescription.id);

    expect(mappedPrescription).toBeDefined();
    expect(mappedPrescription!.generatedPlanSessionId).toBe(prescribedSession.generatedPlanSessionId);
  });
});

describe("generationResultToPersistencePayload — hierarchical relation", () => {
  it("version -> block -> week -> session -> prescription chains correctly by id", () => {
    const { blockInput, result, context } = buildFixture();
    const payload = generationResultToPersistencePayload(result, blockInput, context);

    expect(payload.blocks[0]!.id).toBe(result.context.blockId); // block belongs to (is minted alongside) the version

    for (const week of payload.weeks) {
      expect(week.blockId).toBe(payload.blocks[0]!.id); // week -> block

      const sessionsInWeek = payload.sessions.filter((s) => s.weekId === week.id); // session -> week
      expect(sessionsInWeek.length).toBeGreaterThan(0);

      for (const session of sessionsInWeek) {
        const prescription = payload.plannedPrescriptions.find((p) => p.generatedPlanSessionId === session.id);
        // prescription -> session, when one exists (asserted separately for the no-prescription case below)
        if (prescription !== undefined) {
          expect(prescription.generatedPlanSessionId).toBe(session.id);
        }
      }
    }
  });
});

describe("generationResultToPersistencePayload — session without a prescription", () => {
  it("an aerobic session is present in sessions[] but absent from plannedPrescriptions[]", () => {
    const { blockInput, result, context } = buildFixture();
    const payload = generationResultToPersistencePayload(result, blockInput, context);

    const aerobicDomainSession = result.weeks.flatMap((w) => w.sessions).find((s) => s.prescription === undefined)!;
    expect(aerobicDomainSession).toBeDefined();

    const mappedSession = payload.sessions.find((s) => s.id === aerobicDomainSession.generatedPlanSessionId);
    expect(mappedSession).toBeDefined();

    const mappedPrescription = payload.plannedPrescriptions.find((p) => p.generatedPlanSessionId === aerobicDomainSession.generatedPlanSessionId);
    expect(mappedPrescription).toBeUndefined();
  });
});

describe("generationResultToPersistencePayload — purity", () => {
  it("the same input produces an identical output on repeated calls", () => {
    const { blockInput, result, context } = buildFixture();

    const first = generationResultToPersistencePayload(result, blockInput, context);
    const second = generationResultToPersistencePayload(result, blockInput, context);

    expect(first).toEqual(second);
  });
});
