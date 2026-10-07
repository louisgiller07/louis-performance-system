import { describe, expect, it } from "vitest";
import { buildDailyPlan } from "../../src/engine/buildDailyPlan.js";
import { applyV2TodayTimeConstraint } from "../../src/supabase/dailyV2/applyV2TodayTimeConstraint.js";
import { applyV2SystemicFloor } from "../../src/supabase/dailyV2/applyV2SystemicFloor.js";
import { realignSessionSections } from "../../src/supabase/dailyV2/realignSessionSections.js";
import type { FinalPrescriptionV2Result } from "../../src/supabase/dailyV2/reconcileFinalPrescriptionV2.js";
import { baseRawContext } from "../../fixtures/louis.js";

// P0 adapted-session coherence — once the V2 path changes the session after M1,
// no secondary advice of the replaced session survives (dogfood: DH → recovery kept DH advice).

const DH = { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 90 } as const;
const isDhText = (t: string) => /\bDH\b|run\b|descente/i.test(t);

function m1DhDay(checkin: Record<string, unknown> = {}) {
  return buildDailyPlan(baseRawContext({ active_mode: "IN_SEASON", planned_session: DH, checkin }));
}
const toRecovery = (minutes: number): FinalPrescriptionV2Result =>
  ({
    status: "created",
    finalPrescription: {} as never,
    timeConstraint: { availableMinutes: minutes, action: "adapted", before: { decision: "KEEP", kind: "DH_TECHNICAL", loadProfile: "MODERATE", durationMin: 90 }, after: { decision: "REPLACE", kind: "RECOVERY_ACTIVE" } },
  }) as FinalPrescriptionV2Result;

describe("P0 — session-derived sections follow the effective session", () => {
  it("M1 DH day: the DH sections are DH (baseline of the test)", () => {
    const plan = m1DhDay({ work_stress: 7 });
    expect(plan.final_session.kind).toBe("DH_TECHNICAL");
    expect([plan.nutrition.notes, ...plan.recovery.actions].some((t) => t !== undefined && isDhText(t))).toBe(true);
  });

  it("A10 DH → active recovery: no DH nutrition, recovery, technique or monitoring advice; recovery advice present; signal-driven lines kept", () => {
    const plan = m1DhDay({ work_stress: 7 });
    expect(plan.final_session.kind).toBe("DH_TECHNICAL");
    const after = applyV2TodayTimeConstraint(plan, toRecovery(30));
    expect(after.final_session.kind).toBe("RECOVERY_ACTIVE");
    expect(after.dh_or_technical).toEqual({ active: false });
    expect(after.nutrition.notes === undefined || !isDhText(after.nutrition.notes)).toBe(true);
    expect(after.recovery.actions.some(isDhText)).toBe(false);
    expect(after.recovery.actions).toContain("Journée orientée récupération : mobilité douce, marche, pas de charge structurée");
    expect(after.monitoring.observe.some((t) => /DH/.test(t))).toBe(false);
    expect(after.mental.action_hint === undefined || !/run/.test(after.mental.action_hint)).toBe(true);
    expect(after.protection).toEqual(plan.protection);
  });

  it("the DH pre-run mental hint becomes M1's base hint for the mental rule that fired", () => {
    const plan = buildDailyPlan(baseRawContext({ active_mode: "IN_SEASON", planned_session: DH, checkin: { work_stress: 7 }, coaching_profile: { technique_primary_focus: "regard loin" } as never }));
    const rewritten = realignSessionSections(plan, { kind: "RECOVERY_ACTIVE" });
    expect(plan.mental.action_hint).toMatch(/^Avant de partir/);
    expect([
      "Fais quelques respirations lentes, puis reviens à une seule priorité.",
      "Choisis une seule action simple et commence par celle-là.",
      "Le plan du jour tient déjà compte de la charge mentale. Garde une seule priorité d'exécution.",
    ]).toContain(rewritten.mental.action_hint);
  });

  it("a DH kept as a DH (shorter window): sections unchanged", () => {
    const plan = m1DhDay({ work_stress: 7 });
    const kept = realignSessionSections(plan, { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 60 });
    expect([kept.dh_or_technical, kept.monitoring, kept.mental]).toEqual([plan.dh_or_technical, plan.monitoring, plan.mental]);
  });

  it("V2 systemic floor (Force LIGHT → recovery): recovery advice follows the recovery", () => {
    const plan = buildDailyPlan(
      baseRawContext({ active_mode: "IN_SEASON", planned_session: { kind: "STRENGTH_LOWER", load_profile: "LIGHT", duration_min: 45 }, checkin: { sleep_hours: 4, sleep_quality: 2, sleep_wake_ups: 4, energy: 2 } })
    );
    const floored = applyV2SystemicFloor(plan);
    expect(floored.final_session.kind).toBe("RECOVERY_ACTIVE");
    expect(floored.recovery.actions).toContain("Journée orientée récupération : mobilité douce, marche, pas de charge structurée");
  });
});
