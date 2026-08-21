/** Minimal-but-complete builders for M5_002A source types, used only by the M5_002B timeline unit tests. Every field defaults to a neutral/null value; tests override only what they care about. */
import type {
  CompletedSessionSource,
  DailyCheckinSource,
  DecisionOutcomeSource,
  DecisionSource,
  HealthFlagSource,
} from "../../../src/types/sources.js";

export const ATHLETE_A = "athlete-a";
export const ATHLETE_B = "athlete-b";

let seq = 0;
/** Deterministic-within-a-test-run sequential id — never used for ordering assertions (real ordering is always driven by an explicit sortable field), only for uniqueness. */
export function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

export function resetIdSequence(): void {
  seq = 0;
}

export function checkin(overrides: Partial<DailyCheckinSource> = {}): DailyCheckinSource {
  return {
    id: nextId("checkin"),
    athleteId: ATHLETE_A,
    checkinDate: "2026-08-10",
    submittedAt: "2026-08-10T07:00:00.000Z",
    sleepHours: null,
    sleepQuality: null,
    sleepWakeUps: null,
    energy: null,
    legFatigue: null,
    gripFatigue: null,
    motivation: null,
    workStress: null,
    pain: false,
    painIntensity: null,
    painNew: null,
    painLocationCode: null,
    painTraumatic: null,
    painFunctionLoss: null,
    painGettingWorse: null,
    suspectedConcussion: false,
    feverOrIllness: false,
    freeComment: null,
    ...overrides,
  };
}

export function decision(overrides: Partial<DecisionSource> = {}): DecisionSource {
  return {
    id: nextId("decision"),
    athleteId: ATHLETE_A,
    decisionDate: "2026-08-10",
    computedAt: "2026-08-10T08:00:00.000Z",
    finalSession: "REST",
    plannedSessionBefore: null,
    activeMode: null,
    confidenceLevel: null,
    dailyPlan: null,
    engineVersion: "test",
    overriddenByUser: false,
    overrideReason: null,
    sourceCheckinId: null,
    ...overrides,
  };
}

export function completedSession(overrides: Partial<CompletedSessionSource> = {}): CompletedSessionSource {
  return {
    id: nextId("session"),
    athleteId: ATHLETE_A,
    sessionDate: "2026-08-10",
    decisionId: null,
    plannedSessionId: null,
    sessionType: "RECOVERY",
    completionStatus: "done",
    actualDurationMin: null,
    rpe: null,
    sessionLoad: null,
    intervention: null,
    mainContent: null,
    postLegFatigue: null,
    postGripFatigue: null,
    newPain: false,
    newPainNote: null,
    ...overrides,
  };
}

export function decisionOutcome(overrides: Partial<DecisionOutcomeSource> & { decisionId: string }): DecisionOutcomeSource {
  return {
    id: nextId("outcome"),
    athleteId: ATHLETE_A,
    horizon: "J_PLUS_1",
    calculatorId: "test_calculator",
    calculatorVersion: "v1",
    inputSnapshot: {},
    outcomeSignals: {},
    calculatedAt: "2026-08-11T00:00:00.000Z",
    createdAt: "2026-08-11T00:00:00.000Z",
    ...overrides,
  };
}

export function healthFlag(overrides: Partial<HealthFlagSource> = {}): HealthFlagSource {
  return {
    id: nextId("flag"),
    athleteId: ATHLETE_A,
    flagDate: "2026-08-10",
    flagType: "injury_suspect",
    status: "active",
    description: "test flag",
    bodyLocation: null,
    intensity: null,
    professionalConsulted: false,
    professionalType: null,
    resolvedAt: null,
    resolutionNote: null,
    sourceCheckinId: null,
    createdAt: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

export function emptySources() {
  return { checkins: [], decisions: [], completedSessions: [], outcomes: [], healthFlags: [] };
}
