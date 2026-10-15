import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fixtures from "../../test/fixtures/phys02FinalPrescriptionV2.json";
import { decodeFinalPrescriptionV2, decodePlannedPrescriptionV2 } from "./decodeFinalPrescriptionV2";
import { FinalPrescriptionV2Card, PrescriptionV2Details } from "./FinalPrescriptionV2Card";
import { intervalsSummary } from "./enduranceCoachingCopy";
import type { FinalPrescriptionV2View } from "./finalPrescriptionV2Types";
import { fakeBackend } from "../../test/guidedSessionFakeBackend";
import { GuidedSessionHarness as Harness } from "../../test/GuidedSessionHarness";
import { ENDURANCE_COPY } from "../guidedSession/endurance/enduranceCopy";
import { translateExplanation } from "../trainingPlanReview/trainingPlanExplanationLabels";

// PHYS-02 — endurance and intervals on the web, from genuine engine documents
// (scripts/generate-phys02-fixtures.mjs): the intervals as one readable part,
// what each RPE means, the rider's last session of the same protocol, the
// honest refusal of a lighter intervals session, and the guided recording.

type Doc = { id: string; decisionId: string; schemaVersion: string; catalogVersion: string; structure: Record<string, unknown> };
const finals = fixtures.finalPrescriptions as unknown as Record<string, Doc>;
function view(key: string): FinalPrescriptionV2View {
  const r = finals[key]!;
  const d = decodeFinalPrescriptionV2({ id: r.id, decisionId: r.decisionId, schemaVersion: r.schemaVersion, catalogVersion: r.catalogVersion, structure: r.structure });
  if (!d.ok) throw new Error(`${key}: ${d.reason}`);
  return d.view;
}
const planned = (() => {
  const p = fixtures.plannedPrescriptions.PLANNED_INTERVALS as unknown as Doc & { generatedPlanSessionId: string };
  const d = decodePlannedPrescriptionV2({ id: p.id, generatedPlanSessionId: p.generatedPlanSessionId, schemaVersion: p.schemaVersion, catalogVersion: p.catalogVersion, structure: p.structure });
  if (!d.ok) throw new Error(d.reason);
  return d.view;
})();

describe("PHYS-02 — the intervals session, readable", () => {
  it("decoded as a session-model-v2.6 document; its main blocks read as 6 × 3 min at RPE 8, 2 min easy between", () => {
    const v = view("KEEP_INTERVALS_GUIDED");
    expect(v.aggregate).toBe("session-model-v2.6");
    expect(intervalsSummary(v)).toEqual({
      repetitions: 6,
      workMinutes: 3,
      workRpe: { min: 8, max: 8 },
      easyMinutes: 2,
      workInstruction: "Pendant chaque répétition, tiens un effort soutenu et régulier, le même du début à la fin.",
      easyInstruction: "Entre les répétitions, continue très facilement pour récupérer.",
      totalMinutes: 28,
    });
    expect(intervalsSummary(view("KEEP_BASE_EFFORT"))).toBeNull();
  });

  it("the day's card: warm-up, the intervals as one part with each repetition, cool-down; the RPE in plain words; the last intervals session", () => {
    render(<PrescriptionV2Details prescription={view("KEEP_INTERVALS_GUIDED")} />);
    const part = screen.getByTestId("intervals");
    expect(within(part).getByText("Fractionné · 28 min")).toBeTruthy();
    expect(within(part).getByText("6 × 3 min à RPE 8, 2 min faciles entre les répétitions")).toBeTruthy();
    expect(within(part).getByText("Difficile : tu ne peux dire que quelques mots.")).toBeTruthy();
    expect(within(part).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Répétition 1 : 3 min à RPE 8, puis 2 min faciles",
      "Répétition 2 : 3 min à RPE 8, puis 2 min faciles",
      "Répétition 3 : 3 min à RPE 8, puis 2 min faciles",
      "Répétition 4 : 3 min à RPE 8, puis 2 min faciles",
      "Répétition 5 : 3 min à RPE 8, puis 2 min faciles",
      "Répétition 6 : 3 min à RPE 8",
    ]);
    expect([...document.querySelectorAll("[data-block-role]")].map((e) => e.getAttribute("data-block-role"))).toEqual(["warm_up", "main", "cool_down"]);
    expect(screen.getByTestId("endurance-guidance").textContent).toBe("Ta dernière séance de ce type (21 oct.) : Home-trainer, 54 min, RPE ressenti sur toute la séance : 7.");
  });

  it("Program: the planned intervals session reads the same way, without guidance", () => {
    render(<PrescriptionV2Details prescription={planned} title="Séance prévue" />);
    expect(screen.getByText("6 × 3 min à RPE 8, 2 min faciles entre les répétitions")).toBeTruthy();
    expect(screen.queryByTestId("endurance-guidance")).toBeNull();
  });

  it("base endurance: the RPE in plain words (talk test) and, after an RPE 6 last time, the effort reminder", () => {
    render(<PrescriptionV2Details prescription={view("KEEP_BASE_EFFORT")} />);
    expect(screen.getAllByTestId("rpe-hint").map((e) => e.textContent)).toEqual([
      "Facile : respiration aisée, tu peux parler en phrases complètes.",
      "Facile : respiration aisée, tu peux parler en phrases complètes.",
      "Très facile : aucun effort ressenti.",
    ]);
    expect(screen.getByTestId("endurance-guidance").textContent).toBe(
      "Ta dernière séance de ce type (5 nov.) : VTT roulant, 60 min, 21,5 km, RPE ressenti : 6.Tu avais noté RPE 6 pour une cible de 4 au plus : garde aujourd'hui un rythme où tu peux parler en phrases complètes."
    );
  });

  it("MENTAL_RED and the rider's time: the base endurance session replacing the intervals reads as base endurance (53 and 45 min)", () => {
    for (const [key, total] of [["MODIFY_INTERVALS_TO_BASE", 53], ["A10_INTERVALS_TO_BASE_45", 45]] as const) {
      const v = view(key);
      expect([v.sessionKind, intervalsSummary(v), v.blocks.reduce((t, b) => t + b.durationMinutes!.max, 0)]).toEqual(["AEROBIC_BASE", null, total]);
    }
  });

  it("a lighter intervals session does not exist: the precise reason, never an empty session", () => {
    const blocked = fixtures.blockedLightIntervals as { code: string; detail: Record<string, unknown> };
    render(<FinalPrescriptionV2Card state={{ kind: "blocked", code: blocked.code, detail: blocked.detail }} />);
    expect(screen.getByText(/le fractionné n'existe qu'en une seule version : NALYNT ne propose pas de fractionné allégé\. Ne fais pas le fractionné prévu aujourd'hui\./)).toBeTruthy();
  });

  it("an unreadable guidance is dropped, never a failure of the document", () => {
    const r = finals.KEEP_BASE_EFFORT!;
    const d = decodeFinalPrescriptionV2({ ...r, structure: { ...r.structure, enduranceGuidance: { ruleVersion: "endurance-guidance-v1", reference: { sessionDate: "x" } } } });
    expect(d.ok && d.view.enduranceGuidance).toBe(undefined);
    expect(d.ok).toBe(true);
  });

  it("the week explanation names the intervals session in French", () => {
    expect(translateExplanation("Overload week: the highest load of the cycle. This week's endurance session is an intervals session.", "week").text).toBe(
      "Semaine de surcharge : la charge la plus haute du cycle. Cette semaine, la séance d'endurance est un fractionné."
    );
  });
});

describe("PHYS-02 — guided intervals session: start, guidance, the activity performed", () => {
  it("the RPE asked is the repetitions'; the rider records the activity, its real duration and the whole session's RPE", async () => {
    const b = fakeBackend({ prescription: view("KEEP_INTERVALS_GUIDED") });
    render(<Harness deps={b.deps} />);
    await userEvent.click(await screen.findByRole("button", { name: "Commencer la séance" }));
    await waitFor(() => expect(screen.getByTestId("intervals")).toBeTruthy());
    expect(screen.getByLabelText(ENDURANCE_COPY.minutesLabel)).toHaveAccessibleDescription("Prévu : 53 min");
    expect(screen.getByLabelText(ENDURANCE_COPY.rpeLabel)).toHaveAccessibleDescription("Prévu : RPE 8 pendant les répétitions — note ton ressenti sur toute la séance");
    await userEvent.click(screen.getByRole("radio", { name: "Home-trainer" }));
    await userEvent.type(screen.getByLabelText(ENDURANCE_COPY.minutesLabel), "53");
    await userEvent.type(screen.getByLabelText(ENDURANCE_COPY.rpeLabel), "7");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer l'activité" }));
    await waitFor(() => expect(screen.getByTestId("activity-result")).toBeTruthy());
    expect(b.executions[0]!.session_activity_results).toMatchObject([{ activity_id: "home_trainer", duration_seconds: 3180, distance_m: null, rpe_actual: 7 }]);
    expect(screen.getByRole("button", { name: "Terminer la séance" })).toBeEnabled();
  });
});
