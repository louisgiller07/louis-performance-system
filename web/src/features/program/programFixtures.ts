import type { TrainingPlanReview, TrainingPlanReviewSession } from "../trainingPlanReview/trainingPlanReviewTypes";
import type { CompletedSessionRecord, CompletionStatus } from "../completedSession/completedSessionTypes";
import type { DailyPlan } from "../dailyPlan/dailyPlanTypes";

// UX-06 test fixtures. Plan: Mon 2026-10-19 → Sun 2026-11-01, two weeks
// (development, then taper). "Today" in the tests is Thu 2026-10-22.

export const TODAY = "2026-10-22";

export function session(date: string, overrides: Partial<TrainingPlanReviewSession> = {}): TrainingPlanReviewSession {
  return {
    id: `s-${date}`,
    weekId: date <= "2026-10-25" ? "week-1" : "week-2",
    date,
    kind: "DH_TECHNICAL",
    loadProfile: "MODERATE",
    durationMin: 90,
    doseTarget: null,
    rationale: "Standard development week.",
    prescription: null,
    ...overrides,
  };
}

export function drill(drillId: string): TrainingPlanReviewSession["prescription"] {
  return { id: "p-1", generatedPlanSessionId: "s-1", structure: { domain: "dh_technical", drills: [{ drillId }] } };
}

export function exercise(exerciseId: string): TrainingPlanReviewSession["prescription"] {
  return { id: "p-2", generatedPlanSessionId: "s-2", structure: { domain: "strength", blocks: [{ exerciseId }] } };
}

const DOSE = {
  plannedStrengthSessionCount: 1,
  plannedDhTechnicalSessionCount: 1,
  plannedAerobicSessionCount: 0,
  plannedRestOrRecoveryDayCount: 0,
  totalPlannedMinutes: 180,
};

export function plan(sessions: TrainingPlanReviewSession[], overrides: Partial<TrainingPlanReview> = {}): TrainingPlanReview {
  return {
    version: {
      id: "version-1",
      horizonStartDate: "2026-10-19",
      horizonEndDate: "2026-11-01",
      generationTrigger: "initial",
      rationale: "Initial training plan generation.",
      relaxedConstraints: [],
      generatedAt: "2026-09-28T10:00:00Z",
    },
    lifecycleState: "accepted",
    blocks: [
      {
        id: "block-1",
        sequenceNumber: 1,
        name: "Block",
        mode: "IN_SEASON",
        primaryFocus: "base",
        startDate: "2026-10-19",
        endDate: "2026-11-01",
        weeks: [
          {
            id: "week-1",
            blockId: "block-1",
            weekNumber: 1,
            startDate: "2026-10-19",
            endDate: "2026-10-25",
            weekType: "development",
            rationale: "Standard development week.",
            doseSummary: DOSE,
            sessions: sessions.filter((s) => s.date <= "2026-10-25"),
          },
          {
            id: "week-2",
            blockId: "block-1",
            weekNumber: 2,
            startDate: "2026-10-26",
            endDate: "2026-11-01",
            weekType: "taper",
            rationale: "Taper week before race.",
            doseSummary: DOSE,
            sessions: sessions.filter((s) => s.date > "2026-10-25"),
          },
        ],
      },
    ],
    ...overrides,
  };
}

export function completed(date: string, status: CompletionStatus): CompletedSessionRecord {
  return {
    id: `c-${date}-${status}`,
    session_date: date,
    decision_id: null,
    session_type: "DH_TECHNICAL",
    completion_status: status,
    actual_duration_min: 60,
    rpe: null,
    post_leg_fatigue: null,
    post_grip_fatigue: null,
    new_pain: false,
    new_pain_note: null,
    intervention: null,
    main_content: null,
    session_load: null,
  } as CompletedSessionRecord;
}

export const DECISION: DailyPlan = {
  active_mode: "IN_SEASON",
  training: { active: true, session_type: { kind: "DH_TECHNICAL", load_profile: "LIGHT" } },
  dh_or_technical: { active: true },
  mental: { active: false },
  recovery: { active: false, actions: [] },
  nutrition: { active: false },
  sleep: { active: false },
  protection: { do_not_do: [] },
  monitoring: { observe: [] },
  reasoning: "Raisonnement du moteur.",
  confidence: "HIGH",
  triggered_rules: [],
  decision_reasoning: [{ layer: "C", rule_id: "X", detail: "détail", signals_used: ["leg_fatigue_high"] }],
  planned_session_before: { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 90 },
  final_session: { kind: "DH_TECHNICAL", load_profile: "LIGHT", duration_min: 60 },
  decision: "MODIFY",
  overrode_race_protocol: false,
  engine_version: "1.0.0",
};
