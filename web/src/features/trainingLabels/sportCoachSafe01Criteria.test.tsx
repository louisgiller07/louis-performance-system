import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
// Test-only cross-boundary reads of the engine catalogues (same pattern as drillInstructionLabels.test.ts).
import { DRILL_CATALOG } from "../../../../planning-engine/src/catalog/drillCatalog.js";
import { COACHING_TEXT_CATALOG } from "../../../../planning-engine/src/catalog/coachingTextCatalog.js";
import { DRILL_INSTRUCTION_LABELS, translateDrillSuccessCriterion } from "./drillInstructionLabels";
import { COACHING_TEXTS_V1_0 } from "../finalPrescriptionV2/coachingTextsV1_0.generated";
import { ExecutablePrescriptionCard } from "../dailyPlan/ExecutablePrescriptionCard";
import type { ExecutablePrescription } from "../dailyPlan/dailyPlanTypes";
import { FinalPrescriptionV2Card } from "../finalPrescriptionV2/FinalPrescriptionV2Card";
import { fakeBackend, prescriptionView } from "../../test/guidedSessionFakeBackend";
import { GuidedSessionHarness as Harness } from "../../test/GuidedSessionHarness";

// SPORT-COACH-SAFE-01 (HPM 2026-10-19) — six DH success criteria no longer ask for later braking, a faster exit,
// no braking or race speed. Plans already stored (V1: the former English copied at generation; V2: criterion ids)
// read the corrected French on every surface; the catalogues carry it for future plans. Display and catalogue text
// only: drills, passes, cues, doses and stored prescriptions are unchanged.

/** The former texts, frozen here: [V1 English stored in plans, former V1 French label, former V2 French]. */
const FORMER: Readonly<Record<string, readonly [string, string, string]>> = {
  braking_late_entry: [
    "Maintains entry speed later into the corner without overshooting the line.",
    "Tu gardes ta vitesse d'entrée plus loin dans le virage, sans élargir ta trajectoire.",
    "Vitesse d'entrée gardée plus loin dans le virage, sans élargir ta trajectoire.",
  ],
  cornering_berm_speed: [
    "Exits the berm faster than entry speed on 3/5 runs, no drift correction.",
    "Tu sors du virage relevé plus vite que tu n'y es entré, sans devoir rattraper une glisse, sur 3 runs sur 5.",
    "Sortie du virage relevé plus rapide que l'entrée, sans rattraper une glisse.",
  ],
  braking_marked_zone_at_speed: [
    "Brakes only in the marked zones and rides every technical feature off the brakes, at race speed, on 3/5 runs.",
    "Tu freines seulement dans les zones marquées et tu passes chaque passage technique sans freiner, à vitesse course, sur 3 runs sur 5.",
    "Freinage seulement dans la zone marquée, passage technique roulé sans freiner, à vitesse course.",
  ],
  steep_terrain_off_brake_chute: [
    "Rides the steepest part of the chute off the brakes, with no front-wheel wash, on 3/5 runs.",
    "Tu passes la partie la plus raide du couloir sans freiner et sans perte de l'avant, sur 3 runs sur 5.",
    "Partie la plus raide passée sans freiner et sans perte de l'avant.",
  ],
  roots_rocks_committed: [
    "Clears the section at race-relevant speed on 3/5 runs.",
    "Tu passes la section à une vitesse proche de la course, sur 3 runs sur 5.",
    "Section passée à une vitesse proche de la course, sur la ligne choisie.",
  ],
  jumps_linked_tables: [
    "Clears two or three tables in a row with level landings and no speed-check braking on 3/5 runs.",
    "Tu passes deux ou trois table-tops d'affilée, réceptions à plat, sans coup de frein pour contrôler ta vitesse, sur 3 runs sur 5.",
    "Table-tops enchaînés, réceptions à plat, sans coup de frein.",
  ],
};
const SIX = Object.keys(FORMER);
/** Race / no-brake wording outside the six (race-execution and line-comparison drills, advanced and MODERATE only). */
const OTHER_RACE_CRITERIA_V1 = ["line_choice_fast_line_compare", "race_execution_split_pace"];
const OTHER_RACE_CRITERIA_V2 = ["criterion.line_choice_fast_line_compare", "criterion.race_execution_full_run_sim", "criterion.race_execution_split_pace"];

/** The corrected wording, one per drill, identical for V1 and V2 (submitted to the physical trainer). */
const CORRECTED: Readonly<Record<string, string>> = {
  braking_late_entry:
    "Tu termines l'essentiel de ton freinage avant d'entrer dans le virage et tu tiens ta trajectoire jusqu'à la sortie, à une vitesse adaptée à l'adhérence et à ton niveau. Tu peux freiner de nouveau si c'est nécessaire.",
  cornering_berm_speed:
    "Tu traverses le virage relevé sur une trajectoire régulière et tu en sors stable, sans glisse à rattraper. Ta vitesse reste adaptée à l'adhérence et à ton niveau ; freine avant l'entrée si nécessaire.",
  braking_marked_zone_at_speed:
    "Tu fais l'essentiel de ton freinage dans la zone marquée et tu restes en contrôle sur ta trajectoire dans le passage technique ; tu peux y freiner si c'est nécessaire. N'approche ta vitesse course que si l'adhérence, les conditions et ton niveau le permettent.",
  steep_terrain_off_brake_chute:
    "Tu descends la partie la plus raide en contrôle, sans blocage de roue ni perte de l'avant, en dosant ton freinage selon la pente et l'adhérence.",
  roots_rocks_committed:
    "Tu passes la section sur la ligne choisie, stable et en contrôle, à une vitesse que tu maîtrises selon l'adhérence et les conditions, en freinant si nécessaire.",
  jumps_linked_tables:
    "Tu enchaînes les table-tops avec des réceptions à plat et contrôlées, à une vitesse réglée avant la série selon les conditions et ton niveau. Si ta vitesse ne te permet pas de rester en contrôle, freine avant le saut suivant ou roule-le.",
};

/** What the six former criteria asked for. */
const RISKY = /sans freiner|sans coup de frein|plus vite que|plus rapide que|plus loin dans le virage|vitesse proche de la course|passage technique roulé|runs sur/i;

/** A stored V1 executable prescription holding the six drills with the former English (what every V1 plan holds). */
function storedV1Prescription(): ExecutablePrescription {
  return {
    id: "p",
    generatedPlanSessionId: "s",
    schemaVersion: "v1",
    catalogVersion: "v1",
    structure: {
      domain: "dh_technical",
      schemaVersion: "v1",
      drills: SIX.map((drillId) => ({
        drillId,
        skillTarget: DRILL_CATALOG[drillId]!.skillTarget,
        terrainRequirement: DRILL_CATALOG[drillId]!.terrainRequirement,
        runs: 6,
        executionCue: DRILL_CATALOG[drillId]!.executionCue,
        successCriterion: FORMER[drillId]![0],
        progressionCondition: "",
        regressionCondition: "",
      })),
    },
  } as ExecutablePrescription;
}

/** The V2 DH fixture with its single drill set to `drillId` (ids only, as stored). */
function v2DhView(drillId: string) {
  return prescriptionView("DH_TECHNICAL", (structure) => {
    const drill = structure.blocks.find((b: { role: string }) => b.role === "main").items[0];
    drill.drillId = drillId;
    drill.cueId = `cue.${drillId}`;
    drill.successCriterionId = `criterion.${drillId}`;
  });
}

const successLines = (root: HTMLElement) => within(root).queryAllByText(/^Réussite : /).map((p) => p.textContent ?? "");

describe("SPORT-COACH-SAFE-01 — the six DH success criteria", () => {
  it("V1, plans already stored: the former English of each criterion reads as the corrected French", () => {
    for (const id of SIX) {
      expect(translateDrillSuccessCriterion(id, FORMER[id]![0]), id).toBe(CORRECTED[id]);
      expect(DRILL_INSTRUCTION_LABELS[id]!.legacySourceSuccessCriteria, id).toEqual([FORMER[id]![0]]);
    }
  });

  it("V1, future plans: the catalogue carries a new English source, read as the same French; the former English is gone from it", () => {
    for (const id of SIX) {
      const current = DRILL_CATALOG[id]!.successCriteria;
      expect(current, id).not.toBe(FORMER[id]![0]);
      expect(DRILL_INSTRUCTION_LABELS[id]!.sourceSuccessCriterion, id).toBe(current);
      expect(translateDrillSuccessCriterion(id, current), id).toBe(CORRECTED[id]);
    }
  });

  it("V2 (stored criterion ids, old and new plans alike): the catalogue and its web mirror carry the corrected French", () => {
    for (const id of SIX) {
      expect(COACHING_TEXT_CATALOG[`criterion.${id}`]!.text["fr-CH"], id).toBe(CORRECTED[id]);
      expect(COACHING_TEXTS_V1_0[`criterion.${id}`], id).toEqual({ kind: "success_criterion", text: CORRECTED[id] });
    }
  });

  it("the corrected wording: controlled line, speed suited to grip / conditions / level, braking allowed, no speed push, no figure", () => {
    for (const id of SIX) {
      const text = CORRECTED[id]!;
      expect(text, id).not.toMatch(RISKY);
      expect(text, id).toMatch(/contrôle|trajectoire|stable/);
      expect(text, id).toMatch(/adhérence|conditions|niveau|pente/);
      expect(text, id).toMatch(/frein/);
      expect(text, id).not.toMatch(/\d/);
      // The only race-speed mention is a condition (it also keeps the P0 race-intensity lock of T45 on this drill).
      if (/vitesse course/.test(text)) expect(text, id).toMatch(/N'approche ta vitesse course que si l'adhérence, les conditions et ton niveau le permettent/);
    }
    expect(SIX.filter((id) => /vitesse course/.test(CORRECTED[id]!))).toEqual(["braking_marked_zone_at_speed"]);
  });

  it("nothing else changes: only these six criteria have a former source; the other translations and V2 criteria keep their texts", () => {
    const withLegacy = Object.entries(DRILL_INSTRUCTION_LABELS).filter(([, t]) => t.legacySourceSuccessCriteria !== undefined).map(([id]) => id).sort();
    expect(withLegacy).toEqual([...SIX].sort());
    // Outside the six, the remaining race / no-brake wording is in the race-execution and line-comparison drills
    // (advanced, MODERATE only; out of this scope, listed in the gate for the physical trainer).
    const RACE_OR_NO_BRAKE = /sans freiner|sans coup de frein|plus vite que|plus rapide que|vitesse course|mode course|vitesse proche de la course/i;
    const v1Others = Object.entries(DRILL_INSTRUCTION_LABELS).filter(([id, t]) => !SIX.includes(id) && RACE_OR_NO_BRAKE.test(t.successCriterion)).map(([id]) => id).sort();
    expect(v1Others).toEqual(OTHER_RACE_CRITERIA_V1);
    const v2Others = Object.entries(COACHING_TEXTS_V1_0).filter(([key, t]) => key.startsWith("criterion.") && !SIX.includes(key.slice("criterion.".length)) && RACE_OR_NO_BRAKE.test(t.text)).map(([key]) => key).sort();
    expect(v2Others).toEqual(OTHER_RACE_CRITERIA_V2);
  });
});

describe("SPORT-COACH-SAFE-01 — every surface showing a criterion", () => {
  it("Aujourd'hui, V1 (ExecutablePrescriptionCard): a stored plan shows the six corrected criteria and none of the former ones", () => {
    const { container } = render(<ExecutablePrescriptionCard prescription={storedV1Prescription()} />);
    expect(successLines(container)).toEqual(SIX.map((id) => `Réussite : ${CORRECTED[id]}`));
    for (const id of SIX) {
      expect(container.textContent, id).not.toContain(FORMER[id]![0]);
      expect(container.textContent, id).not.toContain(FORMER[id]![1]);
    }
  });

  it("Aujourd'hui and history, V2 (FinalPrescriptionV2Card): each of the six drills shows its corrected criterion", () => {
    for (const id of SIX) {
      const { container, unmount } = render(<FinalPrescriptionV2Card state={{ kind: "created", prescription: v2DhView(id) }} />);
      expect(successLines(container), id).toEqual([`Réussite : ${CORRECTED[id]}`]);
      expect(container.textContent, id).not.toContain(FORMER[id]![2]);
      unmount();
    }
  });

  it("séance guidée, V2 (DhSessionModule): the started session shows the corrected criterion", async () => {
    const b = fakeBackend({ prescription: v2DhView("braking_marked_zone_at_speed") });
    render(<Harness deps={b.deps} />);
    await userEvent.click(await screen.findByRole("button", { name: "Commencer la séance" }));
    await waitFor(() => expect(screen.getByTestId("success-criterion")).toBeInTheDocument());
    expect(screen.getByTestId("success-criterion").textContent).toBe(`Critère de réussite : ${CORRECTED.braking_marked_zone_at_speed}`);
    expect(document.body.textContent).not.toContain(FORMER.braking_marked_zone_at_speed![2]);
  });
});
