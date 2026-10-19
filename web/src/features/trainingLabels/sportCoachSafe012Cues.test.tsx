import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
// Test-only cross-boundary reads of the engine catalogues (same pattern as drillInstructionLabels.test.ts).
import { DRILL_CATALOG } from "../../../../planning-engine/src/catalog/drillCatalog.js";
import { COACHING_TEXT_CATALOG } from "../../../../planning-engine/src/catalog/coachingTextCatalog.js";
import { SESSION_DRILL_CATALOG_V2 } from "../../../../planning-engine/src/catalog/sessionDrillCatalogV2.js";
import { DRILL_INSTRUCTION_LABELS, translateDrillExecutionCue, translateDrillSuccessCriterion } from "./drillInstructionLabels";
import { DRILL_LABELS } from "./exerciseLabels";
import { COACHING_TEXTS_V1_0 } from "../finalPrescriptionV2/coachingTextsV1_0.generated";
import { ExecutablePrescriptionCard } from "../dailyPlan/ExecutablePrescriptionCard";
import type { ExecutablePrescription } from "../dailyPlan/dailyPlanTypes";
import { FinalPrescriptionV2Card } from "../finalPrescriptionV2/FinalPrescriptionV2Card";
import { TrainingPlanSessionCard } from "../trainingPlanReview/components/TrainingPlanSessionCard";
import { fakeBackend, prescriptionView } from "../../test/guidedSessionFakeBackend";
import { GuidedSessionHarness as Harness } from "../../test/GuidedSessionHarness";

// SPORT-COACH-SAFE-01.2 (HPM 2026-10-19) — four execution cues no longer say not to touch the brakes again, to ride
// a feature or a chute off the brakes, or to carry race-pace speed, and three drill names no longer promise speed or
// no braking. With the six criteria of SPORT-COACH-SAFE-01, the name, the cue and the criterion of each drill agree.
// Stored plans (V1 English copied at generation, V2 ids) read the corrected French; ids and passes are unchanged.

/** Former cues: [V1 English stored in plans, former V1 French label, former V2 French]. */
const FORMER_CUES: Readonly<Record<string, readonly [string, string, string]>> = {
  braking_late_entry: [
    "Delay brake release until just before the corner entry, then commit to the line without touching the brakes again.",
    "Garde les freins jusqu'à juste avant l'entrée du virage, puis engage-toi sur ta ligne sans retoucher aux freins.",
    "Garde les freins jusqu'à juste avant l'entrée du virage, puis engage-toi sur ta ligne sans retoucher aux freins.",
  ],
  braking_marked_zone_at_speed: [
    "Mark one short braking zone before each technical feature — brake hard there only, then release fully and ride the feature off the brakes.",
    "Marque une courte zone de freinage avant chaque passage technique — freine fort uniquement là, puis relâche complètement et passe l'obstacle sans freiner.",
    "Marque une courte zone de freinage avant le passage technique : freine fort uniquement là, puis relâche et passe sans freiner.",
  ],
  steep_terrain_off_brake_chute: [
    "Scrub speed before the chute, release the brakes through the steepest part and let the bike run out at the bottom — heels down, eyes on the exit.",
    "Casse ta vitesse avant le couloir raide, lâche les freins dans la partie la plus raide et laisse filer le vélo en bas — talons bas, regard sur la sortie.",
    "Casse ta vitesse avant le couloir, lâche les freins dans la partie la plus raide, talons bas, regard sur la sortie.",
  ],
  roots_rocks_committed: [
    "Pick your line before entry and carry race-pace speed through — trust the bike to track over the roots.",
    "Choisis ta ligne avant l'entrée et garde ta vitesse course jusqu'au bout — fais confiance au vélo pour passer les racines.",
    "Choisis ta ligne avant l'entrée et garde ta vitesse course jusqu'au bout.",
  ],
};
const FOUR = Object.keys(FORMER_CUES);

/** The corrected cues (same French for V1 and V2), the wording prepared in the SPORT-COACH-SAFE-01 gate. */
const CUES: Readonly<Record<string, string>> = {
  braking_late_entry:
    "Termine l'essentiel de ton freinage avant l'entrée du virage, relâche progressivement et engage-toi sur ta ligne ; refreine si ta vitesse ou l'adhérence l'exigent.",
  braking_marked_zone_at_speed:
    "Marque une courte zone de freinage avant chaque passage technique et fais-y l'essentiel de ton freinage ; dans le passage, garde ta trajectoire et freine si nécessaire.",
  steep_terrain_off_brake_chute:
    "Casse ta vitesse avant le couloir raide, puis dose tes freins sans bloquer les roues dans la partie la plus raide — talons bas, regard sur la sortie.",
  roots_rocks_committed:
    "Choisis ta ligne avant l'entrée et garde une vitesse que tu contrôles jusqu'au bout ; n'approche ta vitesse course que si l'adhérence et ton niveau le permettent.",
};

const NAMES: Readonly<Record<string, readonly [string, string]>> = {
  braking_marked_zone_at_speed: ["Points de freinage à vitesse de course", "Points de freinage marqués"],
  steep_terrain_off_brake_chute: ["Couloir raide sans freiner", "Couloir raide, freinage dosé"],
  roots_rocks_committed: ["Racines et rochers engagés, à vitesse", "Racines et rochers, ligne engagée"],
};

/** The six drills of SPORT-COACH-SAFE-01 (criteria) — name, cue and criterion must agree for each. */
const SIX = ["braking_late_entry", "cornering_berm_speed", "braking_marked_zone_at_speed", "steep_terrain_off_brake_chute", "roots_rocks_committed", "jumps_linked_tables"];

/** What a name, cue or criterion may no longer say (race speed only as a condition: « n'approche ta vitesse course que si… »). */
const CONTRADICTION =
  /sans freiner|sans retoucher|lâche les freins|laisse filer|garde ta vitesse course|à vitesse de course|à vitesse\b(?! que)|vitesse proche de la course|sans coup de frein|plus vite que|plus rapide que|plus loin dans le virage/i;
const UNCONDITIONAL_RACE_SPEED = (text: string) => /vitesse course/i.test(text) && !/n'approche ta vitesse course que si/i.test(text);

function v2DhView(drillId: string) {
  return prescriptionView("DH_TECHNICAL", (structure) => {
    const drill = structure.blocks.find((b: { role: string }) => b.role === "main").items[0];
    drill.drillId = drillId;
    drill.cueId = `cue.${drillId}`;
    drill.successCriterionId = `criterion.${drillId}`;
  });
}

/** A stored V1 prescription with the six drills exactly as plans generated before this change hold them. */
function storedV1(drillIds: readonly string[]): ExecutablePrescription {
  return {
    id: "p",
    generatedPlanSessionId: "s",
    schemaVersion: "v1",
    catalogVersion: "v1",
    structure: {
      domain: "dh_technical",
      schemaVersion: "v1",
      drills: drillIds.map((drillId) => ({
        drillId,
        skillTarget: DRILL_CATALOG[drillId]!.skillTarget,
        terrainRequirement: DRILL_CATALOG[drillId]!.terrainRequirement,
        runs: 6,
        executionCue: FORMER_CUES[drillId]?.[0] ?? DRILL_CATALOG[drillId]!.executionCue,
        successCriterion: DRILL_INSTRUCTION_LABELS[drillId]!.legacySourceSuccessCriteria![0],
        progressionCondition: "",
        regressionCondition: "",
      })),
    },
  } as ExecutablePrescription;
}

describe("SPORT-COACH-SAFE-01.2 — four cues and three names", () => {
  it("V1, plans already stored: the former English cue reads as the corrected French cue", () => {
    for (const id of FOUR) {
      expect(translateDrillExecutionCue(id, FORMER_CUES[id]![0]), id).toBe(CUES[id]);
      expect(DRILL_INSTRUCTION_LABELS[id]!.legacySourceExecutionCues, id).toEqual([FORMER_CUES[id]![0]]);
    }
  });

  it("V1, future plans: the catalogue carries a new English cue, read as the same French; the former one is gone", () => {
    for (const id of FOUR) {
      const current = DRILL_CATALOG[id]!.executionCue;
      expect(current, id).not.toBe(FORMER_CUES[id]![0]);
      expect(DRILL_INSTRUCTION_LABELS[id]!.sourceExecutionCue, id).toBe(current);
      expect(translateDrillExecutionCue(id, current), id).toBe(CUES[id]);
    }
  });

  it("V2 (stored cue ids, old and new plans alike): the catalogue and its web mirror carry the corrected cue", () => {
    for (const id of FOUR) {
      expect(COACHING_TEXT_CATALOG[`cue.${id}`]!.text["fr-CH"], id).toBe(CUES[id]);
      expect(COACHING_TEXTS_V1_0[`cue.${id}`], id).toEqual({ kind: "cue", text: CUES[id] });
    }
  });

  it("names: new display labels for the same ids, in V1 and V2 alike (ids, catalogue entries and English names untouched)", () => {
    for (const [id, [former, current]] of Object.entries(NAMES)) {
      expect(DRILL_LABELS[id], id).toBe(current);
      expect(DRILL_LABELS[id], id).not.toBe(former);
      expect(DRILL_CATALOG[id]?.id, id).toBe(id);
      expect(SESSION_DRILL_CATALOG_V2[id]?.drillId, id).toBe(id);
    }
    expect(DRILL_CATALOG.steep_terrain_off_brake_chute!.displayName).toBe("Steep Chute Off the Brakes"); // engine metadata, never displayed
  });

  it("each cue keeps its exercise: the technique it teaches is still named (no artificially easy drill)", () => {
    expect(CUES.braking_late_entry).toMatch(/avant l'entrée du virage.*relâche progressivement.*ligne/);
    expect(CUES.braking_marked_zone_at_speed).toMatch(/courte zone de freinage avant chaque passage technique.*l'essentiel de ton freinage/);
    expect(CUES.steep_terrain_off_brake_chute).toMatch(/Casse ta vitesse avant le couloir raide.*talons bas, regard sur la sortie/);
    expect(CUES.roots_rocks_committed).toMatch(/Choisis ta ligne avant l'entrée.*jusqu'au bout/);
    for (const id of FOUR) expect(CUES[id], id).not.toMatch(/\d/);
  });

  it("name, cue and criterion agree for the six drills, in V1 and V2: nothing says not to brake or to go faster; race speed only as a condition", () => {
    for (const id of SIX) {
      const t = DRILL_INSTRUCTION_LABELS[id]!;
      const texts = {
        name: DRILL_LABELS[id]!,
        v1Cue: t.executionCue,
        v1Criterion: t.successCriterion,
        v2Cue: COACHING_TEXTS_V1_0[`cue.${id}`]!.text,
        v2Criterion: COACHING_TEXTS_V1_0[`criterion.${id}`]!.text,
      };
      for (const [what, text] of Object.entries(texts)) {
        expect(text, `${id} ${what}`).not.toMatch(CONTRADICTION);
        expect(UNCONDITIONAL_RACE_SPEED(text), `${id} ${what}`).toBe(false);
      }
      // The corrected cues and criteria are one wording for V1 and V2; the two untouched cues keep their own V1 / V2 phrasing.
      if (FOUR.includes(id)) expect(texts.v1Cue, id).toBe(texts.v2Cue);
      expect(texts.v1Criterion, id).toBe(texts.v2Criterion);
    }
  });

  it("T45 contract kept: the two race-intensity drills among the six still carry « vitesse course » in their cue or criterion, as a condition", () => {
    for (const id of ["braking_marked_zone_at_speed", "roots_rocks_committed"]) {
      const d = SESSION_DRILL_CATALOG_V2[id]!;
      const texts = [COACHING_TEXT_CATALOG[d.cueId]!, COACHING_TEXT_CATALOG[d.criterionId]!].map((x) => x.text["fr-CH"]).join(" ");
      expect(texts, id).toMatch(/n'approche ta vitesse course que si/i);
    }
  });

  it("only these four cues have a former source; the six criteria keep theirs (SPORT-COACH-SAFE-01)", () => {
    const withLegacyCue = Object.entries(DRILL_INSTRUCTION_LABELS).filter(([, t]) => t.legacySourceExecutionCues !== undefined).map(([id]) => id).sort();
    expect(withLegacyCue).toEqual([...FOUR].sort());
    for (const id of SIX) expect(translateDrillSuccessCriterion(id, DRILL_INSTRUCTION_LABELS[id]!.legacySourceSuccessCriteria![0]), id).toBe(DRILL_INSTRUCTION_LABELS[id]!.successCriterion);
  });
});

describe("SPORT-COACH-SAFE-01.2 — every surface, stored plans", () => {
  it("Aujourd'hui, V1 (ExecutablePrescriptionCard): a stored plan of the six drills shows new names, cues and criteria, no contradiction", () => {
    const { container } = render(<ExecutablePrescriptionCard prescription={storedV1(SIX)} />);
    const text = container.textContent ?? "";
    for (const id of FOUR) expect(text, id).toContain(CUES[id]);
    for (const [, [former, current]] of Object.entries(NAMES)) {
      expect(text).toContain(current);
      expect(text).not.toContain(former);
    }
    expect(text).not.toMatch(CONTRADICTION);
    expect(UNCONDITIONAL_RACE_SPEED(text)).toBe(false);
  });

  it("Programme (TrainingPlanSessionCard): a stored V1 session shows the new names and cues", () => {
    const { container } = render(
      <TrainingPlanSessionCard
        session={{
          id: "s",
          weekId: "w",
          date: "2026-10-20",
          kind: "DH_TECHNICAL",
          loadProfile: "MODERATE",
          durationMin: 90,
          doseTarget: { domain: "dh_technical", skillTargets: ["braking"], focusedRunsCount: 6 },
          rationale: "Standard development week.",
          prescription: {
            status: "supported",
            schemaVersion: "v1",
            prescription: {
              id: "p",
              generatedPlanSessionId: "s",
              structure: { domain: "dh_technical", schemaVersion: "v1", drills: FOUR.map((drillId) => ({ drillId, skillTarget: DRILL_CATALOG[drillId]!.skillTarget, runs: 6, executionCue: FORMER_CUES[drillId]![0] })) },
            },
          },
        } as never}
      />
    );
    const text = container.textContent ?? "";
    for (const id of FOUR) expect(text, id).toContain(CUES[id]);
    for (const [, [former, current]] of Object.entries(NAMES)) {
      expect(text).toContain(current);
      expect(text).not.toContain(former);
    }
    expect(text).not.toMatch(CONTRADICTION);
  });

  it("Aujourd'hui and history, V2 (FinalPrescriptionV2Card): each of the six drills shows a coherent name, cue and criterion", () => {
    for (const id of SIX) {
      const { container, unmount } = render(<FinalPrescriptionV2Card state={{ kind: "created", prescription: v2DhView(id) }} />);
      const text = container.textContent ?? "";
      expect(text, id).toContain(DRILL_LABELS[id]!);
      expect(text, id).toContain(`Consigne : ${COACHING_TEXTS_V1_0[`cue.${id}`]!.text}`);
      expect(text, id).not.toMatch(CONTRADICTION);
      expect(UNCONDITIONAL_RACE_SPEED(text), id).toBe(false);
      unmount();
    }
  });

  it("séance guidée, V2 (DhSessionModule): the started steep-chute session shows the new name and cue", async () => {
    const b = fakeBackend({ prescription: v2DhView("steep_terrain_off_brake_chute") });
    render(<Harness deps={b.deps} />);
    await userEvent.click(await screen.findByRole("button", { name: "Commencer la séance" }));
    await waitFor(() => expect(screen.getByTestId("success-criterion")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Couloir raide, freinage dosé" })).toBeInTheDocument();
    expect(document.body.textContent).toContain(`Consigne : ${CUES.steep_terrain_off_brake_chute}`);
    expect(document.body.textContent).not.toMatch(CONTRADICTION);
  });
});
