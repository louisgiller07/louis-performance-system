import { describe, it, expect } from "vitest";
import { buildDailyPlan } from "../src/engine/buildDailyPlan.js";
import { baseRawContext, RACE_CALENDAR } from "../fixtures/louis.js";

describe("T10 — Confidence qualitative", () => {
  it("T10.1 — Confidence HIGH sur SAFETY (voir aussi T3.1)", () => {
    const ctx = baseRawContext({ checkin: { suspected_concussion: true } });
    const plan = buildDailyPlan(ctx);
    expect(plan.confidence).toBe("HIGH");
  });

  it("T10.2 — Confidence LOW sur une incohérence STRUCTURELLE (deux courses 'en cours' le même jour), pas sur un désaccord entre dimensions valides", () => {
    // Scénario synthétique volontairement impossible (pas un vrai conflit du
    // calendrier Louis) : deux courses dont les fenêtres event_start/event_end
    // se chevauchent le même `today`. Un seul athlète ne peut pas courir deux
    // événements simultanément — c'est une donnée structurellement invalide,
    // pas un désaccord normal entre signaux. Voir docs/11_DECISION_LOG.md 2026-08-13 (round 2).
    const overlappingRace = {
      ...RACE_CALENDAR.LA_BERRA,
      event_name: "Course fictive se chevauchant avec La Berra (scénario de test)",
    };

    const ctx = baseRawContext({
      active_mode: "OFF_SEASON_DEVELOPMENT",
      today: "2026-08-16", // La Berra event_day=1 (in_progress)
      upcoming_races: [RACE_CALENDAR.LA_BERRA, overlappingRace],
      planned_session: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" },
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.confidence).toBe("LOW");
    expect(plan.triggered_rules.some((r) => r.rule_id === "CONTRADICTION_OVERLAPPING_RACES")).toBe(true);
  });

  it("systemic GREEN + recent_load RED est un état plausible, PAS une contradiction (confidence reste MEDIUM)", () => {
    const ctx = baseRawContext({
      active_mode: "OFF_SEASON_DEVELOPMENT",
      today: "2026-08-24",
      upcoming_races: [],
      planned_session: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" },
      recent_sessions: [
        { date: "2026-08-23", intervention: { kind: "STRENGTH_LOWER", load_profile: "MODERATE" } },
        { date: "2026-08-22", intervention: { kind: "STRENGTH_UPPER", load_profile: "HEAVY" } },
        { date: "2026-08-21", intervention: { kind: "DH_TECHNICAL", load_profile: "MODERATE" } },
        { date: "2026-08-20", intervention: { kind: "STRENGTH_LOWER", load_profile: "HEAVY" } },
        { date: "2026-08-19", intervention: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" } },
      ],
    });

    const plan = buildDailyPlan(ctx);

    // Un athlète peut être frais aujourd'hui malgré une charge 7 jours très élevée.
    expect(plan.confidence).toBe("MEDIUM");
    expect(plan.triggered_rules.some((r) => r.rule_id.startsWith("CONTRADICTION"))).toBe(false);
    expect(plan.final_session).toEqual({ kind: "STRENGTH_UPPER", load_profile: "MODERATE" });
  });

  it("T10.3 (implicite) — Confidence MEDIUM en cas normal", () => {
    const ctx = baseRawContext({
      active_mode: "OFF_SEASON_DEVELOPMENT",
      planned_session: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" },
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.confidence).toBe("MEDIUM");
  });
});

describe("Soft constraints `strong` — participent à l'arbitrage sans être hard ni ignorées", () => {
  // INJURY_RECOVERY porte no_development(strong) + no_dh_intense(strong), mais
  // DH_TECHNICAL n'est pas un kind de "développement" (voir DEVELOPMENT_KINDS
  // dans rules/modes.ts) : seule no_dh_intense est concernée ici, ce qui isole
  // proprement son comportement (voir aussi tests/modesConstraints.test.ts
  // pour chaque contrainte testée unitairement).

  it("strong ≠ ignoré : sans justification (planned_intent absent), la contrainte est effectivement appliquée", () => {
    const ctx = baseRawContext({
      active_mode: "INJURY_RECOVERY", // no_dh_intense strong
      today: "2026-08-24",
      upcoming_races: [],
      planned_session: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.final_session).not.toEqual({ kind: "DH_TECHNICAL", load_profile: "MODERATE" });
    expect(plan.final_session).toEqual({ kind: "DH_LIGHT", load_profile: "LIGHT" });
    expect(plan.decision).toBe("REPLACE");
    expect(plan.confidence).toBe("MEDIUM"); // pas une contradiction, un arbitrage normal
    expect(plan.triggered_rules.some((r) => r.rule_id === "SOFT_CONSTRAINT_STRONG_APPLIED")).toBe(true);
  });

  it("strong ≠ hard : avec justification (planned_intent), le plan initial est conservé", () => {
    const ctx = baseRawContext({
      active_mode: "INJURY_RECOVERY", // no_dh_intense strong
      today: "2026-08-24",
      upcoming_races: [],
      planned_session: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
      planned_intent: "Retour progressif validé par le physio, DH technique léger encadré exceptionnellement autorisé",
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.final_session).toEqual({ kind: "DH_TECHNICAL", load_profile: "MODERATE" });
    expect(plan.decision).toBe("KEEP");
    expect(plan.confidence).toBe("MEDIUM");
    expect(plan.triggered_rules.some((r) => r.rule_id === "SOFT_CONSTRAINT_STRONG_OVERRIDDEN")).toBe(true);
  });

  it("dérogation à une soft constraint strong → override_reason non vide, citant la contrainte et la justification (docs/07_GLOSSARY.md §override_reason)", () => {
    const justification = "Retour progressif validé par le physio, DH technique léger encadré exceptionnellement autorisé";
    const ctx = baseRawContext({
      active_mode: "INJURY_RECOVERY", // no_dh_intense strong
      today: "2026-08-24",
      upcoming_races: [],
      planned_session: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
      planned_intent: justification,
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.triggered_rules.some((r) => r.rule_id === "SOFT_CONSTRAINT_STRONG_OVERRIDDEN")).toBe(true);
    expect(plan.override_reason).toBeDefined();
    expect(plan.override_reason?.length).toBeGreaterThan(0);
    expect(plan.override_reason).toContain("no_dh_intense");
    expect(plan.override_reason).toContain(justification);
  });

  it("override traçable : la règle appliquée référence explicitement la contrainte, le mode et le changement de séance", () => {
    const ctx = baseRawContext({
      active_mode: "INJURY_RECOVERY",
      today: "2026-08-24",
      upcoming_races: [],
      planned_session: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
    });

    const plan = buildDailyPlan(ctx);

    const rule = plan.triggered_rules.find((r) => r.rule_id === "SOFT_CONSTRAINT_STRONG_APPLIED");
    expect(rule).toBeDefined();
    expect(rule?.detail).toContain("no_dh_intense");
    expect(rule?.detail).toContain("INJURY_RECOVERY");
    expect(rule?.detail).toContain("DH_TECHNICAL");
  });

  it("RACE_WEEK + GRIP_WORK HEAVY : plusieurs contraintes strong concernées simultanément (no_development ET no_grip_heavy), la première appliquée est tracée", () => {
    const ctx = baseRawContext({
      active_mode: "RACE_WEEK",
      today: "2026-08-24",
      upcoming_races: [],
      planned_session: { kind: "GRIP_WORK", load_profile: "HEAVY" },
    });

    const plan = buildDailyPlan(ctx);

    // GRIP_WORK HEAVY viole à la fois no_development et no_grip_heavy ; ce
    // test documente que ce n'est ni ignoré ni traité comme un cas d'erreur.
    expect(plan.final_session).not.toEqual({ kind: "GRIP_WORK", load_profile: "HEAVY" });
    expect(plan.confidence).toBe("MEDIUM");
    expect(plan.triggered_rules.some((r) => r.rule_id === "SOFT_CONSTRAINT_STRONG_APPLIED")).toBe(true);
  });
});
