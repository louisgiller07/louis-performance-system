import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { HealthFlagBanner } from "./HealthFlagBanner";

describe("HealthFlagBanner", () => {
  it("renders nothing when there are no open flags", () => {
    const { container } = render(<HealthFlagBanner flags={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  // A. open concussion_suspect -> banner visible
  it("A: renders when an open concussion_suspect flag is present", () => {
    render(<HealthFlagBanner flags={[{ type: "concussion_suspect", flagDate: "2026-09-05" }]} />);
    expect(screen.getByText("Suivi santé actif")).toBeInTheDocument();
  });

  // B. banner includes friendly label/date
  it("B: shows the friendly French label and the declared date, never the raw enum slug", () => {
    render(<HealthFlagBanner flags={[{ type: "concussion_suspect", flagDate: "2026-09-05" }]} />);
    expect(screen.getByText(/Suspicion de commotion signalée le 5 septembre\./)).toBeInTheDocument();
    expect(screen.queryByText(/concussion_suspect/)).not.toBeInTheDocument();
  });

  // C. banner explains today's "Non" does not clear the prior signal
  it("C: states that today's 'Non' does not clear the prior signal", () => {
    render(<HealthFlagBanner flags={[{ type: "concussion_suspect", flagDate: "2026-09-05" }]} />);
    expect(screen.getByText(/Ce signal reste actif même si tu réponds « Non » aujourd'hui\./)).toBeInTheDocument();
  });

  // D. banner explicitly states NALYNT currently cannot close the follow-up from the app
  it("D: explicitly states NALYNT cannot currently close this follow-up from the app", () => {
    render(<HealthFlagBanner flags={[{ type: "concussion_suspect", flagDate: "2026-09-05" }]} />);
    expect(screen.getByText(/NALYNT ne permet pas encore de clôturer ce suivi depuis l'application\./)).toBeInTheDocument();
  });

  // E. raw enum/status/UUID absent
  it("E: never shows the raw enum slug, DB status name, or a UUID", () => {
    render(<HealthFlagBanner flags={[{ type: "concussion_suspect", flagDate: "2026-09-05" }]} />);
    expect(screen.queryByText(/concussion_suspect/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\bactive\b/)).not.toBeInTheDocument();
    expect(screen.queryByText(/monitoring/)).not.toBeInTheDocument();
    expect(screen.queryByText(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)).not.toBeInTheDocument();
  });

  // F. open illness only -> persistent Safety banner NOT rendered
  it("F: does not render for an open illness flag alone (no persistent Safety follow-up exists for it)", () => {
    const { container } = render(<HealthFlagBanner flags={[{ type: "illness", flagDate: "2026-09-05" }]} />);
    expect(container).toBeEmptyDOMElement();
  });

  // G. open injury_suspect only -> persistent Safety banner NOT rendered
  it("G: does not render for an open injury_suspect flag alone", () => {
    const { container } = render(<HealthFlagBanner flags={[{ type: "injury_suspect", flagDate: "2026-09-05" }]} />);
    expect(container).toBeEmptyDOMElement();
  });

  // H. open pain_persistent only -> persistent Safety banner NOT rendered
  it("H: does not render for an open pain_persistent flag alone", () => {
    const { container } = render(<HealthFlagBanner flags={[{ type: "pain_persistent", flagDate: "2026-09-05" }]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the concussion banner even when other non-concussion flags are also open simultaneously", () => {
    render(
      <HealthFlagBanner
        flags={[
          { type: "illness", flagDate: "2026-09-07" },
          { type: "concussion_suspect", flagDate: "2026-09-05" },
        ]}
      />
    );
    expect(screen.getByText("Suivi santé actif")).toBeInTheDocument();
    expect(screen.getByText(/Suspicion de commotion/)).toBeInTheDocument();
    // The illness flag's own label must not leak into this concussion-only banner.
    expect(screen.queryByText(/Maladie \/ fièvre/)).not.toBeInTheDocument();
  });

  it("never offers a resolution/clearance action", () => {
    render(<HealthFlagBanner flags={[{ type: "concussion_suspect", flagDate: "2026-09-05" }]} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/Résoudre/)).not.toBeInTheDocument();
    expect(screen.queryByText(/guéri/)).not.toBeInTheDocument();
    expect(screen.queryByText(/[Vv]alidation médicale/)).not.toBeInTheDocument();
  });
});
