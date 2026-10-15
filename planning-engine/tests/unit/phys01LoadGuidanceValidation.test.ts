import { describe, expect, it } from "vitest";
import { assignPrescriptionIds, buildSessionModelV2CatalogManifest, buildStrengthPrescriptionV2Content, validatePrescriptionV2, type PrescriptionV2 } from "../../src/sessionModelV2/index.js";
import { STRENGTH_LOAD_GUIDANCE_RULES_VERSION } from "../../src/catalog/strengthLoadGuidancePolicyV2.js";

// PHYS-01 — the single exception to « no load anywhere »: `loadGuidance` on a work exercise of a FINAL Force
// prescription, with its exact shape. Everywhere else, any load key stays forbidden.

const MANIFEST = buildSessionModelV2CatalogManifest();
let n = 0;
const mint = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const base = (): PrescriptionV2 =>
  JSON.parse(JSON.stringify(assignPrescriptionIds(buildStrengthPrescriptionV2Content({ sessionKind: "STRENGTH_UPPER", athleteTier: "intermediate", equipment: ["dumbbells", "bench"], loadProfile: "MODERATE", catalog: MANIFEST }), mint)));

const TARGET = {
  ruleVersion: STRENGTH_LOAD_GUIDANCE_RULES_VERSION,
  mode: "target",
  reason: "top_of_range_reached",
  change: "increase",
  targetKg: 22,
  stepKg: 2,
  reference: { sessionDate: "2026-10-13", loadKg: 20, reps: [8, 8, 8, 8], setsPrescribed: 4, repsRange: { min: 6, max: 8 }, rpeMax: 7 },
};

type Mutable = { blocks: { role: string; items: Record<string, unknown>[] }[] } & Record<string, unknown>;
const withGuidance = (at: (p: Mutable) => Record<string, unknown>, guidance: unknown = TARGET) => {
  const p = base() as unknown as Mutable;
  at(p).loadGuidance = guidance;
  return p;
};
const main = (p: Mutable) => p.blocks.find((b) => b.role === "main")!.items[0]!;
const codes = (value: unknown, stage: "planned" | "final" = "final") => {
  const r = validatePrescriptionV2(value, { stage });
  return r.ok ? [] : r.issues.map((i) => i.code);
};

describe("PHYS-01 — where load guidance is allowed", () => {
  it("a work exercise of a final Force prescription: accepted (target, reference and calibrate shapes)", () => {
    expect(codes(withGuidance(main))).toEqual([]);
    expect(codes(withGuidance(main, { ruleVersion: STRENGTH_LOAD_GUIDANCE_RULES_VERSION, mode: "calibrate", reason: "no_history", repsInReserve: { min: 2, max: 3 } }))).toEqual([]);
    expect(codes(withGuidance(main, { ruleVersion: STRENGTH_LOAD_GUIDANCE_RULES_VERSION, mode: "reference", reason: "different_dose", reference: TARGET.reference, repsInReserve: null }))).toEqual([]);
  });

  it("a planned prescription never carries it", () => {
    expect(codes(withGuidance(main), "planned")).toEqual(["load_guidance_not_allowed"]);
  });

  it("never on a warm-up or cool-down exercise", () => {
    expect(codes(withGuidance((p) => p.blocks[0]!.items[0]!))).toEqual(["load_guidance_not_allowed"]);
    expect(codes(withGuidance((p) => p.blocks.at(-1)!.items[0]!))).toEqual(["load_guidance_not_allowed"]);
  });

  it("anywhere else (prescription or block level) it is a forbidden load field, as before", () => {
    expect(codes(withGuidance((p) => p as unknown as Record<string, unknown>))).toContain("forbidden_load_field");
    expect(codes(withGuidance((p) => p.blocks[1] as unknown as Record<string, unknown>))).toContain("forbidden_load_field");
  });

  it("any other load key on an item stays forbidden (loadKg, targetKg…)", () => {
    const p = base() as unknown as Mutable;
    main(p).targetKg = 22;
    expect(codes(p)).toEqual(["forbidden_load_field"]);
  });
});

describe("PHYS-01 — exact shape", () => {
  it.each<[string, unknown]>([
    ["unknown rule version", { ...TARGET, ruleVersion: "strength-load-guidance-v0" }],
    ["unknown mode", { ...TARGET, mode: "one_rep_max" }],
    ["a reason of another mode", { ...TARGET, reason: "no_history" }],
    ["an extra key (e.g. a 1RM)", { ...TARGET, oneRepMaxKg: 30 }],
    ["a missing key", { ...TARGET, stepKg: undefined }],
    ["a target without a positive load", { ...TARGET, targetKg: 0 }],
    ["a load above 1000 kg", { ...TARGET, targetKg: 1200 }],
    ["an unknown change", { ...TARGET, change: "double" }],
    ["a reference without repetitions", { ...TARGET, reference: { ...TARGET.reference, reps: [] } }],
    ["a reference date not ISO", { ...TARGET, reference: { ...TARGET.reference, sessionDate: "13.10.2026" } }],
    ["an RPE out of 1–10", { ...TARGET, reference: { ...TARGET.reference, rpeMax: 11 } }],
    ["reps in reserve out of 0–10", { ruleVersion: STRENGTH_LOAD_GUIDANCE_RULES_VERSION, mode: "calibrate", reason: "no_history", repsInReserve: { min: 2, max: 12 } }],
    ["not an object", "22 kg"],
  ])("refused: %s", (_label, guidance) => {
    const cleaned = JSON.parse(JSON.stringify(guidance ?? null));
    expect(codes(withGuidance(main, cleaned))).toEqual(["invalid_load_guidance"]);
  });
});
