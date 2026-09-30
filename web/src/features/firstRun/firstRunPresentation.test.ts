import { describe, expect, it } from "vitest";
import * as copy from "./firstRunPresentation";

// UX-09 — NALYNT builds, prepares and adapts; it never claims to learn or
// analyse by itself. Every first-run word is checked.
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") return [];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

describe("first-run wording", () => {
  it("never 'analyse', 'apprend', 'intelligence', 'brouillon', 'version' or 'étape'", () => {
    const all = strings(copy).join(" | ");
    expect(all).not.toMatch(/analys|apprend|intelligen|brouillon|version|étape/i);
  });

  it("the build action is 'Construire ma préparation'", () => {
    expect(copy.SETUP_STEPS.preparation.build).toBe("Construire ma préparation");
  });
});
