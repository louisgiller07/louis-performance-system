import { describe, expect, it } from "vitest";
import { KIND_TITLES, PAGE, RESPONSE, RESPONSES, STATEMENTS, observations } from "./insightsPresentation";

// UX-10B-2A — the insights wording never claims learning, analysis or
// causality, never promises that a response improves the plan, and counts
// observations (never days or sessions).
const ALL_TEXT = [
  ...Object.values(PAGE),
  ...Object.values(KIND_TITLES),
  ...Object.values(STATEMENTS).flatMap((byDirection) => Object.values(byDirection)),
  ...Object.values(RESPONSES),
  RESPONSE.question,
  RESPONSE.keep,
  RESPONSE.noteLabel,
  RESPONSE.noteHint,
  RESPONSE.stale,
  RESPONSE.saved,
];

describe("insightsPresentation", () => {
  it.each([/apprend/i, /analys/i, /intelligen/i, /\bcaus/i, /grâce à/i, /journées/i, /améliore/i, /plus précis/i])(
    "never uses %s",
    (forbidden) => {
      for (const text of ALL_TEXT) expect(text).not.toMatch(forbidden);
    },
  );

  it("keeps the validated title and subtitle", () => {
    expect(PAGE.title).toBe("Ce que NALYNT remarque");
    expect(PAGE.subtitle).toBe("Des tendances observées dans tes check-ins et tes séances. Elles ne changent pas ton plan.");
  });

  it("maps the three locked decisions to rider responses", () => {
    expect(RESPONSES).toEqual({
      accepted_as_insight: "Ça me parle",
      dismissed: "Pas vraiment",
      needs_more_evidence: "Pas encore sûr",
    });
  });

  it("counts observations", () => {
    expect(observations(1)).toBe("1 observation");
    expect(observations(9)).toBe("9 observations");
  });
});
