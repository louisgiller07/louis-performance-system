import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TodayPlanningSummary } from "./TodayPlanningSummary";
import type { PlannedSessionRow } from "./planningTypes";

const { loadPlannedSessions } = vi.hoisted(() => ({ loadPlannedSessions: vi.fn() }));
vi.mock("./planningRepo", () => ({ loadPlannedSessions }));

beforeEach(() => {
  vi.clearAllMocks();
});

function renderSummary(athleteId = "athlete-1", date = "2026-09-01") {
  return render(
    <MemoryRouter>
      <TodayPlanningSummary athleteId={athleteId} date={date} />
    </MemoryRouter>
  );
}

describe("TodayPlanningSummary", () => {
  it("A: loads today's row via loadPlannedSessions(athleteId, today, today)", async () => {
    loadPlannedSessions.mockResolvedValue([]);
    renderSummary("athlete-1", "2026-09-01");
    await waitFor(() => expect(loadPlannedSessions).toHaveBeenCalledWith("athlete-1", "2026-09-01", "2026-09-01"));
  });

  it("B: no row shows Non planifié", async () => {
    loadPlannedSessions.mockResolvedValue([]);
    renderSummary();
    expect(await screen.findByText("Non planifié")).toBeInTheDocument();
  });

  it("C: explicit REST shows Repos", async () => {
    const row: PlannedSessionRow = { planned_date: "2026-09-01", session_type: "REST", intervention: { kind: "REST" }, planned_intent: null };
    loadPlannedSessions.mockResolvedValue([row]);
    renderSummary();
    expect(await screen.findByText("Repos")).toBeInTheDocument();
  });

  it("D: a rich row shows the shared kind + load label", async () => {
    const row: PlannedSessionRow = {
      planned_date: "2026-09-01",
      session_type: "DH_TECHNICAL",
      intervention: { kind: "PUMPTRACK", load_profile: "LIGHT" },
      planned_intent: null,
    };
    loadPlannedSessions.mockResolvedValue([row]);
    renderSummary();
    expect(await screen.findByText("Pumptrack · charge légère")).toBeInTheDocument();
  });

  it("E: a legacy intervention=NULL row with a known coarse type shows the coarse label, never the raw enum", async () => {
    const row: PlannedSessionRow = { planned_date: "2026-09-01", session_type: "STRENGTH_A", intervention: null, planned_intent: null };
    loadPlannedSessions.mockResolvedValue([row]);
    renderSummary();
    expect(await screen.findByText("Force A")).toBeInTheDocument();
    expect(screen.queryByText("STRENGTH_A")).not.toBeInTheDocument();
  });

  it("F: a legacy intervention=NULL row with an unmapped runtime value shows a generic safe label, never the raw enum", async () => {
    const row = {
      planned_date: "2026-09-01",
      session_type: "SOME_FUTURE_ENUM_VALUE",
      intervention: null,
      planned_intent: null,
    } as unknown as PlannedSessionRow;
    loadPlannedSessions.mockResolvedValue([row]);
    renderSummary();
    expect(await screen.findByText("Séance planifiée (ancienne)")).toBeInTheDocument();
    expect(screen.queryByText("SOME_FUTURE_ENUM_VALUE")).not.toBeInTheDocument();
  });

  it("G: links to /plan", async () => {
    loadPlannedSessions.mockResolvedValue([]);
    renderSummary();
    expect(await screen.findByRole("link", { name: "Modifier dans Plan" })).toHaveAttribute("href", "/plan");
  });

  it("H: never renders inline Planning mutation controls", async () => {
    const row: PlannedSessionRow = {
      planned_date: "2026-09-01",
      session_type: "DH_TECHNICAL",
      intervention: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
      planned_intent: null,
    };
    loadPlannedSessions.mockResolvedValue([row]);
    renderSummary();
    await screen.findByText(/DH technique/);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enregistrer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retirer du planning" })).not.toBeInTheDocument();
  });

  it("I: a Planning read failure shows a local, safe 'Planning indisponible' message without crashing", async () => {
    loadPlannedSessions.mockRejectedValue(new Error("boom — raw PostgREST detail that must never surface"));
    renderSummary();
    expect(await screen.findByText("Planning indisponible.")).toBeInTheDocument();
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
    // The /plan link stays available even on a read failure.
    expect(screen.getByRole("link", { name: "Modifier dans Plan" })).toHaveAttribute("href", "/plan");
  });
});
