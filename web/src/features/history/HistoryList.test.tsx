import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HistoryList } from "./HistoryList";
import { formatLocalTime } from "../../lib/date";
import type { DecisionHistoryRow } from "./historyTypes";
import type { CompletedSessionRecord } from "../completedSession/completedSessionTypes";

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

function renderList(rows: DecisionHistoryRow[], linkedSessions: Map<string, CompletedSessionRecord> = new Map()) {
  return render(
    <MemoryRouter>
      <HistoryList rows={rows} linkedSessions={linkedSessions} />
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
          linkedSessions={new Map()}
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

function makeSession(overrides: Partial<CompletedSessionRecord> = {}): CompletedSessionRecord {
  return {
    id: "cs-1",
    session_date: "2026-08-19",
    decision_id: "d-1",
    session_type: "DH_TECHNICAL",
    completion_status: "done",
    actual_duration_min: 120,
    rpe: 7,
    post_leg_fatigue: 5,
    post_grip_fatigue: 4,
    new_pain: false,
    new_pain_note: null,
    intervention: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
    main_content: null,
    session_load: 84,
    updated_at: "2026-08-19T20:00:00Z",
    technical_outcome: null,
    change_reason: null,
    change_reason_note: null,
    ...overrides,
  };
}

// V0.3_007D — §15 list indicator: only an exact decision_id match gets a
// badge, reusing COMPLETION_STATUS_LABELS; a same-day-but-unrelated session
// must never mark the wrong card.
describe("HistoryList — completed-session indicator (V0.3_007D §15)", () => {
  it("shows a compact status badge only on the decision with an exact linked completed session", () => {
    const linked = makeSession({ decision_id: "d-1", completion_status: "done" });
    renderList([makeRow({ id: "d-1" })], new Map([["d-1", linked]]));
    expect(screen.getByText("Faite")).toBeInTheDocument();
  });

  it("shows no badge at all when no session is linked to this decision", () => {
    renderList([makeRow({ id: "d-1" })], new Map());
    expect(screen.queryByText("Faite")).not.toBeInTheDocument();
    expect(screen.queryByText("Non faite")).not.toBeInTheDocument();
  });

  // §26.F — two decisions same day, completed session linked to A only: A's
  // card gets the badge, B's card gets none, even though both share a date.
  it("two decisions same day, completed linked to A only -> A's card gets the badge, B's card gets none", () => {
    const linkedToA = makeSession({ decision_id: "decision-A", completion_status: "replaced" });
    renderList(
      [
        makeRow({ id: "decision-A", createdAt: "2026-08-19T09:00:00Z" }),
        makeRow({ id: "decision-B", createdAt: "2026-08-19T12:00:00Z" }),
      ],
      new Map([["decision-A", linkedToA]])
    );

    expect(screen.getAllByText("Remplacée")).toHaveLength(1);
  });
});
