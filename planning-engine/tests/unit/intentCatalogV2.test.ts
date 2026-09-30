import { describe, expect, it } from "vitest";
import {
  DH_SKILL_TO_INTENT_V2,
  INTENT_CATALOG_V2,
  INTENT_CATALOG_V2_ENTRIES,
  INTENT_CATALOG_V2_VERSION,
  INTENT_SESSION_KINDS_V2,
  SESSION_FAMILIES_V2,
} from "../../src/catalog/intentCatalogV2.js";
import { DH_SKILLS_V2 } from "../../src/catalog/sessionDrillCatalogV2.js";
import { COACHING_TEXT_CATALOG } from "../../src/catalog/coachingTextCatalog.js";
import { DH_SESSION_FRAME_V2, SESSION_BLOCK_ROLES_V2 } from "../../src/catalog/sessionFrameV2.js";

// UX-11A.5a.2a — intent catalogue and DH session frame.
const INTENTS = INTENT_CATALOG_V2_ENTRIES;

describe("Session Model V2 intent catalogue", () => {
  it("has a version, unique ids, valid families and kinds, an intent text each, and everything PROVISIONAL", () => {
    expect(INTENT_CATALOG_V2_VERSION.length).toBeGreaterThan(0);
    const ids = INTENTS.map((i) => i.intentId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(INTENT_CATALOG_V2)).toHaveLength(ids.length);
    for (const i of INTENTS) {
      expect(SESSION_FAMILIES_V2, i.intentId).toContain(i.family);
      expect(i.sessionKinds.length, i.intentId).toBeGreaterThan(0);
      for (const kind of i.sessionKinds) expect(INTENT_SESSION_KINDS_V2, i.intentId).toContain(kind);
      expect(i.textId, i.intentId).toBe(`intent.${i.intentId}`);
      expect(COACHING_TEXT_CATALOG[i.textId]?.kind, i.intentId).toBe("intent");
      expect(i.validationStatus, i.intentId).toBe("PROVISIONAL");
      expect(i.selectable, i.intentId).toBe(i.selection.type === "session_kind" || i.selection.type === "declared_priority");
    }
  });

  it("maps each of the 7 DH skills to exactly one DH intent, only through a declared priority", () => {
    expect(Object.keys(DH_SKILL_TO_INTENT_V2).sort()).toEqual([...DH_SKILLS_V2].sort());
    for (const skill of DH_SKILLS_V2) {
      const dhIntents = INTENTS.filter((i) => i.selection.type === "declared_priority" && i.selection.skill === skill);
      expect(dhIntents, skill).toHaveLength(1);
      expect(DH_SKILL_TO_INTENT_V2[skill], skill).toBe(dhIntents[0]!.intentId);
    }
    for (const i of INTENTS.filter((x) => x.family === "dh_technical")) {
      expect(i.selection.type, i.intentId).toBe("declared_priority");
    }
  });

  it("never activates the grip intent: inactive until a validated rule exists", () => {
    const grip = INTENT_CATALOG_V2["grip_endurance_full_run"]!;
    expect(grip.selection.type).toBe("inactive_until_validated_rule");
    expect(grip.selectable).toBe(false);
  });

  it("offers one generic selectable lower-body intent; the two specific ones stay non-selectable candidates", () => {
    const lower = INTENTS.filter((i) => i.sessionKinds.includes("STRENGTH_LOWER"));
    expect(lower.filter((i) => i.selectable).map((i) => i.intentId)).toEqual(["lower_body_strength_control"]);
    for (const id of ["leg_strength_corner_exit", "leg_stability_rough_terrain"]) {
      expect(INTENT_CATALOG_V2[id]!.selection.type, id).toBe("candidate");
      expect(INTENT_CATALOG_V2[id]!.selectable, id).toBe(false);
    }
  });

  it("needs no choice logic: every non-DH kind has at most one selectable intent", () => {
    for (const kind of INTENT_SESSION_KINDS_V2) {
      const selectable = INTENTS.filter((i) => i.selection.type === "session_kind" && i.sessionKinds.includes(kind));
      expect(selectable.length, kind).toBeLessThanOrEqual(1);
    }
  });
});

describe("Session Model V2 block roles and DH frame", () => {
  it("brief and application belong to the canonical block roles", () => {
    expect(SESSION_BLOCK_ROLES_V2).toEqual(["brief", "warm_up", "main", "complementary", "application", "cool_down"]);
  });

  it("frames a DH session as brief → warm_up → main → application → cool_down, where only main is counted", () => {
    expect(DH_SESSION_FRAME_V2.map((b) => b.role)).toEqual(["brief", "warm_up", "main", "application", "cool_down"]);
    for (const block of DH_SESSION_FRAME_V2) {
      expect(block.countedItems, block.role).toBe(block.role === "main");
      if (block.role === "main") expect(block.instructionIds, block.role).toEqual([]);
      else expect(block.instructionIds.length, block.role).toBeGreaterThan(0);
      for (const id of block.instructionIds) expect(COACHING_TEXT_CATALOG[id]?.kind, id).toBe("instruction");
    }
  });
});
