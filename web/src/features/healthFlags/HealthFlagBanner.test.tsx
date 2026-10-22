import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HealthFlagBanner, flagLocationLabel, zoneLabel } from "./HealthFlagBanner";
import type { OpenHealthFlag } from "./openHealthFlagsRepo";

const resolveMock = vi.fn();
const inspectMock = vi.fn();
vi.mock("./healthFlagResolutionClient", () => ({
  resolveOpenHealthFlag: (...args: unknown[]) => resolveMock(...args),
  inspectOpenHealthFlag: (...args: unknown[]) => inspectMock(...args),
}));

const ID = "0f6e3b1c-2a4d-4e5f-8a9b-0c1d2e3f4a5b";
const concussion: OpenHealthFlag = { id: ID, type: "concussion_suspect", flagDate: "2026-09-05", description: "Suspicion de commotion déclarée au checkin" };
const injury: OpenHealthFlag = { id: ID, type: "injury_suspect", flagDate: "2026-10-23", description: "Douleur sévère déclarée (8/10) — knee_R" };
const illness: OpenHealthFlag = { id: "1f6e3b1c-2a4d-4e5f-8a9b-0c1d2e3f4a5b", type: "illness", flagDate: "2026-10-24", description: "Fièvre ou maladie déclarée au checkin" };
const SIMPLE = { zones: ["knee_R"], requiresProfessionalClearance: false };
const GRAVE = { zones: ["knee_R"], requiresProfessionalClearance: true };
const MULTI = { zones: ["knee_R", "wrist_R"], requiresProfessionalClearance: true };

beforeEach(() => {
  resolveMock.mockReset();
  inspectMock.mockReset();
  inspectMock.mockResolvedValue(SIMPLE);
});

const openClosure = async () => {
  const button = await screen.findByRole("button", { name: "Clôturer ce signal" });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
};
const confirmButton = () => screen.getByRole("button", { name: /Confirmer : je n'ai plus de douleur ni de symptôme/ });

describe("HealthFlagBanner — concussion (V0.3_006A1, unchanged)", () => {
  it("renders nothing when there are no open flags", () => {
    const { container } = render(<HealthFlagBanner flags={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("the friendly label and date; today's 'Non' does not clear it; never the free closure — only the declaration of the assessment (SPORT-SAFE-02 A5)", () => {
    render(<HealthFlagBanner flags={[concussion]} />);
    expect(screen.getByText(/Suspicion de commotion signalée le 5 septembre\./)).toBeInTheDocument();
    expect(screen.getByText(/Ce signal reste actif même si tu réponds « Non » aujourd'hui\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clôturer ce signal" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Déclarer l'issue de mon évaluation"]);
    expect(inspectMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/concussion_suspect/)).not.toBeInTheDocument();
  });

  it("SPORT-SAFE-02 — orientation to a health professional, never a return protocol, never a closure offered as a clearance", async () => {
    render(<HealthFlagBanner flags={[concussion]} />);
    expect(screen.getByTestId("concussion-suspension")).toHaveTextContent("Tant que ce suivi est ouvert, NALYNT suspend ses propositions d'entraînement.");
    expect(screen.getByTestId("concussion-orientation")).toHaveTextContent(
      "Consulte un professionnel de santé : lui seul peut évaluer ta reprise. NALYNT ne propose aucun protocole de reprise après une commotion."
    );
    expect(screen.queryByRole("button", { name: "Clôturer ce signal" })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/autoris|reprise progressive|étape \d/i);
  });

  it("SPORT-SAFE-02 — the orientation is the concussion's own: a followed injury signal does not carry it", async () => {
    render(<HealthFlagBanner flags={[injury]} />);
    await screen.findByText(/Suspicion de blessure/);
    expect(screen.queryByTestId("concussion-orientation")).toBeNull();
  });
});

describe("HealthFlagBanner — followed signals (P0-SAFE)", () => {
  it("an open signal: zone, date and the coaching suspension (not a medical order)", async () => {
    render(<HealthFlagBanner flags={[injury]} />);
    expect(await screen.findByText(/Suspicion de blessure \(genou droit\) signalée le 23 octobre\./)).toBeInTheDocument();
    expect(screen.getByText(/Tant qu'il est ouvert, NALYNT suspend ses propositions d'entraînement\./)).toBeInTheDocument();
    expect(inspectMock).toHaveBeenCalledWith(ID);
  });

  it("several zones grouped in one signal are ALL named in the banner (never only the first complaint)", async () => {
    inspectMock.mockResolvedValue(MULTI);
    render(<HealthFlagBanner flags={[injury]} />);
    expect(await screen.findByText(/Suspicion de blessure \(genou droit, poignet droit\) signalée le 23 octobre\./)).toBeInTheDocument();
  });

  it("simple signal: the declaration closes it; the consultation is optional and explicitly not a clearance", async () => {
    const onResolved = vi.fn();
    resolveMock.mockResolvedValue({ ok: true });
    render(<HealthFlagBanner flags={[injury]} onResolved={onResolved} />);
    await openClosure();
    expect(screen.getByText(/seulement si la douleur ou les symptômes ont entièrement disparu/)).toBeInTheDocument();
    expect(screen.getByText(/Une consultation n'est pas une autorisation de reprise\./)).toBeInTheDocument();
    expect(screen.queryByLabelText(/m'a autorisé à reprendre/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("J'ai consulté un professionnel de santé"));
    fireEvent.click(confirmButton());
    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1));
    expect(resolveMock).toHaveBeenCalledWith(ID, { professionalConsulted: true, professionalClearance: false, confirmedZones: [] });
  });

  it("grave signal: no closure without the attested clearance; the attestation is said to be unverified by NALYNT", async () => {
    inspectMock.mockResolvedValue(GRAVE);
    resolveMock.mockResolvedValue({ ok: true });
    render(<HealthFlagBanner flags={[injury]} />);
    await openClosure();
    expect(screen.getByText(/comportait un critère de gravité/)).toBeInTheDocument();
    expect(screen.getByText(/NALYNT ne vérifie pas cette attestation/)).toBeInTheDocument();
    expect(screen.queryByLabelText("J'ai consulté un professionnel de santé")).not.toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Un professionnel de santé m'a autorisé à reprendre l'entraînement"));
    expect(confirmButton()).toBeEnabled();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(resolveMock).toHaveBeenCalledWith(ID, { professionalConsulted: false, professionalClearance: true, confirmedZones: [] }));
  });

  it("multi-zone signal: every zone must be confirmed before the closure is possible; all of them are sent", async () => {
    inspectMock.mockResolvedValue(MULTI);
    resolveMock.mockResolvedValue({ ok: true });
    render(<HealthFlagBanner flags={[injury]} />);
    await openClosure();
    fireEvent.click(screen.getByLabelText("Un professionnel de santé m'a autorisé à reprendre l'entraînement"));
    fireEvent.click(screen.getByLabelText("Genou droit : plus aucune douleur"));
    expect(confirmButton()).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Poignet droit : plus aucune douleur"));
    expect(confirmButton()).toBeEnabled();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(resolveMock).toHaveBeenCalledWith(ID, { professionalConsulted: false, professionalClearance: true, confirmedZones: ["knee_R", "wrist_R"] }));
  });

  it("cancelling sends nothing; a server refusal is shown with its updated requirements, nothing is reported as closed", async () => {
    const onResolved = vi.fn();
    resolveMock.mockResolvedValue({ ok: false, message: "Ce signal ne peut être clôturé qu'avec l'autorisation de reprise d'un professionnel de santé.", requirements: GRAVE });
    render(<HealthFlagBanner flags={[injury]} onResolved={onResolved} />);
    await openClosure();
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(resolveMock).not.toHaveBeenCalled();
    await openClosure();
    fireEvent.click(confirmButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("autorisation de reprise");
    expect(screen.getByLabelText("Un professionnel de santé m'a autorisé à reprendre l'entraînement")).toBeInTheDocument();
    expect(onResolved).not.toHaveBeenCalled();
  });

  it("illness: shown and closable; requirements unavailable → no closure offered yet", async () => {
    inspectMock.mockResolvedValue(null);
    render(<HealthFlagBanner flags={[illness]} />);
    expect(screen.getByText(/Maladie \/ fièvre signalée le 24 octobre\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clôturer ce signal" })).toBeDisabled();
  });

  it("never shows a raw slug, location code, status name or id", async () => {
    inspectMock.mockResolvedValue(MULTI);
    render(<HealthFlagBanner flags={[injury, illness]} />);
    await screen.findAllByText(/poignet droit/);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/injury_suspect|illness\b|knee_R|wrist_R|\bactive\b|monitoring|[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it("labels: canonical codes only, never a guess", () => {
    expect(flagLocationLabel("Douleur sévère déclarée (8/10) — knee_R")).toBe("Genou droit");
    expect(flagLocationLabel("Fièvre ou maladie déclarée au checkin")).toBeNull();
    expect(zoneLabel("wrist_R")).toBe("Poignet droit");
    expect(zoneLabel("unspecified")).toBe("Zone non précisée");
  });
});
