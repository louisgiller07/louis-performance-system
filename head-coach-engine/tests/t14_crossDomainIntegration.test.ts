import { describe, it, expect } from "vitest";
import { buildDailyPlan } from "../src/engine/buildDailyPlan.js";
import { baseRawContext } from "../fixtures/louis.js";
import type { UpcomingRace } from "../src/types/context.js";

/**
 * T14 — Cross-domain integration (V0.3_002E). Proves composition of
 * already-accepted Technique/Mental/Nutrition behavior against Safety,
 * Training, Recovery, EventContext and SignalTrace ownership. Adds no new
 * coaching content, heuristic, signal, DailyPlan field, or rule ID — see
 * docs/06_ARCHITECTURE.md §V0.3_002 (Contrat d'intégration V0.3_002E).
 *
 * All fixtures go through the real `buildDailyPlan(RawContext)` pipeline —
 * no hand-built EventContext/dimensions injection — so GREEN/AMBER/RED are
 * genuinely derived from check-in values, reusing the exact thresholds
 * already established by T11/T12/T13 (grip/leg_fatigue: 8 → RED;
 * work_stress: 6 → AMBER, 9 → RED).
 */

const PRE_EVENT_FOCUS = "Comme à Wiriehorn.";
const AMBER_STRESS_HINT = "Fais quelques respirations lentes, puis reviens à une seule priorité.";
const RED_SUPPORTIVE_HINT = "Le plan du jour tient déjà compte de la charge mentale. Garde une seule priorité d'exécution.";

const TECHNIQUE_FOCUS = "Fixe ta ligne, dose le freinage, laisse rouler.";
const TECHNIQUE_DEFAULT_SPOT_HINT = "Terrain adapté au focus technique du jour.";

const RACE_WEEK_FOCUS = "En race week : pense à augmenter légèrement l'apport énergétique.";
const RACE_DAY_NOTES = "Jour de course : petit-déjeuner consistant au moins 2 h avant le premier run.";
const DH_DAY_NOTES = "Jour DH : vise environ 3 à 3,5 L sur la journée.";
const STRENGTH_NOTES = "Séance de force planifiée : protéines + glucides dans les 60 minutes après.";

/** today = 2026-08-24 (baseRawContext default) — +3 days lands inside both
 * the 7-day PRE_EVENT window and Technique's 14-day proximity window.
 * race_format "OTHER" carries no T-X table (raceProtocol.ts), so it never
 * overrides `planned_session` — matches the exact pattern already used by
 * T12's own PRE_EVENT wiring fixture. */
function preEventRace(overrides: Partial<UpcomingRace> = {}): UpcomingRace {
  return {
    event_name: "Fixture race",
    event_start: "2026-08-27",
    event_end: "2026-08-27",
    priority: "A",
    race_format: "OTHER",
    ...overrides,
  };
}

/** A genuine in-progress race day (today falls inside event_start..event_end). */
function raceDayRace(overrides: Partial<UpcomingRace> = {}): UpcomingRace {
  return {
    event_name: "Fixture race day",
    event_start: "2026-08-24",
    event_end: "2026-08-24",
    priority: "A",
    race_format: "OTHER",
    ...overrides,
  };
}

describe("T14 — Cross-domain integration (V0.3_002E)", () => {
  describe("PRE_EVENT vs RACE_WEEK — independent triggers", () => {
    it("A. PRE_EVENT true, RACE_WEEK false → Mental focus only", () => {
      const ctx = baseRawContext({
        active_mode: "IN_SEASON",
        planned_session: { kind: "MOBILITY" },
        upcoming_races: [preEventRace()],
      });
      const plan = buildDailyPlan(ctx);

      expect(plan.mental).toEqual({ active: true, focus: PRE_EVENT_FOCUS });
      expect(plan.nutrition).toEqual({ active: false });
    });

    it("B. PRE_EVENT false, RACE_WEEK true → Nutrition focus only", () => {
      const ctx = baseRawContext({
        active_mode: "RACE_WEEK",
        planned_session: { kind: "MOBILITY" },
        upcoming_races: [],
      });
      const plan = buildDailyPlan(ctx);

      expect(plan.nutrition).toEqual({ active: true, focus: RACE_WEEK_FOCUS });
      expect(plan.mental).toEqual({ active: false });
    });

    it("C. PRE_EVENT + RACE_WEEK → both focus fields coexist exactly", () => {
      const ctx = baseRawContext({
        active_mode: "RACE_WEEK",
        planned_session: { kind: "MOBILITY" },
        upcoming_races: [preEventRace()],
      });
      const plan = buildDailyPlan(ctx);

      expect(plan.mental).toEqual({ active: true, focus: PRE_EVENT_FOCUS });
      expect(plan.nutrition).toEqual({ active: true, focus: RACE_WEEK_FOCUS });
    });
  });

  describe("Technique + Mental AMBER + Nutrition, and Mental late-push under full domain load", () => {
    const DH_SESSION = { kind: "DH_TECHNICAL" as const, load_profile: "MODERATE" as const };

    function fixture(mentalAmber: boolean) {
      return baseRawContext({
        planned_session: DH_SESSION,
        upcoming_races: [],
        checkin: mentalAmber ? { work_stress: 6 } : {},
      });
    }

    it("DH + Mental AMBER → Technique/Mental/Nutrition all active, exactly one Mental AMBER rule, no Technique/Nutrition rule", () => {
      const plan = buildDailyPlan(fixture(true));

      expect(plan.decision).toBe("KEEP");
      expect(plan.final_session).toEqual(DH_SESSION);

      expect(plan.dh_or_technical).toEqual({
        active: true,
        focus: TECHNIQUE_FOCUS,
        spot_hint: TECHNIQUE_DEFAULT_SPOT_HINT,
      });
      expect(plan.mental).toEqual({ active: true, action_hint: AMBER_STRESS_HINT });
      expect(plan.nutrition).toEqual({ active: true, notes: DH_DAY_NOTES });

      const mentalAmberRules = plan.triggered_rules.filter((r) => r.rule_id === "MENTAL_AMBER_STRESS");
      expect(mentalAmberRules).toHaveLength(1);
      expect(plan.triggered_rules.some((r) => r.rule_id.startsWith("TECHNIQUE_"))).toBe(false);
      expect(plan.triggered_rules.some((r) => r.rule_id.startsWith("NUTRITION_"))).toBe(false);
    });

    it("Late-push paired regression — Mental AMBER never leaks into Training-derived fields, even with Technique/Nutrition simultaneously active", () => {
      const baseline = buildDailyPlan(fixture(false));
      const enriched = buildDailyPlan(fixture(true));

      // Sanity: both sides genuinely differ only by the Mental signal —
      // Technique/Nutrition are independently active in both.
      expect(baseline.dh_or_technical.active).toBe(true);
      expect(baseline.nutrition.active).toBe(true);
      expect(enriched.dh_or_technical.active).toBe(true);
      expect(enriched.nutrition.active).toBe(true);

      // Training-derived fields already finalized before Mental's late push.
      expect(enriched.decision).toBe(baseline.decision);
      expect(enriched.final_session).toEqual(baseline.final_session);
      expect(enriched.training).toEqual(baseline.training);
      expect(enriched.reasoning).toBe(baseline.reasoning);
      expect(enriched.override_reason).toBe(baseline.override_reason);

      // Domains untouched by the Mental signal.
      expect(enriched.dh_or_technical).toEqual(baseline.dh_or_technical);
      expect(enriched.nutrition).toEqual(baseline.nutrition);
      expect(enriched.recovery).toEqual(baseline.recovery);

      // Expected, isolated differences.
      expect(baseline.mental).toEqual({ active: false });
      expect(enriched.mental).toEqual({ active: true, action_hint: AMBER_STRESS_HINT });
      expect(baseline.triggered_rules.some((r) => r.rule_id === "MENTAL_AMBER_STRESS")).toBe(false);
      expect(enriched.triggered_rules.filter((r) => r.rule_id === "MENTAL_AMBER_STRESS")).toHaveLength(1);
    });
  });

  describe("Mental RED ownership with downstream domains (DH)", () => {
    it("DH + Mental RED → Training owns MENTAL_RED, DH kind survives (load downgraded only), Technique/Nutrition follow the resulting final_session", () => {
      const ctx = baseRawContext({
        planned_session: { kind: "DH_TECHNICAL", load_profile: "HEAVY" },
        upcoming_races: [],
        checkin: { work_stress: 9 },
      });
      const plan = buildDailyPlan(ctx);

      // Actual current Training result, asserted first — Mental RED only
      // downgrades load_profile for DH kinds (training.ts's mental-RED
      // branch never reassigns `kind` except for the AEROBIC_INTERVALS
      // special case), so DH survives with load stepped HEAVY→MODERATE.
      expect(plan.final_session).toEqual({ kind: "DH_TECHNICAL", load_profile: "MODERATE" });
      expect(plan.decision).toBe("MODIFY");

      const mentalRedRules = plan.triggered_rules.filter((r) => r.rule_id === "MENTAL_RED");
      expect(mentalRedRules).toHaveLength(1);
      expect(mentalRedRules[0]?.signals_used).toEqual(["stress_high"]);
      expect(plan.triggered_rules.some((r) => r.rule_id === "MENTAL_AMBER_STRESS")).toBe(false);
      expect(plan.triggered_rules.some((r) => r.rule_id === "MENTAL_AMBER_MOTIVATION")).toBe(false);
      expect(plan.triggered_rules.some((r) => r.rule_id.startsWith("TECHNIQUE_"))).toBe(false);
      expect(plan.triggered_rules.some((r) => r.rule_id.startsWith("NUTRITION_"))).toBe(false);

      // Downstream domains follow the resulting (still-DH) final_session.
      expect(plan.dh_or_technical.active).toBe(true);
      expect(plan.dh_or_technical.focus).toBe(TECHNIQUE_FOCUS);
      expect(plan.nutrition).toEqual({ active: true, notes: DH_DAY_NOTES });

      // Mental supports Training's ownership, no second consume, no new rule.
      expect(plan.mental).toEqual({ active: true, action_hint: RED_SUPPORTIVE_HINT });
    });
  });

  describe("final_session propagation + planned-strength asymmetry", () => {
    it("planned GRIP_WORK + arms_grip RED + legs RED → Training pivots final_session to RECOVERY_ACTIVE; Technique/Nutrition-DH follow it, but Nutrition strength still follows the raw planned_session", () => {
      const ctx = baseRawContext({
        active_mode: "IN_SEASON",
        planned_session: { kind: "GRIP_WORK", load_profile: "MODERATE" },
        upcoming_races: [],
        checkin: { grip_fatigue: 8, leg_fatigue: 8 },
      });
      const plan = buildDailyPlan(ctx);

      // Actual current Training result, asserted first (training.ts C3.5:
      // GRIP_WORK + legs RED → RECOVERY_ACTIVE).
      expect(plan.final_session).toEqual({ kind: "RECOVERY_ACTIVE" });
      expect(plan.decision).toBe("REPLACE");
      expect(plan.planned_session_before).toEqual({ kind: "GRIP_WORK", load_profile: "MODERATE" });

      // Technique and Nutrition's DH branch both correctly follow the
      // pivoted final_session, not the original planned GRIP_WORK.
      expect(plan.dh_or_technical).toEqual({ active: false });

      // Nutrition's strength branch intentionally reads the raw
      // planned_session (never final_session) — accepted asymmetry, not a
      // defect (docs/06_ARCHITECTURE.md §V0.3_002, 002D contract).
      expect(plan.nutrition).toEqual({ active: true, notes: STRENGTH_NOTES, hydration_target_l: 2 });

      expect(plan.recovery).toEqual({
        active: true,
        actions: ["Journée orientée récupération : mobilité douce, marche, pas de charge structurée"],
      });
    });
  });

  describe("Real race-day + Mental AMBER", () => {
    it("genuine in-progress race (via computeEventContext) + AMBER → Nutrition race-day + Mental action coexist, no PRE_EVENT Mental focus", () => {
      const ctx = baseRawContext({
        planned_session: null,
        upcoming_races: [raceDayRace()],
        checkin: { work_stress: 6 },
      });
      const plan = buildDailyPlan(ctx);

      expect(plan.event_context?.in_progress).toBe(true);
      expect(plan.event_context?.phase).not.toBe("PRE_EVENT");

      expect(plan.nutrition).toEqual({ active: true, notes: RACE_DAY_NOTES });
      expect(plan.nutrition.hydration_target_l).toBeUndefined();

      expect(plan.mental).toEqual({ active: true, action_hint: AMBER_STRESS_HINT });
      expect(plan.mental.focus).toBeUndefined();
    });
  });

  describe("Safety + maximum multi-domain pressure", () => {
    it("suspected_concussion + RACE_WEEK + PRE_EVENT + planned DH → Safety path wins, zero cross-domain leakage", () => {
      const ctx = baseRawContext({
        active_mode: "RACE_WEEK",
        planned_session: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
        upcoming_races: [preEventRace()],
        checkin: { suspected_concussion: true },
      });
      const plan = buildDailyPlan(ctx);

      expect(plan.decision).toBe("REST");
      expect(plan.final_session).toEqual({ kind: "REST" });

      expect(plan.dh_or_technical).toEqual({ active: false });
      expect(plan.mental).toEqual({ active: false });
      expect(plan.nutrition).toEqual({ active: false });

      // Safety's own fixed literals (buildSafetyPlan) — not computeRecoveryDomain.
      expect(plan.recovery).toEqual({
        active: true,
        actions: ["Repos complet", "Suivre les consignes du professionnel de santé"],
      });
      expect(plan.sleep).toEqual({ active: true, notes: "Prioriser le sommeil pendant la période de repos" });

      // Only A1 — no other Safety rule, no domain rule, no B/C layer rule.
      expect(plan.triggered_rules).toEqual([
        {
          layer: "A",
          rule_id: "A1",
          detail: "Suspicion de commotion déclarée — REST et orientation médicale immédiate",
          signals_used: ["suspected_concussion"],
        },
      ]);
    });
  });

  describe("TriggeredRule ownership — no TECHNIQUE_*/NUTRITION_* across combined plans", () => {
    it("across representative multi-domain-active plans, no rule_id starts with TECHNIQUE_ or NUTRITION_", () => {
      const plans = [
        buildDailyPlan(
          baseRawContext({
            active_mode: "RACE_WEEK",
            planned_session: { kind: "MOBILITY" },
            upcoming_races: [preEventRace()],
          }),
        ),
        buildDailyPlan(
          baseRawContext({
            planned_session: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
            upcoming_races: [],
            checkin: { work_stress: 6 },
          }),
        ),
        buildDailyPlan(
          baseRawContext({
            planned_session: { kind: "DH_TECHNICAL", load_profile: "HEAVY" },
            upcoming_races: [],
            checkin: { work_stress: 9 },
          }),
        ),
        buildDailyPlan(
          baseRawContext({
            active_mode: "IN_SEASON",
            planned_session: { kind: "GRIP_WORK", load_profile: "MODERATE" },
            upcoming_races: [],
            checkin: { grip_fatigue: 8, leg_fatigue: 8 },
          }),
        ),
        buildDailyPlan(
          baseRawContext({ planned_session: null, upcoming_races: [raceDayRace()], checkin: { work_stress: 6 } }),
        ),
      ];

      for (const plan of plans) {
        expect(plan.triggered_rules.some((r) => r.rule_id.startsWith("TECHNIQUE_"))).toBe(false);
        expect(plan.triggered_rules.some((r) => r.rule_id.startsWith("NUTRITION_"))).toBe(false);
      }
    });
  });

  describe("Recovery paired regression under Technique + Mental + Nutrition load", () => {
    it("Recovery output unchanged when Mental/Technique contributions activate, Recovery-relevant inputs held equivalent", () => {
      const DH_SESSION = { kind: "DH_TECHNICAL" as const, load_profile: "MODERATE" as const };

      const baseline = buildDailyPlan(
        baseRawContext({ active_mode: "IN_SEASON", planned_session: DH_SESSION, upcoming_races: [] }),
      );
      const enriched = buildDailyPlan(
        baseRawContext({
          active_mode: "IN_SEASON",
          planned_session: DH_SESSION,
          upcoming_races: [preEventRace()],
          checkin: { work_stress: 6 },
        }),
      );

      // Not a trivial pair — the enriched plan genuinely activates
      // independent Mental/Technique/Nutrition contributions.
      expect(enriched.mental).toEqual({ active: true, focus: PRE_EVENT_FOCUS, action_hint: AMBER_STRESS_HINT });
      expect(enriched.dh_or_technical.active).toBe(true);
      expect(enriched.nutrition.active).toBe(true);
      expect(baseline.mental).toEqual({ active: false });

      // final_session/modeConstraints identical both sides (IN_SEASON has no
      // soft constraints, race_format OTHER never overrides planned_session);
      // eventContext.phase is never POST_EVENT on either side — the only
      // input Recovery actually reads among these differences.
      expect(enriched.final_session).toEqual(baseline.final_session);
      expect(enriched.recovery).toEqual(baseline.recovery);
    });
  });

  describe("Determinism", () => {
    it("identical RawContext produces identical DailyPlan for a rich multi-domain-active context", () => {
      const ctx = baseRawContext({
        planned_session: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
        upcoming_races: [preEventRace()],
        checkin: { work_stress: 6 },
      });

      const planA = buildDailyPlan(ctx);
      const planB = buildDailyPlan(ctx);

      expect(planA).toEqual(planB);
    });
  });
});
