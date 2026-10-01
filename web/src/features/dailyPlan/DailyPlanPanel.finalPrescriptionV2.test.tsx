import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { keepFinalPrescription } from "../../test/fixtures/finalPrescriptionV2Fixtures";
import { REST_MESSAGE } from "../finalPrescriptionV2/finalPrescriptionV2Copy";
import { PRESCRIPTION_UNAVAILABLE_MESSAGE } from "../prescriptions/prescriptionRead";

// UX-11A.5c.4 — Today shows a V2 daily decision's final prescription live,
// and restores exactly the same state after a refresh from the database.

vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ signOut: vi.fn() }) }));
vi.mock("./runDailyRun", () => ({ runDailyRun: vi.fn() }));
const { loadLatestDecisionForDate } = vi.hoisted(() => ({ loadLatestDecisionForDate: vi.fn() }));
vi.mock("../history/historyRepo", () => ({ loadLatestDecisionForDate }));
const { loadDecisionCurrency } = vi.hoisted(() => ({ loadDecisionCurrency: vi.fn() }));
vi.mock("./decisionCurrencyRepo", () => ({ loadDecisionCurrency }));
const { from, eq } = vi.hoisted(() => {
  const eq = vi.fn();
  const from = vi.fn(() => ({ select: () => ({ eq }) }));
  return { from, eq };
});
vi.mock("../../lib/supabase", () => ({ supabase: { from } }));

import { DailyPlanPanel } from "./DailyPlanPanel";
import { runDailyRun } from "./runDailyRun";

const mockedRun = runDailyRun as unknown as ReturnType<typeof vi.fn>;

const plan = (decision: string, kind = "STRENGTH_LOWER") => ({
  date: "2026-10-07",
  active_mode: "UNSPECIFIED",
  training: { active: decision !== "REST", session_type: { kind, load_profile: "MODERATE" } },
  dh_or_technical: { active: false },
  mental: { active: false },
  recovery: { active: false, actions: [] },
  nutrition: { active: false },
  sleep: { active: false },
  protection: { do_not_do: [] },
  monitoring: { observe: [] },
  reasoning: "M1.",
  confidence: "MEDIUM",
  triggered_rules: [],
  planned_session_before: { kind: "STRENGTH_LOWER", load_profile: "MODERATE" },
  final_session: decision === "REST" ? { kind: "REST" } : { kind, load_profile: "MODERATE" },
  decision,
  overrode_race_protocol: false,
  engine_version: "test",
});

const force = keepFinalPrescription("STRENGTH_LOWER");
const D1 = force.live.decisionId;

function restoredRow(id: string, decision: string, v2: Record<string, unknown>) {
  return { id, decisionDate: "2026-10-07", createdAt: "2026-10-07T07:00:00Z", finalSessionDb: "STRENGTH_A", activeModeDb: null, confidenceLevelDb: "MEDIUM", dailyPlan: plan(decision), ...v2 };
}

const renderPanel = () => render(<DailyPlanPanel athleteId="a" date="2026-10-07" hasCheckin checkinRevision={0} />);

beforeEach(() => {
  vi.resetAllMocks();
  loadLatestDecisionForDate.mockResolvedValue(null);
  loadDecisionCurrency.mockResolvedValue({ isCurrent: true, staleReason: null });
  from.mockImplementation(() => ({ select: () => ({ eq }) }));
});

describe("Today — V2 final prescription", () => {
  it("live: a new V2 KEEP run shows the final prescription (read only)", async () => {
    mockedRun.mockResolvedValue({
      ok: true,
      data: { dailyPlan: plan("KEEP"), decisionId: D1, healthFlagId: null, warnings: [], executablePrescription: null, executablePrescriptionStatus: "unsupported_schema_version", finalPrescriptionStatus: "created", finalPrescription: force.live },
    });
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Préparer ma séance du jour" }));
    expect(await screen.findByText("Goblet squat")).toBeInTheDocument();
    expect(screen.getByText("4 séries × 6–8 répétitions — RPE 7–8")).toBeInTheDocument();
    // The V1 "unavailable" card is never shown for a V2 decision.
    expect(screen.queryByText(PRESCRIPTION_UNAVAILABLE_MESSAGE)).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it("refresh: the same content is restored from the decision + its final prescription row", async () => {
    loadLatestDecisionForDate.mockResolvedValue(restoredRow(D1, "KEEP", { finalPrescriptionStatus: "created", isLatestOfDay: true }));
    eq.mockResolvedValue({ data: [force.row], error: null });
    renderPanel();
    expect(await screen.findByText("Goblet squat")).toBeInTheDocument();
    expect(screen.getByText("4 séries × 6–8 répétitions — RPE 7–8")).toBeInTheDocument();
    expect(from).toHaveBeenCalledWith("decision_final_prescriptions");
    expect(eq).toHaveBeenCalledWith("decision_id", D1);
  });

  it("refresh: REST (not_required) → rest state, no session card, no final prescription read", async () => {
    loadLatestDecisionForDate.mockResolvedValue(restoredRow("d-rest", "REST", { finalPrescriptionStatus: "not_required", isLatestOfDay: true }));
    renderPanel();
    expect(await screen.findByText(REST_MESSAGE)).toBeInTheDocument();
    expect(from).not.toHaveBeenCalled();
  });

  it("refresh: blocked → neutral message, the code is not shown", async () => {
    loadLatestDecisionForDate.mockResolvedValue(
      restoredRow("d-mod", "MODIFY", { finalPrescriptionStatus: "blocked", finalPrescriptionStatusCode: "final_prescription_adaptation_not_defined", finalPrescriptionStatusDetail: { reason: "modify_not_supported" }, isLatestOfDay: true })
    );
    const { container } = renderPanel();
    expect(await screen.findByText("L'adaptation détaillée n'est pas disponible pour cette recommandation.")).toBeInTheDocument();
    expect(container.textContent).not.toContain("final_prescription_adaptation_not_defined");
  });

  it("a newer decision D2 (blocked) is what is restored: F1 is never shown just because it exists", async () => {
    loadLatestDecisionForDate.mockResolvedValue(
      restoredRow("d2", "KEEP", { finalPrescriptionStatus: "blocked", finalPrescriptionStatusCode: "final_prescription_no_lineage", finalPrescriptionStatusDetail: { reason: "no_planned_session" }, isLatestOfDay: true })
    );
    eq.mockResolvedValue({ data: [force.row], error: null });
    renderPanel();
    expect(await screen.findByText("Le détail de la séance n'est pas disponible pour cette recommandation.")).toBeInTheDocument();
    expect(screen.queryByText("Goblet squat")).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it("refresh: created but the final row is missing → explicit inconsistency state", async () => {
    loadLatestDecisionForDate.mockResolvedValue(restoredRow(D1, "KEEP", { finalPrescriptionStatus: "created", isLatestOfDay: true }));
    eq.mockResolvedValue({ data: [], error: null });
    renderPanel();
    expect(await screen.findByText("Le détail de ta séance est momentanément indisponible.")).toBeInTheDocument();
  });

  it("V1 restored decision (no V2 status) → V1 behaviour, no final prescription read", async () => {
    loadLatestDecisionForDate.mockResolvedValue(restoredRow("d-v1", "KEEP", {}));
    renderPanel();
    await waitFor(() => expect(loadDecisionCurrency).toHaveBeenCalled());
    expect(screen.queryByText("Ta séance")).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });
});
