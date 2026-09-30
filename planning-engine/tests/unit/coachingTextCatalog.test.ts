import { describe, expect, it } from "vitest";
import {
  CANONICAL_COACHING_LOCALE,
  COACHING_TEXT_CATALOG_ENTRIES,
  COACHING_TEXT_CATALOG_VERSION,
} from "../../src/catalog/coachingTextCatalog.js";
import { SESSION_EXERCISE_CATALOG_V2_ENTRIES } from "../../src/catalog/sessionExerciseCatalogV2.js";
import { SESSION_DRILL_CATALOG_V2_ENTRIES } from "../../src/catalog/sessionDrillCatalogV2.js";
import { INTENT_CATALOG_V2_ENTRIES } from "../../src/catalog/intentCatalogV2.js";
import { DH_SESSION_FRAME_V2 } from "../../src/catalog/sessionFrameV2.js";

// UX-11A.5a.1 / UX-11A.5a.2a — canonical coaching text library (domain,
// fr-CH, no web dependency). All content is PROVISIONAL — coaching
// validation required.
const PREFIX_BY_KIND = { cue: "cue.", success_criterion: "criterion.", vigilance: "vigilance.", instruction: "instruction.", intent: "intent." } as const;

describe("coaching text library", () => {
  it("has its own version and fr-CH as canonical locale", () => {
    expect(COACHING_TEXT_CATALOG_VERSION.length).toBeGreaterThan(0);
    expect(CANONICAL_COACHING_LOCALE).toBe("fr-CH");
  });

  it("has unique ids, the prefix of its kind, a non-empty canonical text, and every entry is PROVISIONAL", () => {
    const ids = COACHING_TEXT_CATALOG_ENTRIES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of COACHING_TEXT_CATALOG_ENTRIES) {
      expect(t.id.startsWith(PREFIX_BY_KIND[t.kind]), t.id).toBe(true);
      expect(t.text[CANONICAL_COACHING_LOCALE].trim().length, t.id).toBeGreaterThan(0);
      expect(t.validationStatus, t.id).toBe("PROVISIONAL");
    }
  });

  it("has no orphan text: every text is used by a V2 exercise, drill, intent or the DH frame", () => {
    const used = new Set<string>([
      ...SESSION_EXERCISE_CATALOG_V2_ENTRIES.flatMap((e) => [e.cueId, ...e.vigilanceIds]),
      ...SESSION_DRILL_CATALOG_V2_ENTRIES.flatMap((d) => [d.cueId, d.criterionId, ...d.vigilanceIds]),
      ...INTENT_CATALOG_V2_ENTRIES.map((i) => i.textId),
      ...DH_SESSION_FRAME_V2.flatMap((b) => b.instructionIds),
    ]);
    for (const t of COACHING_TEXT_CATALOG_ENTRIES) expect(used.has(t.id), t.id).toBe(true);
  });

  it("vigilance texts are help, never a prohibition", () => {
    for (const t of COACHING_TEXT_CATALOG_ENTRIES.filter((x) => x.kind === "vigilance")) {
      expect(t.text["fr-CH"], t.id).not.toMatch(/interdit|contre-indiqué|jamais/i);
    }
  });

  it("frame instructions never prescribe a number of runs", () => {
    for (const t of COACHING_TEXT_CATALOG_ENTRIES.filter((x) => x.kind === "instruction")) {
      expect(t.text["fr-CH"], t.id).not.toMatch(/\d/);
    }
  });
});
