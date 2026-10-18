// PHYS-01.1 compatibility demonstration — runs inside a THROWAWAY checkout of REL-01 D (649a0a2), never committed:
// the previous web's own decoder, day card and guided Force module, fed with genuine PHYS-01.1 engine documents.
import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fixtures from "./phys01FinalPrescriptionV2.json";
import { decodeFinalPrescriptionV2 } from "../features/finalPrescriptionV2/decodeFinalPrescriptionV2";
import { PrescriptionV2Details } from "../features/finalPrescriptionV2/FinalPrescriptionV2Card";
import { fakeBackend } from "../test/guidedSessionFakeBackend";
import { GuidedSessionHarness as Harness } from "../test/GuidedSessionHarness";
import type { FinalPrescriptionV2View } from "../features/finalPrescriptionV2/finalPrescriptionV2Types";

type Fixture = { id: string; decisionId: string; schemaVersion: string; catalogVersion: string; structure: Record<string, any> };
const docs = fixtures.finalPrescriptions as unknown as Record<string, Fixture>;
function view(key: string): FinalPrescriptionV2View {
  const r = docs[key]!;
  const d = decodeFinalPrescriptionV2({ id: r.id, decisionId: r.decisionId, schemaVersion: r.schemaVersion, catalogVersion: r.catalogVersion, structure: r.structure });
  if (!d.ok) throw new Error(`${key}: ${d.reason}`);
  return d.view;
}

describe("REL-01 D web × PHYS-01.1 documents", () => {
  it("decodes every PHYS-01.1 document (KEEP + cool-down + guidance, held guidance, 30-min session, MODIFY)", () => {
    for (const key of Object.keys(docs)) {
      const v = view(key);
      expect(v.blocks.at(-1)!.role).toBe("cool_down");
      expect(v.blocks.at(-1)!.roleLabel).toBe("Retour au calme");
      // The additive load guidance is ignored by this web: never in its view.
      expect(JSON.stringify(v)).not.toMatch(/loadGuidance|targetKg/);
    }
    expect(view("SHORTENED_UPPER_30").blocks.map((b) => b.role)).toEqual(["warm_up", "main", "cool_down"]);
  });

  it("the day's card shows the session with its cool-down, and no load guidance", () => {
    render(<PrescriptionV2Details prescription={view("GUIDED_KEEP_UPPER")} />);
    expect(screen.getByText("Retour au calme")).toBeTruthy();
    expect(screen.queryByText(/Charge conseillée/)).toBeNull();
  });

  it("the guided Force module runs: work sets counted from main / complementary only, the cool-down read only, a set recorded", async () => {
    const v = view("GUIDED_KEEP_UPPER");
    const b = fakeBackend({ prescription: v });
    render(<Harness deps={b.deps} />);
    await userEvent.click(await screen.findByRole("button", { name: "Commencer la séance" }));
    await waitFor(() => expect(screen.getByTestId("strength-progress").textContent).toBe("Séries de travail réalisées : 0 / 9"));
    const coolDown = document.querySelector('[data-block-role="cool_down"]') as HTMLElement;
    expect(within(coolDown).queryByRole("button")).toBeNull();
    const bench = v.blocks.find((x) => x.role === "main")!.items[0]!;
    await userEvent.click(screen.getByRole("button", { name: `Saisir la série 1 — ${bench.name}` }));
    await userEvent.type(screen.getByLabelText("Répétitions réalisées"), "8");
    await userEvent.type(screen.getByLabelText("Charge utilisée en kg (facultatif)"), "22");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer la série" }));
    await waitFor(() => expect(screen.getByTestId("strength-progress").textContent).toBe("Séries de travail réalisées : 1 / 9"));
  });

  it("the 30-minute session runs too: only the principal's sets are work sets", async () => {
    const b = fakeBackend({ prescription: view("SHORTENED_UPPER_30") });
    render(<Harness deps={b.deps} />);
    await userEvent.click(await screen.findByRole("button", { name: "Commencer la séance" }));
    await waitFor(() => expect(screen.getByTestId("strength-progress").textContent).toBe("Séries de travail réalisées : 0 / 4"));
  });
});
