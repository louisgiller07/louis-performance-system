import type { DailyPlan } from "../dailyPlan/dailyPlanTypes";
import type { CheckinRow } from "../checkin/checkinTypes";
import type { CompletedSessionRecord, CompletionStatus } from "../completedSession/completedSessionTypes";
import type { DecisionHistoryRow } from "./historyTypes";

// UX-07 test fixtures. "Today" is Tue 2026-09-29; this week starts Mon 2026-09-28.
export const TODAY = "2026-09-29";

export const KEEP_PLAN: DailyPlan = {
  active_mode: "IN_SEASON",
  training: { active: true, session_type: { kind: "DH_TECHNICAL", load_profile: "MODERATE" } },
  dh_or_technical: { active: true },
  mental: { active: false },
  recovery: { active: false, actions: [] },
  nutrition: { active: false },
  sleep: { active: false },
  protection: { do_not_do: [] },
  monitoring: { observe: [] },
  reasoning: "Raisonnement du moteur.",
  confidence: "MEDIUM",
  triggered_rules: [],
  decision_reasoning: [],
  planned_session_before: { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 90 },
  final_session: { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 90 },
  decision: "KEEP",
  overrode_race_protocol: false,
  engine_version: "1.0.0",
};

export const MODIFY_PLAN: DailyPlan = {
  ...KEEP_PLAN,
  decision_reasoning: [{ layer: "C", rule_id: "X", detail: "détail", signals_used: ["leg_fatigue_high"] }],
  planned_session_before: { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 240 },
  final_session: { kind: "DH_TECHNICAL", load_profile: "LIGHT", duration_min: 150 },
  decision: "MODIFY",
};

export const SAFETY_REST_PLAN: DailyPlan = {
  ...KEEP_PLAN,
  training: { active: false },
  reasoning: "Douleur nouvelle et sévère déclarée. La récupération devient prioritaire.",
  triggered_rules: [{ layer: "A", rule_id: "A2", detail: "Douleur nouvelle et sévère déclarée.", signals_used: ["pain_new_severe"] }],
  decision_reasoning: [{ layer: "A", rule_id: "A2", detail: "Douleur nouvelle et sévère déclarée.", signals_used: ["pain_new_severe"] }],
  health_flag_to_create: { type: "injury_suspect", reason: "Douleur nouvelle" },
  planned_session_before: { kind: "AEROBIC_BASE", load_profile: "MODERATE", duration_min: 45 },
  final_session: { kind: "REST" },
  decision: "REST",
};

export const UNPLANNED_PLAN: DailyPlan = {
  ...KEEP_PLAN,
  planned_session_before: null,
  final_session: { kind: "RECOVERY_ACTIVE", duration_min: 45 },
};

export function decision(id: string, date: string, time: string, dailyPlan: unknown): DecisionHistoryRow {
  return { id, decisionDate: date, createdAt: `${date}T${time}:00Z`, finalSessionDb: "DH_TECHNICAL", activeModeDb: "IN_SEASON", confidenceLevelDb: "MEDIUM", dailyPlan };
}

export function checkin(date: string, overrides: Partial<CheckinRow> = {}): CheckinRow {
  return {
    checkin_date: date,
    sleep_hours: 7,
    sleep_quality: 6,
    sleep_wake_ups: 1,
    energy: 6,
    work_stress: 4,
    motivation: 7,
    leg_fatigue: 7,
    grip_fatigue: 3,
    pain: false,
    pain_intensity: null,
    pain_new: null,
    pain_traumatic: null,
    pain_function_loss: null,
    pain_getting_worse: null,
    suspected_concussion: false,
    fever_or_illness: false,
    free_comment: null,
    ...overrides,
  } as CheckinRow;
}

export function completed(date: string, status: CompletionStatus, actualDurationMin: number | null = 60): CompletedSessionRecord {
  return {
    id: `c-${date}`,
    session_date: date,
    decision_id: null,
    session_type: "DH_TECHNICAL",
    completion_status: status,
    actual_duration_min: actualDurationMin,
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

/** The journey of the test account: today unplanned, a re-evaluated safety day this week, an older kept day. */
export const JOURNEY_ROWS: DecisionHistoryRow[] = [
  decision("d-29", "2026-09-29", "07:10", UNPLANNED_PLAN),
  decision("d-28c", "2026-09-28", "20:42", SAFETY_REST_PLAN),
  decision("d-28b", "2026-09-28", "13:43", MODIFY_PLAN),
  decision("d-28a", "2026-09-28", "09:47", KEEP_PLAN),
  decision("d-24", "2026-09-24", "09:47", KEEP_PLAN),
];
