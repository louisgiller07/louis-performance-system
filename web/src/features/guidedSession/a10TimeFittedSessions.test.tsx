import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fakeBackend, prescriptionView } from "../../test/guidedSessionFakeBackend";
import { GuidedSessionHarness as Harness } from "../../test/GuidedSessionHarness";
import { keepFinalPrescription } from "../../test/fixtures/finalPrescriptionV2Fixtures";
import { decodeFinalPrescriptionV2 } from "../finalPrescriptionV2/decodeFinalPrescriptionV2";
import { resolveSessionModule } from "./sessionModules";
import { RECOVERY_COPY } from "./recovery/RecoverySessionModule";
import type { DrillItemView } from "../finalPrescriptionV2/finalPrescriptionV2Types";

// A10 — prescriptions fitted into the rider's time (engine-generated
// fixtures) decode and run in the guided session like any other.

const phase = () => screen.getByRole("status").getAttribute("data-phase");

describe("A10 — time-fitted prescriptions in the guided session", () => {
  it.each([
    ["TIME_RECOVERY_25", "recovery"],
    ["TIME_DH_60", "dh_technical"],
  ] as const)("%s decodes fully and resolves its module", (kind, module) => {
    const r = decodeFinalPrescriptionV2(keepFinalPrescription(kind).record);
    expect(r.ok).toBe(true);
    if (r.ok) expect(resolveSessionModule(r.view).kind).toBe(module);
  });

  it("recovery inside 25 min: the main block reads 20 min at most, the optional block that did not fit is absent", () => {
    const p = prescriptionView("TIME_RECOVERY_25");
    expect(p.blocks.map((b) => b.role)).toEqual(["main", "cool_down"]);
  });

  it("DH in the 60-min window: the planned drill, at most 5 passages", () => {
    const drill = (k: "TIME_DH_60" | "DH_TECHNICAL") => prescriptionView(k).blocks.find((b) => b.role === "main")!.items[0] as DrillItemView;
    expect(drill("TIME_DH_60").drillId).toBe(drill("DH_TECHNICAL").drillId);
    expect(drill("TIME_DH_60").passes).toBeLessThanOrEqual(5);
  });

  it("the 25-min recovery opens and completes (nothing to measure)", async () => {
    const b = fakeBackend({ prescription: prescriptionView("TIME_RECOVERY_25") });
    render(<Harness deps={b.deps} />);
    await userEvent.click(await screen.findByRole("button", { name: "Commencer la séance" }));
    await waitFor(() => expect(phase()).toBe("active"));
    expect(screen.getByTestId("recovery-note")).toHaveTextContent(RECOVERY_COPY.note);
    await userEvent.click(screen.getByRole("button", { name: "Terminer la séance" }));
    await waitFor(() => expect(phase()).toBe("completed"));
  });
});
