/**
 * Docker-independent proof that calculateAndPersistOutcomes validates
 * observedThroughDate before any decision/horizon iteration, maturity
 * comparison, existing-outcome short circuit, or RPC activity — see the
 * fix recorded in docs/11_DECISION_LOG.md (M5_004, resume). A stub
 * Supabase client (never a real connection) whose `rpc` throws if called
 * is enough to prove the RPC path is never reached; no Docker/local
 * Supabase stack is needed for this file.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildTimeline } from "../../../src/timeline/buildTimeline.js";
import { calculateAndPersistOutcomes } from "../../../src/supabase/outcomeOrchestrator.js";
import { InvalidObservedThroughDateError } from "../../../src/calculators/index.js";
import { ATHLETE_A, decision, emptySources, resetIdSequence } from "../timeline/fixtures.js";

beforeEach(() => resetIdSequence());

/** Never expected to be called by these tests — throwing proves the code path was never reached. */
function neverCalledSupabaseAdmin(): SupabaseClient {
  return {
    rpc: () => {
      throw new Error("supabaseAdmin.rpc must never be invoked when observedThroughDate is invalid");
    },
  } as unknown as SupabaseClient;
}

describe("calculateAndPersistOutcomes — observedThroughDate validation", () => {
  it("throws InvalidObservedThroughDateError for a malformed date, before touching Supabase", async () => {
    // A mature decision that WOULD normally be attempted+persisted, to prove validation happens first.
    const d = decision({ decisionDate: "2020-01-01" });
    const timeline = buildTimeline({
      athleteId: ATHLETE_A,
      range: { fromDate: "2020-01-01", toDate: "2020-01-31" },
      sources: { ...emptySources(), decisions: [d] },
    });

    await expect(
      calculateAndPersistOutcomes({ supabaseAdmin: neverCalledSupabaseAdmin(), timeline, observedThroughDate: "not-a-date" })
    ).rejects.toThrow(InvalidObservedThroughDateError);
  });

  it("throws InvalidObservedThroughDateError for an impossible calendar date, before touching Supabase", async () => {
    const d = decision({ decisionDate: "2020-01-01" });
    const timeline = buildTimeline({
      athleteId: ATHLETE_A,
      range: { fromDate: "2020-01-01", toDate: "2020-01-31" },
      sources: { ...emptySources(), decisions: [d] },
    });

    await expect(
      calculateAndPersistOutcomes({ supabaseAdmin: neverCalledSupabaseAdmin(), timeline, observedThroughDate: "2026-02-30" })
    ).rejects.toThrow(InvalidObservedThroughDateError);
  });

  it("never reaches the calculator or the RPC when observedThroughDate is invalid, even with zero decisions", async () => {
    const timeline = buildTimeline({
      athleteId: ATHLETE_A,
      range: { fromDate: "2020-01-01", toDate: "2020-01-31" },
      sources: emptySources(),
    });

    await expect(
      calculateAndPersistOutcomes({ supabaseAdmin: neverCalledSupabaseAdmin(), timeline, observedThroughDate: "" })
    ).rejects.toThrow(InvalidObservedThroughDateError);
  });
});
