import { useState } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlanningDayCard } from "./PlanningDayCard";
import { PlanningDeleteError, PlanningSaveError } from "./planningRepo";
import { PLANNABLE_FIXED_LOAD_KINDS, PLANNABLE_LOAD_VARIABLE_KINDS } from "./planningTypes";
import type { PlannedSessionRow } from "./planningTypes";

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

function restRow(): PlannedSessionRow {
  return { planned_date: "2026-09-01", session_type: "REST", intervention: { kind: "REST" }, planned_intent: null };
}

function strengthHeavyRow(): PlannedSessionRow {
  return {
    planned_date: "2026-09-01",
    session_type: "STRENGTH_A",
    intervention: { kind: "STRENGTH_LOWER", load_profile: "HEAVY" },
    planned_intent: null,
  };
}

// Minimal stand-in for PlanPage: PlanningDayCard is a controlled component
// (canonical row + expanded state always come from its parent), so a real
// test needs something playing that parent role — never a copy of "what's
// persisted" inside the card itself.
function Harness({
  initialRow = null,
  initialExpanded = false,
  onRowChangeSpy,
}: {
  initialRow?: PlannedSessionRow | null;
  initialExpanded?: boolean;
  onRowChangeSpy?: (date: string, row: PlannedSessionRow | null) => void;
}) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const [row, setRow] = useState<PlannedSessionRow | null>(initialRow);
  return (
    <PlanningDayCard
      athleteId="athlete-1"
      date="2026-09-01"
      isToday={false}
      row={row}
      isExpanded={expanded}
      onToggleExpand={() => setExpanded((e) => !e)}
      onRowChange={(date, newRow) => {
        setRow(newRow);
        setExpanded(false);
        onRowChangeSpy?.(date, newRow);
      }}
    />
  );
}

describe("PlanningDayCard — collapsed states", () => {
  it("D: shows Non planifié when no row exists", () => {
    render(<Harness initialRow={null} />);
    expect(screen.getByText("Non planifié")).toBeInTheDocument();
  });

  it("E: shows Repos for an explicit REST row", () => {
    render(<Harness initialRow={restRow()} />);
    expect(screen.getByText("Repos")).toBeInTheDocument();
  });

  it("shows kind + load for an explicit variable-load row", () => {
    render(<Harness initialRow={strengthHeavyRow()} />);
    expect(screen.getByText(/Renfo bas du corps/)).toBeInTheDocument();
    expect(screen.getByText(/charge lourde/)).toBeInTheDocument();
  });
});

describe("PlanningDayCard — session picker (F, G)", () => {
  it("F: offers exactly the 15 athlete-plannable kinds", () => {
    render(<Harness initialExpanded />);
    const select = screen.getByLabelText("Séance");
    // 15 real options + the "— Choisir —" placeholder.
    expect(within(select).getAllByRole("option")).toHaveLength(16);
  });

  it("G: never offers RACE_ACTIVITY", () => {
    render(<Harness initialExpanded />);
    const select = screen.getByLabelText("Séance");
    expect(within(select).queryByText("Activité course")).not.toBeInTheDocument();
  });
});

describe("PlanningDayCard — load UI (H, I)", () => {
  it("H: shows the load selector for a variable-load kind", async () => {
    const user = userEvent.setup();
    render(<Harness initialExpanded />);
    await user.selectOptions(screen.getByLabelText("Séance"), "DH_TECHNICAL");
    expect(screen.getByRole("group", { name: "Intensité" })).toBeInTheDocument();
  });

  it("I: hides the load selector for a fixed-load kind", async () => {
    const user = userEvent.setup();
    render(<Harness initialExpanded />);
    await user.selectOptions(screen.getByLabelText("Séance"), "REST");
    expect(screen.queryByRole("group", { name: "Intensité" })).not.toBeInTheDocument();
  });

  it("requires an explicit load choice before Save is enabled for a variable kind", async () => {
    const user = userEvent.setup();
    render(<Harness initialExpanded />);
    await user.selectOptions(screen.getByLabelText("Séance"), "DH_TECHNICAL");
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "charge modérée" }));
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeEnabled();
  });
});

describe("PlanningDayCard — create/edit/delete (J, K, L, M, N)", () => {
  it("J: create calls savePlannedSession with the chosen kind and load", async () => {
    const user = userEvent.setup();
    savePlannedSession.mockResolvedValue(strengthHeavyRow());
    render(<Harness initialExpanded />);

    await user.selectOptions(screen.getByLabelText("Séance"), "STRENGTH_LOWER");
    await user.click(screen.getByRole("button", { name: "charge lourde" }));
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(savePlannedSession).toHaveBeenCalledWith("athlete-1", "2026-09-01", "STRENGTH_LOWER", "HEAVY"));
  });

  it("K: edit calls savePlannedSession, replacing the previous intervention", async () => {
    const user = userEvent.setup();
    savePlannedSession.mockResolvedValue(restRow());
    render(<Harness initialRow={strengthHeavyRow()} initialExpanded />);

    await user.selectOptions(screen.getByLabelText("Séance"), "REST");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(savePlannedSession).toHaveBeenCalledWith("athlete-1", "2026-09-01", "REST", null));
  });

  it("L, M: delete calls deletePlannedSession and returns the card to Non planifié, never Repos", async () => {
    const user = userEvent.setup();
    deletePlannedSession.mockResolvedValue(undefined);
    render(<Harness initialRow={restRow()} initialExpanded />);

    await user.click(screen.getByRole("button", { name: "Retirer du planning" }));

    await waitFor(() => expect(deletePlannedSession).toHaveBeenCalledWith("athlete-1", "2026-09-01"));
    expect(await screen.findByText("Non planifié")).toBeInTheDocument();
    expect(screen.queryByText("Repos")).not.toBeInTheDocument();
  });

  it("N: saving REST yields an explicit Repos persisted state", async () => {
    const user = userEvent.setup();
    savePlannedSession.mockResolvedValue(restRow());
    render(<Harness initialExpanded />);

    await user.selectOptions(screen.getByLabelText("Séance"), "REST");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByText("Repos")).toBeInTheDocument();
    expect(deletePlannedSession).not.toHaveBeenCalled();
  });

  it("does not show the delete action when no row exists yet", () => {
    render(<Harness initialRow={null} initialExpanded />);
    expect(screen.queryByRole("button", { name: "Retirer du planning" })).not.toBeInTheDocument();
  });
});

describe("PlanningDayCard — stale load invariant (R, S, T)", () => {
  it("R: prefills the existing persisted load when editing without changing kind", () => {
    render(<Harness initialRow={strengthHeavyRow()} initialExpanded />);
    expect(screen.getByLabelText("Séance")).toHaveValue("STRENGTH_LOWER");
    expect(screen.getByRole("button", { name: "charge lourde" })).toHaveAttribute("aria-pressed", "true");
  });

  it("S: changing to a different variable kind clears the stale load and requires a new choice", async () => {
    const user = userEvent.setup();
    render(<Harness initialRow={strengthHeavyRow()} initialExpanded />);

    await user.selectOptions(screen.getByLabelText("Séance"), "DH_TECHNICAL");

    expect(screen.getByRole("button", { name: "charge lourde" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "charge modérée" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
  });

  it("T: changing to a fixed-load kind removes the load control and submits no load", async () => {
    const user = userEvent.setup();
    savePlannedSession.mockResolvedValue(restRow());
    render(<Harness initialRow={strengthHeavyRow()} initialExpanded />);

    await user.selectOptions(screen.getByLabelText("Séance"), "MOBILITY");
    expect(screen.queryByRole("group", { name: "Intensité" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(savePlannedSession).toHaveBeenCalledWith("athlete-1", "2026-09-01", "MOBILITY", null));
  });
});

describe("PlanningDayCard — failure and draft isolation (O, W, X)", () => {
  it("O, W: a failed save shows the repo's own safe error, keeps the editor open, and does not change the persisted display", async () => {
    const user = userEvent.setup();
    const onRowChangeSpy = vi.fn();
    savePlannedSession.mockRejectedValue(new PlanningSaveError());
    render(<Harness initialRow={null} initialExpanded onRowChangeSpy={onRowChangeSpy} />);

    await user.selectOptions(screen.getByLabelText("Séance"), "REST");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Impossible d'enregistrer");
    expect(screen.getByLabelText("Séance")).toBeInTheDocument(); // editor still open
    expect(onRowChangeSpy).not.toHaveBeenCalled();
  });

  it("O: an unexpected/unknown exception is masked to a generic safe message, never shown verbatim", async () => {
    const user = userEvent.setup();
    savePlannedSession.mockRejectedValue(new Error("Failed to fetch — some raw network/fetch-level detail"));
    render(<Harness initialRow={null} initialExpanded />);

    await user.selectOptions(screen.getByLabelText("Séance"), "REST");
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

    await user.click(screen.getByRole("button", { name: "Retirer du planning" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Impossible de supprimer");
    expect(onRowChangeSpy).not.toHaveBeenCalled();
  });

  it("X: collapsing without saving never shows the unsaved draft as persisted", async () => {
    const user = userEvent.setup();
    render(<Harness initialRow={null} initialExpanded />);

    await user.selectOptions(screen.getByLabelText("Séance"), "DH_TECHNICAL");
    await user.click(screen.getByRole("button", { name: "charge légère" }));
    // Collapse without saving — click the card header again.
    await user.click(screen.getByText(/septembre/i).closest("button")!);

    expect(screen.getByText("Non planifié")).toBeInTheDocument();
    expect(screen.queryByText(/DH technique/)).not.toBeInTheDocument();
    expect(savePlannedSession).not.toHaveBeenCalled();
  });
});

function legacyRow(): PlannedSessionRow {
  return { planned_date: "2026-09-01", session_type: "STRENGTH_A", intervention: null, planned_intent: null };
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
    expect(screen.getByLabelText("Séance")).toHaveValue("");
    expect(screen.getByText("Ancienne séance planifiée : Force A. Choisis une séance pour la modifier.")).toBeInTheDocument();
  });

  it("C: delete still works on a legacy row", async () => {
    const user = userEvent.setup();
    const onRowChangeSpy = vi.fn();
    deletePlannedSession.mockResolvedValue(undefined);
    render(<Harness initialRow={legacyRow()} initialExpanded onRowChangeSpy={onRowChangeSpy} />);

    await user.click(screen.getByRole("button", { name: "Retirer du planning" }));

    await waitFor(() => expect(deletePlannedSession).toHaveBeenCalledWith("athlete-1", "2026-09-01"));
    expect(onRowChangeSpy).toHaveBeenCalledWith("2026-09-01", null);
  });

  it("D: replacing a legacy row requires an explicit rich athlete selection — Save is disabled until one is made", async () => {
    const user = userEvent.setup();
    savePlannedSession.mockResolvedValue(restRow());
    render(<Harness initialRow={legacyRow()} initialExpanded />);

    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("Séance"), "REST");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(savePlannedSession).toHaveBeenCalledWith("athlete-1", "2026-09-01", "REST", null));
  });
});

describe.each(PLANNABLE_LOAD_VARIABLE_KINDS)("PlanningDayCard — variable kind %s (F, H)", (kind) => {
  it("is selectable, shows Intensité, and requires a load before Save enables", async () => {
    const user = userEvent.setup();
    render(<Harness initialExpanded />);

    await user.selectOptions(screen.getByLabelText("Séance"), kind);

    expect(screen.getByLabelText("Séance")).toHaveValue(kind);
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

    await user.selectOptions(screen.getByLabelText("Séance"), kind);

    expect(screen.getByLabelText("Séance")).toHaveValue(kind);
    expect(screen.queryByRole("group", { name: "Intensité" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(savePlannedSession).toHaveBeenCalledWith("athlete-1", "2026-09-01", kind, null));
  });
});
