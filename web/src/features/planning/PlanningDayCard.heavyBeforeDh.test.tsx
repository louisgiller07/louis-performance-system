import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlanningDayCard } from "./PlanningDayCard";
import type { PlannedSessionRow, TrainingIntervention } from "./planningTypes";
import type { UpcomingDh } from "./heavyLowerBeforeDh";
import { HEAVY_LOWER_BEFORE_DH } from "./weekPresentation";
import { TRAINING_KIND_LABELS } from "../dailyPlan/dailyPlanLabels";

// V1-WARN-01 — the day card warns about a heavy lower-body Force planned by hand at J-1 / J-2 of a known
// DH day, on the saved session and while editing. It never blocks the save, never removes or changes the session,
// and never shows on a coach-generated session.

const { savePlannedSession, deletePlannedSession } = vi.hoisted(() => ({ savePlannedSession: vi.fn(), deletePlannedSession: vi.fn() }));
vi.mock("./planningRepo", async (importOriginal) => ({ ...(await importOriginal<typeof import("./planningRepo")>()), savePlannedSession, deletePlannedSession }));
beforeEach(() => vi.clearAllMocks());

const DATE = "2026-11-06";
const DH_TOMORROW: UpcomingDh = { daysBefore: 1, date: "2026-11-07", what: "dh" };
const WARNING = `${HEAVY_LOWER_BEFORE_DH.title}${HEAVY_LOWER_BEFORE_DH.body}${HEAVY_LOWER_BEFORE_DH.advice}`;

function row(intervention: TrainingIntervention | null, source: PlannedSessionRow["source"]): PlannedSessionRow {
  return { planned_date: DATE, session_type: "STRENGTH_A", intervention, planned_intent: null, is_committed: false, ...(source ? { source } : {}) };
}
const HEAVY_LOWER = { kind: "STRENGTH_LOWER", load_profile: "HEAVY" } as TrainingIntervention;

function Harness({ initialRow, upcomingDh, initialExpanded = false }: { initialRow: PlannedSessionRow | null; upcomingDh: UpcomingDh | null; initialExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const [current, setCurrent] = useState(initialRow);
  return (
    <PlanningDayCard
      athleteId="athlete-1"
      date={DATE}
      isToday={false}
      row={current}
      planKnown
      races={[]}
      upcomingDh={upcomingDh}
      isExpanded={expanded}
      onToggleExpand={() => setExpanded((e) => !e)}
      onRowChange={(_d, next) => {
        setCurrent(next);
        setExpanded(false);
      }}
    />
  );
}

describe("V1-WARN-01 — day card", () => {
  it("saved manual heavy lower-body Force the day before a DH: the warning shows; the session stays as planned", () => {
    render(<Harness initialRow={row(HEAVY_LOWER, "manual")} upcomingDh={DH_TOMORROW} />);
    expect(screen.getByTestId("heavy-lower-before-dh").textContent).toBe(WARNING);
    expect(screen.getByText(TRAINING_KIND_LABELS.STRENGTH_LOWER)).toBeInTheDocument();
    expect(screen.getByText("charge lourde")).toBeInTheDocument();
  });

  it("no warning: no known DH, a moderate load, an upper-body Force, a generated or unsourced row, a legacy row", () => {
    const cases: [PlannedSessionRow | null, UpcomingDh | null][] = [
      [row(HEAVY_LOWER, "manual"), null],
      [row({ kind: "STRENGTH_LOWER", load_profile: "MODERATE" } as TrainingIntervention, "manual"), DH_TOMORROW],
      [row({ kind: "STRENGTH_UPPER", load_profile: "HEAVY" } as TrainingIntervention, "manual"), DH_TOMORROW],
      [row(HEAVY_LOWER, "generated"), DH_TOMORROW],
      [row(HEAVY_LOWER, undefined), DH_TOMORROW],
      [row(null, "manual"), DH_TOMORROW],
    ];
    for (const [r, dh] of cases) {
      const { unmount } = render(<Harness initialRow={r} upcomingDh={dh} />);
      expect(screen.queryByTestId("heavy-lower-before-dh")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("while editing: choosing a heavy lower-body Force before a DH warns, and saving is still allowed", async () => {
    const user = userEvent.setup();
    savePlannedSession.mockResolvedValue(row(HEAVY_LOWER, "manual"));
    render(<Harness initialRow={null} upcomingDh={DH_TOMORROW} initialExpanded />);
    expect(screen.queryByTestId("heavy-lower-before-dh")).not.toBeInTheDocument();

    await user.click(within(screen.getByRole("group", { name: "Séance" })).getByRole("button", { name: TRAINING_KIND_LABELS.STRENGTH_LOWER }));
    await user.click(within(screen.getByRole("group", { name: "Intensité" })).getByRole("button", { name: "charge modérée" }));
    expect(screen.queryByTestId("heavy-lower-before-dh")).not.toBeInTheDocument();
    await user.click(within(screen.getByRole("group", { name: "Intensité" })).getByRole("button", { name: "charge lourde" }));
    expect(screen.getByTestId("heavy-lower-before-dh").textContent).toBe(WARNING);

    const save = screen.getByRole("button", { name: "Enregistrer" });
    expect(save).toBeEnabled();
    await user.click(save);
    expect(savePlannedSession).toHaveBeenCalledTimes(1);
    expect(savePlannedSession.mock.calls[0]!.slice(2, 4)).toEqual(["STRENGTH_LOWER", "HEAVY"]);
    // Saved as the rider chose; collapsed, the warning stays on the manual session.
    expect(await screen.findByTestId("heavy-lower-before-dh")).toBeInTheDocument();
  });
});
