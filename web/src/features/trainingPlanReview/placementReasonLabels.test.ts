import { describe, expect, it } from "vitest";
import { describeRelaxedConstraints } from "./placementReasonLabels";

const shortfall = (reason: string, domain?: string) => ({ constraintId: "placement_shortfall", reason, ...(domain !== undefined ? { domain } : {}) });

describe("describeRelaxedConstraints — known reasons (V06-04)", () => {
  it("insufficient_available_time → athlete wording with the session's domain", () => {
    expect(describeRelaxedConstraints([shortfall("insufficient_available_time", "dh_technical")])).toEqual([
      "1 séance DH non placée : pas assez de temps disponible dans tes créneaux.",
    ]);
  });

  it("insufficient_available_dates → athlete wording", () => {
    expect(describeRelaxedConstraints([shortfall("insufficient_available_dates", "aerobic")])).toEqual([
      "1 séance aérobie non placée : pas assez de jours disponibles.",
    ]);
  });

  it("terrain_incompatible → athlete wording", () => {
    expect(describeRelaxedConstraints([shortfall("terrain_incompatible", "dh_technical")])).toEqual([
      "1 séance DH non placée : aucun jour disponible compatible avec ton terrain.",
    ]);
  });

  it("recovery_spacing → athlete wording, never its English engine sentence", () => {
    expect(
      describeRelaxedConstraints([
        { constraintId: "recovery_spacing", reason: "Reduced heavy strength load to avoid consecutive heavy strength sessions", domain: "strength", date: "2026-10-21" },
      ])
    ).toEqual(["1 séance de force allégée pour éviter deux séances lourdes d'affilée."]);
  });

  it("counts identical entries into one sentence (one per unplaced session), in first-occurrence order", () => {
    expect(
      describeRelaxedConstraints([
        shortfall("insufficient_available_time", "dh_technical"),
        shortfall("insufficient_available_dates", "strength"),
        shortfall("insufficient_available_time", "dh_technical"),
        shortfall("insufficient_available_dates", "strength"),
        shortfall("insufficient_available_time", "dh_technical"),
      ])
    ).toEqual([
      "3 séances DH non placées : pas assez de temps disponible dans tes créneaux.",
      "2 séances de force non placées : pas assez de jours disponibles.",
    ]);
  });

  it("keeps the same reason on different domains as separate sentences", () => {
    expect(describeRelaxedConstraints([shortfall("insufficient_available_time", "dh_technical"), shortfall("insufficient_available_time", "strength")])).toEqual([
      "1 séance DH non placée : pas assez de temps disponible dans tes créneaux.",
      "1 séance de force non placée : pas assez de temps disponible dans tes créneaux.",
    ]);
  });

  it("a known reason without a domain omits the domain, never shows a placeholder", () => {
    expect(describeRelaxedConstraints([shortfall("insufficient_available_time")])).toEqual([
      "1 séance non placée : pas assez de temps disponible dans tes créneaux.",
    ]);
  });
});

describe("describeRelaxedConstraints — fallbacks (V06-04)", () => {
  it("unknown shortfall reason → generic sentence, never the raw key", () => {
    const texts = describeRelaxedConstraints([shortfall("future_engine_reason", "dh_technical"), shortfall("another_one", "dh_technical")]);

    expect(texts).toEqual(["2 séances DH n'ont pas pu être placées."]);
  });

  it("unknown domain is never shown raw", () => {
    expect(describeRelaxedConstraints([shortfall("insufficient_available_time", "mobility_future_domain")])).toEqual([
      "1 séance non placée : pas assez de temps disponible dans tes créneaux.",
    ]);
  });

  it("unknown constraintId → one generic sentence", () => {
    expect(describeRelaxedConstraints([{ constraintId: "future_constraint", reason: "something" }, { constraintId: "other", reason: "x" }])).toEqual([
      "Le plan a été ajusté pour rester réalisable.",
    ]);
  });

  it("inherited object keys (toString, constructor) are treated as unknown, never matched", () => {
    const texts = describeRelaxedConstraints([shortfall("toString", "constructor")]);

    expect(texts).toEqual(["1 séance n'a pas pu être placée."]);
  });

  it("no output ever contains an internal code", () => {
    const texts = describeRelaxedConstraints([
      shortfall("insufficient_available_time", "dh_technical"),
      shortfall("insufficient_available_dates", "strength"),
      shortfall("terrain_incompatible", "dh_technical"),
      shortfall("unknown_reason", "aerobic"),
      { constraintId: "recovery_spacing", reason: "Reduced heavy strength load to avoid consecutive heavy strength sessions", domain: "strength" },
      { constraintId: "unknown_constraint", reason: "raw_reason" },
    ]).join(" ");

    expect(texts).not.toMatch(/[a-z]+_[a-z]+|placement|shortfall|recovery|Reduced|strength|dh_/);
  });
});

describe("describeRelaxedConstraints — absent reasons (V06-04)", () => {
  it("no constraint → nothing", () => {
    expect(describeRelaxedConstraints([])).toEqual([]);
  });

  it("missing, blank or non-string reason, or a non-object entry → nothing shown for it", () => {
    expect(
      describeRelaxedConstraints([
        { constraintId: "placement_shortfall", domain: "dh_technical" },
        { constraintId: "placement_shortfall", reason: "   " },
        { constraintId: "placement_shortfall", reason: 42 },
        null,
        "insufficient_available_time",
      ])
    ).toEqual([]);
  });
});
