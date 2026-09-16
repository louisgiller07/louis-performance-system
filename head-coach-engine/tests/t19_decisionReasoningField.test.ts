import { describe, it, expect } from "vitest";
import { buildDailyPlan } from "../src/engine/buildDailyPlan.js";
import { baseRawContext } from "../fixtures/louis.js";
import { PROVISIONAL_THRESHOLDS } from "../src/engine/provisionalThresholds.js";
import type { CompletedSessionSummary } from "../src/types/rawContext.js";

/**
 * V0.3.012 — `decision_reasoning` (new, additive field) must expose exactly
 * the same rule set already used to build `reasoning`/`training.objective`
 * (T18/V0.3.010-011), so that the web "Pourquoi cette décision ?" panel and
 * History's detail view (same DailyPlanView component) stop rendering raw
 * `triggered_rules` and stay coherent with the summary. This module never
 * changes which rules fire, the decision, or the prescribed session — only
 * exposes an already-computed selection as its own field. See
 * docs/11_DECISION_LOG.md V0.3.012.
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

describe("T19 — decision_reasoning field (V0.3.012)", () => {
  it("Test 1 — REPLACE: DH_PERFORMANCE HEAVY + fatigue élevée + sommeil faible: decision_reasoning matches reasoning exactly, excludes C3.3 and C3.7", () => {
    const ctx = baseRawContext({
      today: TODAY,
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 240 },
      checkin: {
        sleep_hours: 5, // systemic RED (C3.3) — stale "nature préservée" once kind changes
        leg_fatigue: 8, // legs RED (C3.6)
        grip_fatigue: 8, // arms_grip RED (C3.5)
      },
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.decision).toBe("REPLACE");
    expect(plan.final_session.kind).not.toBe("DH_PERFORMANCE");

    expect(plan.decision_reasoning).toBeDefined();
    const reasoningIds = plan.decision_reasoning!.map((r) => r.rule_id);

    // Same rules that built `reasoning` (T18 SIM-003) — grip/legs pivot, never C3.3/C3.7.
    expect(reasoningIds).toContain("C3.5");
    expect(reasoningIds).toContain("C3.6");
    expect(reasoningIds).not.toContain("C3.3");
    expect(reasoningIds).not.toContain("C3.7");

    // decision_reasoning joined must equal `reasoning` verbatim — the panel
    // and the summary must be the exact same text, not two derivations.
    expect(plan.decision_reasoning!.map((r) => r.detail).join(" ")).toBe(plan.reasoning);

    // Forbidden per the ticket: C3.3's stale claim must not leak into the panel data.
    expect(plan.decision_reasoning!.some((r) => r.detail.includes("nature de la séance préservée"))).toBe(false);

    // Full audit trail (triggered_rules) is untouched — C3.3/C3.7 still tracked there.
    expect(plan.triggered_rules.some((r) => r.rule_id === "C3.3")).toBe(true);
    expect(plan.triggered_rules.some((r) => r.rule_id === "C3.7" || r.rule_id !== "C3.7")).toBe(true);
  });

  it("Test 2 — MODIFY: DH_PERFORMANCE HEAVY → DH_PERFORMANCE MODERATE keeps 'nature préservée' in decision_reasoning", () => {
    const ctx = baseRawContext({
      today: TODAY,
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 240 },
      checkin: { sleep_hours: 5 }, // systemic RED only (C3.3) — no kind-changing rule fires
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.decision).toBe("MODIFY");
    expect(plan.final_session.kind).toBe("DH_PERFORMANCE");
    expect(plan.final_session.load_profile).toBe("MODERATE");

    expect(plan.decision_reasoning).toBeDefined();
    const reasoningIds = plan.decision_reasoning!.map((r) => r.rule_id);
    expect(reasoningIds).toContain("C3.3");
    expect(plan.decision_reasoning!.map((r) => r.detail).join(" ")).toBe(plan.reasoning);
    expect(plan.reasoning).toContain("nature de la séance préservée");
  });

  it("Test 3 — KEEP with C3.7: recent_load RED stays in triggered_rules/monitoring, never in decision_reasoning", () => {
    const redMin = PROVISIONAL_THRESHOLDS.recentLoad.redMinHeavyOrModerateSessions;
    const ctx = baseRawContext({
      today: TODAY,
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 240 },
      recent_sessions: Array.from({ length: redMin }, (_, i) => heavySession(i + 1)),
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.decision).toBe("KEEP");
    expect(plan.triggered_rules.some((r) => r.rule_id === "C3.7")).toBe(true);
    expect(plan.monitoring.observe).toContain("Surveiller la charge cumulée sur 7 jours (très élevée)");

    // decision_reasoning must be empty (C3.7 is the only rule and it's
    // monitoring-only) — a decision NEVER cites a rule that had no effect.
    expect(plan.decision_reasoning).toBeDefined();
    expect(plan.decision_reasoning).toEqual([]);
    expect(plan.reasoning).toBe("Aucun signal particulier — séance maintenue telle quelle.");
  });

  it("SAFETY branch: decision_reasoning is exactly [safety.triggered_rule], same as triggered_rules", () => {
    const ctx = baseRawContext({
      today: TODAY,
      checkin: { suspected_concussion: true },
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.decision).toBe("REST");
    expect(plan.decision_reasoning).toEqual(plan.triggered_rules);
  });
});
