/**
 * SPORT-PLAN-03 V2 contracts (HPM 2026-10-25) — non-prescriptive contracts: DH units, tolerated reference /
 * candidate progression / effective prescription, durations with one end, planned vs realised race exposure, RPE
 * semantics. Every execution or declaration below is an explicit input; nothing is read from a history.
 */
import { globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  addDhRepetitionsV2,
  appendStrengthCoolDownV2,
  buildAerobicBasePrescriptionV2Content,
  buildAerobicIntervalsPrescriptionV2Content,
  buildDhPrescriptionV2Content,
  buildPowerPrescriptionV2Content,
  buildRecoveryActivePrescriptionV2Content,
  buildSessionModelV2CatalogManifest,
  buildStrengthPrescriptionV2Content,
  checkDhSessionPlanV2,
  checkRpeSemanticsV2,
  countEndBlocksV2,
  dhHistoryByUnitV2,
  dhRepetitionCountV2,
  durationVerdictV2,
  estimateStrengthDurationMinutesV2,
  exposureLedgerV2,
  exposureSummaryV2,
  protocolDurationV2,
  readLegacyPassMeasureV2,
  assessProgressionCandidateV2,
  CANDIDATE_ONE_STEP_POLICY_V2,
  checkEffectivePrescriptionV2,
  NO_PROGRESSION_POLICY_V2,
  nextToleratedReferenceV2,
  RPE_SEMANTICS_V2,
  strengthSessionDurationV2,
  type PrescriptionV2,
  type PrescriptionV2Content,
  type DoseQuantityV2,
  type ProgressionEvidenceV2,
  type ToleratedDoseReferenceV2,
} from "../../src/sessionModelV2/index.js";
import { STRENGTH_DOSE_STEPS_V2 } from "../../src/catalog/strengthDoseCatalogV2.js";

const catalog = buildSessionModelV2CatalogManifest();
const EQUIPMENT = { none: [] as string[], dumbbells: ["dumbbells", "bench"], gym: ["barbell", "squat_rack", "dumbbells", "bench", "cable_machine", "pull_up_bar"] };
const TIERS = ["beginner", "intermediate", "advanced"] as const;
const strengthContents = (): PrescriptionV2Content[] =>
  (["STRENGTH_LOWER", "STRENGTH_UPPER"] as const).flatMap((sessionKind) =>
    TIERS.flatMap((athleteTier) =>
      Object.values(EQUIPMENT).flatMap((equipment) =>
        STRENGTH_DOSE_STEPS_V2.map((doseStep) => buildStrengthPrescriptionV2Content({ sessionKind, athleteTier, equipment, loadProfile: doseStep === "LIGHT" ? "LIGHT" : "MODERATE", doseStep, catalog }))
      )
    )
  );

describe("SPORT-PLAN-03 contracts · DH repetition unit", () => {
  it("a new count needs a known unit: UNKNOWN blocks it, a FULL_RUN needs track data, a SECTION is prescribed — the budget is kept", () => {
    expect(dhRepetitionCountV2({ unit: "UNKNOWN", repetitions: 6, sessionBudgetMin: 90 })).toEqual({ status: "count_blocked", reason: "unit_unknown", dose: { unit: "UNKNOWN", repetitions: null, sessionBudgetMin: 90 } });
    expect(dhRepetitionCountV2({ unit: "FULL_RUN", repetitions: 4, sessionBudgetMin: 60 })).toMatchObject({ status: "count_blocked", reason: "full_run_needs_track_data" });
    expect(dhRepetitionCountV2({ unit: "FULL_RUN", repetitions: 4, sessionBudgetMin: 60, descentMinPerRepetition: 3 })).toEqual({ status: "prescribed", dose: { unit: "FULL_RUN", repetitions: 4, sessionBudgetMin: 60 } });
    expect(dhRepetitionCountV2({ unit: "SECTION", repetitions: 4, sessionBudgetMin: 60 })).toEqual({ status: "prescribed", dose: { unit: "SECTION", repetitions: 4, sessionBudgetMin: 60 } });
  });

  it("an existing `pass` measure keeps its count and reads as UNKNOWN; units are never added together", () => {
    expect(readLegacyPassMeasureV2({ type: "pass", count: 6 })).toEqual({ unit: "UNKNOWN", count: 6 });
    const h = dhHistoryByUnitV2([
      { date: "2026-10-03", unit: "UNKNOWN", done: 5, prescribed: 5 },
      { date: "2026-10-10", unit: "UNKNOWN", done: 3, prescribed: 6 },
      { date: "2026-11-07", unit: "SECTION", done: 4, prescribed: 4 },
    ]);
    expect([h.lines.length, h.doneByUnit]).toEqual([3, { SECTION: 4, FULL_RUN: 0, UNKNOWN: 8 }]);
    expect(addDhRepetitionsV2({ unit: "SECTION", count: 4 }, { unit: "FULL_RUN", count: 2 })).toBeNull();
    expect(addDhRepetitionsV2({ unit: "UNKNOWN", count: 4 }, { unit: "UNKNOWN", count: 2 })).toBeNull();
    expect(addDhRepetitionsV2({ unit: "SECTION", count: 4 }, { unit: "SECTION", count: 2 })).toEqual({ unit: "SECTION", count: 6 });
  });

  it("compatibility: every existing DH content keeps its `pass` measure, read as UNKNOWN with its count; no count is admissible from it", () => {
    for (const focusedRunsCount of [4, 5, 6, 7, 8]) {
      const content = buildDhPrescriptionV2Content({ sessionKind: "DH_TECHNICAL", dhSessionOrdinal: 0, dhTechnicalTier: "intermediate", priorityAreas: ["cornering", "braking"], terrainAccess: ["technical_trail", "root_rock_trail", "full_dh_track"], focusedRunsCount, catalog });
      const drill = content.blocks.flatMap((b) => b.items).find((i) => i.kind === "drill")!;
      expect(drill.measure).toEqual({ type: "pass", count: focusedRunsCount });
      expect(readLegacyPassMeasureV2(drill.measure as { type: "pass"; count: number })).toEqual({ unit: "UNKNOWN", count: focusedRunsCount });
      expect(dhRepetitionCountV2({ unit: "UNKNOWN", repetitions: focusedRunsCount, sessionBudgetMin: 90 }).status).toBe("count_blocked");
    }
  });

  it("the session plan against its budget: CONFORME, NON CONFORME with the overflow, NON VÉRIFIABLE when a part is unknown", () => {
    const dose = { unit: "SECTION" as const, repetitions: 4, sessionBudgetMin: 60 };
    const plan = { briefMin: 5, warmUpMin: 10, rideMinPerRepetition: 2, climbMinPerRepetition: 6, pauseMinPerRepetition: 2, freeDescentsMin: 0, endMin: 5 };
    expect(checkDhSessionPlanV2(dose, plan)).toEqual({ verdict: "CONFORME", plannedMin: 60, overflowMin: 0 });
    expect(checkDhSessionPlanV2(dose, { ...plan, rideMinPerRepetition: 3, climbMinPerRepetition: 8, freeDescentsMin: 10 })).toEqual({ verdict: "NON CONFORME", plannedMin: 82, overflowMin: 22 });
    expect(checkDhSessionPlanV2(dose, { ...plan, climbMinPerRepetition: null })).toEqual({ verdict: "NON VÉRIFIABLE", unknown: ["climbMinPerRepetition"] });
  });
});

describe("SPORT-PLAN-03 contracts · tolerated reference, candidate progression, effective prescription (V2-CONTRACTS-REVIEW-01)", () => {
  const step = (s: (typeof STRENGTH_DOSE_STEPS_V2)[number]): DoseQuantityV2 => ({ family: "force", measure: "dose_step", step: s });
  const sets = (n: number): DoseQuantityV2 => ({ family: "force", measure: "work_sets", sets: n });
  const minutes = (n: number): DoseQuantityV2 => ({ family: "endurance", measure: "minutes", minutes: n });
  const dh = (n: number, unit: "SECTION" | "FULL_RUN" | "UNKNOWN"): DoseQuantityV2 => ({ family: "dh", measure: "repetitions", repetitions: n, unit });
  const ref = (dose: DoseQuantityV2): ToleratedDoseReferenceV2 => ({ dose, date: "2026-10-20", source: "recorded" });
  const reliable: ProgressionEvidenceV2 = { kind: "result", outcome: "complete", targetMet: true, healthSignal: false };
  const unfavourable: ProgressionEvidenceV2 = { kind: "result", outcome: "complete", targetMet: false, healthSignal: false };
  const assess = (candidate: DoseQuantityV2, reference: ToleratedDoseReferenceV2 | null, evidence: ProgressionEvidenceV2, policy?: typeof CANDIDATE_ONE_STEP_POLICY_V2) =>
    assessProgressionCandidateV2({ candidate: { dose: candidate, date: "2026-11-10" }, reference, evidence, ...(policy !== undefined ? { policy } : {}) });

  it("case 1 — a reliable tolerated dose allows a proposal of progression ONLY under an explicitly given policy", () => {
    expect(assess(step("MODERATE"), ref(step("LIGHT")), reliable)).toMatchObject({ admissibleMax: step("LIGHT"), riseAdmissible: false, situation: "hausse_non_prevue_par_la_politique", policy: { status: "TECHNICAL_DEFAULT" } });
    expect(assess(step("MODERATE"), ref(step("LIGHT")), reliable, CANDIDATE_ONE_STEP_POLICY_V2)).toMatchObject({ admissibleMax: step("MODERATE"), riseAdmissible: true, situation: "hausse_admissible", policy: { id: "candidate_one_step", status: "CANDIDATE_NOT_VALIDATED" } });
    expect(assess(minutes(75), ref(minutes(45)), reliable, CANDIDATE_ONE_STEP_POLICY_V2).admissibleMax).toEqual(minutes(60));
    // Not adopted, even by the candidate policy: M+, a set increase, a DH repetition increase.
    expect(assess(step("MODERATE_PLUS"), ref(step("MODERATE")), reliable, CANDIDATE_ONE_STEP_POLICY_V2)).toMatchObject({ admissibleMax: step("MODERATE"), situation: "palier_exclu_par_la_politique" });
    expect(assess(sets(15), ref(sets(13)), reliable, CANDIDATE_ONE_STEP_POLICY_V2)).toMatchObject({ admissibleMax: sets(13), riseAdmissible: false });
    expect(assess(dh(6, "SECTION"), ref(dh(5, "SECTION")), reliable, CANDIDATE_ONE_STEP_POLICY_V2)).toMatchObject({ admissibleMax: dh(5, "SECTION"), riseAdmissible: false });
    expect([NO_PROGRESSION_POLICY_V2.autonomous, CANDIDATE_ONE_STEP_POLICY_V2.autonomous]).toEqual([false, false]);
  });

  it("case 2 — an absent result: no automatic rise, and never read as a failure", () => {
    const a = assess(step("MODERATE"), ref(step("LIGHT")), { kind: "absent" }, CANDIDATE_ONE_STEP_POLICY_V2);
    expect(a).toMatchObject({ admissibleMax: step("LIGHT"), riseAdmissible: false, situation: "resultat_absent", adaptationReview: false });
    expect(assess(step("MODERATE"), ref(step("LIGHT")), { kind: "result", outcome: "missed", targetMet: false, healthSignal: false }, CANDIDATE_ONE_STEP_POLICY_V2)).toMatchObject({ situation: "execution_incomplete_ou_non_faite", adaptationReview: false });
    expect(nextToleratedReferenceV2(ref(step("LIGHT")), { dose: step("LIGHT"), date: "2026-11-03", evidence: { kind: "absent" } })).toEqual(ref(step("LIGHT")));
  });

  it("case 3 — an unfavourable result: no progression, the reference kept, no obligation to represcribe it, a review flagged", () => {
    const a = assess(step("MODERATE"), ref(step("MODERATE")), unfavourable, CANDIDATE_ONE_STEP_POLICY_V2);
    const rise = assess(step("MODERATE_PLUS"), ref(step("LIGHT")), unfavourable, CANDIDATE_ONE_STEP_POLICY_V2);
    expect(rise).toMatchObject({ admissibleMax: step("LIGHT"), riseAdmissible: false, situation: "resultat_defavorable", adaptationReview: true });
    expect(checkEffectivePrescriptionV2(a, { kind: "prescribed", dose: step("LIGHT") })).toEqual({ ok: true, relation: "below_admissible_max" });
    expect(nextToleratedReferenceV2(ref(step("MODERATE")), { dose: step("MODERATE"), date: "2026-11-10", evidence: unfavourable })).toEqual(ref(step("MODERATE")));
  });

  it("case 4 — a taper: a reference of 13 sets with an effective dose of 7, and the historical reference stays 13", () => {
    // 13 and 7 are illustrative test values, not FM7 as an official prescription.
    const a = assess(sets(7), ref(sets(13)), { kind: "absent" });
    expect(a).toMatchObject({ admissibleMax: sets(7), situation: "dans_la_reference" });
    expect(checkEffectivePrescriptionV2(a, { kind: "prescribed", dose: sets(7) })).toEqual({ ok: true, relation: "at_admissible_max" });
    const after = nextToleratedReferenceV2(ref(sets(13)), { dose: sets(7), date: "2026-11-24", evidence: reliable });
    expect(after).toEqual(ref(sets(13)));
  });

  it("case 5 — fatigue and Safety: the daily rules may lower, replace or suspend; no floor from this contract", () => {
    const doses = [step("LIGHT"), step("MODERATE"), step("MODERATE_PLUS"), minutes(45), minutes(60), minutes(75), sets(7), sets(13), dh(4, "SECTION"), dh(6, "SECTION")];
    const evidences: ProgressionEvidenceV2[] = [{ kind: "absent" }, reliable, unfavourable, { kind: "result", outcome: "partial", targetMet: false, healthSignal: false }, { kind: "result", outcome: "complete", targetMet: true, healthSignal: true }];
    let checked = 0;
    for (const candidate of doses)
      for (const reference of [null, ...doses.map(ref)])
        for (const evidence of evidences)
          for (const policy of [NO_PROGRESSION_POLICY_V2, CANDIDATE_ONE_STEP_POLICY_V2]) {
            const a = assess(candidate, reference, evidence, policy);
            expect(Object.keys(a).sort()).toEqual(["adaptationReview", "admissibleMax", "candidate", "policy", "reference", "riseAdmissible", "situation", "startingDoseDecisionRequired"]);
            expect(a.reference).toBe(reference);
            expect(checkEffectivePrescriptionV2(a, { kind: "suspended" })).toEqual({ ok: true, relation: "suspended" });
            expect(checkEffectivePrescriptionV2(a, { kind: "replaced", byFamily: "recovery" })).toEqual({ ok: true, relation: "replaced" });
            if (a.admissibleMax !== null) {
              const lowest = doses.find((d) => d.family === a.admissibleMax!.family && d.measure === a.admissibleMax!.measure && (d.family !== "dh" || (a.admissibleMax!.family === "dh" && d.unit === a.admissibleMax!.unit)))!;
              expect(checkEffectivePrescriptionV2(a, { kind: "prescribed", dose: lowest }).ok).toBe(true);
            }
            checked++;
          }
    expect(checked).toBe(10 * 11 * 5 * 2);
  });

  it("case 6 — DH: a SECTION reference admits no FULL_RUN progression, and the reverse; an unknown unit admits no count", () => {
    expect(assess(dh(4, "FULL_RUN"), ref(dh(6, "SECTION")), reliable, CANDIDATE_ONE_STEP_POLICY_V2)).toMatchObject({ admissibleMax: null, riseAdmissible: false, situation: "reference_non_comparable", startingDoseDecisionRequired: true });
    expect(assess(dh(6, "SECTION"), ref(dh(4, "FULL_RUN")), reliable, CANDIDATE_ONE_STEP_POLICY_V2)).toMatchObject({ admissibleMax: null, situation: "reference_non_comparable" });
    expect(assess(dh(6, "UNKNOWN"), ref(dh(6, "SECTION")), reliable, CANDIDATE_ONE_STEP_POLICY_V2)).toMatchObject({ admissibleMax: null, situation: "unite_dh_inconnue" });
    expect(nextToleratedReferenceV2(ref(dh(6, "SECTION")), { dose: dh(4, "FULL_RUN"), date: "2026-11-14", evidence: reliable })).toEqual(ref(dh(6, "SECTION")));
  });

  it("counter-proof: never above the candidate; above the reference only with an explicit policy and a reliable result", () => {
    const doses = [step("LIGHT"), step("MODERATE"), step("MODERATE_PLUS"), minutes(45), minutes(60), minutes(75), minutes(90)];
    const mag = (d: DoseQuantityV2) => (d.measure === "dose_step" ? STRENGTH_DOSE_STEPS_V2.indexOf(d.step) : d.measure === "minutes" ? d.minutes : 0);
    for (const candidate of doses)
      for (const r of doses.filter((d) => d.family === candidate.family))
        for (const evidence of [{ kind: "absent" } as const, reliable, unfavourable]) {
          const none = assess(candidate, ref(r), evidence);
          const cand = assess(candidate, ref(r), evidence, CANDIDATE_ONE_STEP_POLICY_V2);
          expect(mag(none.admissibleMax!)).toBeLessThanOrEqual(Math.min(mag(candidate), mag(r)));
          expect(mag(cand.admissibleMax!)).toBeLessThanOrEqual(mag(candidate));
          if (mag(cand.admissibleMax!) > mag(r)) expect([evidence, cand.riseAdmissible]).toEqual([reliable, true]);
        }
    // Without any reference: the catalogue's introduction level caps a rise, flagged as a sports decision.
    expect(assess(step("MODERATE"), null, reliable, CANDIDATE_ONE_STEP_POLICY_V2)).toMatchObject({ admissibleMax: step("LIGHT"), situation: "sans_reference", startingDoseDecisionRequired: true });
  });
});

describe("SPORT-PLAN-03 contracts · session duration with ONE end (C1)", () => {
  it("the maximum equals the production estimator for every Force content, with and without the daily cool-down", () => {
    for (const content of strengthContents()) {
      const bare = strengthSessionDurationV2(content, { withDailyCoolDown: false });
      expect(bare.maxMin).toBe(estimateStrengthDurationMinutesV2(content));
      expect(bare.minMin).toBeLessThanOrEqual(bare.maxMin);
      let n = 0;
      const daily = appendStrengthCoolDownV2({ ...content, blocks: content.blocks.map((b, i) => ({ ...b, blockId: `b${i}`, items: b.items })) } as unknown as PrescriptionV2, () => `x${++n}`);
      const c1 = strengthSessionDurationV2(content, { withDailyCoolDown: true });
      expect([c1.maxMin, c1.end, c1.endBlocks]).toEqual([estimateStrengthDurationMinutesV2(daily), "daily_cool_down", 1]);
    }
  });

  it("counter-proof: a content that already ends is never given a second end", () => {
    const content = strengthContents()[0]!;
    let n = 0;
    const ended = appendStrengthCoolDownV2({ ...content, blocks: content.blocks.map((b, i) => ({ ...b, blockId: `b${i}`, items: b.items })) } as unknown as PrescriptionV2, () => `y${++n}`);
    const d = strengthSessionDurationV2(ended as unknown as PrescriptionV2Content, { withDailyCoolDown: true });
    expect([d.end, d.endBlocks, countEndBlocksV2(ended)]).toEqual(["content", 1, 1]);
    expect(d.maxMin).toBe(estimateStrengthDurationMinutesV2(ended));
  });

  it("verdicts against the slot, nothing removed: R46 is NON CONFORME (20 reserved, activity 20–40, sheet 28–55)", () => {
    expect(durationVerdictV2({ minMin: 38, maxMin: 47 }, 45)).toEqual({ verdict: "NON CONFORME À LA BORNE HAUTE", overflowMin: 2 });
    expect(durationVerdictV2({ minMin: 46, maxMin: 57 }, 60)).toEqual({ verdict: "CONFORME", overflowMin: 0 });
    expect(durationVerdictV2({ minMin: 28, maxMin: 55 }, 20)).toEqual({ verdict: "NON CONFORME", overflowMin: 35 });
    expect(protocolDurationV2("recovery_active_v1", 20)).toEqual({ protocolId: "recovery_active_v1", reservedMin: 20, required: { minMin: 20, maxMin: 40 }, fullSheet: { minMin: 28, maxMin: 55 }, verdict: "NON CONFORME", overflowMin: 35 });
  });
});

describe("SPORT-PLAN-03 contracts · race planned vs realised, no double count", () => {
  const races = [{ startDate: "2026-11-28", endDate: "2026-11-29" }];
  const planned = [{ date: "2026-11-24", kind: "recovery" as const }, { date: "2026-11-21", kind: "dh_habitual" as const }];
  const raceDays = (e: ReturnType<typeof exposureLedgerV2>) => e.filter((x) => x.date >= "2026-11-28").map((x) => `${x.date} ${x.kind} ${x.status} ${x.minutes} ${x.runs} ${x.unit}`);

  it("future: two planned race days, a load to expect; past without declaration: « passée, non confirmée », never realised", () => {
    expect(raceDays(exposureLedgerV2({ races, planned, asOf: "2026-11-20" }))).toEqual(["2026-11-28 race prevue null null null", "2026-11-29 race prevue null null null"]);
    const after = exposureLedgerV2({ races, planned, asOf: "2026-11-30" });
    expect(exposureSummaryV2(after).race).toEqual({ prevues: 0, realisees: 0, passeesNonConfirmees: 2, nonFaites: 0, minutesRealiseesConnues: 0, realiseesSansDuree: 0 });
  });

  it("declared: each race day realised once, official practice its own entry, unknown values stay null, a declared DH replaces the planned one", () => {
    const e = exposureLedgerV2({
      races,
      planned,
      asOf: "2026-11-30",
      declarations: [
        { date: "2026-11-28", kind: "official_practice", done: true, minutes: 120, runs: 4, unit: "FULL_RUN" },
        { date: "2026-11-28", kind: "race", done: true },
        { date: "2026-11-29", kind: "race", done: true, runs: 2 },
        { date: "2026-11-21", kind: "dh_habitual", done: true, minutes: 60 },
      ],
    });
    expect(raceDays(e)).toEqual(["2026-11-28 official_practice realisee 120 4 FULL_RUN", "2026-11-28 race realisee null null null", "2026-11-29 race realisee null 2 UNKNOWN"]);
    expect(e.filter((x) => x.date === "2026-11-21").map((x) => `${x.kind} ${x.source} ${x.minutes}`)).toEqual(["dh_habitual declaration 60"]);
    expect(exposureSummaryV2(e).race).toMatchObject({ realisees: 2, realiseesSansDuree: 2, minutesRealiseesConnues: 0 });
  });
});

describe("SPORT-PLAN-03 contracts · RPE semantics (docs/05)", () => {
  it("three RPEs with their own scales and uses; no session RPE in V2, never a progression gate", () => {
    expect(RPE_SEMANTICS_V2.set).toMatchObject({ scale: { min: 1, max: 10 }, recordedIn: "exercise_set_results.rpe_actual", progressionUse: "force" });
    expect(RPE_SEMANTICS_V2.activity).toMatchObject({ scale: { min: 1, max: 10 }, recordedIn: "session_activity_results.rpe_actual", progressionUse: "endurance" });
    expect(RPE_SEMANTICS_V2.session).toMatchObject({ scale: { min: 0, max: 10 }, recordedIn: "completed_sessions.rpe", collectedInV2: false, progressionUse: "none" });
  });

  it("every existing prescription complies: Force carries set RPEs on work items only, endurance and recovery activity RPEs on blocks, power none", () => {
    for (const c of strengthContents()) {
      const r = checkRpeSemanticsV2(c);
      expect(r.issues).toEqual([]);
      expect(r.targets.length).toBeGreaterThan(0);
      expect(r.targets.every((t) => t.kind === "set")).toBe(true);
    }
    for (const c of [buildAerobicBasePrescriptionV2Content({ sessionKind: "AEROBIC_BASE", durationMin: 60, catalog }), buildAerobicIntervalsPrescriptionV2Content({ sessionKind: "AEROBIC_INTERVALS", catalog }), buildRecoveryActivePrescriptionV2Content({ catalog })]) {
      const r = checkRpeSemanticsV2(c);
      expect([r.issues, r.targets.length > 0, r.targets.every((t) => t.kind === "activity")]).toEqual([[], true, true]);
    }
    expect(checkRpeSemanticsV2(buildPowerPrescriptionV2Content({ athleteTier: "advanced", equipment: EQUIPMENT.gym, catalog })).targets).toEqual([]);
  });

  it("counter-proof: an activity RPE on a Force block or a set RPE on an endurance item is reported", () => {
    const force = strengthContents()[0]!;
    expect(checkRpeSemanticsV2({ family: "strength", blocks: [{ ...force.blocks[0]!, rpeTarget: { min: 3, max: 4 } }] }).issues).toEqual([{ path: "blocks[0].rpeTarget", code: "activity_rpe_outside_endurance_or_recovery" }]);
    const workItem = force.blocks.find((b) => b.role === "main")!.items[0]!;
    expect(checkRpeSemanticsV2({ family: "endurance", blocks: [{ role: "main", instructionIds: [], items: [workItem] }] }).issues).toEqual([{ path: "blocks[0].items[0].rpeTarget", code: "set_rpe_outside_strength" }]);
  });
});

describe("SPORT-PLAN-03 contracts · non-prescriptive boundary", () => {
  it("V2-CONTRACTS-INTEGRATION-01: the V2 generation and daily final prescription import the session checks only; progression and race stay behind the barrel", () => {
    const SRC = fileURLToPath(new URL("../../src", import.meta.url));
    const contractImports = Object.fromEntries(
      globSync("**/*.ts", { cwd: SRC })
        .map((f) => f.replace(/\\/g, "/"))
        .filter((f) => !f.startsWith("sessionModelV2/contracts/"))
        .map((f) => [f, [...readFileSync(`${SRC}/${f}`, "utf8").matchAll(/from\s+["']([^"']*contracts\/[^"']*)["']/g)].map((m) => m[1]!).sort()] as const)
        .filter(([, imports]) => imports.length > 0)
    );
    expect(contractImports).toEqual({
      "sessionModelV2/index.ts": ["./contracts/index.js"],
      "sessionModelV2/orchestration/generatePlanV2InMemory.ts": ["../contracts/sessionContractChecksV2.js"],
      // V2-DH-UNIT-01 — the daily reads a stored count's unit (never the progression or race contracts).
      "sessionModelV2/final/buildFinalPrescriptionV2.ts": ["../contracts/dhRepetitionUnitV2.js", "../contracts/sessionContractChecksV2.js", "../contracts/sessionDurationContractV2.js"],
    });
  });
});
