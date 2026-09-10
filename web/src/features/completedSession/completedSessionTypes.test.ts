import { describe, expect, it } from "vitest";
import { emptyCompletedSessionForm, formatLinkableDecisionOption, prefillFromPrescription, recordToFormState } from "./completedSessionTypes";
import type { CompletedSessionRecord, LinkableDecision } from "./completedSessionTypes";

describe("emptyCompletedSessionForm (V0.3_007B)", () => {
  it("defaults to done, no decision link, no performed activity selected", () => {
    expect(emptyCompletedSessionForm()).toEqual({
      completion_status: "done",
      decision_id: null,
      performed_kind: "",
      performed_load: null,
      skipped_session_type: "",
      actual_duration_min: "",
      rpe: "",
      post_leg_fatigue: "",
      post_grip_fatigue: "",
      new_pain: null,
      new_pain_note: "",
      main_content: null,
      technical_outcome: "",
      change_reason: "",
      change_reason_note: "",
    });
  });
});

describe("recordToFormState (V0.3_007B)", () => {
  const baseRecord: CompletedSessionRecord = {
    id: "cs-1",
    session_date: "2026-09-01",
    decision_id: "d-1",
    session_type: "DH_PERFORMANCE",
    completion_status: "done",
    actual_duration_min: 120,
    rpe: 7,
    post_leg_fatigue: 5,
    post_grip_fatigue: 4,
    new_pain: false,
    new_pain_note: null,
    intervention: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
    main_content: null,
    session_load: 84,
    updated_at: "2026-09-01T20:00:00Z",
    technical_outcome: null,
    change_reason: null,
    change_reason_note: null,
  };

  it("extracts performed_kind/performed_load from the rich intervention", () => {
    const form = recordToFormState(baseRecord);
    expect(form.performed_kind).toBe("DH_PERFORMANCE");
    expect(form.performed_load).toBe("HEAVY");
  });

  // V0.3_007C
  it("extracts technical_outcome/change_reason/change_reason_note, defaulting null to empty string", () => {
    const empty = recordToFormState(baseRecord);
    expect(empty.technical_outcome).toBe("");
    expect(empty.change_reason).toBe("");
    expect(empty.change_reason_note).toBe("");

    const filled = recordToFormState({
      ...baseRecord,
      technical_outcome: "partial",
      change_reason: "fatigue_control",
      change_reason_note: "Jambes lourdes",
    });
    expect(filled.technical_outcome).toBe("partial");
    expect(filled.change_reason).toBe("fatigue_control");
    expect(filled.change_reason_note).toBe("Jambes lourdes");
  });

  it("skipped_session_type always reflects the persisted coarse session_type, regardless of status", () => {
    const form = recordToFormState({ ...baseRecord, completion_status: "skipped", intervention: null, session_type: "DH_LIGHT" as never });
    expect(form.skipped_session_type).toBe("DH_LIGHT");
    expect(form.performed_kind).toBe("");
    expect(form.performed_load).toBeNull();
  });

  it("a legacy row with completion_status done/partial/replaced but intervention NULL leaves performed_kind unselected (never guessed)", () => {
    const form = recordToFormState({ ...baseRecord, intervention: null });
    expect(form.performed_kind).toBe("");
    expect(form.performed_load).toBeNull();
  });
});

describe("prefillFromPrescription (V0.3_007B §6, extended in the final review)", () => {
  const finalSession = { kind: "DH_LIGHT" as const, load_profile: "LIGHT" as const };

  it("done prefills from the linked prescription", () => {
    expect(prefillFromPrescription("done", finalSession)).toEqual({
      performed_kind: "DH_LIGHT",
      performed_load: "LIGHT",
      skipped_session_type: "",
    });
  });

  it("partial prefills from the linked prescription", () => {
    expect(prefillFromPrescription("partial", finalSession)).toEqual({
      performed_kind: "DH_LIGHT",
      performed_load: "LIGHT",
      skipped_session_type: "",
    });
  });

  it("replaced NEVER prefills, even with a linked prescription — the athlete must explicitly record the actual replacement", () => {
    expect(prefillFromPrescription("replaced", finalSession)).toEqual({
      performed_kind: "",
      performed_load: null,
      skipped_session_type: "",
    });
  });

  it("done/partial with no linked decision (finalSession null) leaves the picker unselected", () => {
    expect(prefillFromPrescription("done", null)).toEqual({ performed_kind: "", performed_load: null, skipped_session_type: "" });
  });

  it("a fixed-load prescription (no load_profile) prefills kind only", () => {
    expect(prefillFromPrescription("done", { kind: "REST" })).toEqual({
      performed_kind: "REST",
      performed_load: null,
      skipped_session_type: "",
    });
  });

  // Final review, Issue B/§6 — skipped never has a performed intervention,
  // but its coarse session_type now defaults from a linked prescription
  // (the athlete shouldn't have to re-enter what the app already knows).
  describe("skipped — no performed intervention, but coarse type defaults from a linked prescription", () => {
    it("skipped with a linked prescription prefills skipped_session_type from its coarse projection, never performed_kind/load", () => {
      expect(prefillFromPrescription("skipped", finalSession)).toEqual({
        performed_kind: "",
        performed_load: null,
        skipped_session_type: "RECOVERY", // DH_LIGHT coarsens to RECOVERY, same canonical mapping as everywhere else
      });
    });

    it("skipped with a STRENGTH_LOWER/HEAVY prescription defaults to STRENGTH_A, not a fabricated value", () => {
      expect(prefillFromPrescription("skipped", { kind: "STRENGTH_LOWER", load_profile: "HEAVY" })).toEqual({
        performed_kind: "",
        performed_load: null,
        skipped_session_type: "STRENGTH_A",
      });
    });

    it("skipped with no linked decision leaves skipped_session_type unselected — never a fabricated default", () => {
      expect(prefillFromPrescription("skipped", null)).toEqual({ performed_kind: "", performed_load: null, skipped_session_type: "" });
    });
  });
});

describe("formatLinkableDecisionOption (V0.3_007B)", () => {
  it("formats time + kind + load, never a raw UUID/enum", () => {
    const decision: LinkableDecision = {
      decisionId: "11111111-1111-1111-1111-111111111111",
      createdAt: "2026-09-01T10:05:00Z",
      finalSession: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
      executionTask: null,
    };
    const label = formatLinkableDecisionOption(decision);
    expect(label).toContain("DH performance");
    expect(label).toContain("charge lourde");
    expect(label).not.toContain("11111111");
    expect(label).not.toContain("DH_PERFORMANCE");
  });

  it("omits the load segment for a fixed-load prescription", () => {
    const decision: LinkableDecision = {
      decisionId: "11111111-1111-1111-1111-111111111111",
      createdAt: "2026-09-01T08:00:00Z",
      finalSession: { kind: "REST" },
      executionTask: null,
    };
    const label = formatLinkableDecisionOption(decision);
    expect(label).toContain("Repos");
    expect(label).not.toContain("·");
  });
});
