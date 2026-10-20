import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
// Test-only cross-boundary read of the engine text catalogue (same pattern as the other catalogue drift tests).
import { COACHING_TEXT_CATALOG } from "../../../../planning-engine/src/catalog/coachingTextCatalog.js";
import { COACHING_TEXTS_V1_0 } from "./coachingTextsV1_0.generated";
import { FinalPrescriptionV2Card } from "./FinalPrescriptionV2Card";
import { DRILL_LABELS } from "../trainingLabels/exerciseLabels";
import { fakeBackend, prescriptionView } from "../../test/guidedSessionFakeBackend";
import { GuidedSessionHarness as Harness } from "../../test/GuidedSessionHarness";

// SPORT-COACH-SAFE-01 finalisation (HPM 2026-10-20) — the objective of V2 cornering DH sessions no longer pushes exit
// speed. Stored V2 prescriptions keep `intentId: "dh_corner_exit_speed"`; the web resolves it to the corrected text,
// for existing and future plans alike. Same id, same session content.

const FORMER = "Sortir des virages avec plus de vitesse.";
const CORRECTED = "Sortir des virages sur une trajectoire stable et maîtrisée.";
const SPEED_PUSH = /plus de vitesse|plus vite|plus rapide|sans freiner|vitesse course|vitesse de course/i;

describe("SPORT-COACH-SAFE-01 — V2 cornering objective", () => {
  it("the engine catalogue and its web mirror carry the corrected objective; the former one is gone from the mirror", () => {
    expect(COACHING_TEXT_CATALOG["intent.dh_corner_exit_speed"]!.text["fr-CH"]).toBe(CORRECTED);
    expect(COACHING_TEXTS_V1_0["intent.dh_corner_exit_speed"]).toEqual({ kind: "intent", text: CORRECTED });
    expect(Object.values(COACHING_TEXTS_V1_0).some((t) => t.text === FORMER)).toBe(false);
    expect(CORRECTED).not.toMatch(SPEED_PUSH);
  });

  it("a stored V2 cornering prescription (intentId unchanged) decodes to the corrected objective", () => {
    const view = prescriptionView("DH_TECHNICAL");
    expect(view.intent).toBe(CORRECTED);
  });

  it("Aujourd'hui, historique, programme (FinalPrescriptionV2Card): the objective, the drill name, cue and criterion agree", () => {
    const { container } = render(<FinalPrescriptionV2Card state={{ kind: "created", prescription: prescriptionView("DH_TECHNICAL") }} />);
    const text = container.textContent ?? "";
    expect(text).toContain(CORRECTED);
    expect(text).not.toContain(FORMER);
    expect(text).toContain(DRILL_LABELS.cornering_berm_speed!);
    expect(text).toContain(`Réussite : ${COACHING_TEXTS_V1_0["criterion.cornering_berm_speed"]!.text}`);
    expect(COACHING_TEXTS_V1_0["criterion.cornering_berm_speed"]!.text).not.toMatch(SPEED_PUSH);
  });

  it("séance guidée (GuidedSessionView): the header shows the corrected objective, never the former one", async () => {
    const b = fakeBackend({ prescription: prescriptionView("DH_TECHNICAL") });
    render(<Harness deps={b.deps} />);
    await screen.findByRole("button", { name: "Commencer la séance" });
    expect(screen.getByText(CORRECTED)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(FORMER);
  });
});
