import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { DailyPlanResult } from "./DailyPlanResult";
import type { DailyPlan, DailyRunResponse } from "./dailyPlanTypes";

// UX-05 — Today's collapsible plan detail. Safety-relevant elements stay
// visible under the mission; the rest moves, unchanged, into "Voir les
// détails du plan" at the bottom of the page. History-style rendering
// (no detailsTarget) is covered by every other DailyPlanView/Result test.
const PLAN: DailyPlan = {
  active_mode: "IN_SEASON",
  training: { active: false },
  dh_or_technical: { active: true, focus: "Précision", load_guidance: "Roule propre, sans forcer." },
  mental: { active: true, focus: "Respire avant chaque run" },
  recovery: { active: true, actions: ["Étirements 10 min"] },
  nutrition: { active: true, focus: "Hydratation régulière" },
  sleep: { active: true, target_hours: 8 },
  protection: { do_not_do: ["Pas de saut aujourd'hui"] },
  monitoring: { observe: ["Surveiller le poignet"] },
  reasoning: "Raisonnement.",
  confidence: "HIGH",
  triggered_rules: [{ layer: "A", rule_id: "A3", detail: "Règle de sécurité appliquée." }],
  planned_session_before: { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 240 },
  final_session: { kind: "DH_TECHNICAL", load_profile: "LIGHT", duration_min: 150 },
  decision: "MODIFY",
  overrode_race_protocol: false,
  engine_version: "1",
};
const RESULT: DailyRunResponse = { dailyPlan: PLAN, decisionId: "d-1", healthFlagId: "flag-1", warnings: [] };

function renderToday(target: HTMLElement | null) {
  return render(<DailyPlanResult result={RESULT} today={{ checkin: null, revealed: false, detailsTarget: target }} />);
}

describe("DailyPlanView — Today's collapsible plan detail (UX-05)", () => {
  it("safety stays visible under the mission: Attention santé, À éviter, À surveiller; the rest goes into 'Voir les détails du plan' in the target", () => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    const { container } = renderToday(target);

    // Visible, in the mission area.
    expect(within(container).getByText("Ta mission du jour")).toBeInTheDocument();
    expect(within(container).getByText("Attention santé")).toBeInTheDocument();
    expect(within(container).getByText("À éviter")).toBeInTheDocument();
    expect(within(container).getByText("Pas de saut aujourd'hui")).toBeInTheDocument();
    expect(within(container).getByText("À surveiller")).toBeInTheDocument();
    // Not in the mission area anymore…
    for (const title of ["Plan de séance", "Mental", "Récupération", "Sommeil", "Nutrition", "Pourquoi cette décision ?"]) {
      expect(within(container).queryByText(title)).not.toBeInTheDocument();
    }
    // …but unchanged inside the collapsible at the bottom.
    const details = within(target).getByText("Voir les détails du plan").closest("details")!;
    expect(details).not.toHaveAttribute("open");
    for (const title of ["Plan de séance", "Mental", "Récupération", "Sommeil", "Nutrition", "Pourquoi cette décision ?"]) {
      expect(within(details).getByText(title)).toBeInTheDocument();
    }
    expect(within(details).getByText("Roule propre, sans forcer.")).toBeInTheDocument();
    target.remove();
  });

  it("while the target is not mounted yet, the detail is simply not rendered (no duplicate, no crash)", () => {
    const { container } = renderToday(null);
    expect(screen.queryByText("Voir les détails du plan")).not.toBeInTheDocument();
    expect(within(container).getByText("À éviter")).toBeInTheDocument();
  });

  it("without Today presentation (detailsTarget undefined) everything stays inline, as before", () => {
    const { container } = render(<DailyPlanResult result={RESULT} />);
    expect(screen.queryByText("Voir les détails du plan")).not.toBeInTheDocument();
    expect(within(container).getByText("Plan de séance")).toBeInTheDocument();
    expect(within(container).getByText("Récupération")).toBeInTheDocument();
  });
});
