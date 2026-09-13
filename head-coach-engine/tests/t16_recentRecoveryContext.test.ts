import { describe, it, expect } from "vitest";
import { buildDailyPlan } from "../src/engine/buildDailyPlan.js";
import { baseRawContext } from "../fixtures/louis.js";
import type { RecentRecoveryContext } from "../src/types/rawContext.js";
import type { DailyCheckin } from "../src/types/checkin.js";

/**
 * T16 — V0.3_008A, Previous-Day Recovery Continuity. Proves the pure-engine
 * side of the invariant: `recent_recovery_context` is a straight passthrough
 * from RawContext to DailyPlan, and its presence/absence/content NEVER
 * changes dimensions, SignalTrace consumption, session, or the final
 * decision — see docs/11_DECISION_LOG.md V0.3_008A for the architecture
 * decision this proves.
 */
const RECOVERY_CONTEXT: RecentRecoveryContext = {
  session_date: "2026-08-23",
  completion_status: "partial",
  change_reason: "fatigue_control",
  post_leg_fatigue: 7,
  post_grip_fatigue: 7,
};

describe("T16 — Previous-Day Recovery Continuity: passthrough", () => {
  it("present in RawContext -> present verbatim in DailyPlan", () => {
    const plan = buildDailyPlan(baseRawContext({ recent_recovery_context: RECOVERY_CONTEXT }));
    expect(plan.recent_recovery_context).toEqual(RECOVERY_CONTEXT);
  });

  it("absent from RawContext -> absent from DailyPlan, never fabricated", () => {
    const plan = buildDailyPlan(baseRawContext());
    expect(plan.recent_recovery_context).toBeUndefined();
    expect(plan).not.toHaveProperty("recent_recovery_context");
  });

  it("present even on the SAFETY REST early-return branch", () => {
    const plan = buildDailyPlan(
      baseRawContext({
        recent_recovery_context: RECOVERY_CONTEXT,
        checkin: { suspected_concussion: true },
      })
    );
    expect(plan.decision).toBe("REST");
    expect(plan.recent_recovery_context).toEqual(RECOVERY_CONTEXT);
  });

  it("SKIPPED D-1 context (post fatigue null) also passes through verbatim, never enriched/fabricated", () => {
    const skippedContext: RecentRecoveryContext = {
      session_date: "2026-08-23",
      completion_status: "skipped",
      change_reason: "fatigue_control",
      post_leg_fatigue: null,
      post_grip_fatigue: null,
    };
    const plan = buildDailyPlan(baseRawContext({ recent_recovery_context: skippedContext }));
    expect(plan.recent_recovery_context).toEqual(skippedContext);
  });
});

describe("T16 — no arbitration effect (§11/§35 acceptance)", () => {
  const scenarios: { name: string; checkin: Partial<DailyCheckin> }[] = [
    { name: "fresh morning", checkin: {} },
    { name: "moderate current morning fatigue", checkin: { leg_fatigue: 5, grip_fatigue: 5 } },
    { name: "high current morning fatigue (RED)", checkin: { leg_fatigue: 8, grip_fatigue: 8 } },
  ];

  it.each(scenarios)("$name — identical decision/kind/load/duration with vs without recovery context", ({ checkin }) => {
    const without = buildDailyPlan(baseRawContext({ checkin }));
    const withContext = buildDailyPlan(baseRawContext({ checkin, recent_recovery_context: RECOVERY_CONTEXT }));

    expect(withContext.decision).toBe(without.decision);
    expect(withContext.final_session).toEqual(without.final_session);
    expect(withContext.triggered_rules).toEqual(without.triggered_rules);
    expect(withContext.reasoning).toBe(without.reasoning);
    expect(withContext.dh_or_technical).toEqual(without.dh_or_technical);
    expect(withContext.training).toEqual(without.training);
    expect(withContext.monitoring).toEqual(without.monitoring);
    expect(withContext.protection).toEqual(without.protection);
    expect(withContext.confidence).toBe(without.confidence);

    // The ONLY field allowed to differ.
    expect(withContext.recent_recovery_context).toEqual(RECOVERY_CONTEXT);
    expect(without.recent_recovery_context).toBeUndefined();
  });

  it("recovery context never consumes a current-day SignalTrace key — legs/grip RED reactions still fire identically", () => {
    const highFatigueCheckin = { leg_fatigue: 8, grip_fatigue: 8 };
    const without = buildDailyPlan(baseRawContext({ checkin: highFatigueCheckin, planned_session: { kind: "DH_TECHNICAL", load_profile: "HEAVY" } }));
    const withContext = buildDailyPlan(
      baseRawContext({
        checkin: highFatigueCheckin,
        planned_session: { kind: "DH_TECHNICAL", load_profile: "HEAVY" },
        recent_recovery_context: RECOVERY_CONTEXT,
      })
    );

    // Both legs and grip are RED today -> C3.5/C3.6 already fire and pivot
    // DH_TECHNICAL -> DH_LIGHT regardless of yesterday's context.
    expect(without.final_session.kind).toBe("DH_LIGHT");
    expect(withContext.final_session.kind).toBe("DH_LIGHT");
    expect(withContext.triggered_rules.map((r) => r.rule_id)).toEqual(without.triggered_rules.map((r) => r.rule_id));
  });
});
