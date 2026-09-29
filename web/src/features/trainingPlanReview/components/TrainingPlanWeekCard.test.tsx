import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrainingPlanWeekCard } from "./TrainingPlanWeekCard";
import type { TrainingPlanReviewWeek } from "../trainingPlanReviewTypes";

const WEEK: TrainingPlanReviewWeek = {
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
  sessions: [
    {
      id: "session-1",
      weekId: "week-1",
      date: "2026-10-20",
      kind: "STRENGTH_LOWER",
      loadProfile: "HEAVY",
      durationMin: 60,
      doseTarget: { domain: "strength" },
      rationale: "Standard development week. Adjusted due to recent missed or replaced sessions pattern",
      prescription: null,
    },
    {
      id: "session-2",
      weekId: "week-1",
      date: "2026-10-21",
      kind: "AEROBIC_BASE",
      loadProfile: "MODERATE",
      durationMin: 90,
      doseTarget: { domain: "aerobic" },
      rationale: "Standard development week. Adjusted due to recent missed or replaced sessions pattern",
      prescription: null,
    },
  ],
};

describe("TrainingPlanWeekCard", () => {
  it("displays the week number, type, rationale, and dose summary", () => {
    render(<TrainingPlanWeekCard week={WEEK} />);

    expect(screen.getByText(/Semaine 1/)).toBeInTheDocument();
    expect(screen.getByText("Développement")).toBeInTheDocument();
    expect(screen.getByText("Semaine standard de développement.")).toBeInTheDocument();
    expect(screen.getByText(/2 force/)).toBeInTheDocument();
    expect(screen.getByText("240 min au total")).toBeInTheDocument();
  });

  it("renders every one of the week's sessions", () => {
    render(<TrainingPlanWeekCard week={WEEK} />);

    expect(screen.getByText("Renfo bas du corps")).toBeInTheDocument();
    expect(screen.getByText("Aérobie base")).toBeInTheDocument();
  });
});

// REV-013 — the week's English engine rationale is translated for display; the relaxed-constraint count becomes a separate summary line.
describe("TrainingPlanWeekCard — explanation (REV-013)", () => {
  it("translates the explanation and shows the relaxed-constraint count as a separate attention summary", () => {
    render(<TrainingPlanWeekCard week={{ ...WEEK, rationale: "Standard development week. 3 constraint(s) relaxed." }} />);

    expect(screen.getByText("Semaine standard de développement.")).toBeInTheDocument();
    expect(screen.getByText("3 points d'attention cette semaine.")).toBeInTheDocument();
    expect(screen.queryByText(/constraint|relaxed|Standard development week/)).not.toBeInTheDocument();
  });

  it("shows no attention summary when the week has none", () => {
    render(<TrainingPlanWeekCard week={WEEK} />);

    expect(screen.queryByText(/point.? d'attention/)).not.toBeInTheDocument();
  });

  it("taper week explanation is translated", () => {
    render(
      <TrainingPlanWeekCard
        week={{ ...WEEK, weekType: "taper", rationale: "Taper week ahead of an upcoming race: reduced volume versus a normal development week. 1 constraint(s) relaxed." }}
      />
    );

    expect(screen.getByText("Semaine d'affûtage avant une course : volume réduit par rapport à une semaine de développement normale.")).toBeInTheDocument();
    expect(screen.getByText("1 point d'attention cette semaine.")).toBeInTheDocument();
  });

  it("the sessions' own explanations are translated too, the other week fields are unchanged", () => {
    render(<TrainingPlanWeekCard week={WEEK} />);

    expect(screen.getAllByText("Semaine standard de développement. Charge allégée car plusieurs séances récentes ont été manquées ou remplacées.")).toHaveLength(2);
    expect(screen.getByText("Développement")).toBeInTheDocument();
    expect(screen.getByText(/2 force · 1 DH · 1 aérobie · 3 repos/)).toBeInTheDocument();
    expect(screen.getByText("240 min au total")).toBeInTheDocument();
  });
});

// REV-015.2 — week type badge is French; an unknown type hides the badge.
describe("TrainingPlanWeekCard — week type (REV-015.2)", () => {
  it.each([
    ["development", "Développement"],
    ["taper", "Affûtage"],
    ["race", "Course"],
    ["deload", "Allègement"],
    ["recovery", "Récupération"],
  ])("%s → %s", (weekType, label) => {
    render(<TrainingPlanWeekCard week={{ ...WEEK, weekType }} />);

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(`^${weekType}$`, "i"))).not.toBeInTheDocument();
  });

  it("an unknown week type shows no badge, never the identifier", () => {
    const { container } = render(<TrainingPlanWeekCard week={{ ...WEEK, weekType: "future_week" }} />);

    expect(container.textContent).not.toMatch(/future_week|Future Week/);
    expect(screen.getByText(/Semaine 1/)).toBeInTheDocument();
  });
});
