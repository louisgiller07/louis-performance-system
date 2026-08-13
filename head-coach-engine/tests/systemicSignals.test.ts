import { describe, it, expect } from "vitest";
import { computeSystemic } from "../src/engine/computeDimensions.js";
import { baseCheckin } from "../fixtures/louis.js";

describe("computeSystemic — signaux causaux séparés (docs/11_DECISION_LOG.md 2026-08-13)", () => {
  it("checkin neutre → GREEN, aucun signal", () => {
    const dim = computeSystemic(baseCheckin());
    expect(dim.level).toBe("GREEN");
    expect(dim.raw_signals).toEqual([]);
  });

  it("sleep_hours bas seul → signal sleep_deficit uniquement, pas les autres", () => {
    const dim = computeSystemic(baseCheckin({ sleep_hours: 5.5 }));
    expect(dim.level).toBe("RED");
    expect(dim.raw_signals).toEqual(["sleep_deficit"]);
  });

  it("Mauvaise énergie avec sommeil normal → energy_low, JAMAIS sleep_deficit", () => {
    const dim = computeSystemic(baseCheckin({ energy: 3 }));
    expect(dim.raw_signals).toContain("energy_low");
    expect(dim.raw_signals).not.toContain("sleep_deficit");
    expect(dim.level).toBe("AMBER");
  });

  it("Mauvaise qualité de sommeil avec durée normale → sleep_quality_low, JAMAIS sleep_deficit", () => {
    const dim = computeSystemic(baseCheckin({ sleep_quality: 3 }));
    expect(dim.raw_signals).toContain("sleep_quality_low");
    expect(dim.raw_signals).not.toContain("sleep_deficit");
    expect(dim.level).toBe("AMBER");
  });

  it("Réveils nocturnes fréquents avec sommeil par ailleurs normal → sleep_fragmented, JAMAIS sleep_deficit", () => {
    const dim = computeSystemic(baseCheckin({ sleep_wake_ups: 3 }));
    expect(dim.raw_signals).toContain("sleep_fragmented");
    expect(dim.raw_signals).not.toContain("sleep_deficit");
    expect(dim.level).toBe("AMBER");
  });

  it("Sommeil insuffisant ET mauvaise qualité → les deux signaux co-existent", () => {
    const dim = computeSystemic(baseCheckin({ sleep_hours: 5.5, sleep_quality: 4 }));
    expect(dim.level).toBe("RED");
    expect(dim.raw_signals).toContain("sleep_deficit");
    expect(dim.raw_signals).toContain("sleep_quality_low");
  });
});
