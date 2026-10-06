import { describe, expect, it } from "vitest";
// Cross-boundary reads of the engine catalogues, test only (same practice as
// trainingLabels/exerciseLabels.test.ts): the web mirror and labels must
// match the supported Session Model V2 version exactly.
import { COACHING_TEXT_CATALOG_ENTRIES, COACHING_TEXT_CATALOG_VERSION } from "../../../../planning-engine/src/catalog/coachingTextCatalog.ts";
import { SESSION_EXERCISE_CATALOG_V2, SESSION_EXERCISE_ROLES_V2 } from "../../../../planning-engine/src/catalog/sessionExerciseCatalogV2.ts";
import { SESSION_DRILL_CATALOG_V2 } from "../../../../planning-engine/src/catalog/sessionDrillCatalogV2.ts";
import { SESSION_FAMILIES_V2 as ENGINE_FAMILIES } from "../../../../planning-engine/src/catalog/intentCatalogV2.ts";
import { ENDURANCE_ACTIVITIES_V2 } from "../../../../planning-engine/src/catalog/protocolCatalogV2.ts";
import { SESSION_BLOCK_ROLES_V2 } from "../../../../planning-engine/src/catalog/sessionFrameV2.ts";
import { buildSessionModelV2CatalogManifest } from "../../../../planning-engine/src/sessionModelV2/catalogManifest.ts";
import { COACHING_TEXTS_V1_0, COACHING_TEXTS_V1_0_VERSION } from "./coachingTextsV1_0.generated";
import {
  BLOCK_ROLE_LABELS_V2,
  drillNameV2,
  ENDURANCE_ACTIVITY_LABELS_V2,
  EXERCISE_IDS_V2_1,
  EXERCISE_ROLES_V2,
  exerciseNameV2,
  resolveCoachingText,
  SESSION_FAMILIES_V2,
  SUPPORTED_SESSION_MODEL_V2_MANIFEST,
  SUPPORTED_SESSION_MODEL_V2_MANIFESTS,
} from "./sessionModelV2Support";

describe("supported Session Model V2 version (UX-11A.5c.4)", () => {
  it("the supported manifest is exactly the engine's session-model-v2.6 manifest", () => {
    expect(SUPPORTED_SESSION_MODEL_V2_MANIFEST).toEqual(buildSessionModelV2CatalogManifest());
    expect(SUPPORTED_SESSION_MODEL_V2_MANIFEST.aggregate).toBe("session-model-v2.6");
  });

  it("BUG-V2-2 — v2.5 stays readable: it differs from v2.6 only by the strength dose / plan dose policy versions (same id tables)", () => {
    expect(SUPPORTED_SESSION_MODEL_V2_MANIFESTS.map((m) => m.aggregate)).toEqual(["session-model-v2.6", "session-model-v2.5"]);
    const [current, previous] = SUPPORTED_SESSION_MODEL_V2_MANIFESTS;
    const differing = Object.keys(current!).filter((k) => current![k] !== previous![k]);
    expect(differing).toEqual(["aggregate", "strengthDoses", "planDosePolicy"]);
  });

  it("the generated text mirror equals the engine catalogue of the supported texts version (regenerate with scripts/generate-session-model-v2-texts.mjs)", () => {
    expect(COACHING_TEXTS_V1_0_VERSION).toBe(COACHING_TEXT_CATALOG_VERSION);
    expect(COACHING_TEXTS_V1_0_VERSION).toBe(SUPPORTED_SESSION_MODEL_V2_MANIFEST.texts);
    const engine = Object.fromEntries(COACHING_TEXT_CATALOG_ENTRIES.map((e) => [e.id, { kind: e.kind, text: e.text["fr-CH"] }]));
    expect(COACHING_TEXTS_V1_0).toEqual(engine);
  });

  it("texts resolve by id AND kind only (a cue id is never shown as a vigilance)", () => {
    expect(resolveCoachingText("cue.goblet_squat", "cue")).toBe(COACHING_TEXTS_V1_0["cue.goblet_squat"]!.text);
    expect(resolveCoachingText("cue.goblet_squat", "vigilance")).toBeNull();
    expect(resolveCoachingText("cue.unknown", "cue")).toBeNull();
    expect(resolveCoachingText("toString", "cue")).toBeNull();
  });

  it("every V2 exercise has a French name, never its id", () => {
    expect([...EXERCISE_IDS_V2_1].sort()).toEqual(Object.keys(SESSION_EXERCISE_CATALOG_V2).sort());
    for (const id of EXERCISE_IDS_V2_1) {
      const name = exerciseNameV2(id);
      expect(name, id).not.toBeNull();
      expect(name, id).not.toMatch(/_/);
    }
    expect(exerciseNameV2("unknown_exercise")).toBeNull();
  });

  it("every V2 drill has a French name", () => {
    for (const id of Object.keys(SESSION_DRILL_CATALOG_V2)) expect(drillNameV2(id), id).not.toBeNull();
  });

  it("UI vocabularies match the engine (activities, block roles, families, exercise roles)", () => {
    expect(Object.keys(ENDURANCE_ACTIVITY_LABELS_V2).sort()).toEqual([...ENDURANCE_ACTIVITIES_V2].sort());
    expect(Object.keys(BLOCK_ROLE_LABELS_V2).sort()).toEqual([...SESSION_BLOCK_ROLES_V2].sort());
    expect([...SESSION_FAMILIES_V2].sort()).toEqual([...ENGINE_FAMILIES].sort());
    expect([...EXERCISE_ROLES_V2].sort()).toEqual([...SESSION_EXERCISE_ROLES_V2].sort());
  });
});
