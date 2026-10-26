import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SESSION_DRILL_CATALOG_V2, SESSION_DRILL_NAMES_V2 } from "../../../../planning-engine/src/catalog/sessionDrillCatalogV2.ts";
import { DH_SESSION_FRAME_V2 } from "../../../../planning-engine/src/catalog/sessionFrameV2.ts";
import { INTENT_CATALOG_V2_ENTRIES } from "../../../../planning-engine/src/catalog/intentCatalogV2.ts";
import { COACHING_TEXT_CATALOG } from "../../../../planning-engine/src/catalog/coachingTextCatalog.ts";
import { decodeFinalPrescriptionV2 } from "./decodeFinalPrescriptionV2";
import { drillNameV2, resolveCoachingText } from "./sessionModelV2Support";
import type { DrillItemView } from "./finalPrescriptionV2Types";
import { keepFinalPrescription } from "../../test/fixtures/finalPrescriptionV2Fixtures";

// V2-DH-SPORT-GATE-01B (HPM 2026-10-26) — what the web presents of a DH session is the content the engine's sign-off
// binds: the drill name (C), and the texts every DH session shares (one common validation). A frozen document stays
// readable whatever the current validation says: the web never reads a sign-off.

describe("V2-DH-SPORT-GATE-01B · the web serves the signed content", () => {
  it("every V2 drill name the web shows is the engine's name, the one C signs (a rename on one side only fails here)", () => {
    for (const id of Object.keys(SESSION_DRILL_CATALOG_V2)) expect(drillNameV2(id), id).toBe(SESSION_DRILL_NAMES_V2[id]);
    expect(Object.keys(SESSION_DRILL_NAMES_V2).sort()).toEqual(Object.keys(SESSION_DRILL_CATALOG_V2).sort());
    expect(drillNameV2("race_execution_split_pace")).toBe("Run fractionné à allure course");
  });

  it("the DH frame instructions and DH session objectives the web shows are the engine's texts, the ones the common validation signs", () => {
    for (const id of DH_SESSION_FRAME_V2.flatMap((b) => b.instructionIds)) expect(resolveCoachingText(id, "instruction"), id).toBe(COACHING_TEXT_CATALOG[id]!.text["fr-CH"]);
    for (const intent of INTENT_CATALOG_V2_ENTRIES.filter((i) => i.family === "dh_technical")) {
      expect(resolveCoachingText(`intent.${intent.intentId}`, "intent"), intent.intentId).toBe(COACHING_TEXT_CATALOG[`intent.${intent.intentId}`]!.text["fr-CH"]);
    }
  });

  it("a frozen SECTION document decodes with its name and unit; no web source reads a sign-off (reading never depends on the current validation)", () => {
    const { record } = keepFinalPrescription("DH_TECHNICAL");
    const drill = record.structure.blocks.find((b: { role: string }) => b.role === "main").items[0];
    drill.measure = { type: "pass", count: drill.measure.count, unit: "SECTION" };
    const r = decodeFinalPrescriptionV2(record);
    if (!r.ok) throw new Error(r.reason);
    const item = r.view.blocks.find((b) => b.role === "main")!.items[0] as DrillItemView;
    expect(item).toMatchObject({ name: SESSION_DRILL_NAMES_V2[drill.drillId], repetitionUnit: "SECTION" });

    const SRC = join(__dirname, "..", "..");
    const sources = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? sources(path) : /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
      });
    expect(sources(SRC).filter((f) => /dhSportGate|DH_SPORT_SIGNOFFS|DH_SPORT_COMMON_SIGNOFF/.test(readFileSync(f, "utf8")))).toEqual([]);
  });
});
