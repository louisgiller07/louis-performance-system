import { describe, it, expect } from "vitest";
import { describeStrongConstraintViolation } from "../src/rules/modes.js";
import type { SoftConstraint } from "../src/types/context.js";

function strong(type: string): SoftConstraint {
  return { type, reason: "test", weight: "strong" };
}

describe("describeStrongConstraintViolation — chaque contrainte isolée", () => {
  it("no_grip_heavy : GRIP_WORK viole la contrainte", () => {
    const violation = describeStrongConstraintViolation(strong("no_grip_heavy"), {
      kind: "GRIP_WORK",
      load_profile: "MODERATE",
    });
    expect(violation).not.toBeNull();
    expect(violation?.replacement).toEqual({ kind: "STRENGTH_LOWER", load_profile: "MODERATE" });
  });

  it("no_grip_heavy : une séance sans grip ne viole rien", () => {
    const violation = describeStrongConstraintViolation(strong("no_grip_heavy"), {
      kind: "STRENGTH_UPPER",
      load_profile: "MODERATE",
    });
    expect(violation).toBeNull();
  });

  it("no_dh_intense : DH_TECHNICAL viole la contrainte", () => {
    const violation = describeStrongConstraintViolation(strong("no_dh_intense"), {
      kind: "DH_TECHNICAL",
      load_profile: "MODERATE",
    });
    expect(violation).not.toBeNull();
    expect(violation?.replacement).toEqual({ kind: "DH_LIGHT", load_profile: "LIGHT" });
  });

  it("no_dh_intense : DH_LIGHT ne viole rien (déjà léger)", () => {
    const violation = describeStrongConstraintViolation(strong("no_dh_intense"), {
      kind: "DH_LIGHT",
      load_profile: "LIGHT",
    });
    expect(violation).toBeNull();
  });

  it("no_development : STRENGTH_LOWER HEAVY viole la contrainte", () => {
    const violation = describeStrongConstraintViolation(strong("no_development"), {
      kind: "STRENGTH_LOWER",
      load_profile: "HEAVY",
    });
    expect(violation).not.toBeNull();
    expect(violation?.replacement).toEqual({ kind: "RECOVERY_ACTIVE" });
  });

  it("no_development : RECOVERY_ACTIVE ne viole rien", () => {
    const violation = describeStrongConstraintViolation(strong("no_development"), { kind: "RECOVERY_ACTIVE" });
    expect(violation).toBeNull();
  });

  it("no_development : session LIGHT ne viole rien (pas un vrai stimulus de développement)", () => {
    const violation = describeStrongConstraintViolation(strong("no_development"), {
      kind: "STRENGTH_LOWER",
      load_profile: "LIGHT",
    });
    expect(violation).toBeNull();
  });

  it("contrainte inconnue (ex. protect_sleep) : jamais de violation décrite", () => {
    const violation = describeStrongConstraintViolation(strong("protect_sleep"), {
      kind: "STRENGTH_LOWER",
      load_profile: "HEAVY",
    });
    expect(violation).toBeNull();
  });
});
