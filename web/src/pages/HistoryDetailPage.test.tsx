import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HistoryDetailPage } from "./HistoryDetailPage";

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ athleteId: "athlete-1" }),
}));

vi.mock("../features/history/historyRepo", () => ({
  loadDecisionById: vi.fn(),
}));

import { loadDecisionById } from "../features/history/historyRepo";

const mockedLoad = loadDecisionById as unknown as ReturnType<typeof vi.fn>;

const VALID_ROW = {
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
};

function renderDetailPage(decisionId = "d-1") {
  return render(
    <MemoryRouter initialEntries={[`/history/${decisionId}`]}>
      <Routes>
        <Route path="/history/:decisionId" element={<HistoryDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("HistoryDetailPage", () => {
  it("shows a loading state before the decision resolves", () => {
    mockedLoad.mockReturnValue(new Promise(() => {}));
    renderDetailPage();
    expect(screen.getByText(/Chargement/)).toBeInTheDocument();
  });

  it("fetches by the decisionId from the URL and the resolved athleteId — RLS is what actually protects it", async () => {
    mockedLoad.mockResolvedValue(VALID_ROW);
    renderDetailPage("d-1");
    await waitFor(() => expect(mockedLoad).toHaveBeenCalledWith("athlete-1", "d-1"));
  });

  it("shows a not-found state when no row is returned", async () => {
    mockedLoad.mockResolvedValue(null);
    renderDetailPage();
    await waitFor(() => expect(screen.getByText("Décision introuvable.")).toBeInTheDocument());
  });

  it("shows the fixed generic error message on the repo's own HistoryLoadError", async () => {
    mockedLoad.mockRejectedValue(new Error("Impossible de charger l'historique. Réessaie."));
    renderDetailPage();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("Impossible de charger cette décision. Réessaie.");
  });

  it("never renders a raw/unexpected error message, even if the repo throws something other than HistoryLoadError", async () => {
    mockedLoad.mockRejectedValue(new Error("permission denied for table decisions"));
    renderDetailPage();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("Impossible de charger cette décision. Réessaie.");
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument();
  });

  it("renders the stored DailyPlan via HistoryDetail on success, with the decision date and time", async () => {
    mockedLoad.mockResolvedValue(VALID_ROW);
    renderDetailPage();
    await waitFor(() => expect(screen.getByText("Maintenir")).toBeInTheDocument());
    expect(screen.getByText(/19 août/)).toBeInTheDocument();
  });

  it("links back to /history", async () => {
    mockedLoad.mockResolvedValue(VALID_ROW);
    renderDetailPage();
    await waitFor(() => expect(screen.getByText(/Historique/)).toBeInTheDocument());
    expect(screen.getByText(/Historique/).closest("a")).toHaveAttribute("href", "/history");
  });
});
