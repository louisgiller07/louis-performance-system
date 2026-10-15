// Counter-proof (throwaway, never committed): the first PHYS-01 documents (session-model-v2.7) are refused by REL-01 D's web.
import { describe, expect, it } from "vitest";
import v27 from "./phys01v27.json";
import { decodeFinalPrescriptionV2 } from "../features/finalPrescriptionV2/decodeFinalPrescriptionV2";

describe("REL-01 D web × the first PHYS-01 documents (v2.7)", () => {
  it("refuses them (unsupported manifest): the reason PHYS-01.1 keeps v2.6", () => {
    for (const r of Object.values(v27.finalPrescriptions) as { id: string; decisionId: string; schemaVersion: string; catalogVersion: string; structure: Record<string, unknown> }[]) {
      expect(r.catalogVersion).toBe("session-model-v2.7");
      expect(decodeFinalPrescriptionV2({ id: r.id, decisionId: r.decisionId, schemaVersion: r.schemaVersion, catalogVersion: r.catalogVersion, structure: r.structure }).ok).toBe(false);
    }
  });
});
