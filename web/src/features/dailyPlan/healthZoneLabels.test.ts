import { describe, expect, it } from "vitest";
import { PAIN_LOCATION_CODES, PAIN_LOCATION_LABELS } from "../checkin/checkinTypes";
import { sanitizeHealthSignalReason, translateHealthZone } from "./healthZoneLabels";

describe("translateHealthZone (REV-014)", () => {
  it("covers all 32 canonical pain_location_code values with their canonical label", () => {
    expect(PAIN_LOCATION_CODES).toHaveLength(32);
    for (const code of PAIN_LOCATION_CODES) {
      const label = translateHealthZone(code);
      expect(label, code).toBe(PAIN_LOCATION_LABELS[code]);
      expect(label, code).not.toContain("_");
      expect(label, code).not.toBe(code);
    }
  });

  it("knee_R → Genou droit, knee_L → Genou gauche (canonical casing)", () => {
    expect(translateHealthZone("knee_R")).toBe("Genou droit");
    expect(translateHealthZone("knee_L")).toBe("Genou gauche");
  });

  it("unknown, inherited, empty, null and undefined → null", () => {
    for (const value of ["unknown_zone", "shoulder_X", "toString", "constructor", "", null, undefined, 42]) {
      expect(translateHealthZone(value)).toBeNull();
    }
  });
});

describe("sanitizeHealthSignalReason (REV-014)", () => {
  // Exact formats of head-coach-engine rules/safety.ts A2/A4 health_flag_to_create.reason.
  it("A2 with a known zone: the code becomes its label, the sentence is unchanged", () => {
    expect(sanitizeHealthSignalReason("Douleur nouvelle sévère (8/10) — knee_R")).toBe("Douleur nouvelle sévère (8/10) — Genou droit");
  });

  it("A4 with a known zone: the code becomes its label, the criteria are unchanged", () => {
    expect(sanitizeHealthSignalReason("Douleur avec critère objectif de gravité (traumatique, perte de fonction) — shoulder_L")).toBe(
      "Douleur avec critère objectif de gravité (traumatique, perte de fonction) — Épaule gauche"
    );
  });

  it("every canonical code is replaced, none survives", () => {
    for (const code of PAIN_LOCATION_CODES) {
      const result = sanitizeHealthSignalReason(`Douleur nouvelle sévère (7/10) — ${code}`)!;
      expect(result).toBe(`Douleur nouvelle sévère (7/10) — ${PAIN_LOCATION_LABELS[code]}`);
      expect(result).not.toMatch(new RegExp(`\\b${code}\\b`));
    }
  });

  it("an unknown zone code is removed with its dash, never shown", () => {
    expect(sanitizeHealthSignalReason("Douleur nouvelle sévère (8/10) — unknown_zone")).toBe("Douleur nouvelle sévère (8/10)");
    expect(sanitizeHealthSignalReason("Douleur nouvelle sévère (8/10) — shoulder_X")).toBe("Douleur nouvelle sévère (8/10)");
    expect(sanitizeHealthSignalReason("Douleur nouvelle sévère (8/10) — constructor")).toBe("Douleur nouvelle sévère (8/10)"); // inherited key, never a label
  });

  it("reasons without a zone are returned exactly as-is", () => {
    for (const reason of [
      "Douleur nouvelle sévère (8/10)",
      "Douleur avec critère objectif de gravité (aggravation nette)",
      "Suspicion de commotion déclarée au checkin",
      "Fièvre ou maladie déclarée au checkin",
      "Douleur 3 jours de suite",
    ]) {
      expect(sanitizeHealthSignalReason(reason)).toBe(reason);
    }
  });

  it("an already-French label at the end is never touched", () => {
    expect(sanitizeHealthSignalReason("Douleur nouvelle sévère (8/10) — Genou droit")).toBe("Douleur nouvelle sévère (8/10) — Genou droit");
  });

  it("missing, non-string or blank reason → undefined (the caller keeps its generic fallback)", () => {
    for (const value of [undefined, null, "", "   ", 42]) {
      expect(sanitizeHealthSignalReason(value)).toBeUndefined();
    }
  });
});
