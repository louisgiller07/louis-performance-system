/**
 * Pilot observability events (PILOT_007/008) — best-effort, append-only rows in
 * `pilot_observability_events`. Observability only: never read by any planning,
 * prescription or coaching logic. Rows carry references (ids) and technical
 * codes, never business payloads (no check-in, health, prescription, plan or
 * user data). Each row is built field by field from a closed event union, so no
 * arbitrary request/error object can ever reach the table.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const PILOT_EVENTS_TABLE = "pilot_observability_events";
export const MAX_WARNINGS = 5;
export const MAX_WARNING_LENGTH = 300;
const MAX_CODE_LENGTH = 100;

export type PilotEventSeverity = "info" | "warning" | "error";
export type PilotDailyDecision = "KEEP" | "MODIFY" | "REPLACE" | "REST";

interface EventBase {
  athleteId: string;
}

export type PilotEvent =
  | (EventBase & {
      eventType: "plan_generation_succeeded";
      planVersionId: string;
      generationRequestId: string;
      idempotentReplay: boolean;
      durationWeeks: number;
    })
  | (EventBase & { eventType: "plan_generation_blocked"; generationRequestId: string; blockedReason: string })
  | (EventBase & { eventType: "plan_generation_failed"; generationRequestId: string; errorName: string; errorCode: string })
  | (EventBase & {
      eventType: "plan_acceptance_succeeded";
      planVersionId: string;
      idempotentReplay: boolean;
      projectedSessionCount?: number;
      trainingBlockOutcome?: string;
    })
  | (EventBase & { eventType: "plan_acceptance_projection_warning"; planVersionId: string; warnings: readonly string[] })
  | (EventBase & { eventType: "plan_acceptance_failed"; planVersionId: string; errorName: string; errorCode: string })
  | (EventBase & {
      eventType: "daily_run_succeeded";
      eventDate: string;
      decisionId: string;
      decision: PilotDailyDecision;
      executablePrescriptionDelivered: boolean;
      generatedSessionId?: string;
    })
  | (EventBase & { eventType: "daily_run_warning"; eventDate: string; decisionId: string; warnings: readonly string[] })
  | (EventBase & { eventType: "daily_run_failed"; eventDate: string; errorName: string; errorCode: string })
  | (EventBase & {
      eventType: "session_completion_succeeded";
      eventDate: string;
      completedSessionId: string;
      decisionId: string | null;
      completionStatus: string;
    })
  | (EventBase & { eventType: "session_completion_failed"; eventDate: string; errorCode: string });

export type PilotEventType = PilotEvent["eventType"];

// Severity is fixed per event type, never caller-supplied: MODIFY/REPLACE/REST
// are normal coaching outcomes (daily_run_succeeded -> info), never errors.
const SEVERITY: Record<PilotEventType, PilotEventSeverity> = {
  plan_generation_succeeded: "info",
  plan_generation_blocked: "warning",
  plan_generation_failed: "error",
  plan_acceptance_succeeded: "info",
  plan_acceptance_projection_warning: "warning",
  plan_acceptance_failed: "error",
  daily_run_succeeded: "info",
  daily_run_warning: "warning",
  daily_run_failed: "error",
  session_completion_succeeded: "info",
  session_completion_failed: "error",
};

export interface PilotEventRow {
  event_type: PilotEventType;
  severity: PilotEventSeverity;
  athlete_id: string;
  plan_version_id: string | null;
  generation_request_id: string | null;
  event_date: string | null;
  decision_id: string | null;
  generated_session_id: string | null;
  completed_session_id: string | null;
  metadata: Record<string, string | number | boolean | string[]>;
}

export function boundWarnings(warnings: readonly string[]): string[] {
  return warnings.slice(0, MAX_WARNINGS).map((warning) => warning.slice(0, MAX_WARNING_LENGTH));
}

function code(value: string): string {
  return value.slice(0, MAX_CODE_LENGTH);
}

/** Error name only — never the message, stack or the error object itself. */
export function errorNameOf(error: unknown): string {
  return code(error instanceof Error ? error.name : typeof error);
}

export function toPilotEventRow(event: PilotEvent): PilotEventRow {
  const row: PilotEventRow = {
    event_type: event.eventType,
    severity: SEVERITY[event.eventType],
    athlete_id: event.athleteId,
    plan_version_id: null,
    generation_request_id: null,
    event_date: null,
    decision_id: null,
    generated_session_id: null,
    completed_session_id: null,
    metadata: {},
  };

  switch (event.eventType) {
    case "plan_generation_succeeded":
      return {
        ...row,
        plan_version_id: event.planVersionId,
        generation_request_id: event.generationRequestId,
        metadata: { idempotentReplay: event.idempotentReplay, durationWeeks: event.durationWeeks },
      };
    case "plan_generation_blocked":
      return { ...row, generation_request_id: event.generationRequestId, metadata: { blockedReason: code(event.blockedReason) } };
    case "plan_generation_failed":
      return {
        ...row,
        generation_request_id: event.generationRequestId,
        metadata: { errorName: code(event.errorName), errorCode: code(event.errorCode) },
      };
    case "plan_acceptance_succeeded":
      return {
        ...row,
        plan_version_id: event.planVersionId,
        metadata: {
          idempotentReplay: event.idempotentReplay,
          ...(event.projectedSessionCount !== undefined ? { projectedSessionCount: event.projectedSessionCount } : {}),
          ...(event.trainingBlockOutcome !== undefined ? { trainingBlockOutcome: code(event.trainingBlockOutcome) } : {}),
        },
      };
    case "plan_acceptance_projection_warning":
      return { ...row, plan_version_id: event.planVersionId, metadata: { warnings: boundWarnings(event.warnings) } };
    case "plan_acceptance_failed":
      return {
        ...row,
        plan_version_id: event.planVersionId,
        metadata: { errorName: code(event.errorName), errorCode: code(event.errorCode) },
      };
    case "daily_run_succeeded":
      return {
        ...row,
        event_date: event.eventDate,
        decision_id: event.decisionId,
        generated_session_id: event.generatedSessionId ?? null,
        metadata: { decision: event.decision, executablePrescriptionDelivered: event.executablePrescriptionDelivered },
      };
    case "daily_run_warning":
      return { ...row, event_date: event.eventDate, decision_id: event.decisionId, metadata: { warnings: boundWarnings(event.warnings) } };
    case "daily_run_failed":
      return { ...row, event_date: event.eventDate, metadata: { errorName: code(event.errorName), errorCode: code(event.errorCode) } };
    case "session_completion_succeeded":
      return {
        ...row,
        event_date: event.eventDate,
        completed_session_id: event.completedSessionId,
        decision_id: event.decisionId,
        metadata: { completionStatus: code(event.completionStatus) },
      };
    case "session_completion_failed":
      return { ...row, event_date: event.eventDate, metadata: { errorCode: code(event.errorCode) } };
  }
}

/**
 * Best-effort: never throws, never changes the caller's result. On failure it
 * logs only the event type and the error code/name — no payload — and never
 * tries to record an event about the failed event.
 */
export async function recordPilotEvent(client: SupabaseClient, event: PilotEvent): Promise<void> {
  try {
    const { error } = await client.from(PILOT_EVENTS_TABLE).insert(toPilotEventRow(event));
    if (error) console.warn(`pilot observability: ${event.eventType} insert failed [${error.code ?? "unknown"}]`);
  } catch (err) {
    console.warn(`pilot observability: ${event.eventType} insert threw [${errorNameOf(err)}]`);
  }
}
