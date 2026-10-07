// A07 — the effective session of a day: ONE read model shared by Today,
// Programme, History and the after-session block, so every screen tells the
// same story. Pure: built from rows the repository already reads.
//
// Precedence (highest first), consistent with UX-11R.9:
// 1. a V2 execution of the day — the completed one (authoritative even when a
//    newer decision exists: R9-UI-01), else the open one: the session is the
//    one of the execution's OWN decision (its final prescription is frozen);
// 2. the day's latest valid decision — REST is a rest day (never a missed
//    session); KEEP / MODIFY / REPLACE: its final session (on the V2 path the
//    persisted final session is the final prescription's effective session,
//    A07 server side);
// 3. the planned session, only when nothing adapted the day.
// A legacy debrief (completed_sessions) completes the day without changing
// which session it was; a legacy `skipped` marks a non-performed day.
import type { CompletedSessionRecord } from "../completedSession/completedSessionTypes";
import type { DailyPlan, TrainingIntervention } from "../dailyPlan/dailyPlanTypes";
import { isValidDailyPlan } from "../dailyPlan/dailyPlanValidation";
import type { DecisionHistoryRow } from "../history/historyTypes";

export interface EffectiveExecution {
  executionId: string;
  sessionDate: string;
  decisionId: string | null;
  finalPrescriptionId: string | null;
  startedAt: string;
  /** Lifecycle event types of the execution (any order). */
  events: readonly string[];
}

/** A planned session as each screen knows it (planned_sessions row, or the plan's generated session). */
export interface PlannedDaySession {
  date: string;
  session: TrainingIntervention;
}

export interface EffectiveSources {
  decisions: readonly DecisionHistoryRow[];
  executions: readonly EffectiveExecution[];
  legacy: readonly CompletedSessionRecord[];
  planned: readonly PlannedDaySession[];
}

export type EffectiveStatus =
  | "planned" // nothing decided yet: the plan
  | "decided" // a decision gives the day's session, not started
  | "rest" // the decision is REST
  | "in_progress" // a V2 execution is open
  | "completed" // a V2 execution completed, or a legacy debrief (not skipped)
  | "abandoned" // only abandoned V2 attempts
  | "skipped" // a legacy debrief says the session was skipped
  | "none"; // nothing planned, nothing decided

export type EffectiveSource = "execution" | "decision" | "planned" | "none";

export interface EffectiveDay {
  date: string;
  /** The session the day is about (REST for a rest decision); null when nothing exists for the day. */
  session: TrainingIntervention | null;
  status: EffectiveStatus;
  source: EffectiveSource;
  /** The Head Coach adaptation of a planned session (null: kept, unplanned or undecided). */
  adaptation: "MODIFY" | "REPLACE" | "REST" | null;
  /** What was initially planned (null when the day had no planned session). */
  planned: TrainingIntervention | null;
  /** The decision whose session this is (the execution's own, else the latest). */
  decisionId: string | null;
  executionId: string | null;
  finalPrescriptionId: string | null;
}

const TERMINAL = ["completed", "abandoned"];

function latestValidDecision(date: string, decisions: readonly DecisionHistoryRow[]): (DecisionHistoryRow & { dailyPlan: DailyPlan }) | null {
  const valid = decisions.filter((d) => d.decisionDate === date && isValidDailyPlan(d.dailyPlan)).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  return (valid[0] as (DecisionHistoryRow & { dailyPlan: DailyPlan }) | undefined) ?? null;
}

function adaptationOf(plan: DailyPlan): EffectiveDay["adaptation"] {
  if (plan.decision === "REST") return plan.planned_session_before ? "REST" : null;
  if (plan.planned_session_before === null || plan.decision === "KEEP") return null;
  return plan.decision;
}

export function effectiveDay(date: string, sources: EffectiveSources): EffectiveDay {
  const plannedRow = sources.planned.find((p) => p.date === date)?.session ?? null;
  const executions = sources.executions.filter((e) => e.sessionDate === date).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const completedExecution = executions.find((e) => e.events.includes("completed")) ?? null;
  const openExecution = executions.find((e) => !e.events.some((t) => TERMINAL.includes(t))) ?? null;
  const latest = latestValidDecision(date, sources.decisions);
  const legacyDone = sources.legacy.find((r) => r.session_date === date && r.completion_status !== "skipped") ?? null;
  const legacySkipped = sources.legacy.some((r) => r.session_date === date && r.completion_status === "skipped");

  // 1. A V2 execution: its own decision is the day's session.
  const execution = completedExecution ?? openExecution;
  if (execution) {
    const own = sources.decisions.find((d) => d.id === execution.decisionId && isValidDailyPlan(d.dailyPlan));
    const plan = (own?.dailyPlan as DailyPlan | undefined) ?? latest?.dailyPlan ?? null;
    return {
      date,
      session: plan?.final_session ?? plannedRow,
      status: completedExecution ? "completed" : "in_progress",
      source: "execution",
      adaptation: plan ? adaptationOf(plan) : null,
      planned: plan?.planned_session_before ?? plannedRow,
      decisionId: execution.decisionId,
      executionId: execution.executionId,
      finalPrescriptionId: execution.finalPrescriptionId,
    };
  }

  // 2. The latest decision.
  if (latest) {
    const plan = latest.dailyPlan;
    const rest = plan.decision === "REST";
    const status: EffectiveStatus = legacyDone ? "completed" : rest ? "rest" : executions.length > 0 ? "abandoned" : legacySkipped ? "skipped" : "decided";
    return {
      date,
      session: rest ? { kind: "REST" } : plan.final_session,
      status,
      source: "decision",
      adaptation: adaptationOf(plan),
      planned: plan.planned_session_before ?? plannedRow,
      decisionId: latest.id,
      executionId: executions[0]?.executionId ?? null,
      finalPrescriptionId: null,
    };
  }

  // 3. The plan.
  if (plannedRow) {
    return { date, session: plannedRow, status: legacyDone ? "completed" : legacySkipped ? "skipped" : "planned", source: "planned", adaptation: null, planned: plannedRow, decisionId: null, executionId: null, finalPrescriptionId: null };
  }
  return { date, session: null, status: legacyDone ? "completed" : "none", source: "none", adaptation: null, planned: null, decisionId: null, executionId: null, finalPrescriptionId: null };
}

export function effectiveDays(dates: readonly string[], sources: EffectiveSources): EffectiveDay[] {
  return dates.map((date) => effectiveDay(date, sources));
}

/** A day whose effective session is a training session (not a rest, not nothing). */
export function isTrainingDay(day: EffectiveDay): boolean {
  return day.session !== null && day.session.kind !== "REST";
}

/**
 * Week counters, one explicit rule: « prévues » = days whose EFFECTIVE session
 * is a training session (a REPLACE counts once, as its replacement; a REST
 * decision is not a planned session, so never a miss); « réalisées » = days
 * completed (a V2 execution or a legacy debrief).
 */
export function weekCounts(days: readonly EffectiveDay[]): { plannedCount: number; performedCount: number } {
  return { plannedCount: days.filter(isTrainingDay).length, performedCount: days.filter((d) => d.status === "completed").length };
}
