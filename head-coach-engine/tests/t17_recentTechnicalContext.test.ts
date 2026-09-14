import { describe, it, expect } from "vitest";
import { buildDailyPlan } from "../src/engine/buildDailyPlan.js";
import { baseRawContext } from "../fixtures/louis.js";
import type { RecentTechnicalContext } from "../src/types/rawContext.js";
import type { DailyCheckin } from "../src/types/checkin.js";

/**
 * T17 — V0.3_008B, Technical Continuity V1. Proves the pure-engine side of
 * the architecture lock (docs/11_DECISION_LOG.md V0.3_008B):
 * `RawContext.recent_technical_context` (what the engine knows) is
 * surfaced as `DailyPlan.dh_or_technical.prior_task_reference` (what
 * today's coach actually surfaced) ONLY when today's final session is
 * itself DH-family, `age_days` is never persisted, and presence/absence
 * NEVER changes dimensions, SignalTrace consumption, session, decision, or
 * today's own `execution_task` — DISPLAY ONLY, exactly like
 * `recent_recovery_context` (T16) before it.
 */
const TECHNICAL_CONTEXT: RecentTechnicalContext = {
  source_decision_id: "11111111-1111-1111-1111-111111111111",
  session_date: "2026-08-20",
  kind: "DH_TECHNICAL",
  execution_task: "Choisis une section technique courte et travaille un seul point à la fois...",
  technical_outcome: "partial",
  age_days: 4,
};

const DH_TECHNICAL_SESSION = { kind: "DH_TECHNICAL" as const, load_profile: "MODERATE" as const };

describe("T17 — Technical Continuity: knowledge vs surfaced coaching gating", () => {
  it("present in RawContext + today DH-family -> surfaced verbatim minus age_days", () => {
    const plan = buildDailyPlan(
      baseRawContext({ planned_session: DH_TECHNICAL_SESSION, recent_technical_context: TECHNICAL_CONTEXT })
    );
    expect(plan.dh_or_technical.active).toBe(true);
    expect(plan.dh_or_technical.prior_task_reference).toEqual({
      source_decision_id: TECHNICAL_CONTEXT.source_decision_id,
      session_date: TECHNICAL_CONTEXT.session_date,
      kind: TECHNICAL_CONTEXT.kind,
      execution_task: TECHNICAL_CONTEXT.execution_task,
      technical_outcome: TECHNICAL_CONTEXT.technical_outcome,
    });
  });

  it("age_days is never persisted into prior_task_reference", () => {
    const plan = buildDailyPlan(
      baseRawContext({ planned_session: DH_TECHNICAL_SESSION, recent_technical_context: TECHNICAL_CONTEXT })
    );
    expect(plan.dh_or_technical.prior_task_reference).not.toHaveProperty("age_days");
  });

  it("absent from RawContext -> absent from DailyPlan, never fabricated", () => {
    const plan = buildDailyPlan(baseRawContext({ planned_session: DH_TECHNICAL_SESSION }));
    expect(plan.dh_or_technical.active).toBe(true);
    expect(plan.dh_or_technical.prior_task_reference).toBeUndefined();
    expect(plan.dh_or_technical).not.toHaveProperty("prior_task_reference");
  });

  it("present in RawContext but today's final session is NOT DH-family -> absent (knowledge vs surfaced coaching)", () => {
    const plan = buildDailyPlan(
      baseRawContext({ planned_session: { kind: "AEROBIC_BASE", load_profile: "MODERATE" }, recent_technical_context: TECHNICAL_CONTEXT })
    );
    expect(plan.dh_or_technical.active).toBe(false);
    expect(plan.dh_or_technical).not.toHaveProperty("prior_task_reference");
  });

  it("present in RawContext but final session is REST -> absent", () => {
    const plan = buildDailyPlan(baseRawContext({ planned_session: { kind: "REST" }, recent_technical_context: TECHNICAL_CONTEXT }));
    expect(plan.dh_or_technical.active).toBe(false);
    expect(plan.dh_or_technical).not.toHaveProperty("prior_task_reference");
  });

  it("present in RawContext but Safety REST early-return fires -> absent, Safety output otherwise unchanged", () => {
    const plan = buildDailyPlan(
      baseRawContext({
        planned_session: DH_TECHNICAL_SESSION,
        recent_technical_context: TECHNICAL_CONTEXT,
        checkin: { suspected_concussion: true },
      })
    );
    expect(plan.decision).toBe("REST");
    expect(plan.dh_or_technical).toEqual({ active: false });
  });

  it("cross-kind V1: a prior DH_TECHNICAL fact surfaces even when today's final session is DH_PERFORMANCE — no semantic matching claim", () => {
    const plan = buildDailyPlan(
      baseRawContext({
        planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
        recent_technical_context: TECHNICAL_CONTEXT, // TECHNICAL_CONTEXT.kind === "DH_TECHNICAL"
      })
    );
    expect(plan.dh_or_technical.active).toBe(true);
    expect(plan.dh_or_technical.prior_task_reference?.kind).toBe("DH_TECHNICAL");
  });

  it("Pumptrack as the historical source kind surfaces identically to any other DH-family kind", () => {
    const pumptrackContext: RecentTechnicalContext = { ...TECHNICAL_CONTEXT, kind: "PUMPTRACK" };
    const plan = buildDailyPlan(baseRawContext({ planned_session: DH_TECHNICAL_SESSION, recent_technical_context: pumptrackContext }));
    expect(plan.dh_or_technical.prior_task_reference?.kind).toBe("PUMPTRACK");
  });

  it.each(["yes", "partial", "no"] as const)("technical_outcome=%s passes through verbatim", (outcome) => {
    const context: RecentTechnicalContext = { ...TECHNICAL_CONTEXT, technical_outcome: outcome };
    const plan = buildDailyPlan(baseRawContext({ planned_session: DH_TECHNICAL_SESSION, recent_technical_context: context }));
    expect(plan.dh_or_technical.prior_task_reference?.technical_outcome).toBe(outcome);
  });
});

describe("T17 — no arbitration effect, no current-day task effect (acceptance)", () => {
  const scenarios: { name: string; checkin: Partial<DailyCheckin> }[] = [
    { name: "fresh morning", checkin: {} },
    { name: "moderate current morning fatigue", checkin: { leg_fatigue: 5, grip_fatigue: 5 } },
    { name: "high current morning fatigue (RED)", checkin: { leg_fatigue: 8, grip_fatigue: 8 } },
  ];

  it.each(scenarios)(
    "$name — identical decision/kind/load/duration/today execution_task/triggered_rules/reasoning with vs without technical context",
    ({ checkin }) => {
      const without = buildDailyPlan(baseRawContext({ planned_session: DH_TECHNICAL_SESSION, checkin }));
      const withContext = buildDailyPlan(
        baseRawContext({ planned_session: DH_TECHNICAL_SESSION, checkin, recent_technical_context: TECHNICAL_CONTEXT })
      );

      expect(withContext.decision).toBe(without.decision);
      expect(withContext.final_session).toEqual(without.final_session);
      expect(withContext.triggered_rules).toEqual(without.triggered_rules);
      expect(withContext.reasoning).toBe(without.reasoning);
      expect(withContext.confidence).toBe(without.confidence);
      expect(withContext.training).toEqual(without.training);
      expect(withContext.monitoring).toEqual(without.monitoring);
      expect(withContext.protection).toEqual(without.protection);
      expect(withContext.mental).toEqual(without.mental);
      expect(withContext.nutrition).toEqual(without.nutrition);

      // today's own focus/execution_task/load_guidance/spot_hint are
      // identical — only prior_task_reference is allowed to differ.
      expect(withContext.dh_or_technical.focus).toEqual(without.dh_or_technical.focus);
      expect(withContext.dh_or_technical.execution_task).toEqual(without.dh_or_technical.execution_task);
      expect(withContext.dh_or_technical.load_guidance).toEqual(without.dh_or_technical.load_guidance);
      expect(withContext.dh_or_technical.spot_hint).toEqual(without.dh_or_technical.spot_hint);

      // The ONLY field allowed to differ.
      expect(withContext.dh_or_technical.prior_task_reference).toBeDefined();
      expect(without.dh_or_technical.prior_task_reference).toBeUndefined();
    }
  );

  it("technical context never consumes a current-day SignalTrace key — legs/grip RED reactions still fire identically", () => {
    const highFatigueCheckin = { leg_fatigue: 8, grip_fatigue: 8 };
    const without = buildDailyPlan(baseRawContext({ checkin: highFatigueCheckin, planned_session: { kind: "DH_TECHNICAL", load_profile: "HEAVY" } }));
    const withContext = buildDailyPlan(
      baseRawContext({
        checkin: highFatigueCheckin,
        planned_session: { kind: "DH_TECHNICAL", load_profile: "HEAVY" },
        recent_technical_context: TECHNICAL_CONTEXT,
      })
    );

    // Both legs and grip are RED today -> C3.5/C3.6 already fire and pivot
    // DH_TECHNICAL -> DH_LIGHT regardless of any prior technical context.
    expect(without.final_session.kind).toBe("DH_LIGHT");
    expect(withContext.final_session.kind).toBe("DH_LIGHT");
    expect(withContext.triggered_rules.map((r) => r.rule_id)).toEqual(without.triggered_rules.map((r) => r.rule_id));
  });
});
