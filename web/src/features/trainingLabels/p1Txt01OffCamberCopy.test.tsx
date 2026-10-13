import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DRILL_CATALOG } from "../../../../planning-engine/src/catalog/drillCatalog.js";
import { DRILL_INSTRUCTION_LABELS, translateDrillExecutionCue } from "./drillInstructionLabels";
import { ExecutablePrescriptionCard } from "../dailyPlan/ExecutablePrescriptionCard";
import type { ExecutablePrescription } from "../dailyPlan/dailyPlanTypes";
import { TrainingPlanSessionCard } from "../trainingPlanReview/components/TrainingPlanSessionCard";
import { COACHING_TEXTS_V1_0 } from "../finalPrescriptionV2/coachingTextsV1_0.generated";

// P1-TXT-01 (HPM 2026-10-13) — the V1 off-camber cue shown to riders no longer tells them to pedal through
// the off-camber section. Display only: the stored V1 prescriptions (English catalogue text) are unchanged.

const OFF_CAMBER = DRILL_CATALOG["cornering_off_camber"]!;
const STORED_V1_CUE = OFF_CAMBER.executionCue; // what every stored V1 prescription holds
const FIXED = "Engage ton poids côté aval du vélo et continue dans la section en dévers — ne lâche rien en plein virage.";
const PEDALING_INJUNCTION = /continue(r)? (de|à) pédaler|pédale(r|s)? (dans|à travers|pendant)|garde(r)? (le |un )?pédalage/i;

describe("P1-TXT-01 — the label", () => {
  it("stored V1 data is untouched: the frozen English source still says « keep pedaling » and still matches the label", () => {
    expect(STORED_V1_CUE).toContain("keep pedaling through the off-camber section");
    expect(DRILL_INSTRUCTION_LABELS.cornering_off_camber!.sourceExecutionCue).toBe(STORED_V1_CUE);
  });

  it("the stored cue is shown as the corrected French label: no pedaling, nothing added", () => {
    expect(translateDrillExecutionCue("cornering_off_camber", STORED_V1_CUE)).toBe(FIXED);
    expect(FIXED).not.toMatch(/pédal/i);
    // No new technical instruction and no absolute braking ban: same words as before, minus « de pédaler ».
    expect(FIXED).not.toMatch(/frein/i);
    expect(FIXED).toBe("Engage ton poids côté aval du vélo et continue de pédaler dans la section en dévers — ne lâche rien en plein virage.".replace(" de pédaler", ""));
  });

  it("other translations: none tells the rider to pedal; the remaining « pédale » words are pedal positions or « sans pédaler » between jumps", () => {
    for (const [id, t] of Object.entries(DRILL_INSTRUCTION_LABELS)) {
      expect(t.executionCue, id).not.toMatch(PEDALING_INJUNCTION);
      expect(t.successCriterion, id).not.toMatch(/pédal/i);
    }
    const withPedal = Object.entries(DRILL_INSTRUCTION_LABELS).filter(([, t]) => /pédal/i.test(t.executionCue)).map(([id]) => id).sort();
    expect(withPedal).toEqual(["cornering_berm_speed", "jumps_linked_tables", "jumps_table_top_basic", "roots_rocks_unweighted_line"]);
  });
});

describe("P1-TXT-01 — every surface showing the V1 cue", () => {
  it("Aujourd'hui (ExecutablePrescriptionCard, V1 executable prescription of the day)", () => {
    const prescription: ExecutablePrescription = {
      id: "p",
      generatedPlanSessionId: "s",
      schemaVersion: "v1",
      catalogVersion: "v1",
      structure: {
        domain: "dh_technical",
        schemaVersion: "v1",
        drills: [{ drillId: "cornering_off_camber", skillTarget: "cornering", terrainRequirement: "technical_trail", runs: 6, executionCue: STORED_V1_CUE, successCriterion: OFF_CAMBER.successCriteria, progressionCondition: "", regressionCondition: "" }],
      },
    } as ExecutablePrescription;
    const { container } = render(<ExecutablePrescriptionCard prescription={prescription} />);
    expect(screen.getByText(FIXED)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/pédal|pedal/i);
  });

  it("Programme / aperçu du plan (TrainingPlanSessionCard, V1 planned prescription)", () => {
    const { container } = render(
      <TrainingPlanSessionCard
        session={{
          id: "s",
          weekId: "w",
          date: "2026-10-20",
          kind: "DH_TECHNICAL",
          loadProfile: "MODERATE",
          durationMin: 90,
          doseTarget: { domain: "dh_technical", skillTargets: ["cornering"], focusedRunsCount: 6 },
          rationale: "Standard development week.",
          prescription: {
            status: "supported",
            schemaVersion: "v1",
            prescription: { id: "p", generatedPlanSessionId: "s", structure: { domain: "dh_technical", schemaVersion: "v1", drills: [{ drillId: "cornering_off_camber", skillTarget: "cornering", runs: 6, executionCue: STORED_V1_CUE }] } },
          },
        } as never}
      />
    );
    expect(screen.getByText(FIXED)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/pédal|pedal/i);
  });

  it("Séance guidée: V2 only (final prescription texts) — the V2 off-camber cue never told the rider to pedal", () => {
    expect(COACHING_TEXTS_V1_0["cue.cornering_off_camber"]!.text).not.toMatch(/pédal/i);
  });
});
