import { describe, expect, it } from "vitest";
import { BODY_STATUS_LABELS, bodyStatusOf, healthSignalReasonOf } from "./bodyStatus";

const rule = (layer: string, rule_id: string, detail = "") => ({ layer, rule_id, detail, signals_used: [] });

describe("P0-SAFE — État du corps", () => {
  it("incident A after the fix: a Safety rule (A6) rules the day → Signal actif, with its sentence", () => {
    const plan = { triggered_rules: [rule("A", "A6", "Douleur forte déclarée (8/10) — repos et avis d'un professionnel de santé")], health_flag_to_create: { type: "injury_suspect", reason: "Douleur sévère déclarée (8/10) — knee_R" } } as never;
    expect(BODY_STATUS_LABELS[bodyStatusOf(plan)]).toBe("Signal actif");
    expect(healthSignalReasonOf(plan)).toBe("Douleur sévère déclarée (8/10) — knee_R");
  });

  it("incident B after the fix: an open signal from a previous day (A7, no signal created today) → Signal actif, with the reminder", () => {
    const plan = { triggered_rules: [rule("A", "A7", "Signal de santé non clôturé (suspicion de blessure du 23.10) — pas d'entraînement tant qu'il n'est pas clôturé")] } as never;
    expect(bodyStatusOf(plan)).toBe("signal");
    expect(healthSignalReasonOf(plan)).toMatch(/^Signal de santé non clôturé/);
  });

  it("A5 (concussion follow-up, DH swapped) is a signal too, not 'Prêt'", () => {
    expect(bodyStatusOf({ triggered_rules: [rule("A", "A5")] } as never)).toBe("signal");
  });

  it("a declared non-Safety pain is never 'Prêt': Douleur signalée", () => {
    expect(BODY_STATUS_LABELS[bodyStatusOf({ triggered_rules: [rule("C", "PAIN_NON_SAFETY")] } as never)]).toBe("Douleur signalée");
  });

  it("fatigue / sleep signals only, or nothing → Prêt (no new block, no alarm)", () => {
    expect(bodyStatusOf({ triggered_rules: [rule("C", "LEGS_RED")] } as never)).toBe("ready");
    expect(bodyStatusOf({ triggered_rules: [] } as never)).toBe("ready");
  });

  it("a signal id returned by the server is enough", () => {
    expect(bodyStatusOf({ triggered_rules: [] } as never, "a-flag-id")).toBe("signal");
  });
});

describe("P0-SAFE — coaching suspension wording (A6 / A7 only)", () => {
  it("A6 / A7 REST days read as a suspension of the coaching; A1–A5 keep their own wording", async () => {
    const { isCoachingSuspended } = await import("./bodyStatus");
    const { missionStatus } = await import("./missionStatus");
    const plan = (rule_id: string) => ({ decision: "REST", planned_session_before: null, triggered_rules: [rule("A", rule_id)] }) as never;
    expect(isCoachingSuspended(plan("A6"))).toBe(true);
    expect(isCoachingSuspended(plan("A7"))).toBe(true);
    expect(missionStatus(plan("A7"))).toBe("NALYNT suspend ses propositions d'entraînement");
    for (const id of ["A1", "A2", "A3", "A4"]) {
      expect(isCoachingSuspended(plan(id))).toBe(false);
      expect(missionStatus(plan(id))).toBe("NALYNT te propose de récupérer");
    }
    expect(isCoachingSuspended({ decision: "KEEP", triggered_rules: [rule("A", "A5")] } as never)).toBe(false);
  });
});

describe("SPORT-SAFE-02 (candidate) — an open concussion follow-up (A5) suspends the coaching", () => {
  const A5_DETAIL = "Suivi post-commotion ouvert — propositions d'entraînement suspendues jusqu'à l'évaluation d'un professionnel de santé";
  it("A5 REST reads as « Coaching suspendu », with its sentence under « Attention santé »", async () => {
    const { isCoachingSuspended } = await import("./bodyStatus");
    const { missionStatus } = await import("./missionStatus");
    const plan = { decision: "REST", planned_session_before: null, triggered_rules: [rule("A", "A5", A5_DETAIL)] } as never;
    expect(isCoachingSuspended(plan)).toBe(true);
    expect(missionStatus(plan)).toBe("NALYNT suspend ses propositions d'entraînement");
    expect(healthSignalReasonOf(plan)).toBe(A5_DETAIL);
  });

  it("a historical A5 (before SPORT-SAFE-02: DH swapped, never a REST) keeps its reading: no suspension, no raw detail", async () => {
    const { isCoachingSuspended } = await import("./bodyStatus");
    const legacy = { decision: "MODIFY", triggered_rules: [rule("A", "A5", "Flag concussion_suspect actif non résolu — DH interdit tant que non validé médicalement")] } as never;
    expect(isCoachingSuspended(legacy)).toBe(false);
    expect(healthSignalReasonOf(legacy)).toBeUndefined();
  });
});
