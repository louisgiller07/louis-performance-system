import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HistoryList } from "./HistoryList";
import { formatLocalTime } from "../../lib/date";
import type { DecisionHistoryRow } from "./historyTypes";

const VALID_DAILY_PLAN = {
  active_mode: "IN_SEASON",
  training: { active: false },
  dh_or_technical: { active: false },
  mental: { active: false },
  recovery: { active: false, actions: [] },
  nutrition: { active: false },
  sleep: { active: false },
  protection: { do_not_do: [] },
  monitoring: { observe: [] },
  reasoning: "Tout va bien.",
  confidence: "MEDIUM",
  triggered_rules: [],
  planned_session_before: null,
  final_session: { kind: "PUMPTRACK", load_profile: "LIGHT" },
  decision: "KEEP",
  overrode_race_protocol: false,
  engine_version: "1.0.0",
};

function makeRow(overrides: Partial<DecisionHistoryRow> = {}): DecisionHistoryRow {
  return {
    id: "d-1",
    decisionDate: "2026-08-19",
    createdAt: "2026-08-19T08:00:00Z",
    finalSessionDb: "REST",
    activeModeDb: "IN_SEASON",
    confidenceLevelDb: "MEDIUM",
    dailyPlan: VALID_DAILY_PLAN,
    ...overrides,
  };
}

function renderList(rows: DecisionHistoryRow[]) {
  return render(
    <MemoryRouter>
      <HistoryList rows={rows} />
    </MemoryRouter>
  );
}

describe("HistoryList", () => {
  it("renders date, French decision label, confidence, and final session for one decision", () => {
    renderList([makeRow()]);

    expect(screen.getByText(/19 août/)).toBeInTheDocument();
    expect(screen.getByText("Maintenir")).toBeInTheDocument();
    expect(screen.getByText(/Confiance moyenne/)).toBeInTheDocument();
    expect(screen.getByText(/Pumptrack/)).toBeInTheDocument();
  });

  it("renders multiple decisions on the same day, both distinctly", () => {
    renderList([
      makeRow({ id: "d-1", createdAt: "2026-08-19T08:00:00Z", dailyPlan: { ...VALID_DAILY_PLAN, decision: "KEEP" } }),
      makeRow({ id: "d-2", createdAt: "2026-08-19T18:42:00Z", dailyPlan: { ...VALID_DAILY_PLAN, decision: "MODIFY" } }),
    ]);

    expect(screen.getByText("Maintenir")).toBeInTheDocument();
    expect(screen.getByText("Adapter")).toBeInTheDocument();
    expect(screen.getAllByText(/19 août/)).toHaveLength(2);
  });

  it("shows the time to distinguish same-day decisions, but not for a lone decision", () => {
    const firstTime = formatLocalTime("2026-08-19T08:00:00Z");
    const secondTime = formatLocalTime("2026-08-19T18:42:00Z");

    const { rerender } = renderList([makeRow({ id: "d-1", createdAt: "2026-08-19T08:00:00Z" })]);
    expect(screen.queryByText(new RegExp(firstTime))).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <HistoryList
          rows={[
            makeRow({ id: "d-1", createdAt: "2026-08-19T08:00:00Z" }),
            makeRow({ id: "d-2", createdAt: "2026-08-19T18:42:00Z" }),
          ]}
        />
      </MemoryRouter>
    );
    expect(screen.getByText(new RegExp(secondTime))).toBeInTheDocument();
  });

  it("shows a degraded summary for a malformed/legacy row instead of crashing", () => {
    renderList([makeRow({ dailyPlan: { decision: "NOT_A_REAL_ENUM" } })]);

    expect(screen.getByText(/ne peut pas être affichée complètement/)).toBeInTheDocument();
  });

  it("links each row to /history/:decisionId", () => {
    renderList([makeRow({ id: "abc-123" })]);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/history/abc-123");
  });
});
