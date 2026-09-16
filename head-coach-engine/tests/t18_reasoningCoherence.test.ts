import { describe, it, expect } from "vitest";
import { buildDailyPlan } from "../src/engine/buildDailyPlan.js";
import { baseRawContext } from "../fixtures/louis.js";
import { PROVISIONAL_THRESHOLDS } from "../src/engine/provisionalThresholds.js";
import type { CompletedSessionSummary } from "../src/types/rawContext.js";

/**
 * V0.3.010 — SIM-002/SIM-003. `reasoning` (and `training.objective`, the
 * short athlete-facing message DailyPlanView renders next to the decision)
 * must explain the FINAL decision, never read as a raw concatenation of
 * every rule that fired along the way — including rules that never
 * affected the session (C3.7) or whose own claim was since contradicted by
 * a later rule in the same run (C3.3/MENTAL_RED's "nature préservée" when a
 * subsequent rule changed the kind anyway). `triggered_rules` (the full
 * audit trail) and `monitoring` are never touched by this — only the
 * human-facing joined strings. See docs/11_DECISION_LOG.md V0.3.010 for the
 * full root-cause analysis (10-day Simulation Lab review).
 */

const TODAY = "2026-08-24";

function heavySession(daysAgo: number): CompletedSessionSummary {
  const [y, m, d] = TODAY.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return {
    date: date.toISOString().slice(0, 10),
    intervention: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
    completion_status: "done",
  };
}

describe("T18 — reasoning/objective coherence (V0.3.010)", () => {
  it("SIM-002: recent_load RED (C3.7) never appears in reasoning/objective when the session is otherwise KEPT — stays in triggered_rules and monitoring", () => {
    const redMin = PROVISIONAL_THRESHOLDS.recentLoad.redMinHeavyOrModerateSessions;
    const ctx = baseRawContext({
      today: TODAY,
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 240 },
      recent_sessions: Array.from({ length: redMin }, (_, i) => heavySession(i + 1)),
      // Every other dimension stays GREEN (baseCheckin default) — nothing
      // else should fire, isolating C3.7's own effect.
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.decision).toBe("KEEP");
    expect(plan.final_session).toEqual({ kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 240 });

    // The bug: the message said "forte recommandation de récupération" next
    // to a decision that kept the heavy session as-is. C3.7 is the only
    // rule that fired here, so once excluded there is honestly nothing
    // left to show as `objective` — `undefined` (no message at all) is the
    // correct outcome, not a stale/misleading one.
    expect(plan.reasoning).not.toContain("récupération");
    expect(plan.training.objective).toBeUndefined();

    // Audit trail and monitoring are untouched — C3.7 still fired, still
    // tracked, still surfaced to the athlete via the correct channel.
    expect(plan.triggered_rules.some((r) => r.rule_id === "C3.7")).toBe(true);
    expect(plan.monitoring.observe).toContain("Surveiller la charge cumulée sur 7 jours (très élevée)");
  });

  it("SIM-003: C3.3's 'nature préservée' claim is dropped from reasoning once C3.5/C3.6 have actually changed the kind (REPLACE)", () => {
    const ctx = baseRawContext({
      today: TODAY,
      planned_session: { kind: "DH_TECHNICAL", load_profile: "HEAVY" },
      checkin: {
        sleep_hours: 5, // systemic RED (C3.3)
        leg_fatigue: 8, // legs RED (C3.6)
        grip_fatigue: 8, // arms_grip RED (C3.5)
      },
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.decision).toBe("REPLACE");
    expect(plan.final_session.kind).not.toBe("DH_TECHNICAL");

    // The bug: reasoning claimed "nature de la séance préservée" (C3.3's
    // own, now-stale claim) right next to a REPLACE that changed the kind.
    expect(plan.reasoning).not.toContain("nature de la séance préservée");

    // Still fully tracked in the audit trail.
    expect(plan.triggered_rules.some((r) => r.rule_id === "C3.3")).toBe(true);
    // The rule(s) that actually explain the kind change are still present.
    expect(plan.reasoning.length).toBeGreaterThan(0);
  });

  it("regression guard: C3.3's 'nature préservée' text still appears normally when nature genuinely IS preserved (same-kind MODIFY, no filter over-triggering)", () => {
    const ctx = baseRawContext({
      today: TODAY,
      planned_session: { kind: "STRENGTH_LOWER", load_profile: "HEAVY" },
      checkin: { sleep_hours: 5 }, // systemic RED only — no kind-changing rule fires
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.decision).toBe("MODIFY");
    expect(plan.final_session.kind).toBe("STRENGTH_LOWER");
    expect(plan.reasoning).toContain("nature de la séance préservée");
  });

  it("regression guard: MENTAL_RED's 'nature physique préservée' text still appears normally when no other rule changed the kind", () => {
    const ctx = baseRawContext({
      today: TODAY,
      planned_session: { kind: "AEROBIC_BASE", load_profile: "MODERATE" },
      checkin: { work_stress: 9 }, // mental RED (stress_high) only
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.final_session.kind).toBe("AEROBIC_BASE");
    expect(plan.reasoning).toContain("nature physique préservée");
  });
});
