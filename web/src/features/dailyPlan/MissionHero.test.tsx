import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MissionHero } from "./MissionHero";
import { formatDuration } from "./durationLabels";
import type { DailyPlan } from "./dailyPlanTypes";

const BASE_PLAN: DailyPlan = {
  active_mode: "IN_SEASON",
  training: { active: false },
  dh_or_technical: { active: true, focus: "Précision des lignes", execution_task: "Trois runs propres sur le secteur 2." },
  mental: { active: false },
  recovery: { active: false, actions: [] },
  nutrition: { active: false },
  sleep: { active: false },
  protection: { do_not_do: [] },
  monitoring: { observe: [] },
  reasoning: "Fatigue jambes élevée : volume réduit.",
  confidence: "HIGH",
  triggered_rules: [],
  planned_session_before: { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 240 },
  final_session: { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 150 },
  decision: "MODIFY",
  overrode_race_protocol: false,
  engine_version: "1.0.0",
};

const hero = () => screen.getByRole("region");

describe("MissionHero (UX-03)", () => {
  it("MODIFY with a planned session: the mission title, then Prévu 4 h → Adapté 2 h 30, the decision and confidence", () => {
    render(<MissionHero dailyPlan={BASE_PLAN} />);

    expect(screen.getByText("Ta mission du jour")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "DH technique" })).toBeInTheDocument();
    expect(hero().textContent).toContain("Prévu : 4 h (charge modérée). Adapté : 2 h 30 (charge modérée).");
    expect(within(hero()).getByText("Adapter")).toBeInTheDocument();
    expect(within(hero()).getByText("Confiance élevée")).toBeInTheDocument();
    expect(within(hero()).getByText("Précision des lignes")).toBeInTheDocument();
    expect(within(hero()).getByText("Fatigue jambes élevée : volume réduit.")).toBeInTheDocument();
  });

  it("a changed session kind shows the kinds on both sides (REPLACE)", () => {
    render(
      <MissionHero
        dailyPlan={{
          ...BASE_PLAN,
          decision: "REPLACE",
          dh_or_technical: { active: false },
          final_session: { kind: "RECOVERY_ACTIVE", duration_min: 40 },
        }}
      />
    );

    expect(hero().textContent).toContain("Prévu : DH technique (4 h · charge modérée). Adapté : Récupération active (40 min).");
  });

  it("KEEP: no comparison, just the session duration", () => {
    render(<MissionHero dailyPlan={{ ...BASE_PLAN, decision: "KEEP", final_session: { ...BASE_PLAN.planned_session_before!, duration_min: 240 } }} />);

    expect(within(hero()).queryByText(/Prévu/)).not.toBeInTheDocument();
    expect(hero().textContent).toContain("4 h");
    expect(within(hero()).getByText("Maintenir")).toBeInTheDocument();
  });

  it("no planned session to compare against: no comparison even when the decision is not KEEP", () => {
    render(<MissionHero dailyPlan={{ ...BASE_PLAN, planned_session_before: null }} />);

    expect(within(hero()).queryByText(/Prévu/)).not.toBeInTheDocument();
    expect(hero().textContent).toContain("2 h 30");
  });

  it("REST keeps the red safety accent, never gold", () => {
    render(<MissionHero dailyPlan={{ ...BASE_PLAN, decision: "REST", final_session: { kind: "REST" }, dh_or_technical: { active: false } }} />);

    expect(hero().className).toContain("border-red-500");
    expect(within(hero()).getByText("Repos", { selector: "span" }).className).toContain("text-red-300");
  });

  it("the training phase is a French label, hidden when UNSPECIFIED ('Phase non configurée' says nothing to the rider)", () => {
    const { unmount } = render(<MissionHero dailyPlan={{ ...BASE_PLAN, active_mode: "RACE_WEEK" }} />);
    expect(screen.getByText("Semaine de course")).toBeInTheDocument();
    expect(screen.queryByText("RACE_WEEK")).not.toBeInTheDocument();
    unmount();

    render(<MissionHero dailyPlan={{ ...BASE_PLAN, active_mode: "UNSPECIFIED" }} />);
    expect(screen.queryByText("Phase non configurée")).not.toBeInTheDocument();
  });

  it("a previous technical task stays visually distinct from today's objective (V0.3_008B)", () => {
    render(
      <MissionHero
        dailyPlan={{
          ...BASE_PLAN,
          dh_or_technical: {
            ...BASE_PLAN.dh_or_technical,
            prior_task_reference: { source_decision_id: "d-0", session_date: "2026-09-27", kind: "DH_TECHNICAL", execution_task: "Freiner plus tard", technical_outcome: "yes" },
          },
        }}
      />
    );

    expect(screen.getByText("Tâche précédente")).toBeInTheDocument();
    expect(screen.getByText("« Freiner plus tard »")).toBeInTheDocument();
  });
});

describe("formatDuration", () => {
  it.each([
    [45, "45 min"],
    [60, "1 h"],
    [90, "1 h 30"],
    [150, "2 h 30"],
    [245, "4 h 05"],
  ])("%i min → %s (non-breaking)", (minutes, expected) => {
    expect(formatDuration(minutes)).toBe(expected);
  });
});
