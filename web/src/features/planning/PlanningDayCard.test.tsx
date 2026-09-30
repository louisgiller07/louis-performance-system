import { useState } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlanningDayCard } from "./PlanningDayCard";
import { PlanningDeleteError, PlanningSaveError } from "./planningRepo";
import { PLANNABLE_FIXED_LOAD_KINDS, PLANNABLE_LOAD_VARIABLE_KINDS } from "./planningTypes";
import type { PlannedSessionRow, TrainingInterventionKind } from "./planningTypes";
import type { RaceOverlayEvent } from "./raceOverlayRepo";
import type { PlanDaySession } from "./weekPresentation";
import { TRAINING_KIND_LABELS } from "../dailyPlan/dailyPlanLabels";

const { savePlannedSession, deletePlannedSession } = vi.hoisted(() => ({
  savePlannedSession: vi.fn(),
  deletePlannedSession: vi.fn(),
}));
// Keeps the real error classes (PlanningSaveError, etc.) — PlanningDayCard's
// safeErrorMessage does an `instanceof` check against them, so a bare mock
// without these would make every failure-path test throw.
vi.mock("./planningRepo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./planningRepo")>();
  return { ...actual, savePlannedSession, deletePlannedSession };
});

beforeEach(() => {
  vi.clearAllMocks();
});

type User = ReturnType<typeof userEvent.setup>;

function kindButton(kind: TrainingInterventionKind) {
  return within(screen.getByRole("group", { name: "Séance" })).getByRole("button", { name: TRAINING_KIND_LABELS[kind] });
}

async function pick(user: User, kind: TrainingInterventionKind) {
  await user.click(kindButton(kind));
}

function pressedKinds(): string[] {
  return within(screen.getByRole("group", { name: "Séance" }))
    .getAllByRole("button")
    .filter((button) => button.getAttribute("aria-pressed") === "true")
    .map((button) => button.textContent ?? "");
}

function durationValue(): string {
  return within(screen.getByRole("group", { name: "Durée prévue" })).getByRole("status").textContent ?? "";
}

async function stepTo(user: User, minutes: number) {
  // From "Pas de durée", + starts at 1 h, then 30 min per step.
  await user.click(screen.getByRole("button", { name: "Pas de durée" }));
  await user.click(screen.getByRole("button", { name: "Augmenter la durée" }));
  for (let current = 60; current < minutes; current += 30) {
    await user.click(screen.getByRole("button", { name: "Augmenter la durée" }));
  }
}

function restRow(): PlannedSessionRow {
  return {
    planned_date: "2026-09-01",
    session_type: "REST",
    intervention: { kind: "REST" },
    planned_intent: null,
    is_committed: false,
  };
}

function strengthHeavyRow(): PlannedSessionRow {
  return {
    planned_date: "2026-09-01",
    session_type: "STRENGTH_A",
    intervention: { kind: "STRENGTH_LOWER", load_profile: "HEAVY" },
    planned_intent: null,
    is_committed: false,
  };
}

const PLAN_DH: PlanDaySession = { kind: "DH_TECHNICAL", loadProfile: "MODERATE", durationMin: 90 };

// Minimal stand-in for PlanPage: PlanningDayCard is a controlled component
// (canonical row + expanded state always come from its parent), so a real
// test needs something playing that parent role — never a copy of "what's
// persisted" inside the card itself.
function Harness({
  initialRow = null,
  initialExpanded = false,
  races = [],
  planSession = null,
  planKnown = true,
  onRowChangeSpy,
}: {
  initialRow?: PlannedSessionRow | null;
  initialExpanded?: boolean;
  races?: RaceOverlayEvent[];
  planSession?: PlanDaySession | null;
  planKnown?: boolean;
  onRowChangeSpy?: (date: string, row: PlannedSessionRow | null, notice?: string) => void;
}) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const [row, setRow] = useState<PlannedSessionRow | null>(initialRow);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <PlanningDayCard
      athleteId="athlete-1"
      date="2026-09-01"
      isToday={false}
      row={row}
      planSession={planSession}
      planKnown={planKnown}
      notice={notice}
      races={races}
      isExpanded={expanded}
      onToggleExpand={() => setExpanded((e) => !e)}
      onRowChange={(date, newRow, newNotice) => {
        setRow(newRow);
        setNotice(newNotice ?? null);
        setExpanded(false);
        onRowChangeSpy?.(date, newRow, newNotice);
      }}
    />
  );
}

describe("PlanningDayCard — collapsed states (UX-10B-2B)", () => {
  it("D: no row and nothing in the plan → Libre, with Ajouter une séance", () => {
    render(<Harness initialRow={null} />);
    expect(screen.getByText("Libre")).toBeInTheDocument();
    expect(screen.getByText("Ajouter une séance")).toBeInTheDocument();
  });

  it("no row but the plan has a session that day → the plan's session, Prévue par ton plan (never Libre)", () => {
    render(<Harness initialRow={null} planSession={PLAN_DH} />);
    expect(screen.getByText("DH technique")).toBeInTheDocument();
    expect(screen.getByText("Prévue par ton plan")).toBeInTheDocument();
    expect(screen.getByText("charge modérée")).toBeInTheDocument();
    expect(screen.getByText("1 h 30")).toBeInTheDocument();
    expect(screen.queryByText("Libre")).not.toBeInTheDocument();
  });

  it("no row and the plan could not be read → never claims Libre", () => {
    render(<Harness initialRow={null} planKnown={false} />);
    expect(screen.getByText("Aucune séance")).toBeInTheDocument();
    expect(screen.queryByText("Libre")).not.toBeInTheDocument();
  });

  it("E: shows Repos for an explicit REST row", () => {
    render(<Harness initialRow={restRow()} />);
    expect(screen.getByText("Repos")).toBeInTheDocument();
  });

  it("shows kind + load for an explicit variable-load row", () => {
    render(<Harness initialRow={strengthHeavyRow()} />);
    expect(screen.getByText(/Renfo bas du corps/)).toBeInTheDocument();
    expect(screen.getByText("charge lourde")).toBeInTheDocument();
  });
});

describe("PlanningDayCard — source, duration and commitment on the collapsed card", () => {
  function dhRow(overrides: Partial<PlannedSessionRow> = {}): PlannedSessionRow {
    return {
      planned_date: "2026-09-01",
      session_type: "DH_TECHNICAL",
      intervention: { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 90 },
      planned_intent: null,
      is_committed: false,
      ...overrides,
    };
  }

  it("source generated → 'Prévue par ton plan' badge", () => {
    render(<Harness initialRow={dhRow({ source: "generated" })} />);
    expect(screen.getByText("Prévue par ton plan")).toBeInTheDocument();
    expect(screen.queryByText("Modifiée par toi")).not.toBeInTheDocument();
  });

  it("source manual → 'Modifiée par toi' badge", () => {
    render(<Harness initialRow={dhRow({ source: "manual" })} />);
    expect(screen.getByText("Modifiée par toi")).toBeInTheDocument();
    expect(screen.queryByText("Prévue par ton plan")).not.toBeInTheDocument();
  });

  it("source absent → no source badge at all", () => {
    render(<Harness initialRow={dhRow()} />);
    expect(screen.queryByText("Prévue par ton plan")).not.toBeInTheDocument();
    expect(screen.queryByText("Modifiée par toi")).not.toBeInTheDocument();
  });

  it("legacy row (intervention NULL, manual only through the DB default) → no source badge", () => {
    render(<Harness initialRow={dhRow({ source: "manual", session_type: "REST", intervention: null })} />);
    expect(screen.queryByText("Prévue par ton plan")).not.toBeInTheDocument();
    expect(screen.queryByText("Modifiée par toi")).not.toBeInTheDocument();
  });

  it("unused enum values (rule/template) → no source badge", () => {
    render(<Harness initialRow={dhRow({ source: "template" })} />);
    expect(screen.queryByText("Prévue par ton plan")).not.toBeInTheDocument();
    expect(screen.queryByText("Modifiée par toi")).not.toBeInTheDocument();
  });

  it("no row → no source badge", () => {
    render(<Harness initialRow={null} />);
    expect(screen.queryByText("Prévue par ton plan")).not.toBeInTheDocument();
    expect(screen.queryByText("Modifiée par toi")).not.toBeInTheDocument();
  });

  it("shows the persisted duration (≥ 1 h and < 1 h)", () => {
    const { unmount } = render(<Harness initialRow={dhRow({ source: "generated" })} />);
    expect(screen.getByText("1 h 30")).toBeInTheDocument();
    unmount();

    render(<Harness initialRow={dhRow({ intervention: { kind: "AEROBIC_BASE", load_profile: "LIGHT", duration_min: 45 } })} />);
    expect(screen.getByText("45 min")).toBeInTheDocument();
  });

  it("shows no duration when the intervention has none", () => {
    render(<Harness initialRow={strengthHeavyRow()} />);
    expect(screen.queryByText(/\d+ (h|min)/)).not.toBeInTheDocument();
  });

  it("shows 'Séance engagée' only for a committed row", () => {
    const { unmount } = render(<Harness initialRow={dhRow({ is_committed: true })} />);
    expect(screen.getByText("Séance engagée")).toBeInTheDocument();
    unmount();

    render(<Harness initialRow={dhRow({ is_committed: false })} />);
    expect(screen.queryByText("Séance engagée")).not.toBeInTheDocument();
  });

  it("a saved edit shows the returned row's own source (manual)", async () => {
    const user = userEvent.setup();
    savePlannedSession.mockResolvedValue(dhRow({ source: "manual", intervention: { kind: "REST" }, session_type: "REST" }));
    render(<Harness initialRow={dhRow({ source: "generated" })} planSession={PLAN_DH} initialExpanded />);

    await pick(user, "REST");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByText("Modifiée par toi")).toBeInTheDocument();
    expect(screen.queryByText("Prévue par ton plan")).not.toBeInTheDocument();
  });
});

describe("PlanningDayCard — session picker (F, G)", () => {
  it("F: offers exactly the 15 athlete-plannable kinds, as buttons (no dropdown)", () => {
    render(<Harness initialExpanded />);
    expect(within(screen.getByRole("group", { name: "Séance" })).getAllByRole("button")).toHaveLength(15);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("G: never offers RACE_ACTIVITY", () => {
    render(<Harness initialExpanded />);
    expect(within(screen.getByRole("group", { name: "Séance" })).queryByText("Activité course")).not.toBeInTheDocument();
  });

  it("nothing is preselected on a free day", () => {
    render(<Harness initialExpanded />);
    expect(pressedKinds()).toEqual([]);
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
  });
});

describe("PlanningDayCard — create/edit and day actions (J, K, L, M, N)", () => {
  it("J: create calls savePlannedSession with the chosen kind and load", async () => {
    const user = userEvent.setup();
    savePlannedSession.mockResolvedValue(strengthHeavyRow());
    render(<Harness initialExpanded />);

    await pick(user, "STRENGTH_LOWER");
    await user.click(screen.getByRole("button", { name: "charge lourde" }));
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(savePlannedSession).toHaveBeenCalledWith("athlete-1", "2026-09-01", "STRENGTH_LOWER", "HEAVY", false, null)
    );
  });

  it("K: edit calls savePlannedSession, replacing the previous intervention", async () => {
    const user = userEvent.setup();
    savePlannedSession.mockResolvedValue(restRow());
    render(<Harness initialRow={strengthHeavyRow()} initialExpanded />);

    await pick(user, "REST");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(savePlannedSession).toHaveBeenCalledWith("athlete-1", "2026-09-01", "REST", null, false, null));
  });

  it("L, M: the athlete's own session on a free day → Retirer cette séance deletes it, and the day is Libre again, never Repos", async () => {
    const user = userEvent.setup();
    deletePlannedSession.mockResolvedValue(undefined);
    render(<Harness initialRow={{ ...restRow(), source: "manual" }} initialExpanded />);

    expect(screen.getByText("Le jour redevient libre.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retirer cette séance" }));

    await waitFor(() => expect(deletePlannedSession).toHaveBeenCalledWith("athlete-1", "2026-09-01"));
    expect(await screen.findByText("Libre")).toBeInTheDocument();
    expect(screen.queryByText("Repos")).not.toBeInTheDocument();
  });

  it("N: saving REST yields an explicit Repos persisted state", async () => {
    const user = userEvent.setup();
    savePlannedSession.mockResolvedValue(restRow());
    render(<Harness initialExpanded />);

    await pick(user, "REST");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByText("Repos")).toBeInTheDocument();
    expect(deletePlannedSession).not.toHaveBeenCalled();
  });

  it("a plan day offers Passer en repos (never a delete that the next update would undo), saved as the athlete's REST", async () => {
    const user = userEvent.setup();
    const onRowChangeSpy = vi.fn();
    savePlannedSession.mockResolvedValue({ ...restRow(), source: "manual" });
    render(<Harness initialRow={{ ...strengthHeavyRow(), source: "generated" }} planSession={PLAN_DH} initialExpanded onRowChangeSpy={onRowChangeSpy} />);

    expect(screen.queryByRole("button", { name: "Retirer cette séance" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revenir au plan" })).not.toBeInTheDocument();
    expect(screen.getByText("Cette journée sera conservée comme une modification de ton planning.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Passer en repos" }));

    await waitFor(() => expect(savePlannedSession).toHaveBeenCalledWith("athlete-1", "2026-09-01", "REST", null, false, null));
    expect(deletePlannedSession).not.toHaveBeenCalled();
    expect(onRowChangeSpy).toHaveBeenCalledWith("2026-09-01", { ...restRow(), source: "manual" }, "Cette journée sera conservée comme une modification de ton planning.");
    expect(await screen.findByText("Modifiée par toi")).toBeInTheDocument();
  });

  it("a plan day not written yet also offers Passer en repos", () => {
    render(<Harness initialRow={null} planSession={PLAN_DH} initialExpanded />);
    expect(screen.getByRole("button", { name: "Passer en repos" })).toBeInTheDocument();
  });

  it("a plan rest day offers no Passer en repos", () => {
    render(<Harness initialRow={null} planSession={{ kind: "REST", loadProfile: null, durationMin: null }} initialExpanded />);
    expect(screen.queryByRole("button", { name: "Passer en repos" })).not.toBeInTheDocument();
  });

  it("the athlete's change of a plan day → Revenir au plan deletes it and says the plan's session comes back at the next update (not instantly)", async () => {
    const user = userEvent.setup();
    deletePlannedSession.mockResolvedValue(undefined);
    render(<Harness initialRow={{ ...restRow(), source: "manual" }} planSession={PLAN_DH} initialExpanded />);

    expect(screen.queryByRole("button", { name: "Retirer cette séance" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Revenir au plan" }));

    await waitFor(() => expect(deletePlannedSession).toHaveBeenCalledWith("athlete-1", "2026-09-01"));
    expect(await screen.findByText("Prévue par ton plan")).toBeInTheDocument();
    expect(screen.getByText("DH technique")).toBeInTheDocument();
    expect(screen.getByText("NALYNT remettra la séance prévue par ton plan lors de la prochaine mise à jour.")).toBeInTheDocument();
  });

  it("plan unreadable: the athlete's session can be removed, but no Libre promise is made", () => {
    render(<Harness initialRow={{ ...restRow(), source: "manual" }} planKnown={false} initialExpanded />);
    expect(screen.getByRole("button", { name: "Retirer cette séance" })).toBeInTheDocument();
    expect(screen.queryByText("Le jour redevient libre.")).not.toBeInTheDocument();
  });

  it("editing a plan day not written yet starts from the plan's own session", () => {
    render(<Harness initialRow={null} planSession={PLAN_DH} initialExpanded />);
    expect(pressedKinds()).toEqual(["DH technique"]);
    expect(screen.getByRole("button", { name: "charge modérée" })).toHaveAttribute("aria-pressed", "true");
    expect(durationValue()).toBe("1 h 30");
  });

  it("Séance engagée defaults off for a new session and is passed through when switched on", async () => {
    const user = userEvent.setup();
    savePlannedSession.mockResolvedValue(strengthHeavyRow());
    render(<Harness initialExpanded />);

    const committedToggle = screen.getByRole("switch", { name: /Séance engagée/ });
    expect(committedToggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Cette séance compte comme une priorité. NALYNT peut ensuite l'alléger ou l'adapter selon ton état.")).toBeInTheDocument();

    await pick(user, "STRENGTH_LOWER");
    await user.click(screen.getByRole("button", { name: "charge lourde" }));
    await user.click(committedToggle);
    expect(committedToggle).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(savePlannedSession).toHaveBeenCalledWith("athlete-1", "2026-09-01", "STRENGTH_LOWER", "HEAVY", true, null)
    );
  });

  it("Séance engagée initializes from the persisted row and survives an unrelated kind change", async () => {
    const user = userEvent.setup();
    const committedRow = { ...strengthHeavyRow(), is_committed: true };
    savePlannedSession.mockResolvedValue(committedRow);
    render(<Harness initialRow={committedRow} initialExpanded />);

    const committedToggle = screen.getByRole("switch", { name: /Séance engagée/ });
    expect(committedToggle).toHaveAttribute("aria-checked", "true");

    await pick(user, "REST");
    expect(committedToggle).toHaveAttribute("aria-checked", "true");

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(savePlannedSession).toHaveBeenCalledWith("athlete-1", "2026-09-01", "REST", null, true, null));
  });

  it("a free day with no row shows no secondary action", () => {
    render(<Harness initialRow={null} initialExpanded />);
    expect(screen.queryByRole("button", { name: "Retirer cette séance" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Passer en repos" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revenir au plan" })).not.toBeInTheDocument();
  });
});

describe("PlanningDayCard — stale load invariant (R, S, T)", () => {
  it("R: prefills the existing persisted load when editing without changing kind", () => {
    render(<Harness initialRow={strengthHeavyRow()} initialExpanded />);
    expect(pressedKinds()).toEqual(["Renfo bas du corps"]);
    expect(screen.getByRole("button", { name: "charge lourde" })).toHaveAttribute("aria-pressed", "true");
  });

  it("S: changing to a different variable kind clears the stale load and requires a new choice", async () => {
    const user = userEvent.setup();
    render(<Harness initialRow={strengthHeavyRow()} initialExpanded />);

    await pick(user, "DH_TECHNICAL");

    expect(screen.getByRole("button", { name: "charge lourde" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "charge modérée" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
  });

  it("T: changing to a fixed-load kind removes the load control and submits no load", async () => {
    const user = userEvent.setup();
    savePlannedSession.mockResolvedValue(restRow());
    render(<Harness initialRow={strengthHeavyRow()} initialExpanded />);

    await pick(user, "MOBILITY");
    expect(screen.queryByRole("group", { name: "Intensité" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(savePlannedSession).toHaveBeenCalledWith("athlete-1", "2026-09-01", "MOBILITY", null, false, null));
  });
});

function dhHeavyRow(durationMin?: number): PlannedSessionRow {
  return {
    planned_date: "2026-09-01",
    session_type: "DH_PERFORMANCE",
    intervention: { kind: "DH_PERFORMANCE", load_profile: "HEAVY", ...(durationMin !== undefined ? { duration_min: durationMin } : {}) },
    planned_intent: null,
    is_committed: false,
  };
}

// V0.3_006C2 — planned DH duration. DH-only; the ONE authoritative source is
// intervention.duration_min. UX-10B-2B: a − / + stepper over the same 15
// values (1 h to 8 h, 30 min steps), plus "Pas de durée".
describe("PlanningDayCard — planned duration (V0.3_006C2 / UX-10B-2B stepper)", () => {
  it("shows the Durée prévue control for a DH kind", async () => {
    const user = userEvent.setup();
    render(<Harness initialExpanded />);
    await pick(user, "DH_PERFORMANCE");
    expect(screen.getByRole("group", { name: "Durée prévue" })).toBeInTheDocument();
  });

  it("hides the Durée prévue control for a non-DH kind", async () => {
    const user = userEvent.setup();
    render(<Harness initialExpanded />);
    await pick(user, "STRENGTH_LOWER");
    expect(screen.queryByRole("group", { name: "Durée prévue" })).not.toBeInTheDocument();
  });

  it("hides the Durée prévue control for every non-DH kind, shows it only for the 4 DH-family kinds", async () => {
    const user = userEvent.setup();
    render(<Harness initialExpanded />);
    for (const kind of PLANNABLE_LOAD_VARIABLE_KINDS) {
      await pick(user, kind);
      const isDh = (["DH_PERFORMANCE", "DH_TECHNICAL", "DH_LIGHT", "PUMPTRACK"] as string[]).includes(kind);
      if (isDh) {
        expect(screen.getByRole("group", { name: "Durée prévue" })).toBeInTheDocument();
      } else {
        expect(screen.queryByRole("group", { name: "Durée prévue" })).not.toBeInTheDocument();
      }
    }
  });

  // V0.3_007C UI canary follow-up hotfix — PUMPTRACK shows the control but
  // must never claim uplifts: it is DH-family-plannable but not lift-served.
  it("duration copy: only lift-served DH kinds (DH_PERFORMANCE/DH_TECHNICAL/DH_LIGHT) claim remontées/pauses — PUMPTRACK keeps the generic copy", async () => {
    const user = userEvent.setup();
    render(<Harness initialExpanded />);

    for (const kind of ["DH_PERFORMANCE", "DH_TECHNICAL", "DH_LIGHT"] as const) {
      await pick(user, kind);
      expect(screen.getByText(/Pour la DH, remontées et pauses comprises/)).toBeInTheDocument();
    }

    await pick(user, "PUMPTRACK");
    expect(screen.getByRole("group", { name: "Durée prévue" })).toBeInTheDocument();
    expect(screen.queryByText(/remontées/)).not.toBeInTheDocument();
    expect(screen.getByText("Temps que tu prévois de consacrer à cette séance. NALYNT peut la réduire si ton état demande une adaptation.")).toBeInTheDocument();
  });

  it("stepper: starts at Pas de durée, + goes to 1 h then 30 min per step, capped at 8 h; − never goes below 1 h", async () => {
    const user = userEvent.setup();
    render(<Harness initialExpanded />);
    await pick(user, "DH_PERFORMANCE");

    expect(durationValue()).toBe("Pas de durée");
    expect(screen.getByRole("button", { name: "Réduire la durée" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Augmenter la durée" }));
    expect(durationValue()).toBe("1 h");
    expect(screen.getByRole("button", { name: "Réduire la durée" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Augmenter la durée" }));
    expect(durationValue()).toBe("1 h 30");

    for (let i = 0; i < 20; i++) await user.click(screen.getByRole("button", { name: "Augmenter la durée" }));
    expect(durationValue()).toBe("8 h");
    expect(screen.getByRole("button", { name: "Augmenter la durée" })).toBeDisabled();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("create: a chosen duration passes the exact minute value to savePlannedSession", async () => {
    const user = userEvent.setup();
    savePlannedSession.mockResolvedValue(dhHeavyRow(120));
    render(<Harness initialExpanded />);

    await pick(user, "DH_PERFORMANCE");
    await user.click(screen.getByRole("button", { name: "charge lourde" }));
    await stepTo(user, 120);
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(savePlannedSession).toHaveBeenCalledWith("athlete-1", "2026-09-01", "DH_PERFORMANCE", "HEAVY", false, "120")
    );
  });

  it("create: no duration chosen passes null", async () => {
    const user = userEvent.setup();
    savePlannedSession.mockResolvedValue(dhHeavyRow());
    render(<Harness initialExpanded />);

    await pick(user, "DH_PERFORMANCE");
    await user.click(screen.getByRole("button", { name: "charge lourde" }));
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(savePlannedSession).toHaveBeenCalledWith("athlete-1", "2026-09-01", "DH_PERFORMANCE", "HEAVY", false, null)
    );
  });

  it("edit: prefills the exact persisted duration when reopening", () => {
    render(<Harness initialRow={dhHeavyRow(150)} initialExpanded />);
    expect(durationValue()).toBe("2 h 30");
  });

  it("edit: changing 2h to 3h persists 180, not 120", async () => {
    const user = userEvent.setup();
    savePlannedSession.mockResolvedValue(dhHeavyRow(180));
    render(<Harness initialRow={dhHeavyRow(120)} initialExpanded />);

    expect(durationValue()).toBe("2 h");
    await user.click(screen.getByRole("button", { name: "Augmenter la durée" }));
    await user.click(screen.getByRole("button", { name: "Augmenter la durée" }));
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(savePlannedSession).toHaveBeenCalledWith("athlete-1", "2026-09-01", "DH_PERFORMANCE", "HEAVY", false, "180")
    );
  });

  // Critical JSONB clear semantics: choosing "Pas de durée" on a row that
  // already has a persisted duration must pass null, never resend the old value.
  it("clear: Pas de durée on a row with a persisted duration passes null, not the stale value", async () => {
    const user = userEvent.setup();
    savePlannedSession.mockResolvedValue(dhHeavyRow());
    render(<Harness initialRow={dhHeavyRow(120)} initialExpanded />);

    expect(durationValue()).toBe("2 h");
    await user.click(screen.getByRole("button", { name: "Pas de durée" }));
    expect(durationValue()).toBe("Pas de durée");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(savePlannedSession).toHaveBeenCalledWith("athlete-1", "2026-09-01", "DH_PERFORMANCE", "HEAVY", false, null)
    );
  });

  it("DH → non-DH: hides the control and saves without any duration, even though a DH duration was persisted", async () => {
    const user = userEvent.setup();
    savePlannedSession.mockResolvedValue(strengthHeavyRow());
    render(<Harness initialRow={dhHeavyRow(120)} initialExpanded />);

    expect(durationValue()).toBe("2 h");
    await pick(user, "STRENGTH_LOWER");
    expect(screen.queryByRole("group", { name: "Durée prévue" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "charge lourde" }));
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(savePlannedSession).toHaveBeenCalledWith("athlete-1", "2026-09-01", "STRENGTH_LOWER", "HEAVY", false, null)
    );
  });

  it("non-DH → DH: starts from 'Pas de durée', never a fabricated default", async () => {
    const user = userEvent.setup();
    render(<Harness initialRow={strengthHeavyRow()} initialExpanded />);

    await pick(user, "DH_PERFORMANCE");
    expect(durationValue()).toBe("Pas de durée");
  });
});

describe("PlanningDayCard — failure and draft isolation (O, W, X)", () => {
  it("O, W: a failed save shows the repo's own safe error, keeps the editor open, and does not change the persisted display", async () => {
    const user = userEvent.setup();
    const onRowChangeSpy = vi.fn();
    savePlannedSession.mockRejectedValue(new PlanningSaveError());
    render(<Harness initialRow={null} initialExpanded onRowChangeSpy={onRowChangeSpy} />);

    await pick(user, "REST");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Impossible d'enregistrer");
    expect(screen.getByRole("group", { name: "Séance" })).toBeInTheDocument(); // editor still open
    expect(onRowChangeSpy).not.toHaveBeenCalled();
  });

  it("O: an unexpected/unknown exception is masked to a generic safe message, never shown verbatim", async () => {
    const user = userEvent.setup();
    savePlannedSession.mockRejectedValue(new Error("Failed to fetch — some raw network/fetch-level detail"));
    render(<Harness initialRow={null} initialExpanded />);

    await pick(user, "REST");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Une erreur est survenue");
    expect(alert).not.toHaveTextContent(/Failed to fetch/);
  });

  it("W: a failed delete keeps the editor open and does not clear the persisted display", async () => {
    const user = userEvent.setup();
    const onRowChangeSpy = vi.fn();
    deletePlannedSession.mockRejectedValue(new PlanningDeleteError());
    render(<Harness initialRow={restRow()} initialExpanded onRowChangeSpy={onRowChangeSpy} />);

    await user.click(screen.getByRole("button", { name: "Retirer cette séance" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Impossible de supprimer");
    expect(onRowChangeSpy).not.toHaveBeenCalled();
  });

  it("X: collapsing without saving never shows the unsaved draft as persisted", async () => {
    const user = userEvent.setup();
    render(<Harness initialRow={null} initialExpanded />);

    await pick(user, "DH_TECHNICAL");
    await user.click(screen.getByRole("button", { name: "charge légère" }));
    // Collapse without saving — click the card header again.
    await user.click(screen.getByText(/septembre/i).closest("button")!);

    expect(screen.getByText("Libre")).toBeInTheDocument();
    expect(screen.queryByText(/DH technique/)).not.toBeInTheDocument();
    expect(savePlannedSession).not.toHaveBeenCalled();
  });
});

function legacyRow(): PlannedSessionRow {
  return {
    planned_date: "2026-09-01",
    session_type: "STRENGTH_A",
    intervention: null,
    planned_intent: null,
    is_committed: false,
  };
}

describe("PlanningDayCard — legacy row with intervention=NULL", () => {
  it("A: renders the coarse DbSessionType as a French label, never the raw enum", () => {
    render(<Harness initialRow={legacyRow()} />);
    expect(screen.getByText("Force A")).toBeInTheDocument();
    expect(screen.queryByText("STRENGTH_A")).not.toBeInTheDocument();
  });

  it("A2: an unmapped/unknown runtime session_type falls back to a generic safe label, never the raw enum", () => {
    const row = { planned_date: "2026-09-01", session_type: "SOME_FUTURE_ENUM_VALUE", intervention: null, planned_intent: null } as unknown as PlannedSessionRow;
    render(<Harness initialRow={row} />);
    expect(screen.getByText("Séance planifiée (ancienne)")).toBeInTheDocument();
    expect(screen.queryByText("SOME_FUTURE_ENUM_VALUE")).not.toBeInTheDocument();
  });

  it("B: opening it never fabricates/preselects a rich kind, and explains why", () => {
    render(<Harness initialRow={legacyRow()} initialExpanded />);
    expect(pressedKinds()).toEqual([]);
    expect(screen.getByText("Ancienne séance planifiée : Force A. Choisis une séance pour la modifier.")).toBeInTheDocument();
  });

  it("C: delete still works on a legacy row", async () => {
    const user = userEvent.setup();
    const onRowChangeSpy = vi.fn();
    deletePlannedSession.mockResolvedValue(undefined);
    render(<Harness initialRow={legacyRow()} initialExpanded onRowChangeSpy={onRowChangeSpy} />);

    await user.click(screen.getByRole("button", { name: "Retirer cette séance" }));

    await waitFor(() => expect(deletePlannedSession).toHaveBeenCalledWith("athlete-1", "2026-09-01"));
    expect(onRowChangeSpy).toHaveBeenCalledWith("2026-09-01", null, "Le jour redevient libre.");
  });

  it("D: replacing a legacy row requires an explicit rich athlete selection — Save is disabled until one is made", async () => {
    const user = userEvent.setup();
    savePlannedSession.mockResolvedValue(restRow());
    render(<Harness initialRow={legacyRow()} initialExpanded />);

    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();

    await pick(user, "REST");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(savePlannedSession).toHaveBeenCalledWith("athlete-1", "2026-09-01", "REST", null, false, null));
  });
});

// --- NAL-007: race calendar overlay ---

const A_PLUS_RACE: RaceOverlayEvent = { eventName: "EDC Verbier", startDate: "2026-09-01", endDate: "2026-09-03", priority: "A_PLUS" };
const C_RACE: RaceOverlayEvent = { eventName: "Sortie club local", startDate: "2026-09-01", endDate: "2026-09-01", priority: "C" };

describe("PlanningDayCard — NAL-007 race calendar overlay", () => {
  it("shows the race name and 'Course / événement' context when a race overlaps this date", () => {
    render(<Harness races={[A_PLUS_RACE]} />);
    expect(screen.getByText("EDC Verbier")).toBeInTheDocument();
    expect(screen.getByText(/Course \/ événement/)).toBeInTheDocument();
  });

  it("shows a priority badge for A_PLUS/A, but not for lower priorities", () => {
    const { rerender } = render(<Harness races={[A_PLUS_RACE]} />);
    expect(screen.getByText("A+")).toBeInTheDocument();

    rerender(<Harness races={[C_RACE]} />);
    expect(screen.queryByText("A+")).not.toBeInTheDocument();
    expect(screen.getByText("Sortie club local")).toBeInTheDocument();
  });

  it("renders no race banner at all when races is empty (default, unchanged behavior)", () => {
    render(<Harness races={[]} />);
    expect(screen.queryByText(/Course \/ événement/)).not.toBeInTheDocument();
  });

  it("no row + a race present: shows 'Aucune séance ajoutée', never plain 'Libre'", () => {
    render(<Harness initialRow={null} races={[A_PLUS_RACE]} />);
    expect(screen.getByText("Aucune séance ajoutée")).toBeInTheDocument();
    expect(screen.queryByText("Libre")).not.toBeInTheDocument();
  });

  it("no row + no race: Libre", () => {
    render(<Harness initialRow={null} races={[]} />);
    expect(screen.getByText("Libre")).toBeInTheDocument();
  });

  it("F: planned_session + race coexist — both the race banner and the planned session are visible", () => {
    render(<Harness initialRow={strengthHeavyRow()} races={[A_PLUS_RACE]} />);
    expect(screen.getByText("EDC Verbier")).toBeInTheDocument();
    expect(screen.getByText(/Renfo bas du corps/)).toBeInTheDocument();
  });

  it("G: Planning CRUD (save) still works exactly as before on a day with a race overlay", async () => {
    const user = userEvent.setup();
    savePlannedSession.mockResolvedValue(strengthHeavyRow());
    render(<Harness initialExpanded races={[A_PLUS_RACE]} />);

    await pick(user, "STRENGTH_LOWER");
    await user.click(screen.getByRole("button", { name: "charge lourde" }));
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(savePlannedSession).toHaveBeenCalledWith("athlete-1", "2026-09-01", "STRENGTH_LOWER", "HEAVY", false, null)
    );
  });

  it("H: merely rendering a day with a race overlay creates/mutates no planned_sessions row", () => {
    render(<Harness races={[A_PLUS_RACE]} planSession={PLAN_DH} />);
    expect(savePlannedSession).not.toHaveBeenCalled();
    expect(deletePlannedSession).not.toHaveBeenCalled();
  });

  it("I: RACE_ACTIVITY is still never offered in the session picker on a race day (unchanged)", () => {
    render(<Harness initialExpanded races={[A_PLUS_RACE]} />);
    expect(within(screen.getByRole("group", { name: "Séance" })).queryByText("Activité course")).not.toBeInTheDocument();
  });

  it("multiple races the same day are all displayed", () => {
    render(<Harness races={[A_PLUS_RACE, C_RACE]} />);
    expect(screen.getByText("EDC Verbier")).toBeInTheDocument();
    expect(screen.getByText("Sortie club local")).toBeInTheDocument();
  });
});

describe.each(PLANNABLE_LOAD_VARIABLE_KINDS)("PlanningDayCard — variable kind %s (F, H)", (kind) => {
  it("is selectable, shows Intensité, and requires a load before Save enables", async () => {
    const user = userEvent.setup();
    render(<Harness initialExpanded />);

    await pick(user, kind);

    expect(kindButton(kind)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("group", { name: "Intensité" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "charge modérée" }));
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeEnabled();
  });
});

describe.each(PLANNABLE_FIXED_LOAD_KINDS)("PlanningDayCard — fixed kind %s (F, I)", (kind) => {
  it("is selectable, hides Intensité, and Save is enabled without any load", async () => {
    const user = userEvent.setup();
    savePlannedSession.mockResolvedValue(restRow());
    render(<Harness initialExpanded />);

    await pick(user, kind);

    expect(kindButton(kind)).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("group", { name: "Intensité" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(savePlannedSession).toHaveBeenCalledWith("athlete-1", "2026-09-01", kind, null, false, null));
  });
});

// REV-015.2 — the current day's card reads "Aujourd'hui", never "Today"; kinds stay French.
describe("PlanningDayCard — today label (REV-015.2)", () => {
  it("today's card reads 'Aujourd'hui'", () => {
    render(
      <PlanningDayCard
        athleteId="athlete-1"
        date="2026-09-01"
        row={strengthHeavyRow()}
        races={[]}
        isToday
        isExpanded={false}
        onToggleExpand={() => {}}
        onRowChange={() => {}}
      />
    );

    expect(screen.getByText("Aujourd'hui")).toBeInTheDocument();
    expect(screen.queryByText("Today")).not.toBeInTheDocument();
    expect(screen.getByText("Renfo bas du corps")).toBeInTheDocument();
  });
});
