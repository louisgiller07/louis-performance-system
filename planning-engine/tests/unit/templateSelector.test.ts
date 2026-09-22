import { describe, expect, it } from "vitest";
import {
  selectWeekTemplate,
  TemplateNotFoundError,
  InvalidCandidateWeekTypeError,
  type TemplateSelectionInput,
} from "../../src/pipeline/templateSelector.js";
import type { PlanInputRace } from "../../src/types/planInputSnapshot.js";

function race(overrides: Partial<PlanInputRace> = {}): PlanInputRace {
  return { eventName: "Test race", startDate: "2026-10-24", endDate: "2026-10-25", priority: "A", ...overrides };
}

const BASE_INPUT: TemplateSelectionInput = {
  weekStartDate: "2026-10-19",
  weekEndDate: "2026-10-25",
  races: [],
};

describe("selectWeekTemplate — priority order", () => {
  it("no race, no candidate -> development (default)", () => {
    const result = selectWeekTemplate(BASE_INPUT);

    expect(result.weekType).toBe("development");
    expect(result.selectionReason).toBe("default_development");
    expect(result.template.id).toBe("development");
  });

  it("a race overlapping the current week -> race, regardless of any candidate hint", () => {
    const result = selectWeekTemplate({ ...BASE_INPUT, races: [race()], candidateWeekType: "deload" });

    expect(result.weekType).toBe("race");
    expect(result.selectionReason).toBe("race_in_week");
    expect(result.template.id).toBe("race");
  });

  it("a race overlapping the next week (none this week) -> taper, regardless of any candidate hint", () => {
    const result = selectWeekTemplate({
      ...BASE_INPUT,
      nextWeekStartDate: "2026-10-26",
      nextWeekEndDate: "2026-11-01",
      races: [race({ startDate: "2026-10-31", endDate: "2026-11-01" })],
      candidateWeekType: "recovery",
    });

    expect(result.weekType).toBe("taper");
    expect(result.selectionReason).toBe("race_in_next_week");
    expect(result.template.id).toBe("taper");
  });

  it("race in current week takes priority over a race that would also match the next-week check", () => {
    const result = selectWeekTemplate({
      ...BASE_INPUT,
      nextWeekStartDate: "2026-10-26",
      nextWeekEndDate: "2026-11-01",
      races: [race({ startDate: "2026-10-24", endDate: "2026-10-25" }), race({ eventName: "Later race", startDate: "2026-10-31", endDate: "2026-11-01" })],
    });

    expect(result.weekType).toBe("race");
    expect(result.selectionReason).toBe("race_in_week");
  });

  it("candidateWeekType=recovery applies when no race is in this week or the next", () => {
    const result = selectWeekTemplate({ ...BASE_INPUT, candidateWeekType: "recovery" });

    expect(result.weekType).toBe("recovery");
    expect(result.selectionReason).toBe("candidate_hint");
    expect(result.template.id).toBe("recovery");
  });

  it("candidateWeekType=deload applies when no race is in this week or the next", () => {
    const result = selectWeekTemplate({ ...BASE_INPUT, candidateWeekType: "deload" });

    expect(result.weekType).toBe("deload");
    expect(result.selectionReason).toBe("candidate_hint");
    expect(result.template.id).toBe("deload");
  });
});

describe("selectWeekTemplate — race window boundaries and multiplicity", () => {
  it("a race starting exactly on weekEndDate counts as overlapping (inclusive boundary)", () => {
    const result = selectWeekTemplate({ ...BASE_INPUT, races: [race({ startDate: "2026-10-25", endDate: "2026-10-28" })] });

    expect(result.weekType).toBe("race");
  });

  it("a race ending exactly on weekStartDate counts as overlapping (inclusive boundary)", () => {
    const result = selectWeekTemplate({ ...BASE_INPUT, races: [race({ startDate: "2026-10-15", endDate: "2026-10-19" })] });

    expect(result.weekType).toBe("race");
  });

  it("a race entirely before the week does not trigger race or taper", () => {
    const result = selectWeekTemplate({ ...BASE_INPUT, races: [race({ startDate: "2026-10-01", endDate: "2026-10-02" })] });

    expect(result.weekType).toBe("development");
  });

  it("a race entirely after the next week does not trigger race or taper", () => {
    const result = selectWeekTemplate({
      ...BASE_INPUT,
      nextWeekStartDate: "2026-10-26",
      nextWeekEndDate: "2026-11-01",
      races: [race({ startDate: "2026-11-15", endDate: "2026-11-16" })],
    });

    expect(result.weekType).toBe("development");
  });

  it("V0.4_104 decision: race priority is never consulted — even a C-priority race triggers the race rule", () => {
    const result = selectWeekTemplate({ ...BASE_INPUT, races: [race({ priority: "C" })] });

    expect(result.weekType).toBe("race");
  });

  it("multiple races, only one overlapping -> still race (existence check, no single-race selection needed)", () => {
    const result = selectWeekTemplate({
      ...BASE_INPUT,
      races: [race({ eventName: "Irrelevant", startDate: "2026-01-01", endDate: "2026-01-02" }), race({ eventName: "Relevant" })],
    });

    expect(result.weekType).toBe("race");
  });
});

describe("selectWeekTemplate — next-week bounds partially supplied", () => {
  it("only nextWeekStartDate given (no nextWeekEndDate) -> the taper check is skipped, never an error", () => {
    const result = selectWeekTemplate({
      ...BASE_INPUT,
      nextWeekStartDate: "2026-10-26",
      races: [race({ startDate: "2026-10-31", endDate: "2026-11-01" })],
    });

    expect(result.weekType).toBe("development");
  });

  it("only nextWeekEndDate given (no nextWeekStartDate) -> the taper check is skipped, never an error", () => {
    const result = selectWeekTemplate({
      ...BASE_INPUT,
      nextWeekEndDate: "2026-11-01",
      races: [race({ startDate: "2026-10-31", endDate: "2026-11-01" })],
    });

    expect(result.weekType).toBe("development");
  });
});

describe("selectWeekTemplate — determinism", () => {
  it("the same input produces the exact same output on repeated calls", () => {
    const input: TemplateSelectionInput = { ...BASE_INPUT, races: [race()] };

    const first = selectWeekTemplate(input);
    const second = selectWeekTemplate(input);

    expect(second).toEqual(first);
  });
});

describe("selectWeekTemplate — errors", () => {
  it("throws InvalidCandidateWeekTypeError for an unrecognized candidateWeekType value", () => {
    const input = { ...BASE_INPUT, candidateWeekType: "taper" } as unknown as TemplateSelectionInput;

    expect(() => selectWeekTemplate(input)).toThrow(InvalidCandidateWeekTypeError);
  });
});

describe("TemplateNotFoundError", () => {
  // Unreachable through selectWeekTemplate today: WEEK_TEMPLATE_CATALOG_ENTRIES
  // has exactly one non-deprecated entry per WeekType, enforced by
  // catalog.test.ts (V0.4_103). This tests the error class's own shape
  // directly rather than mocking the catalogue import to force it.
  it("carries the weekType that could not be resolved, and a descriptive message", () => {
    const error = new TemplateNotFoundError("race");

    expect(error.name).toBe("TemplateNotFoundError");
    expect(error.weekType).toBe("race");
    expect(error.message).toContain("race");
  });
});
