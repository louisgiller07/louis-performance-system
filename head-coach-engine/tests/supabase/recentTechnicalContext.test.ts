import { describe, it, expect } from "vitest";
import { resolveRecentTechnicalContext } from "../../src/supabase/mapping/recentTechnicalContext.js";
import type { CompletedSessionRawRow } from "../../src/supabase/repositories/completedSessionsRepo.js";
import type { DecisionRawRow } from "../../src/supabase/repositories/decisionsRepo.js";

const TODAY = "2026-09-14";
const D1 = "2026-09-13";
const D4 = "2026-09-10";
const D14 = "2026-08-31";

function candidate(overrides: Partial<CompletedSessionRawRow> = {}): CompletedSessionRawRow {
  return {
    session_date: D1,
    decision_id: "decision-d1",
    completion_status: "partial",
    technical_outcome: "yes",
    intervention: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
    ...overrides,
  };
}

function decision(id: string, decision_date: string, execution_task: string | null = "Choisis une section..."): DecisionRawRow {
  return {
    id,
    decision_date,
    daily_plan: execution_task === null ? { dh_or_technical: { active: true } } : { dh_or_technical: { active: true, execution_task } },
  };
}

function byId(...rows: DecisionRawRow[]): ReadonlyMap<string, DecisionRawRow> {
  return new Map(rows.map((r) => [r.id, r]));
}

describe("V0.3_008B — resolveRecentTechnicalContext (pure resolver, no I/O)", () => {
  it("single valid candidate resolves to the full context, age_days computed from today", () => {
    const result = resolveRecentTechnicalContext([candidate()], byId(decision("decision-d1", D1)), TODAY);
    expect(result).toEqual({
      source_decision_id: "decision-d1",
      session_date: D1,
      kind: "DH_TECHNICAL",
      execution_task: "Choisis une section...",
      technical_outcome: "yes",
      age_days: 1,
    });
  });

  it("age_days=14 for the oldest theoretically-eligible candidate", () => {
    const result = resolveRecentTechnicalContext(
      [candidate({ session_date: D14, decision_id: "decision-d14" })],
      byId(decision("decision-d14", D14)),
      TODAY
    );
    expect(result?.age_days).toBe(14);
  });

  it("no candidates -> undefined", () => {
    expect(resolveRecentTechnicalContext([], new Map(), TODAY)).toBeUndefined();
  });

  it("newest candidate wins when it resolves cleanly", () => {
    const result = resolveRecentTechnicalContext(
      [candidate({ session_date: D1, decision_id: "d1" }), candidate({ session_date: D4, decision_id: "d4" })],
      byId(decision("d1", D1), decision("d4", D4)),
      TODAY
    );
    expect(result?.session_date).toBe(D1);
  });

  it("newest candidate malformed (missing execution_task) -> falls back to the next older VALID candidate, never returns undefined outright", () => {
    const result = resolveRecentTechnicalContext(
      [
        candidate({ session_date: D1, decision_id: "d1" }), // malformed: linked decision has no execution_task
        candidate({ session_date: D4, decision_id: "d4" }), // valid
      ],
      byId(decision("d1", D1, null), decision("d4", D4)),
      TODAY
    );
    expect(result?.source_decision_id).toBe("d4");
    expect(result?.session_date).toBe(D4);
  });

  it("decision missing from the batch entirely -> candidate skipped, older valid candidate used", () => {
    const result = resolveRecentTechnicalContext(
      [candidate({ session_date: D1, decision_id: "d1" }), candidate({ session_date: D4, decision_id: "d4" })],
      byId(decision("d4", D4)), // d1 absent from the batch
      TODAY
    );
    expect(result?.source_decision_id).toBe("d4");
  });

  it("decision_date mismatch (defensive check) -> candidate skipped, older valid candidate used", () => {
    const result = resolveRecentTechnicalContext(
      [candidate({ session_date: D1, decision_id: "d1" }), candidate({ session_date: D4, decision_id: "d4" })],
      byId(decision("d1", "2026-09-12" /* mismatched date */), decision("d4", D4)),
      TODAY
    );
    expect(result?.source_decision_id).toBe("d4");
  });

  it("execution_task empty string on the linked decision -> skipped as malformed", () => {
    const result = resolveRecentTechnicalContext([candidate()], byId(decision("decision-d1", D1, "")), TODAY);
    expect(result).toBeUndefined();
  });

  it("intervention.kind absent -> skipped as malformed", () => {
    const result = resolveRecentTechnicalContext(
      [candidate({ intervention: {} })],
      byId(decision("decision-d1", D1)),
      TODAY
    );
    expect(result).toBeUndefined();
  });

  it("intervention.kind not DH-family (e.g. AEROBIC_BASE) -> skipped as malformed, performed kind authority still respected", () => {
    const result = resolveRecentTechnicalContext(
      [candidate({ intervention: { kind: "AEROBIC_BASE", load_profile: "MODERATE" } })],
      byId(decision("decision-d1", D1)),
      TODAY
    );
    expect(result).toBeUndefined();
  });

  it("technical_outcome invalid (not yes/partial/no) -> skipped as malformed", () => {
    const result = resolveRecentTechnicalContext(
      [candidate({ technical_outcome: "maybe" })],
      byId(decision("decision-d1", D1)),
      TODAY
    );
    expect(result).toBeUndefined();
  });

  it("technical_outcome null (should never occur given the repository's own filter, but defended here anyway) -> skipped", () => {
    const result = resolveRecentTechnicalContext([candidate({ technical_outcome: null })], byId(decision("decision-d1", D1)), TODAY);
    expect(result).toBeUndefined();
  });

  describe("defensive completion_status re-verification (Gap A)", () => {
    it("DONE + valid task/outcome -> valid candidate", () => {
      const result = resolveRecentTechnicalContext([candidate({ completion_status: "done" })], byId(decision("decision-d1", D1)), TODAY);
      expect(result?.source_decision_id).toBe("decision-d1");
    });

    it("PARTIAL + valid task/outcome -> valid candidate", () => {
      const result = resolveRecentTechnicalContext(
        [candidate({ completion_status: "partial" })],
        byId(decision("decision-d1", D1)),
        TODAY
      );
      expect(result?.source_decision_id).toBe("decision-d1");
    });

    it("REPLACED + malformed non-null technical_outcome + otherwise valid DH intervention -> skipped, never accepted on DB-filter trust alone", () => {
      const result = resolveRecentTechnicalContext(
        [candidate({ completion_status: "replaced" })],
        byId(decision("decision-d1", D1)),
        TODAY
      );
      expect(result).toBeUndefined();
    });

    it("SKIPPED + malformed non-null technical_outcome -> skipped", () => {
      const result = resolveRecentTechnicalContext(
        [candidate({ completion_status: "skipped" })],
        byId(decision("decision-d1", D1)),
        TODAY
      );
      expect(result).toBeUndefined();
    });

    it("unknown/invalid completion_status value -> skipped", () => {
      const result = resolveRecentTechnicalContext(
        [candidate({ completion_status: "not_a_real_status" })],
        byId(decision("decision-d1", D1)),
        TODAY
      );
      expect(result).toBeUndefined();
    });

    it("missing completion_status entirely -> skipped", () => {
      const result = resolveRecentTechnicalContext(
        [candidate({ completion_status: undefined })],
        byId(decision("decision-d1", D1)),
        TODAY
      );
      expect(result).toBeUndefined();
    });

    it("newest candidate malformed (REPLACED) falls back to an older valid PARTIAL candidate", () => {
      const result = resolveRecentTechnicalContext(
        [
          candidate({ session_date: D1, decision_id: "d1", completion_status: "replaced" }), // malformed
          candidate({ session_date: D4, decision_id: "d4", completion_status: "partial" }), // valid
        ],
        byId(decision("d1", D1), decision("d4", D4)),
        TODAY
      );
      expect(result?.source_decision_id).toBe("d4");
      expect(result?.session_date).toBe(D4);
    });
  });

  it("performed kind comes from intervention.kind, never a hypothetical prescription field — PUMPTRACK example", () => {
    const result = resolveRecentTechnicalContext(
      [candidate({ intervention: { kind: "PUMPTRACK", load_profile: "LIGHT" } })],
      byId(decision("decision-d1", D1)),
      TODAY
    );
    expect(result?.kind).toBe("PUMPTRACK");
  });

  it("all four DH-family kinds are individually valid performed kinds", () => {
    for (const kind of ["DH_TECHNICAL", "DH_PERFORMANCE", "DH_LIGHT", "PUMPTRACK"] as const) {
      const result = resolveRecentTechnicalContext(
        [candidate({ intervention: { kind, load_profile: "MODERATE" } })],
        byId(decision("decision-d1", D1)),
        TODAY
      );
      expect(result?.kind).toBe(kind);
    }
  });

  it("exact decision_id linkage with multiple same-date decisions: only the exact-linked one is ever used", () => {
    // Two decisions exist on the same historical date; the candidate links
    // to exactly one of them (decision-B), which must be the one resolved —
    // never the other, never picked by date/latest heuristics.
    const result = resolveRecentTechnicalContext(
      [candidate({ session_date: D1, decision_id: "decision-B" })],
      byId(decision("decision-A", D1, "Tâche de la décision A — jamais celle-ci"), decision("decision-B", D1, "Tâche de la décision B")),
      TODAY
    );
    expect(result?.source_decision_id).toBe("decision-B");
    expect(result?.execution_task).toBe("Tâche de la décision B");
  });
});
