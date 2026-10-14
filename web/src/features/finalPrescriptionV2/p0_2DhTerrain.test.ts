import { describe, expect, it } from "vitest";
import { decodeFinalPrescriptionV2 } from "./decodeFinalPrescriptionV2";
import { keepFinalPrescription } from "../../test/fixtures/finalPrescriptionV2Fixtures";
import { COACHING_TEXTS_V1_0 } from "./coachingTextsV1_0.generated";

// P0-2 (HPM 2026-10-13) — content added to session-model-v2.6 without a version change: the prescriptions
// already stored keep rendering exactly as before, and the new V2-only drill renders with its own texts.

type Drill = { kind: string; drillId: string; cueId: string; successCriterionId: string; vigilanceIds: string[] };

function dhWith(drillId: string, intentId: string, vigilanceIds: string[]) {
  const { record } = keepFinalPrescription("DH_TECHNICAL");
  record.structure.intentId = intentId;
  for (const block of record.structure.blocks as { items: Drill[] }[]) {
    for (const item of block.items) {
      if (item.kind !== "drill") continue;
      Object.assign(item, { drillId, cueId: `cue.${drillId}`, successCriterionId: `criterion.${drillId}`, vigilanceIds });
    }
  }
  return record;
}
const drillView = (r: ReturnType<typeof decodeFinalPrescriptionV2>) => (r.ok ? r.view.blocks.flatMap((b) => b.items).find((i) => i.kind === "drill") : undefined);

describe("P0-2 — V2 prescriptions after the catalogue change", () => {
  it("a stored v2.6 DH prescription (genuine engine fixture) still decodes, under its own manifest", () => {
    const { record } = keepFinalPrescription("DH_TECHNICAL");
    expect(record.catalogVersion).toBe("session-model-v2.6");
    expect(decodeFinalPrescriptionV2(record).ok).toBe(true);
  });

  it("a stored off-camber prescription renders unchanged: same name, cue, criterion and intent texts as before P0-2", () => {
    const r = decodeFinalPrescriptionV2(dhWith("cornering_off_camber", "dh_corner_exit_speed", ["vigilance.dh_stop_on_precision_loss"]));
    expect(r.ok).toBe(true);
    expect(drillView(r)).toMatchObject({
      drillId: "cornering_off_camber",
      name: "Engagement en virage en dévers",
      cue: "Engage ton poids côté aval du vélo et continue dans la section en dévers, sans lâcher en plein virage.",
      successCriterion: "Section en dévers passée sur ta ligne, sans pied posé.",
    });
    expect(r.ok && r.view.intent).toBe("Sortir des virages avec plus de vitesse.");
  });

  it("the new general advanced cornering drill renders with its draft texts and its own intent (no imposed speed increase)", () => {
    const r = decodeFinalPrescriptionV2(dhWith("cornering_advanced_line_exit", "dh_corner_line_control", ["vigilance.dh_scout_first", "vigilance.dh_stop_on_precision_loss"]));
    expect(r.ok).toBe(true);
    expect(drillView(r)).toMatchObject({
      drillId: "cornering_advanced_line_exit",
      name: "Trajectoire et sortie de virage",
      cue: COACHING_TEXTS_V1_0["cue.cornering_advanced_line_exit"]!.text,
      successCriterion: COACHING_TEXTS_V1_0["criterion.cornering_advanced_line_exit"]!.text,
    });
    expect(r.ok && r.view.intent).toBe("Choisir et répéter une trajectoire propre, avec une sortie stable.");
    expect(r.ok && r.view.intent).not.toMatch(/vitesse/);
  });
});
