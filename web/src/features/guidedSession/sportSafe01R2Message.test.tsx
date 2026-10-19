import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { fakeBackend, prescriptionView } from "../../test/guidedSessionFakeBackend";
import { GuidedSessionHarness as Harness } from "../../test/GuidedSessionHarness";
import { FinalPrescriptionV2Card } from "../finalPrescriptionV2/FinalPrescriptionV2Card";
import { BLOCKED_MESSAGES, MANUAL_BLOCKED_MESSAGES, MODIFY_NOT_SUPPORTED_MESSAGE } from "../finalPrescriptionV2/finalPrescriptionV2Copy";
import { UNAVAILABLE_MESSAGES } from "./guidedSessionCopy";

// SPORT-SAFE-01R.2 (proposed copy) — a day refused `modify_not_supported` (ADR A04 §6: no guided version lighter than
// the planned one) says so, on Today's session card and on /today/session. Every other blocked reason keeps its message.

const REFUSED = { reason: "modify_not_supported", planned: "MODERATE", final: "LIGHT", durationMin: 45 };

describe("SPORT-SAFE-01R.2 — the message of a `modify_not_supported` day", () => {
  it("the proposed text, exactly", () => {
    expect(MODIFY_NOT_SUPPORTED_MESSAGE).toBe(
      "Ton état du jour demande d'adapter cette séance, mais NALYNT n'en a pas de version guidée plus légère que celle prévue : pas de séance guidée aujourd'hui."
    );
  });

  it.each([
    ["planned endurance 45, M1 LIGHT", REFUSED],
    ["manual session (P0-3), same refusal", { ...REFUSED, durationMin: 60 }],
  ])("Today's session card, %s → the specific message", (_, detail) => {
    render(<FinalPrescriptionV2Card state={{ kind: "blocked", code: "final_prescription_adaptation_not_defined", detail }} />);
    expect(screen.getByText(MODIFY_NOT_SUPPORTED_MESSAGE)).toBeTruthy();
  });

  it.each([
    ["upward MODIFY", "final_prescription_adaptation_not_defined", { reason: "upward_modify_not_supported" }, BLOCKED_MESSAGES.final_prescription_adaptation_not_defined!],
    ["no detail", "final_prescription_adaptation_not_defined", null, BLOCKED_MESSAGES.final_prescription_adaptation_not_defined!],
    ["manual kind not supported", "final_prescription_adaptation_not_defined", { reason: "manual_kind_not_supported" }, MANUAL_BLOCKED_MESSAGES.manual_kind_not_supported!],
  ] as const)("unchanged on Today's card: %s", (_, code, detail, message) => {
    render(<FinalPrescriptionV2Card state={{ kind: "blocked", code, detail }} />);
    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.queryByText(MODIFY_NOT_SUPPORTED_MESSAGE)).toBeNull();
  });

  it("/today/session, a modify_not_supported day → the specific message, and the way back to Today", async () => {
    const b = fakeBackend({ prescription: null, unavailable: { kind: "unavailable", reason: "blocked", blockedReason: "modify_not_supported" } });
    render(<Harness deps={b.deps} />);
    expect(await screen.findByText(MODIFY_NOT_SUPPORTED_MESSAGE)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Retour à Aujourd'hui" })).toBeTruthy();
  });

  it.each([["intervals_load_not_supported"], ["upward_modify_not_supported"], [undefined]])("/today/session, unchanged for any other blocked reason (%s)", async (blockedReason) => {
    const b = fakeBackend({ prescription: prescriptionView("AEROBIC_BASE"), unavailable: { kind: "unavailable", reason: "blocked", ...(blockedReason ? { blockedReason } : {}) } });
    render(<Harness deps={b.deps} />);
    expect(await screen.findByText(UNAVAILABLE_MESSAGES.blocked)).toBeTruthy();
    expect(screen.queryByText(MODIFY_NOT_SUPPORTED_MESSAGE)).toBeNull();
  });
});
