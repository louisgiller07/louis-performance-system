import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HistoryPage } from "./HistoryPage";

const signOut = vi.fn();

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ user: { email: "louis@example.test" }, athleteId: "athlete-1", signOut }),
}));

vi.mock("../features/history/historyRepo", () => ({
  loadDecisionHistory: vi.fn(),
  HistoryLoadError: class HistoryLoadError extends Error {
    constructor() {
      super("Impossible de charger l'historique. Réessaie.");
    }
  },
}));

import { loadDecisionHistory } from "../features/history/historyRepo";

const mockedLoad = loadDecisionHistory as unknown as ReturnType<typeof vi.fn>;

function renderHistoryPage() {
  return render(
    <MemoryRouter initialEntries={["/history"]}>
      <HistoryPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("HistoryPage", () => {
  it("shows a loading state before the history resolves", () => {
    mockedLoad.mockReturnValue(new Promise(() => {}));
    renderHistoryPage();
    expect(screen.getByText(/Chargement/)).toBeInTheDocument();
  });

  it("shows an empty state when there is no decision yet", async () => {
    mockedLoad.mockResolvedValue([]);
    renderHistoryPage();
    await waitFor(() => expect(screen.getByText("Aucune décision enregistrée pour le moment.")).toBeInTheDocument());
  });

  it("shows the fixed generic error message on the repo's own HistoryLoadError", async () => {
    mockedLoad.mockRejectedValue(new Error("Impossible de charger l'historique. Réessaie."));
    renderHistoryPage();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("Impossible de charger l'historique. Réessaie.");
  });

  it("never renders a raw/unexpected error message, even if the repo throws something other than HistoryLoadError", async () => {
    mockedLoad.mockRejectedValue(new Error("permission denied for table decisions"));
    renderHistoryPage();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("Impossible de charger l'historique. Réessaie.");
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument();
  });

  it("renders the decision list on success, reusing HistoryList", async () => {
    mockedLoad.mockResolvedValue([
      {
        id: "d-1",
        decisionDate: "2026-08-19",
        createdAt: "2026-08-19T08:00:00Z",
        finalSessionDb: "REST",
        activeModeDb: "IN_SEASON",
        confidenceLevelDb: "MEDIUM",
        dailyPlan: {
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
          final_session: { kind: "REST" },
          decision: "KEEP",
          overrode_race_protocol: false,
          engine_version: "1.0.0",
        },
      },
    ]);
    renderHistoryPage();
    await waitFor(() => expect(screen.getByText("Maintenir")).toBeInTheDocument());
  });

  it("calls loadDecisionHistory with the resolved athleteId, never a URL/user-supplied id", async () => {
    mockedLoad.mockResolvedValue([]);
    renderHistoryPage();
    await waitFor(() => expect(mockedLoad).toHaveBeenCalledWith("athlete-1"));
  });

  it("logout button calls signOut", () => {
    mockedLoad.mockReturnValue(new Promise(() => {}));
    renderHistoryPage();
    screen.getByText("Logout").click();
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
