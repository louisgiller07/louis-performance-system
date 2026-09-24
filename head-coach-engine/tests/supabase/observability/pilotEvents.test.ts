import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  recordPilotEvent,
  toPilotEventRow,
  boundWarnings,
  errorNameOf,
  PILOT_EVENTS_TABLE,
  MAX_WARNINGS,
  MAX_WARNING_LENGTH,
  type PilotEvent,
} from "../../../src/supabase/observability/pilotEvents.js";

const ATHLETE = "11111111-1111-4111-8111-111111111111";
const PLAN = "22222222-2222-4222-8222-222222222222";
const REQ = "33333333-3333-4333-8333-333333333333";
const DECISION = "44444444-4444-4444-8444-444444444444";
const SESSION = "55555555-5555-4555-8555-555555555555";
const COMPLETED = "66666666-6666-4666-8666-666666666666";

const FORBIDDEN_KEYS = [
  "authorization", "jwt", "accessToken", "refreshToken", "serviceKey", "password", "email", "profile",
  "requestBody", "checkin", "checkinText", "notes", "prescription", "dailyPlan", "message", "stack",
];

function allKeys(value: unknown): string[] {
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [k, ...allKeys(v)]);
}

function capturingClient(result: { error: { code?: string } | null } | Error) {
  const inserts: Array<{ table: string; row: unknown }> = [];
  const client = {
    from(table: string) {
      return {
        insert(row: unknown) {
          inserts.push({ table, row });
          if (result instanceof Error) throw result;
          return Promise.resolve(result);
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, inserts };
}

const EVENTS: PilotEvent[] = [
  { eventType: "plan_generation_succeeded", athleteId: ATHLETE, planVersionId: PLAN, generationRequestId: REQ, idempotentReplay: false, durationWeeks: 6 },
  { eventType: "plan_generation_blocked", athleteId: ATHLETE, generationRequestId: REQ, blockedReason: "missing_availability" },
  { eventType: "plan_generation_failed", athleteId: ATHLETE, generationRequestId: REQ, errorName: "Error", errorCode: "internal_error" },
  { eventType: "plan_acceptance_succeeded", athleteId: ATHLETE, planVersionId: PLAN, idempotentReplay: false, projectedSessionCount: 10, trainingBlockOutcome: "updated" },
  { eventType: "plan_acceptance_projection_warning", athleteId: ATHLETE, planVersionId: PLAN, warnings: ["w"] },
  { eventType: "plan_acceptance_failed", athleteId: ATHLETE, planVersionId: PLAN, errorName: "Error", errorCode: "plan_not_draft" },
  { eventType: "daily_run_succeeded", athleteId: ATHLETE, eventDate: "2026-09-24", decisionId: DECISION, decision: "KEEP", executablePrescriptionDelivered: true, generatedSessionId: SESSION },
  { eventType: "daily_run_warning", athleteId: ATHLETE, eventDate: "2026-09-24", decisionId: DECISION, warnings: ["w"] },
  { eventType: "daily_run_failed", athleteId: ATHLETE, eventDate: "2026-09-24", errorName: "NoCurrentCheckinError", errorCode: "no_checkin_for_date" },
  { eventType: "session_completion_succeeded", athleteId: ATHLETE, eventDate: "2026-09-24", completedSessionId: COMPLETED, decisionId: DECISION, completionStatus: "done" },
  { eventType: "session_completion_failed", athleteId: ATHLETE, eventDate: "2026-09-24", errorCode: "persistence_failed" },
];

afterEach(() => vi.restoreAllMocks());

describe("pilotEvents — row mapping", () => {
  it("success event -> exact row inserted into pilot_observability_events", async () => {
    const { client, inserts } = capturingClient({ error: null });
    await recordPilotEvent(client, EVENTS[0]!);

    expect(inserts).toEqual([
      {
        table: PILOT_EVENTS_TABLE,
        row: {
          event_type: "plan_generation_succeeded",
          severity: "info",
          athlete_id: ATHLETE,
          plan_version_id: PLAN,
          generation_request_id: REQ,
          event_date: null,
          decision_id: null,
          generated_session_id: null,
          completed_session_id: null,
          metadata: { idempotentReplay: false, durationWeeks: 6 },
        },
      },
    ]);
  });

  it("daily_run_succeeded carries decision/session ids and never an error severity", () => {
    expect(toPilotEventRow(EVENTS[6]!)).toMatchObject({
      severity: "info",
      event_date: "2026-09-24",
      decision_id: DECISION,
      generated_session_id: SESSION,
      metadata: { decision: "KEEP", executablePrescriptionDelivered: true },
    });
  });

  it.each(["REST", "MODIFY", "REPLACE"] as const)("%s -> daily_run_succeeded with severity info", (decision) => {
    const row = toPilotEventRow({ eventType: "daily_run_succeeded", athleteId: ATHLETE, eventDate: "2026-09-24", decisionId: DECISION, decision, executablePrescriptionDelivered: false });
    expect(row.event_type).toBe("daily_run_succeeded");
    expect(row.severity).toBe("info");
    expect(row.generated_session_id).toBeNull();
  });

  it("severity is fixed per event type: blocked/warnings -> warning, failed -> error", () => {
    const severities = Object.fromEntries(EVENTS.map((e) => [e.eventType, toPilotEventRow(e).severity]));
    expect(severities).toEqual({
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
    });
  });

  it("no row, for any of the 11 event types, contains a sensitive/business-payload key", () => {
    for (const event of EVENTS) {
      const keys = allKeys(toPilotEventRow(event));
      for (const forbidden of FORBIDDEN_KEYS) expect(keys).not.toContain(forbidden);
    }
  });

  it("extra properties smuggled onto an event never reach the row", () => {
    const smuggled = { ...EVENTS[9]!, notes: "free text", dailyPlan: { decision: "KEEP" }, email: "x@example.invalid" } as unknown as PilotEvent;
    const keys = allKeys(toPilotEventRow(smuggled));
    expect(keys).not.toContain("notes");
    expect(keys).not.toContain("dailyPlan");
    expect(keys).not.toContain("email");
  });

  it("plan_acceptance_succeeded omits projection fields when they are not available", () => {
    const row = toPilotEventRow({ eventType: "plan_acceptance_succeeded", athleteId: ATHLETE, planVersionId: PLAN, idempotentReplay: true });
    expect(row.metadata).toEqual({ idempotentReplay: true });
  });
});

describe("pilotEvents — warning bounds", () => {
  it(`keeps only the first ${MAX_WARNINGS} warnings`, () => {
    const warnings = ["w1", "w2", "w3", "w4", "w5", "w6", "w7"];
    expect(boundWarnings(warnings)).toEqual(["w1", "w2", "w3", "w4", "w5"]);
  });

  it(`truncates each warning to ${MAX_WARNING_LENGTH} characters`, () => {
    const [bounded] = boundWarnings(["x".repeat(1000)]);
    expect(bounded).toHaveLength(MAX_WARNING_LENGTH);
  });

  it("daily_run_warning and plan_acceptance_projection_warning store bounded warnings", () => {
    const many = Array.from({ length: 8 }, (_, i) => `${i}-${"y".repeat(400)}`);
    const daily = toPilotEventRow({ eventType: "daily_run_warning", athleteId: ATHLETE, eventDate: "2026-09-24", decisionId: DECISION, warnings: many });
    const accept = toPilotEventRow({ eventType: "plan_acceptance_projection_warning", athleteId: ATHLETE, planVersionId: PLAN, warnings: many });
    for (const row of [daily, accept]) {
      const stored = row.metadata.warnings as string[];
      expect(stored).toHaveLength(MAX_WARNINGS);
      expect(stored.every((w) => w.length === MAX_WARNING_LENGTH)).toBe(true);
    }
  });
});

describe("pilotEvents — best effort", () => {
  it("an insert that returns an error never throws, and logs only the event type + error code", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client } = capturingClient({ error: { code: "42501" } });

    await expect(recordPilotEvent(client, EVENTS[9]!)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toBe("pilot observability: session_completion_succeeded insert failed [42501]");
  });

  it("an insert that throws never throws, and logs only the event type + error name", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client } = capturingClient(new TypeError("fetch failed: secret-bearing detail"));

    await expect(recordPilotEvent(client, EVENTS[0]!)).resolves.toBeUndefined();
    expect(warn.mock.calls[0]![0]).toBe("pilot observability: plan_generation_succeeded insert threw [TypeError]");
    expect(String(warn.mock.calls[0]![0])).not.toContain("secret-bearing");
  });

  it("a client whose .from is not usable at all (e.g. a test double) never throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(recordPilotEvent({} as SupabaseClient, EVENTS[2]!)).resolves.toBeUndefined();
  });

  it("errorNameOf never exposes a message or stack", () => {
    expect(errorNameOf(new RangeError("contains a token abc.def.ghi"))).toBe("RangeError");
    expect(errorNameOf("plain string")).toBe("string");
  });
});
