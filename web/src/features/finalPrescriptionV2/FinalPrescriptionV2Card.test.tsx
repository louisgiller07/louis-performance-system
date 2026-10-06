import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FinalPrescriptionV2Card } from "./FinalPrescriptionV2Card";
import { BLOCKED_MESSAGES, formatMeasure, INVALID_MESSAGE, MISSING_MESSAGE, REST_MESSAGE } from "./finalPrescriptionV2Copy";
import { decodeFinalPrescriptionV2 } from "./decodeFinalPrescriptionV2";
import { COACHING_TEXTS_V1_0 } from "./coachingTextsV1_0.generated";
import { keepFinalPrescription, type FixtureKind } from "../../test/fixtures/finalPrescriptionV2Fixtures";
import { PRESCRIPTION_UNAVAILABLE_MESSAGE } from "../prescriptions/prescriptionRead";

const text = (id: string) => COACHING_TEXTS_V1_0[id]!.text;
function created(kind: FixtureKind) {
  const r = decodeFinalPrescriptionV2(keepFinalPrescription(kind).record);
  if (!r.ok) throw new Error(r.reason);
  return { kind: "created" as const, prescription: r.view };
}

describe("FinalPrescriptionV2Card — read-only rendering (UX-11A.5c.4)", () => {
  it("Force: intent, warm-up then exercises in order, sets × measure, RPE, rest, ramp-up, cue, vigilance; no legacy dose; no action", () => {
    const { record } = keepFinalPrescription("STRENGTH_LOWER");
    const { container } = render(<FinalPrescriptionV2Card state={created("STRENGTH_LOWER")} />);
    expect(screen.getByText(text(`intent.${record.structure.intentId}`))).toBeInTheDocument();
    expect([...container.querySelectorAll("[data-block-role]")].map((b) => b.getAttribute("data-block-role"))).toEqual(
      record.structure.blocks.map((b: { role: string }) => b.role)
    );
    expect(screen.getByText("Échauffement")).toBeInTheDocument();
    expect(screen.getByText("Goblet squat")).toBeInTheDocument();
    expect(screen.getByText("4 séries × 6–8 répétitions — RPE 7–8")).toBeInTheDocument();
    expect(screen.getByText("Repos : 2–3 min")).toBeInTheDocument();
    expect(screen.getByText(`Montée en charge : 1–2 séries — ${text("instruction.strength_warm_up.main_movement_ramp")}`)).toBeInTheDocument();
    expect(screen.getByText(`Consigne : ${text("cue.goblet_squat")}`)).toBeInTheDocument();
    expect(screen.getAllByText(`Vigilance : ${text("vigilance.knee_pain_free_range")}`).length).toBeGreaterThan(0);
    expect(container.textContent).toMatch(/par côté/);
    expect(container.textContent).not.toMatch(/setVolume|targetRpeOrRir/);
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(container.querySelectorAll("input, form")).toHaveLength(0);
  });

  it("Force: every item keeps its prescriptionItemId (rendering order = document order)", () => {
    const { record } = keepFinalPrescription("STRENGTH_UPPER");
    const { container } = render(<FinalPrescriptionV2Card state={created("STRENGTH_UPPER")} />);
    const ids = record.structure.blocks.flatMap((b: { items: { prescriptionItemId: string }[] }) => b.items.map((i) => i.prescriptionItemId));
    expect([...container.querySelectorAll("[data-item-id]")].map((e) => e.getAttribute("data-item-id"))).toEqual(ids);
  });

  it("DH: drill, passes of this drill (never runs of the day), cue, success criterion, brief / warm-up / application / cool-down", () => {
    const { record } = keepFinalPrescription("DH_TECHNICAL");
    const drill = record.structure.blocks.find((b: { role: string }) => b.role === "main").items[0];
    const { container } = render(<FinalPrescriptionV2Card state={created("DH_TECHNICAL")} />);
    expect(screen.getByText(`${drill.measure.count} passages`)).toBeInTheDocument();
    expect(screen.getByText(`Consigne : ${text(drill.cueId)}`)).toBeInTheDocument();
    expect(screen.getByText(`Réussite : ${text(drill.successCriterionId)}`)).toBeInTheDocument();
    for (const id of ["instruction.dh.brief", "instruction.dh.warm_up_easy", "instruction.dh.apply_cue", "instruction.dh.debrief_and_check"]) expect(screen.getByText(text(id))).toBeInTheDocument();
    // The passes count is never turned into a number of runs / descents of the day
    // (the catalogue texts themselves may mention descents without a number).
    expect(container.textContent).not.toMatch(new RegExp(`${drill.measure.count} *(descentes|runs)`, "i"));
    expect(container.textContent).not.toMatch(/\d+\s*(descentes|runs)/i);
  });

  it("endurance: allowed activities, warm-up / main / cool-down durations and RPE, talk test, no fake exercise", () => {
    const { container } = render(<FinalPrescriptionV2Card state={created("AEROBIC_BASE")} />);
    expect(screen.getByText("Activité au choix : Vélo de route, VTT roulant, Home-trainer, Course à pied")).toBeInTheDocument();
    expect(screen.getByText("Échauffement · 10 min · RPE 2–3")).toBeInTheDocument();
    expect(screen.getByText("Bloc principal · 30 min · RPE 3–4")).toBeInTheDocument();
    expect(screen.getByText("Retour au calme · 5 min · RPE 2")).toBeInTheDocument();
    expect(screen.getByText(text("instruction.endurance.talk_test_full_sentences"))).toBeInTheDocument();
    expect(container.querySelectorAll("[data-item-id]")).toHaveLength(0);
  });

  it("measures: reps, duration, distance, per side", () => {
    expect(formatMeasure({ type: "reps", min: 8, max: 8, perSide: true })).toBe("8 répétitions par côté");
    expect(formatMeasure({ type: "duration", minSeconds: 30, maxSeconds: 45, perSide: false })).toBe("30–45 s");
    expect(formatMeasure({ type: "duration", minSeconds: 45, maxSeconds: 60, perSide: true })).toBe("45–60 s par côté");
    expect(formatMeasure({ type: "distance", minMeters: 20, maxMeters: 30 })).toBe("20–30 m");
  });

  it("REST: a clear rest state, no session card", () => {
    const { container } = render(<FinalPrescriptionV2Card state={{ kind: "not_required" }} />);
    expect(screen.getByText(REST_MESSAGE)).toBeInTheDocument();
    expect(container.querySelectorAll("[data-block-role]")).toHaveLength(0);
  });

  it.each([
    ["final_prescription_no_lineage", "Le détail de la séance n'est pas disponible pour cette recommandation."],
    ["final_prescription_adaptation_not_defined", "L'adaptation détaillée n'est pas disponible pour cette recommandation."],
    ["final_prescription_catalog_mismatch", PRESCRIPTION_UNAVAILABLE_MESSAGE],
  ])("blocked %s: neutral message, the internal code is never the text", (code, message) => {
    const { container } = render(<FinalPrescriptionV2Card state={{ kind: "blocked", code, detail: { reason: "x" } }} />);
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(BLOCKED_MESSAGES[code]).toBe(message);
    expect(container.textContent).not.toContain(code);
    expect(container.querySelector(`[data-code="${code}"]`)).not.toBeNull();
  });

  it("fail-closed states: missing row, unsupported version, invalid document", () => {
    render(<FinalPrescriptionV2Card state={{ kind: "final_prescription_missing" }} />);
    expect(screen.getByText(MISSING_MESSAGE)).toBeInTheDocument();
    render(<FinalPrescriptionV2Card state={{ kind: "unsupported_schema_or_catalog", reason: "catalogue session-model-v2.7" }} />);
    expect(screen.getByText(PRESCRIPTION_UNAVAILABLE_MESSAGE)).toBeInTheDocument();
    render(<FinalPrescriptionV2Card state={{ kind: "invalid", reason: "x" }} />);
    expect(screen.getByText(INVALID_MESSAGE)).toBeInTheDocument();
  });
});
