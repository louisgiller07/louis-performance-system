/**
 * V2-DH-SPORT-GATE-01C (HPM 2026-10-26) — historical versions.
 *
 * A stored prescription keeps ids only (drill, cue, criterion, vigilances, objective, frame instructions) and the
 * catalogue versions in its manifest (texts: coaching-text-v1.0, drills: session-drills-v2.0). The web — today's
 * prescription, the guided session, the history — resolves every id in those versions when it shows it. For a rider
 * never to be shown today's wording as the wording they were given, a released version's content is immutable: a text
 * or a drill name of the version never changes and is never removed. A correction takes a new id (append-only, the
 * drill then points to it) or a new catalogue version whose earlier content stays renderable for the documents that
 * reference it. Adding an id means pinning it here, deliberately.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COACHING_TEXT_CATALOG, COACHING_TEXT_CATALOG_VERSION } from "../../src/catalog/coachingTextCatalog.js";
import { SESSION_DRILL_CATALOG_V2_VERSION, SESSION_DRILL_NAMES_V2 } from "../../src/catalog/sessionDrillCatalogV2.js";

type Pins = { version: string; entries: Record<string, string> };
const pins = (file: string): Pins => JSON.parse(readFileSync(new URL(`./pins/${file}`, import.meta.url), "utf8")) as Pins;
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const textHashes = (catalog: Readonly<Record<string, { kind: string; text: Record<string, string> }>>) =>
  Object.fromEntries(Object.entries(catalog).map(([id, e]) => [id, hash(`${e.kind}\u0000${e.text["fr-CH"]}`)]));
const nameHashes = (names: Readonly<Record<string, string>>) => Object.fromEntries(Object.entries(names).map(([id, n]) => [id, hash(n)]));

/** What moved against the pins: a changed or removed pinned id, or a current id nobody pinned. */
function drift(current: Record<string, string>, pinned: Record<string, string>) {
  return {
    changed: Object.keys(pinned).filter((id) => id in current && current[id] !== pinned[id]),
    removed: Object.keys(pinned).filter((id) => !(id in current)),
    unpinned: Object.keys(current).filter((id) => !(id in pinned)),
  };
}
const RULE = "a released version is immutable: give the corrected text or name a new id, or release a new catalogue version (and keep the earlier one renderable)";

describe("V2-DH-SPORT-GATE-01C · a released version's content never changes", () => {
  it(`coaching-text-v1.0: every text keeps its kind and its exact fr-CH wording, none is removed, every text is pinned (${RULE})`, () => {
    const pinned = pins("coaching-text-v1.0.json");
    expect(COACHING_TEXT_CATALOG_VERSION).toBe(pinned.version);
    expect(drift(textHashes(COACHING_TEXT_CATALOG), pinned.entries), RULE).toEqual({ changed: [], removed: [], unpinned: [] });
  });

  it(`session-drills-v2.0: every displayed drill name (signed in C) keeps its exact wording, none is removed, every name is pinned (${RULE})`, () => {
    const pinned = pins("session-drills-v2.0.names.json");
    expect(SESSION_DRILL_CATALOG_V2_VERSION).toBe(pinned.version);
    expect(drift(nameHashes(SESSION_DRILL_NAMES_V2), pinned.entries), RULE).toEqual({ changed: [], removed: [], unpinned: [] });
  });

  it("counter-proof: a text corrected in place, a text removed, an unpinned text, the sheet-14 rename in place — each one is caught", () => {
    const pinnedTexts = pins("coaching-text-v1.0.json").entries;
    const catalog = { ...COACHING_TEXT_CATALOG } as Record<string, (typeof COACHING_TEXT_CATALOG)[string]>;
    const cue = catalog["cue.race_execution_split_pace"]!;
    catalog["cue.race_execution_split_pace"] = { ...cue, text: { "fr-CH": `${cue.text["fr-CH"]} Ralentis si nécessaire.` } };
    delete catalog["intent.dh_race_pace"];
    catalog["cue.race_execution_split_pace.v2"] = { ...cue, id: "cue.race_execution_split_pace.v2" };
    expect(drift(textHashes(catalog), pinnedTexts)).toEqual({ changed: ["cue.race_execution_split_pace"], removed: ["intent.dh_race_pace"], unpinned: ["cue.race_execution_split_pace.v2"] });

    const renamed = { ...SESSION_DRILL_NAMES_V2, race_execution_split_pace: "Section fractionnée à allure course" };
    expect(drift(nameHashes(renamed), pins("session-drills-v2.0.names.json").entries).changed).toEqual(["race_execution_split_pace"]);
  });
});
