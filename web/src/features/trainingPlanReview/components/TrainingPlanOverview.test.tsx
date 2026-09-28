import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TrainingPlanOverview } from "./TrainingPlanOverview";
import type { TrainingPlanReview } from "../trainingPlanReviewTypes";

vi.mock("../acceptTrainingPlan", () => ({ acceptTrainingPlan: vi.fn() }));

function review(overrides: Partial<TrainingPlanReview> = {}): TrainingPlanReview {
  return {
    version: {
      id: "version-1",
      horizonStartDate: "2026-10-19",
      horizonEndDate: "2026-11-01",
      generationTrigger: "initial",
      rationale: "Initial training plan generation.",
      relaxedConstraints: [],
      generatedAt: "2026-09-20T10:00:00Z",
    },
    lifecycleState: "draft",
    blocks: [
      {
        id: "block-1",
        sequenceNumber: 1,
        name: "Base Phase",
        mode: "IN_SEASON",
        primaryFocus: "base_building",
        startDate: "2026-10-19",
        endDate: "2026-11-01",
        weeks: [
          {
            id: "week-1",
            blockId: "block-1",
            weekNumber: 1,
            startDate: "2026-10-19",
            endDate: "2026-10-25",
            weekType: "development",
            rationale: "Standard development week.",
            doseSummary: {
              plannedStrengthSessionCount: 2,
              plannedDhTechnicalSessionCount: 1,
              plannedAerobicSessionCount: 1,
              plannedRestOrRecoveryDayCount: 3,
              totalPlannedMinutes: 240,
            },
            sessions: [],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function renderOverview(props: Partial<Parameters<typeof TrainingPlanOverview>[0]> = {}) {
  return render(
    <MemoryRouter>
      <TrainingPlanOverview review={review()} hasActivePlan={false} onAccepted={vi.fn()} {...props} />
    </MemoryRouter>
  );
}

describe("TrainingPlanOverview", () => {
  it("displays the plan period, week count, and global rationale", () => {
    renderOverview();

    expect(screen.getByText(/1 semaine/)).toBeInTheDocument();
    expect(screen.getByText("Première génération de ton plan d'entraînement.")).toBeInTheDocument();
  });

  it("displays the lifecycle state and volume summary", () => {
    renderOverview();

    expect(screen.getByText("Plan prêt à être accepté")).toBeInTheDocument();
    expect(screen.getByText(/2 force/)).toBeInTheDocument();
    expect(screen.getByText("240 min au total")).toBeInTheDocument();
  });

  it("shows the Accept button for a draft, and a link to modify the configuration", () => {
    renderOverview();

    expect(screen.getByRole("button", { name: "Accepter ce plan" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Modifier ma configuration" })).toHaveAttribute("href", "/performance-setup");
  });

  it("never shows an Accept button once the version is no longer a draft", () => {
    renderOverview({ review: review({ lifecycleState: "accepted" }) });

    expect(screen.queryByRole("button", { name: "Accepter ce plan" })).not.toBeInTheDocument();
    expect(screen.getByText("Plan actif")).toBeInTheDocument();
  });

  it("never renders any internal id, hash, or technical version string", () => {
    renderOverview();

    expect(screen.queryByText(/version-1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/inputSnapshot/i)).not.toBeInTheDocument();
  });
});

describe("TrainingPlanOverview — explanation (REV-013)", () => {
  function withRationale(rationale: string): TrainingPlanReview {
    const base = review();
    return { ...base, version: { ...base.version, rationale } };
  }

  it("translates the plan's generation explanation, never shows the English", () => {
    renderOverview({ review: withRationale("Regenerated after declared availability changed.") });

    expect(screen.getByText("Plan régénéré après une modification de tes disponibilités.")).toBeInTheDocument();
    expect(screen.queryByText(/Regenerated|availability/)).not.toBeInTheDocument();
  });

  it("an unknown explanation falls back to the neutral sentence", () => {
    renderOverview({ review: withRationale("Some future generation note.") });

    expect(screen.getByText("Plan généré à partir de ta configuration.")).toBeInTheDocument();
    expect(screen.queryByText(/future generation note/)).not.toBeInTheDocument();
  });

  it("other overview fields are unchanged", () => {
    renderOverview();

    expect(screen.getByText("Première génération de ton plan d'entraînement.")).toBeInTheDocument();
    expect(screen.getByText(/Base Phase/)).toBeInTheDocument();
    expect(screen.getByText("Volume global")).toBeInTheDocument();
    expect(screen.getByText("240 min au total")).toBeInTheDocument();
  });
});

describe("TrainingPlanOverview — placement reasons (V06-04)", () => {
  function withConstraints(relaxedConstraints: TrainingPlanReview["version"]["relaxedConstraints"]): TrainingPlanReview {
    const base = review();
    return { ...base, version: { ...base.version, relaxedConstraints } };
  }

  it("shows each engine reason as athlete wording in the existing 'Points d'attention' card, never the raw key", () => {
    renderOverview({
      review: withConstraints([
        { constraintId: "placement_shortfall", reason: "insufficient_available_time", domain: "dh_technical" },
        { constraintId: "placement_shortfall", reason: "insufficient_available_time", domain: "dh_technical" },
        { constraintId: "placement_shortfall", reason: "insufficient_available_dates", domain: "aerobic" },
      ]),
    });

    expect(screen.getByText("Points d'attention")).toBeInTheDocument();
    expect(screen.getByText("2 séances DH non placées : pas assez de temps disponible dans tes créneaux.")).toBeInTheDocument();
    expect(screen.getByText("1 séance aérobie non placée : pas assez de jours disponibles.")).toBeInTheDocument();
    expect(screen.queryByText(/insufficient_|placement_shortfall|dh_technical/)).not.toBeInTheDocument();
  });

  it("an unknown reason still appears, as the generic fallback", () => {
    renderOverview({ review: withConstraints([{ constraintId: "placement_shortfall", reason: "some_future_reason", domain: "strength" }]) });

    expect(screen.getByText("1 séance de force n'a pas pu être placée.")).toBeInTheDocument();
    expect(screen.queryByText(/some_future_reason/)).not.toBeInTheDocument();
  });

  it("a plan without relaxed constraints shows no 'Points d'attention' card at all", () => {
    renderOverview({ review: withConstraints([]) });

    expect(screen.queryByText("Points d'attention")).not.toBeInTheDocument();
    expect(screen.queryByText(/non placée|pas pu être placée/)).not.toBeInTheDocument();
  });

  it("entries with no usable reason show no card rather than an empty or raw one", () => {
    renderOverview({ review: withConstraints([{ constraintId: "placement_shortfall", reason: "", domain: "dh_technical" }]) });

    expect(screen.queryByText("Points d'attention")).not.toBeInTheDocument();
  });

  it("normal sessions and the rest of the overview are unaffected by the reasons", () => {
    renderOverview({ review: withConstraints([{ constraintId: "placement_shortfall", reason: "insufficient_available_time", domain: "dh_technical" }]) });

    expect(screen.getByText("Première génération de ton plan d'entraînement.")).toBeInTheDocument();
    expect(screen.getByText("Volume global")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accepter ce plan" })).toBeInTheDocument();
  });
});

describe("TrainingPlanOverview — athlete modifications (V06-02)", () => {
  it("shows how many program days the athlete modified, with their dates", () => {
    renderOverview({ review: review({ lifecycleState: "accepted" }), athleteModifiedDates: ["2026-10-20", "2026-10-22", "2026-10-24"] });

    expect(screen.getByText("3 jours de ce programme ont été modifiés par toi dans ton planning.")).toBeInTheDocument();
    expect(screen.getByText(/20 oct\..*22 oct\..*24 oct\./)).toBeInTheDocument();
    expect(screen.getByText("Pour ces jours, ta semaine suit tes modifications.")).toBeInTheDocument();
  });

  it("uses the singular for a single modified day", () => {
    renderOverview({ review: review({ lifecycleState: "accepted" }), athleteModifiedDates: ["2026-10-20"] });

    expect(screen.getByText("1 jour de ce programme a été modifié par toi dans ton planning.")).toBeInTheDocument();
  });

  it("shows no message when no day was modified", () => {
    renderOverview({ review: review({ lifecycleState: "accepted" }), athleteModifiedDates: [] });

    expect(screen.queryByText(/modifiés? par toi/)).not.toBeInTheDocument();
  });

  it("shows no message when the modifications are unknown (not loaded or read failed)", () => {
    renderOverview({ review: review({ lifecycleState: "accepted" }), athleteModifiedDates: null });

    expect(screen.queryByText(/modifiés? par toi/)).not.toBeInTheDocument();
    expect(screen.getByText("Plan actif")).toBeInTheDocument();
  });
});

describe("TrainingPlanOverview — post-acceptance CTA (V0.5_050)", () => {
  it("draft: shows the Accept button, never the 'Aller à Aujourd'hui' CTA", () => {
    renderOverview();

    expect(screen.getByRole("button", { name: "Accepter ce plan" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Aller à Aujourd'hui" })).not.toBeInTheDocument();
  });

  it("accepted: shows 'Plan actif' and the 'Aller à Aujourd'hui' CTA pointing to /today", () => {
    renderOverview({ review: review({ lifecycleState: "accepted" }) });

    expect(screen.getByText("Plan actif")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Aller à Aujourd'hui" })).toHaveAttribute("href", "/today");
  });

  it("accepted: clicking the CTA navigates to /today", async () => {
    render(
      <MemoryRouter initialEntries={["/training-plan-preview/version-1"]}>
        <Routes>
          <Route
            path="/training-plan-preview/:planVersionId"
            element={<TrainingPlanOverview review={review({ lifecycleState: "accepted" })} hasActivePlan={true} onAccepted={vi.fn()} />}
          />
          <Route path="/today" element={<p>Today page</p>} />
        </Routes>
      </MemoryRouter>
    );

    await userEvent.click(screen.getByRole("button", { name: "Aller à Aujourd'hui" }));

    expect(screen.getByText("Today page")).toBeInTheDocument();
  });

  it.each(["superseded", "abandoned"] as const)("%s: never shows the post-acceptance CTA", (lifecycleState) => {
    renderOverview({ review: review({ lifecycleState }) });

    expect(screen.queryByRole("link", { name: "Aller à Aujourd'hui" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accepter ce plan" })).not.toBeInTheDocument();
  });
});
