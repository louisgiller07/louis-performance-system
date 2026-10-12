import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HealthFlagBanner, flagLocationLabel } from "./HealthFlagBanner";
import type { OpenHealthFlag } from "./openHealthFlagsRepo";

const resolveMock = vi.fn();
vi.mock("./healthFlagResolutionClient", () => ({ resolveOpenHealthFlag: (...args: unknown[]) => resolveMock(...args) }));

const ID = "0f6e3b1c-2a4d-4e5f-8a9b-0c1d2e3f4a5b";
const concussion: OpenHealthFlag = { id: ID, type: "concussion_suspect", flagDate: "2026-09-05", description: "Suspicion de commotion déclarée au checkin" };
const injury: OpenHealthFlag = { id: ID, type: "injury_suspect", flagDate: "2026-10-23", description: "Douleur avec critère objectif de gravité (traumatique, perte de fonction) — knee_R" };
const illness: OpenHealthFlag = { id: "1f6e3b1c-2a4d-4e5f-8a9b-0c1d2e3f4a5b", type: "illness", flagDate: "2026-10-24", description: "Fièvre ou maladie déclarée au checkin" };

beforeEach(() => resolveMock.mockReset());

describe("HealthFlagBanner — concussion (V0.3_006A1, unchanged)", () => {
  it("renders nothing when there are no open flags", () => {
    const { container } = render(<HealthFlagBanner flags={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("A/B: the friendly label and the declared date, never the raw enum slug", () => {
    render(<HealthFlagBanner flags={[concussion]} />);
    expect(screen.getByText("Suivi santé actif")).toBeInTheDocument();
    expect(screen.getByText(/Suspicion de commotion signalée le 5 septembre\./)).toBeInTheDocument();
    expect(screen.queryByText(/concussion_suspect/)).not.toBeInTheDocument();
  });

  it("C/D: today's 'Non' does not clear it, and it cannot be closed from the app (no button, no medical claim)", () => {
    render(<HealthFlagBanner flags={[concussion]} />);
    expect(screen.getByText(/Ce signal reste actif même si tu réponds « Non » aujourd'hui\./)).toBeInTheDocument();
    expect(screen.getByText(/NALYNT ne permet pas encore de clôturer ce suivi depuis l'application\./)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/guéri/)).not.toBeInTheDocument();
  });
});

describe("HealthFlagBanner — followed signals (P0-SAFE)", () => {
  it("an open injury signal is shown with its zone and date, its consequence, and a closure action", () => {
    render(<HealthFlagBanner flags={[injury]} />);
    expect(screen.getByText(/Suspicion de blessure \(genou droit\) signalée le 23 octobre\./)).toBeInTheDocument();
    expect(screen.getByText(/Tant qu'il est ouvert, NALYNT ne te propose pas d'entraînement\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clôturer ce signal" })).toBeInTheDocument();
  });

  it("illness and persistent pain are shown too; several signals are each shown once", () => {
    render(<HealthFlagBanner flags={[illness, { ...injury, type: "pain_persistent", description: "Douleur persistante" }]} />);
    expect(screen.getByText(/Maladie \/ fièvre signalée le 24 octobre\./)).toBeInTheDocument();
    expect(screen.getByText(/Douleur persistante signalée le 23 octobre\./)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Clôturer ce signal" })).toHaveLength(2);
  });

  it("concussion + injury: the concussion keeps its non-closable notice, the injury gets its own closure", () => {
    render(<HealthFlagBanner flags={[concussion, { ...injury, id: "2f6e3b1c-2a4d-4e5f-8a9b-0c1d2e3f4a5b" }]} />);
    expect(screen.getByText(/NALYNT ne permet pas encore de clôturer ce suivi/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Clôturer ce signal" })).toHaveLength(1);
  });

  it("closing asks for a confirmation that is a declaration, never a medical validation; the consultation is optional", async () => {
    const onResolved = vi.fn();
    resolveMock.mockResolvedValue({ ok: true });
    render(<HealthFlagBanner flags={[injury]} onResolved={onResolved} />);
    fireEvent.click(screen.getByRole("button", { name: "Clôturer ce signal" }));
    expect(screen.getByText(/seulement si la douleur ou les symptômes ont disparu/)).toBeInTheDocument();
    expect(screen.getByText(/NALYNT ne valide pas médicalement ta reprise/)).toBeInTheDocument();
    expect(resolveMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("J'ai consulté un professionnel de santé"));
    fireEvent.click(screen.getByRole("button", { name: /Confirmer : je n'ai plus de douleur ni de symptôme/ }));
    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1));
    expect(resolveMock).toHaveBeenCalledWith(ID, true);
  });

  it("cancelling sends nothing; a failure is shown and nothing is reported as closed", async () => {
    const onResolved = vi.fn();
    resolveMock.mockResolvedValue({ ok: false, message: "Ce signal est déjà clôturé." });
    render(<HealthFlagBanner flags={[injury]} onResolved={onResolved} />);
    fireEvent.click(screen.getByRole("button", { name: "Clôturer ce signal" }));
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(resolveMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Clôturer ce signal" }));
    fireEvent.click(screen.getByRole("button", { name: /Confirmer/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ce signal est déjà clôturé.");
    expect(resolveMock).toHaveBeenCalledWith(ID, false);
    expect(onResolved).not.toHaveBeenCalled();
  });

  it("never shows a raw slug, location code, status name or id", () => {
    render(<HealthFlagBanner flags={[injury, illness]} />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/injury_suspect|illness\b|knee_R|\bactive\b|monitoring|[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it("flagLocationLabel: the trailing canonical code only, never a guess", () => {
    expect(flagLocationLabel("Douleur sévère déclarée (8/10) — knee_R")).toBe("Genou droit");
    expect(flagLocationLabel("Fièvre ou maladie déclarée au checkin")).toBeNull();
    expect(flagLocationLabel("Douleur — not_a_code")).toBeNull();
  });
});
