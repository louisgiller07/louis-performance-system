/**
 * Pure unit tests for supabase/functions/completed-session/apiErrors.ts —
 * proves the exact public shape of the persistence_readback_missing branch
 * without needing to trigger the underlying race via a real HTTP request
 * (which the public API surface has no deterministic way to force — see
 * docs/11_DECISION_LOG.md, M5_003 final review).
 */
import { describe, expect, it } from "vitest";
import { classifyMissingReadback } from "../../../../supabase/functions/completed-session/apiErrors.js";

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
