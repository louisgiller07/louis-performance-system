/**
 * Pure unit tests for supabase/functions/completed-session/apiErrors.ts —
 * proves the exact public shape of the persistence_readback_missing branch
 * without needing to trigger the underlying race via a real HTTP request
 * (which the public API surface has no deterministic way to force — see
 * docs/11_DECISION_LOG.md, M5_003 final review).
 */
import { describe, expect, it } from "vitest";
import { classifyHealthGuardRefusal, classifyMissingReadback, COMPLETED_SESSION_V2_EXISTS, COMPLETED_SESSION_V2_EXISTS_MESSAGE, COMPLETED_SESSION_V2_EXISTS_SQLSTATE, hasNonAbandonedExecution } from "../../../../supabase/functions/completed-session/apiErrors.js";

describe("classifyMissingReadback", () => {
  it("returns exactly 500 persistence_readback_missing", () => {
    expect(classifyMissingReadback()).toEqual({
      status: 500,
      code: "persistence_readback_missing",
      message: "The completed session was saved but could not be read back.",
    });
  });

  it("never includes any dynamic/internal detail — no athleteId, completed_session_id, SQL, or RPC error text", () => {
    const result = classifyMissingReadback();
    const serialized = JSON.stringify(result);
    const forbidden = ["athleteId", "athlete_id", "completed_session_id", "SELECT", "INSERT", "UPDATE", "postgres", "pg_", "rpc"];
    for (const token of forbidden) {
      expect(serialized.toLowerCase()).not.toContain(token.toLowerCase());
    }
  });

  it("takes no argument — nothing dynamic can be smuggled in by a future caller", () => {
    expect(classifyMissingReadback.length).toBe(0);
  });
});

describe("completed_session_v2_exists (UX-11R.9)", () => {
  it("stable public code and the guard's dedicated SQLSTATE", () => {
    expect(COMPLETED_SESSION_V2_EXISTS).toBe("completed_session_v2_exists");
    expect(COMPLETED_SESSION_V2_EXISTS_SQLSTATE).toBe("NX101");
    expect(COMPLETED_SESSION_V2_EXISTS_MESSAGE).not.toMatch(/NX101|sqlstate|athlete|execution_id/i);
  });
});

describe("hasNonAbandonedExecution (UX-11R.9 F-5b precheck rule)", () => {
  const ex = (...types: string[]) => ({ execution_events: types.map((event_type) => ({ event_type })) });
  it("open (started / paused / resumed) or completed → true", () => {
    expect(hasNonAbandonedExecution([ex("started")])).toBe(true);
    expect(hasNonAbandonedExecution([ex("started", "paused")])).toBe(true);
    expect(hasNonAbandonedExecution([ex("started", "paused", "resumed")])).toBe(true);
    expect(hasNonAbandonedExecution([ex("started", "completed")])).toBe(true);
    expect(hasNonAbandonedExecution([ex("started", "abandoned"), ex("started")])).toBe(true);
  });
  it("only abandoned executions, or none → false", () => {
    expect(hasNonAbandonedExecution([])).toBe(false);
    expect(hasNonAbandonedExecution([ex("started", "abandoned")])).toBe(false);
    expect(hasNonAbandonedExecution([ex("started", "paused", "abandoned"), ex("started", "abandoned")])).toBe(false);
  });
});

// INT-01 (HPM 2026-10-13) — the RPC health guard's SQLSTATEs are business refusals (409, stable code), never a 500.
describe("classifyHealthGuardRefusal", () => {
  it.each([
    ["NX102", "health_suspended"],
    ["NX103", "daily_decision_not_current"],
    ["NX104", "guided_results_exist"],
  ])("%s → 409 %s", (sqlstate, code) => {
    expect(classifyHealthGuardRefusal(sqlstate)).toMatchObject({ status: 409, code });
  });
  it("any other SQLSTATE (or none) stays an unexpected failure: null", () => {
    for (const sqlstate of [undefined, "NX101", "NX201", "23505", "P0001", "nx102"]) expect(classifyHealthGuardRefusal(sqlstate)).toBeNull();
  });
  it("messages carry no dynamic detail", () => {
    for (const sqlstate of ["NX102", "NX103", "NX104"]) expect(classifyHealthGuardRefusal(sqlstate)!.message).not.toMatch(/[0-9a-f]{8}-|select|athlete/i);
  });
});

