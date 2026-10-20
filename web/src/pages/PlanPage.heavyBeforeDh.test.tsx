import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { PlanPage } from "./PlanPage";
import type { PlannedSessionRow, TrainingIntervention } from "../features/planning/planningTypes";
import { HEAVY_LOWER_BEFORE_DH } from "../features/planning/weekPresentation";
import { TRAINING_KIND_LABELS } from "../features/dailyPlan/dailyPlanLabels";

// V1-WARN-01 — /plan, end to end over the page's own reads (mocked I/O only). Today is fixed to Monday 2026-11-02:
// Monday … Sunday 2026-11-08 are displayed; the next Monday 11-09 and Tuesday 11-10 are read for detection only.

vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ user: { email: "rider@example.test" }, athleteId: "athlete-1", signOut: vi.fn() }) }));
const { loadPlannedSessions, savePlannedSession } = vi.hoisted(() => ({ loadPlannedSessions: vi.fn(), savePlannedSession: vi.fn() }));
vi.mock("../features/planning/planningRepo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/planning/planningRepo")>()),
  loadPlannedSessions,
  savePlannedSession,
  deletePlannedSession: vi.fn(),
}));
const { loadRacesInRange } = vi.hoisted(() => ({ loadRacesInRange: vi.fn() }));
vi.mock("../features/planning/raceOverlayRepo", async (importOriginal) => ({ ...(await importOriginal<typeof import("../features/planning/raceOverlayRepo")>()), loadRacesInRange }));
vi.mock("../features/trainingPlanReview/trainingPlanReviewRepo", () => ({ getActivePlanVersionId: vi.fn().mockResolvedValue(null), getTrainingPlanReview: vi.fn() }));

const MON = "2026-11-02", FRI = "2026-11-06", SAT = "2026-11-07", SUN = "2026-11-08", NEXT_MON = "2026-11-09", NEXT_TUE = "2026-11-10";
const WARNING = `${HEAVY_LOWER_BEFORE_DH.title}${HEAVY_LOWER_BEFORE_DH.body}${HEAVY_LOWER_BEFORE_DH.advice}`;

const plannedRow = (date: string, intervention: TrainingIntervention, source: "manual" | "generated" = "manual"): PlannedSessionRow => ({
  planned_date: date,
  session_type: "STRENGTH_A",
  intervention,
  planned_intent: null,
  is_committed: false,
  source,
});
const HEAVY_LOWER = { kind: "STRENGTH_LOWER", load_profile: "HEAVY" } as TrainingIntervention;
const DH = (kind: "DH_TECHNICAL" | "DH_LIGHT" = "DH_TECHNICAL") => ({ kind, load_profile: kind === "DH_LIGHT" ? "LIGHT" : "MODERATE", duration_min: 90 }) as TrainingIntervention;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/plan"]}>
      <PlanPage />
    </MemoryRouter>
  );
}
/** The day card of a date (its header shows « lundi 9 nov. » style labels; the warning is located through its row). */
async function warnings(): Promise<HTMLElement[]> {
  await waitFor(() => expect(loadPlannedSessions).toHaveBeenCalled());
  await screen.findAllByText(/charge lourde|charge modérée|Libre|DH/);
  return screen.queryAllByTestId("heavy-lower-before-dh");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${MON}T09:00:00`));
  loadRacesInRange.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

describe("V1-WARN-01 — /plan across two weeks", () => {
  it("reads the same two queries over the 7 displayed days + 2 lookahead days, and still displays 7 days", async () => {
    loadPlannedSessions.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(loadPlannedSessions).toHaveBeenCalledWith("athlete-1", MON, NEXT_TUE));
    await waitFor(() => expect(loadRacesInRange).toHaveBeenCalledWith("athlete-1", MON, NEXT_TUE));
    expect(await screen.findAllByRole("button", { expanded: false })).toHaveLength(7);
  });

  it("heavy Force Friday, DH Saturday → warning on Friday", async () => {
    loadPlannedSessions.mockResolvedValue([plannedRow(FRI, HEAVY_LOWER), plannedRow(SAT, DH())]);
    renderPage();
    const notes = await warnings();
    expect(notes).toHaveLength(1);
    expect(notes[0]!.textContent).toBe(WARNING);
  });

  it("heavy Force Saturday, DH the next Monday (not displayed) → warning on Saturday", async () => {
    loadPlannedSessions.mockResolvedValue([plannedRow(SAT, HEAVY_LOWER), plannedRow(NEXT_MON, DH())]);
    renderPage();
    expect(await warnings()).toHaveLength(1);
  });

  it("heavy Force Sunday, DH the next Monday or Tuesday → warning on Sunday", async () => {
    loadPlannedSessions.mockResolvedValue([plannedRow(SUN, HEAVY_LOWER), plannedRow(NEXT_TUE, DH())]);
    const { unmount } = renderPage();
    expect(await warnings()).toHaveLength(1);
    unmount();
    loadPlannedSessions.mockResolvedValue([plannedRow(SUN, HEAVY_LOWER), plannedRow(NEXT_MON, DH())]);
    renderPage();
    expect(await warnings()).toHaveLength(1);
  });

  it("an explicitly identified light DH and a known race count", async () => {
    loadPlannedSessions.mockResolvedValue([plannedRow(SUN, HEAVY_LOWER), plannedRow(NEXT_MON, DH("DH_LIGHT"))]);
    const { unmount } = renderPage();
    expect(await warnings()).toHaveLength(1);
    unmount();
    loadPlannedSessions.mockResolvedValue([plannedRow(SAT, HEAVY_LOWER)]);
    loadRacesInRange.mockResolvedValue([{ eventName: "Hot Trail", startDate: NEXT_MON, endDate: NEXT_MON, priority: "A" }]);
    renderPage();
    expect(await warnings()).toHaveLength(1);
  });

  it("no warning: no known DH; moderate or upper-body Force; a generated session", async () => {
    for (const rows of [
      [plannedRow(SUN, HEAVY_LOWER)],
      [plannedRow(SUN, { kind: "STRENGTH_LOWER", load_profile: "MODERATE" } as TrainingIntervention), plannedRow(NEXT_MON, DH())],
      [plannedRow(SUN, { kind: "STRENGTH_UPPER", load_profile: "HEAVY" } as TrainingIntervention), plannedRow(NEXT_MON, DH())],
      [plannedRow(SUN, HEAVY_LOWER, "generated"), plannedRow(NEXT_MON, DH())],
    ]) {
      loadPlannedSessions.mockResolvedValue(rows);
      const { unmount } = renderPage();
      expect(await warnings()).toHaveLength(0);
      unmount();
    }
  });

  it("editing then saving a manual heavy Force: warning while editing, save allowed, warning kept on the saved card; nothing else claims a validation", async () => {
    const user = userEvent.setup();
    loadPlannedSessions.mockResolvedValue([plannedRow(NEXT_MON, DH())]);
    savePlannedSession.mockResolvedValue(plannedRow(SUN, HEAVY_LOWER));
    renderPage();
    expect(await warnings()).toHaveLength(0);

    // Sunday is the 7th card.
    const cards = await screen.findAllByRole("button", { expanded: false });
    await user.click(cards[6]!);
    await user.click(within(screen.getByRole("group", { name: "Séance" })).getByRole("button", { name: TRAINING_KIND_LABELS.STRENGTH_LOWER }));
    await user.click(within(screen.getByRole("group", { name: "Intensité" })).getByRole("button", { name: "charge lourde" }));
    expect(screen.getByTestId("heavy-lower-before-dh").textContent).toBe(WARNING);
    const save = screen.getByRole("button", { name: "Enregistrer" });
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() => expect(savePlannedSession).toHaveBeenCalledTimes(1));
    expect(await screen.findAllByTestId("heavy-lower-before-dh")).toHaveLength(1);
    // The only « validé » wording on the page is inside the warning, which says the sequence was NOT validated.
    expect(document.body.textContent!.match(/validé/g)?.length ?? 0).toBe(1);
  });
});
