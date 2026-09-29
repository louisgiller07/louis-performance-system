import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useCompletedSessionFlow, type CompletedSessionFlow } from "./useCompletedSessionFlow";

// UX-08 — the contracts CompletedSessionCard carried (M5_003, V0.3_007B/C,
// V0.3_007D), moved with its logic into useCompletedSessionFlow and proven at
// the state / payload level. The rider-facing steps are covered separately
// (AfterSessionFlow.test.tsx).

const signOut = vi.fn();
vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ signOut }),
}));

vi.mock("../completedSession/completedSessionRepo", () => ({
  getCompletedSession: vi.fn(),
  putCompletedSession: vi.fn(),
}));

vi.mock("../history/historyRepo", () => ({
  loadValidDecisionsForDate: vi.fn(),
}));

import { getCompletedSession, putCompletedSession } from "../completedSession/completedSessionRepo";
import { loadValidDecisionsForDate } from "../history/historyRepo";

const mockedGet = getCompletedSession as unknown as ReturnType<typeof vi.fn>;
const mockedPut = putCompletedSession as unknown as ReturnType<typeof vi.fn>;
const mockedLoadDecisions = loadValidDecisionsForDate as unknown as ReturnType<typeof vi.fn>;

const DATE = "2026-08-12";
const ATHLETE_ID = "athlete-1";

const EXISTING_RECORD = {
  id: "cs-1",
  session_date: DATE,
  decision_id: null,
  session_type: "RECOVERY",
  completion_status: "done",
  actual_duration_min: 42,
  rpe: 7,
  post_leg_fatigue: 4,
  post_grip_fatigue: 3,
  new_pain: false,
  new_pain_note: null,
  intervention: { kind: "RECOVERY_ACTIVE" },
  main_content: { free_text: "notes" },
  session_load: 29.4,
  updated_at: "2026-08-12T20:00:00.000Z",
  technical_outcome: null,
  change_reason: null,
  change_reason_note: null,
};

function validDailyPlan(finalSession: { kind: string; load_profile?: string; duration_min?: number }, executionTask?: string) {
  return {
    decision: "KEEP",
    confidence: "MEDIUM",
    reasoning: "Plan.",
    active_mode: "IN_SEASON",
    training: { active: true },
    dh_or_technical: executionTask !== undefined ? { active: true, execution_task: executionTask } : { active: false },
    mental: { active: false },
    recovery: { active: true, actions: [] },
    nutrition: { active: false },
    sleep: { active: false },
    protection: { do_not_do: [] },
    monitoring: { observe: [] },
    triggered_rules: [],
    planned_session_before: null,
    final_session: finalSession,
    overrode_race_protocol: false,
    engine_version: "test",
  };
}

function decisionRow(id: string, createdAt: string, finalSession: { kind: string; load_profile?: string; duration_min?: number }, executionTask?: string) {
  return { id, decisionDate: DATE, createdAt, finalSessionDb: "AEROBIC_BASE", activeModeDb: "IN_SEASON", confidenceLevelDb: "MEDIUM", dailyPlan: validDailyPlan(finalSession, executionTask) };
}

const DH_A = decisionRow("d-a", "2026-08-12T10:05:00Z", { kind: "DH_PERFORMANCE", load_profile: "HEAVY" });
const AERO_B = decisionRow("d-b", "2026-08-12T14:30:00Z", { kind: "AEROBIC_BASE", load_profile: "LIGHT" });
const DH_LIGHT_B = decisionRow("d-b", "2026-08-12T14:30:00Z", { kind: "DH_LIGHT", load_profile: "LIGHT" });
const SAVED = { ok: true, data: { completedSession: { ...EXISTING_RECORD, id: "cs-new" }, warnings: [] } };

async function setup(): Promise<{ current: () => CompletedSessionFlow }> {
  const { result } = renderHook(() => useCompletedSessionFlow(DATE, ATHLETE_ID));
  await waitFor(() => expect(result.current.loadState).toBe("loaded"));
  return { current: () => result.current };
}

async function openEdit(flow: { current: () => CompletedSessionFlow }) {
  await act(async () => {
    await flow.current().startEdit();
  });
}

function act_(fn: () => void) {
  act(fn);
}

/** Every "done" field except the activity. */
function fillRestOfValidDone(flow: { current: () => CompletedSessionFlow }) {
  act_(() => flow.current().updateField("actual_duration_min", 42));
  act_(() => flow.current().updateField("rpe", 7));
  act_(() => flow.current().updateField("post_leg_fatigue", 4));
  act_(() => flow.current().updateField("post_grip_fatigue", 3));
  act_(() => flow.current().updateField("new_pain", false));
}

async function submit(flow: { current: () => CompletedSessionFlow }): Promise<boolean> {
  let saved = false;
  await act(async () => {
    saved = await flow.current().submit();
  });
  return saved;
}

function lastPayload(call = 0) {
  return mockedPut.mock.calls[call]![0];
}

beforeEach(() => {
  vi.resetAllMocks();
  mockedGet.mockResolvedValue({ ok: true, data: null });
  mockedLoadDecisions.mockResolvedValue([]);
});

describe("useCompletedSessionFlow — load", () => {
  it("no row yet: loaded with no record, viewing", async () => {
    const flow = await setup();
    expect(flow.current().record).toBeNull();
    expect(flow.current().mode).toBe("view");
  });

  it("an existing row is loaded; its linked decision gives what was asked (for Prévu → Réalisé)", async () => {
    mockedGet.mockResolvedValue({ ok: true, data: { ...EXISTING_RECORD, decision_id: "d-a" } });
    mockedLoadDecisions.mockResolvedValue([decisionRow("d-a", "2026-08-12T10:05:00Z", { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 90 })]);
    const flow = await setup();
    expect(flow.current().record?.id).toBe("cs-1");
    await waitFor(() => expect(flow.current().recordPlanned).toEqual({ kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 90 }));
  });

  it("an unlinked row has no 'Prévu' and never looks decisions up", async () => {
    mockedGet.mockResolvedValue({ ok: true, data: EXISTING_RECORD });
    const flow = await setup();
    expect(flow.current().recordPlanned).toBeNull();
    expect(mockedLoadDecisions).not.toHaveBeenCalled();
  });

  it("a 401 session_issue error on load calls signOut", async () => {
    mockedGet.mockResolvedValue({ ok: false, error: { code: "unauthenticated", message: "Ta session a expiré. Reconnecte-toi.", retryable: false, action: "session_issue" } });
    renderHook(() => useCompletedSessionFlow(DATE, ATHLETE_ID));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });
});

// V0.3_007B — decision linkage: 0/1/2+ same-day valid decisions.
describe("decision linkage (V0.3_007B)", () => {
  it("A (§35): exactly one valid decision → auto-linked and prefilled, no forced extra choice", async () => {
    mockedLoadDecisions.mockResolvedValue([DH_A]);
    mockedPut.mockResolvedValue(SAVED);
    const flow = await setup();
    await openEdit(flow);

    expect(flow.current().form?.decision_id).toBe("d-a");
    expect(flow.current().form?.performed_kind).toBe("DH_PERFORMANCE");
    expect(flow.current().decisionLinkResolved).toBe(true);
    fillRestOfValidDone(flow);
    expect(flow.current().canSave).toBe(true);

    expect(await submit(flow)).toBe(true);
    expect(lastPayload()).toMatchObject({ decision_id: "d-a", intervention: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" } });
  });

  it("Issue A: unlinking the single plan keeps the performed activity and the status", async () => {
    mockedLoadDecisions.mockResolvedValue([DH_A]);
    mockedPut.mockResolvedValue(SAVED);
    const flow = await setup();
    await openEdit(flow);

    act_(() => flow.current().setDecision(null));
    expect(flow.current().form?.performed_kind).toBe("DH_PERFORMANCE");
    expect(flow.current().form?.completion_status).toBe("done");
    fillRestOfValidDone(flow);
    await submit(flow);
    expect(lastPayload()).toMatchObject({ decision_id: null, completion_status: "done", intervention: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" } });
  });

  it("zero valid decisions → decision_id null, no prefill", async () => {
    mockedPut.mockResolvedValue(SAVED);
    const flow = await setup();
    await openEdit(flow);

    expect(flow.current().linkableDecisions).toEqual([]);
    expect(flow.current().form?.performed_kind).toBe("");
    act_(() => flow.current().setPerformedKind("REST"));
    act_(() => flow.current().updateField("new_pain", false));
    await submit(flow);
    expect(lastPayload()).toMatchObject({ decision_id: null });
  });

  it("B (§36): 2+ decisions → no preselection, save blocked until an explicit choice; the chosen one is sent", async () => {
    mockedLoadDecisions.mockResolvedValue([DH_A, AERO_B]);
    mockedPut.mockResolvedValue(SAVED);
    const flow = await setup();
    await openEdit(flow);

    expect(flow.current().decisionLinkResolved).toBe(false);
    fillRestOfValidDone(flow);
    act_(() => flow.current().setPerformedKind("DH_PERFORMANCE"));
    act_(() => flow.current().updateField("performed_load", "HEAVY"));
    expect(flow.current().canSave).toBe(false);

    act_(() => flow.current().setDecision("d-a"));
    expect(flow.current().canSave).toBe(true);
    await submit(flow);
    expect(lastPayload()).toMatchObject({ decision_id: "d-a" });
  });

  it("C (§37): explicitly choosing no plan with 2+ decisions stores decision_id null", async () => {
    mockedLoadDecisions.mockResolvedValue([DH_A, AERO_B]);
    mockedPut.mockResolvedValue(SAVED);
    const flow = await setup();
    await openEdit(flow);

    act_(() => flow.current().setDecision(null));
    act_(() => flow.current().setPerformedKind("STRENGTH_LOWER"));
    act_(() => flow.current().updateField("performed_load", "HEAVY"));
    fillRestOfValidDone(flow);
    await submit(flow);
    expect(lastPayload()).toMatchObject({ decision_id: null });
  });

  it("selecting a decision prefills only an EMPTY activity — a later switch never overwrites it (V0.3_007B hotfix)", async () => {
    mockedLoadDecisions.mockResolvedValue([DH_A, AERO_B]);
    const flow = await setup();
    await openEdit(flow);

    act_(() => flow.current().setDecision("d-a"));
    expect(flow.current().form?.performed_kind).toBe("DH_PERFORMANCE");
    act_(() => flow.current().setDecision("d-b"));
    expect(flow.current().form?.performed_kind).toBe("DH_PERFORMANCE");
  });

  it("hotfix §10/§12: an activity entered first is never overwritten by selecting or switching plans", async () => {
    mockedLoadDecisions.mockResolvedValue([DH_A, DH_LIGHT_B]);
    mockedPut.mockResolvedValue(SAVED);
    const flow = await setup();
    await openEdit(flow);

    act_(() => flow.current().setStatus("replaced"));
    act_(() => flow.current().setPerformedKind("PUMPTRACK"));
    act_(() => flow.current().updateField("performed_load", "MODERATE"));
    act_(() => flow.current().setDecision("d-a"));
    expect(flow.current().form?.performed_kind).toBe("PUMPTRACK");
    act_(() => flow.current().setDecision("d-b"));
    expect(flow.current().form?.performed_kind).toBe("PUMPTRACK");

    fillRestOfValidDone(flow);
    act_(() => flow.current().setChangeReason("activity_change"));
    await submit(flow);
    expect(lastPayload()).toMatchObject({ decision_id: "d-b", completion_status: "replaced", intervention: { kind: "PUMPTRACK", load_profile: "MODERATE" } });
  });

  it("hotfix §13: clearing the link keeps an already-entered activity", async () => {
    mockedLoadDecisions.mockResolvedValue([DH_A]);
    mockedPut.mockResolvedValue(SAVED);
    const flow = await setup();
    await openEdit(flow);

    act_(() => flow.current().setPerformedKind("PUMPTRACK"));
    act_(() => flow.current().updateField("performed_load", "MODERATE"));
    act_(() => flow.current().setDecision(null));
    expect(flow.current().form?.performed_kind).toBe("PUMPTRACK");
    fillRestOfValidDone(flow);
    await submit(flow);
    expect(lastPayload()).toMatchObject({ decision_id: null, intervention: { kind: "PUMPTRACK", load_profile: "MODERATE" } });
  });

  it("hotfix §14: a server mismatch is shown and nothing is lost; switching to 'replaced' requires re-entry, then saves", async () => {
    mockedLoadDecisions.mockResolvedValue([DH_A]);
    const flow = await setup();
    await openEdit(flow);

    act_(() => flow.current().setPerformedKind("PUMPTRACK"));
    act_(() => flow.current().updateField("performed_load", "MODERATE"));
    fillRestOfValidDone(flow);
    mockedPut.mockResolvedValueOnce({
      ok: false,
      error: { code: "decision_session_mismatch", message: "Le statut et le type de séance ne correspondent pas à la séance liée.", retryable: false, action: "user_fixable" },
    });
    expect(await submit(flow)).toBe(false);
    expect(flow.current().saveError?.message).toMatch(/ne correspondent pas/);
    expect(flow.current().form?.performed_kind).toBe("PUMPTRACK");

    act_(() => flow.current().setStatus("replaced"));
    expect(flow.current().form?.performed_kind).toBe("");
    act_(() => flow.current().setPerformedKind("PUMPTRACK"));
    act_(() => flow.current().updateField("performed_load", "MODERATE"));
    act_(() => flow.current().setChangeReason("activity_change"));
    mockedPut.mockResolvedValueOnce(SAVED);
    expect(await submit(flow)).toBe(true);
    expect(lastPayload(1)).toMatchObject({ completion_status: "replaced", decision_id: "d-a", intervention: { kind: "PUMPTRACK", load_profile: "MODERATE" } });
  });

  describe("initial link resolution matrix (unresolved → first selection)", () => {
    beforeEach(() => mockedLoadDecisions.mockResolvedValue([DH_A, DH_LIGHT_B]));

    it.each([
      ["replaced", "", false, ""],
      ["done", "", false, "DH_PERFORMANCE"],
      ["done", "PUMPTRACK", true, "PUMPTRACK"],
      ["partial", "", false, "DH_PERFORMANCE"],
      ["partial", "PUMPTRACK", true, "PUMPTRACK"],
    ] as const)("%s + performed '%s': selecting A gives '%s'", async (status, entered, _nonEmpty, expected) => {
      const flow = await setup();
      await openEdit(flow);
      act_(() => flow.current().setStatus(status));
      if (entered) {
        act_(() => flow.current().setPerformedKind(entered));
        act_(() => flow.current().updateField("performed_load", "MODERATE"));
      }
      act_(() => flow.current().setDecision("d-a"));
      expect(flow.current().form?.performed_kind).toBe(expected);
    });
  });

  it("D (§38): editing keeps the persisted link; correcting it never rewrites the recorded activity", async () => {
    mockedGet.mockResolvedValue({ ok: true, data: { ...EXISTING_RECORD, decision_id: "d-a", intervention: { kind: "STRENGTH_LOWER", load_profile: "HEAVY" } } });
    mockedLoadDecisions.mockResolvedValue([DH_A, AERO_B]);
    mockedPut.mockResolvedValue({ ok: true, data: { completedSession: EXISTING_RECORD, warnings: [] } });
    const flow = await setup();
    await openEdit(flow);

    expect(flow.current().form?.decision_id).toBe("d-a");
    expect(flow.current().decisionLinkResolved).toBe(true);
    expect(flow.current().form?.performed_kind).toBe("STRENGTH_LOWER");
    act_(() => flow.current().setDecision("d-b"));
    expect(flow.current().form?.performed_kind).toBe("STRENGTH_LOWER");
    await submit(flow);
    expect(lastPayload()).toMatchObject({ decision_id: "d-b", intervention: { kind: "STRENGTH_LOWER", load_profile: "HEAVY" } });
  });

  it("a failed decision lookup never blocks logging a session — decision_id stays null", async () => {
    mockedLoadDecisions.mockRejectedValue(new Error("boom"));
    mockedPut.mockResolvedValue(SAVED);
    const flow = await setup();
    await openEdit(flow);

    expect(flow.current().decisionResolution).toBe("error");
    act_(() => flow.current().setPerformedKind("REST"));
    act_(() => flow.current().updateField("new_pain", false));
    await submit(flow);
    expect(lastPayload()).toMatchObject({ decision_id: null });
  });
});

// V0.3_007B — REV-003: rich performed activity, never a coarse guess.
describe("rich performed activity (REV-003)", () => {
  it.each([
    ["STRENGTH_LOWER", "HEAVY", "STRENGTH_A"],
    ["PUMPTRACK", "MODERATE", "DH_TECHNICAL"],
    ["RACE_ACTIVITY", null, "RACE_PREP"],
  ] as const)("%s round-trips exactly with its coarse projection", async (kind, load, sessionType) => {
    mockedPut.mockResolvedValue(SAVED);
    const flow = await setup();
    await openEdit(flow);
    act_(() => flow.current().setPerformedKind(kind));
    if (load) act_(() => flow.current().updateField("performed_load", load));
    fillRestOfValidDone(flow);
    await submit(flow);
    expect(lastPayload()).toMatchObject({ intervention: load ? { kind, load_profile: load } : { kind }, session_type: sessionType });
  });

  it("F (§32): a linked skipped session carries no intervention; its type is derived and locked", async () => {
    mockedLoadDecisions.mockResolvedValue([DH_A]);
    mockedPut.mockResolvedValue(SAVED);
    const flow = await setup();
    await openEdit(flow);

    act_(() => flow.current().setStatus("skipped"));
    expect(flow.current().form?.skipped_session_type).toBe("DH_PERFORMANCE");
    expect(flow.current().skippedTypeLocked).toBe(true);
    expect(flow.current().hideDurationRpe).toBe(true);
    act_(() => flow.current().setChangeReason("fatigue_control"));
    act_(() => flow.current().updateField("new_pain", false));
    await submit(flow);
    expect(lastPayload()).toMatchObject({ decision_id: "d-a", intervention: null, session_type: "DH_PERFORMANCE" });
  });

  it("Issue B (§6): unlinking a locked skipped type clears it for an explicit fresh choice", async () => {
    mockedLoadDecisions.mockResolvedValue([DH_A]);
    mockedPut.mockResolvedValue(SAVED);
    const flow = await setup();
    await openEdit(flow);

    act_(() => flow.current().setStatus("skipped"));
    act_(() => flow.current().setDecision(null));
    expect(flow.current().form?.skipped_session_type).toBe("");
    expect(flow.current().skippedTypeLocked).toBe(false);
    act_(() => flow.current().updateField("skipped_session_type", "AEROBIC_BASE"));
    act_(() => flow.current().setChangeReason("time_life"));
    act_(() => flow.current().updateField("new_pain", false));
    await submit(flow);
    expect(lastPayload()).toMatchObject({ decision_id: null, intervention: null, session_type: "AEROBIC_BASE" });
  });

  it("§9: skipped with no linked decision requires an explicit type", async () => {
    mockedPut.mockResolvedValue(SAVED);
    const flow = await setup();
    await openEdit(flow);

    act_(() => flow.current().setStatus("skipped"));
    act_(() => flow.current().setChangeReason("time_life"));
    act_(() => flow.current().updateField("new_pain", false));
    expect(flow.current().canSave).toBe(false);
    act_(() => flow.current().updateField("skipped_session_type", "DH_PERFORMANCE"));
    expect(flow.current().canSave).toBe(true);
    await submit(flow);
    expect(lastPayload()).toMatchObject({ decision_id: null, intervention: null, session_type: "DH_PERFORMANCE" });
  });

  it("G (§33): 'replaced' never keeps the prescription prefill", async () => {
    mockedLoadDecisions.mockResolvedValue([decisionRow("d-a", "2026-08-12T10:05:00Z", { kind: "DH_LIGHT", load_profile: "LIGHT" })]);
    const flow = await setup();
    await openEdit(flow);
    expect(flow.current().form?.performed_kind).toBe("DH_LIGHT");
    act_(() => flow.current().setStatus("replaced"));
    expect(flow.current().form?.performed_kind).toBe("");
  });

  it("H (§34): 'partial' keeps the prescribed prefill", async () => {
    mockedLoadDecisions.mockResolvedValue([DH_A]);
    mockedPut.mockResolvedValue(SAVED);
    const flow = await setup();
    await openEdit(flow);
    act_(() => flow.current().setStatus("partial"));
    expect(flow.current().form?.performed_kind).toBe("DH_PERFORMANCE");
    fillRestOfValidDone(flow);
    act_(() => flow.current().setChangeReason("fatigue_control"));
    await submit(flow);
    expect(lastPayload()).toMatchObject({ completion_status: "partial", intervention: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" } });
  });

  it("changing the activity always clears a previously chosen intensity", async () => {
    const flow = await setup();
    await openEdit(flow);
    act_(() => flow.current().setPerformedKind("PUMPTRACK"));
    act_(() => flow.current().updateField("performed_load", "HEAVY"));
    act_(() => flow.current().setPerformedKind("AEROBIC_BASE"));
    expect(flow.current().form?.performed_load).toBeNull();
    expect(flow.current().isVariablePerformedKind).toBe(true);
  });
});

// V0.3_007C — athlete debrief.
describe("athlete debrief (V0.3_007C)", () => {
  const withTask = (task = "Regarde loin, freine avant le virage") => decisionRow("d-a", "2026-08-12T10:05:00Z", { kind: "DH_PERFORMANCE", load_profile: "HEAVY" }, task);

  it("§31 done: the technical task is shown and required; no reason; persists 'yes' with null reason fields", async () => {
    mockedLoadDecisions.mockResolvedValue([withTask()]);
    mockedPut.mockResolvedValue(SAVED);
    const flow = await setup();
    await openEdit(flow);

    expect(flow.current().showTechnicalOutcome).toBe(true);
    expect(flow.current().linkedExecutionTask).toBe("Regarde loin, freine avant le virage");
    expect(flow.current().showChangeReason).toBe(false);
    fillRestOfValidDone(flow);
    expect(flow.current().canSave).toBe(false);
    act_(() => flow.current().updateField("technical_outcome", "yes"));
    expect(flow.current().canSave).toBe(true);
    await submit(flow);
    expect(lastPayload()).toMatchObject({ technical_outcome: "yes", change_reason: null, change_reason_note: null });
  });

  it("§32 partial: both the task and the reason are required", async () => {
    mockedLoadDecisions.mockResolvedValue([withTask()]);
    mockedPut.mockResolvedValue(SAVED);
    const flow = await setup();
    await openEdit(flow);
    act_(() => flow.current().setStatus("partial"));
    expect(flow.current().showTechnicalOutcome).toBe(true);
    expect(flow.current().showChangeReason).toBe(true);
    fillRestOfValidDone(flow);
    act_(() => flow.current().updateField("technical_outcome", "partial"));
    expect(flow.current().canSave).toBe(false);
    act_(() => flow.current().setChangeReason("fatigue_control"));
    await submit(flow);
    expect(lastPayload()).toMatchObject({ technical_outcome: "partial", change_reason: "fatigue_control" });
  });

  it("§33 'no' persists exactly, never a score", async () => {
    mockedLoadDecisions.mockResolvedValue([withTask()]);
    mockedPut.mockResolvedValue(SAVED);
    const flow = await setup();
    await openEdit(flow);
    fillRestOfValidDone(flow);
    act_(() => flow.current().updateField("technical_outcome", "no"));
    await submit(flow);
    expect(lastPayload()).toMatchObject({ technical_outcome: "no" });
  });

  it("§34 no prescribed task: hidden and sent as null", async () => {
    mockedLoadDecisions.mockResolvedValue([DH_A]);
    mockedPut.mockResolvedValue(SAVED);
    const flow = await setup();
    await openEdit(flow);
    expect(flow.current().showTechnicalOutcome).toBe(false);
    fillRestOfValidDone(flow);
    await submit(flow);
    expect(lastPayload()).toMatchObject({ technical_outcome: null });
  });

  it("§35 replaced: task hidden/null, reason required, activity + link preserved", async () => {
    mockedLoadDecisions.mockResolvedValue([withTask()]);
    mockedPut.mockResolvedValue(SAVED);
    const flow = await setup();
    await openEdit(flow);
    act_(() => flow.current().setStatus("replaced"));
    expect(flow.current().showTechnicalOutcome).toBe(false);
    act_(() => flow.current().setPerformedKind("AEROBIC_BASE"));
    act_(() => flow.current().updateField("performed_load", "MODERATE"));
    act_(() => flow.current().setChangeReason("weather_terrain"));
    fillRestOfValidDone(flow);
    await submit(flow);
    expect(lastPayload()).toMatchObject({ decision_id: "d-a", technical_outcome: null, change_reason: "weather_terrain", intervention: { kind: "AEROBIC_BASE", load_profile: "MODERATE" } });
  });

  it("§36 skipped: no intervention, task hidden/null, reason required", async () => {
    mockedPut.mockResolvedValue(SAVED);
    const flow = await setup();
    await openEdit(flow);
    act_(() => flow.current().setStatus("skipped"));
    act_(() => flow.current().updateField("skipped_session_type", "DH_PERFORMANCE"));
    act_(() => flow.current().updateField("new_pain", false));
    expect(flow.current().canSave).toBe(false);
    act_(() => flow.current().setChangeReason("time_life"));
    await submit(flow);
    expect(lastPayload()).toMatchObject({ intervention: null, technical_outcome: null, change_reason: "time_life" });
  });

  it("§37 rest done: no task, no reason, no duration / effort — never an invented load", async () => {
    mockedPut.mockResolvedValue(SAVED);
    const flow = await setup();
    await openEdit(flow);
    act_(() => flow.current().setPerformedKind("REST"));
    expect(flow.current().showChangeReason).toBe(false);
    expect(flow.current().hideDurationRpe).toBe(true);
    act_(() => flow.current().updateField("new_pain", false));
    expect(flow.current().canSave).toBe(true);
    await submit(flow);
    expect(lastPayload()).toMatchObject({ session_type: "REST", actual_duration_min: null, rpe: null, technical_outcome: null, change_reason: null });
  });

  it("prescribed rest prefills rest, no duration / effort required", async () => {
    mockedLoadDecisions.mockResolvedValue([decisionRow("d-a", "2026-08-12T10:05:00Z", { kind: "REST" })]);
    const flow = await setup();
    await openEdit(flow);
    expect(flow.current().form?.performed_kind).toBe("REST");
    expect(flow.current().hideDurationRpe).toBe(true);
    act_(() => flow.current().updateField("new_pain", false));
    expect(flow.current().canSave).toBe(true);
  });

  it("§38 a plan switch clears the task answer and shows the new plan's own task", async () => {
    mockedLoadDecisions.mockResolvedValue([
      decisionRow("d-a", "2026-08-12T10:05:00Z", { kind: "DH_PERFORMANCE", load_profile: "HEAVY" }, "Tâche A : virages serrés"),
      decisionRow("d-b", "2026-08-12T14:30:00Z", { kind: "DH_LIGHT", load_profile: "LIGHT" }, "Tâche B : sauts"),
    ]);
    const flow = await setup();
    await openEdit(flow);
    act_(() => flow.current().setDecision("d-a"));
    act_(() => flow.current().updateField("technical_outcome", "yes"));
    act_(() => flow.current().setDecision("d-b"));
    expect(flow.current().linkedExecutionTask).toBe("Tâche B : sauts");
    expect(flow.current().form?.technical_outcome).toBe("");
  });

  it("§39 clearing the link clears the task answer and hides it; the activity stays", async () => {
    mockedLoadDecisions.mockResolvedValue([withTask("Tâche A : virages serrés")]);
    mockedPut.mockResolvedValue(SAVED);
    const flow = await setup();
    await openEdit(flow);
    act_(() => flow.current().updateField("technical_outcome", "yes"));
    act_(() => flow.current().setDecision(null));
    expect(flow.current().showTechnicalOutcome).toBe(false);
    expect(flow.current().form?.performed_kind).toBe("DH_PERFORMANCE");
    fillRestOfValidDone(flow);
    await submit(flow);
    expect(lastPayload()).toMatchObject({ decision_id: null, technical_outcome: null });
  });

  it("§40 a relink keeps a factual reason; unlinking clears 'coach_criterion' only", async () => {
    mockedLoadDecisions.mockResolvedValue([DH_A, DH_LIGHT_B]);
    const flow = await setup();
    await openEdit(flow);
    act_(() => flow.current().setStatus("partial"));
    act_(() => flow.current().setDecision("d-a"));
    act_(() => flow.current().setChangeReason("mechanical"));
    act_(() => flow.current().setDecision("d-b"));
    expect(flow.current().form?.change_reason).toBe("mechanical");
    act_(() => flow.current().setChangeReason("coach_criterion"));
    act_(() => flow.current().setDecision(null));
    expect(flow.current().form?.change_reason).toBe("");
  });

  it("§41 status transitions clear stale answers: partial → done clears the reason and the task; done → replaced clears both", async () => {
    mockedLoadDecisions.mockResolvedValue([withTask("Tâche A")]);
    const flow = await setup();
    await openEdit(flow);
    act_(() => flow.current().setStatus("partial"));
    act_(() => flow.current().updateField("technical_outcome", "partial"));
    act_(() => flow.current().setChangeReason("fatigue_control"));
    act_(() => flow.current().setStatus("done"));
    expect(flow.current().showChangeReason).toBe(false);
    expect(flow.current().form?.change_reason).toBe("");
    expect(flow.current().form?.technical_outcome).toBe("");
    act_(() => flow.current().updateField("technical_outcome", "yes"));
    act_(() => flow.current().setStatus("replaced"));
    expect(flow.current().showTechnicalOutcome).toBe(false);
    expect(flow.current().form?.change_reason).toBe("");
  });

  describe("final semantic review", () => {
    it("Issue A: switching reason clears its note; a plan change keeps the note of an unchanged reason", async () => {
      mockedLoadDecisions.mockResolvedValue([DH_A, DH_LIGHT_B]);
      mockedPut.mockResolvedValue(SAVED);
      const flow = await setup();
      await openEdit(flow);
      act_(() => flow.current().setStatus("partial"));
      act_(() => flow.current().setChangeReason("other"));
      act_(() => flow.current().updateField("change_reason_note", "Navette arrêtée à 15h"));
      act_(() => flow.current().setChangeReason("mechanical"));
      expect(flow.current().form?.change_reason_note).toBe("");

      act_(() => flow.current().setDecision("d-a"));
      act_(() => flow.current().updateField("change_reason_note", "Crevaison arrière"));
      act_(() => flow.current().setDecision("d-b"));
      expect(flow.current().form?.change_reason_note).toBe("Crevaison arrière");
      fillRestOfValidDone(flow);
      await submit(flow);
      expect(lastPayload()).toMatchObject({ change_reason: "mechanical", change_reason_note: "Crevaison arrière" });
    });

    it("Issue 3: 'other' requires a note before saving", async () => {
      mockedPut.mockResolvedValue(SAVED);
      const flow = await setup();
      await openEdit(flow);
      act_(() => flow.current().setStatus("skipped"));
      act_(() => flow.current().updateField("skipped_session_type", "AEROBIC_BASE"));
      act_(() => flow.current().setChangeReason("other"));
      act_(() => flow.current().updateField("new_pain", false));
      expect(flow.current().canSave).toBe(false);
      act_(() => flow.current().updateField("change_reason_note", "Navette arrêtée à 15h"));
      expect(flow.current().canSave).toBe(true);
      await submit(flow);
      expect(lastPayload()).toMatchObject({ change_reason: "other", change_reason_note: "Navette arrêtée à 15h" });
    });

    it("Issue B: reason and physical signal are independent facts", async () => {
      mockedPut.mockResolvedValue(SAVED);
      const flow = await setup();
      await openEdit(flow);
      act_(() => flow.current().setStatus("partial"));
      act_(() => flow.current().setPerformedKind("AEROBIC_BASE"));
      act_(() => flow.current().updateField("performed_load", "MODERATE"));
      act_(() => flow.current().setChangeReason("pain"));
      fillRestOfValidDone(flow);
      await submit(flow);
      expect(lastPayload()).toMatchObject({ change_reason: "pain", new_pain: false });
    });

    it("Issue B: done + a physical signal keeps change_reason null", async () => {
      mockedPut.mockResolvedValue(SAVED);
      const flow = await setup();
      await openEdit(flow);
      act_(() => flow.current().setPerformedKind("AEROBIC_BASE"));
      act_(() => flow.current().updateField("performed_load", "MODERATE"));
      fillRestOfValidDone(flow);
      act_(() => flow.current().updateField("new_pain", true));
      expect(flow.current().canSave).toBe(false);
      act_(() => flow.current().updateField("new_pain_note", "Poignet"));
      await submit(flow);
      expect(lastPayload()).toMatchObject({ completion_status: "done", new_pain: true, new_pain_note: "Poignet", change_reason: null });
    });

    it("Issue C: no task question for a non-DH activity, even when the linked plan has one", async () => {
      mockedLoadDecisions.mockResolvedValue([withTask()]);
      mockedPut.mockResolvedValue(SAVED);
      const flow = await setup();
      await openEdit(flow);
      expect(flow.current().showTechnicalOutcome).toBe(true);
      act_(() => flow.current().setPerformedKind("AEROBIC_BASE"));
      act_(() => flow.current().updateField("performed_load", "MODERATE"));
      expect(flow.current().showTechnicalOutcome).toBe(false);
      fillRestOfValidDone(flow);
      await submit(flow);
      expect(lastPayload()).toMatchObject({ technical_outcome: null });
    });
  });
});

describe("save", () => {
  it("is blocked until every required answer is given", async () => {
    mockedLoadDecisions.mockResolvedValue([decisionRow("d-a", "2026-08-12T10:05:00Z", { kind: "AEROBIC_BASE", load_profile: "MODERATE" })]);
    const flow = await setup();
    await openEdit(flow);
    expect(flow.current().canSave).toBe(false);
    fillRestOfValidDone(flow);
    expect(flow.current().canSave).toBe(true);
  });

  it("success: back to viewing, the saved row is the record, 'Prévu' is the linked decision", async () => {
    mockedLoadDecisions.mockResolvedValue([decisionRow("d-a", "2026-08-12T10:05:00Z", { kind: "AEROBIC_BASE", load_profile: "MODERATE", duration_min: 60 })]);
    mockedPut.mockResolvedValue({ ok: true, data: { completedSession: { ...EXISTING_RECORD, id: "cs-new", decision_id: "d-a" }, warnings: [] } });
    const flow = await setup();
    await openEdit(flow);
    fillRestOfValidDone(flow);
    expect(await submit(flow)).toBe(true);
    expect(flow.current().mode).toBe("view");
    expect(flow.current().record?.id).toBe("cs-new");
    expect(flow.current().recordPlanned).toEqual({ kind: "AEROBIC_BASE", load_profile: "MODERATE", duration_min: 60 });
  });

  it.each([
    ["decision_link_invalid", "La décision liée n'est plus valide pour cette date. Recharge la page et réessaie.", false, "user_fixable"],
    ["persistence_failed", "Erreur d'enregistrement côté serveur. Réessaie.", true, "retry"],
  ] as const)("%s: the error is kept, the answers too, and a retry can succeed", async (code, message, retryable, action) => {
    const flow = await setup();
    await openEdit(flow);
    act_(() => flow.current().setPerformedKind("AEROBIC_BASE"));
    act_(() => flow.current().updateField("performed_load", "MODERATE"));
    fillRestOfValidDone(flow);
    mockedPut.mockResolvedValueOnce({ ok: false, error: { code, message, retryable, action } });
    expect(await submit(flow)).toBe(false);
    expect(flow.current().saveError?.message).toBe(message);
    expect(flow.current().mode).toBe("editing");
    expect(flow.current().form?.actual_duration_min).toBe(42);
    expect(signOut).not.toHaveBeenCalled();

    mockedPut.mockResolvedValueOnce(SAVED);
    expect(await submit(flow)).toBe(true);
  });

  it("a 401 session_issue on save calls signOut — the existing auth flow", async () => {
    mockedPut.mockResolvedValue({ ok: false, error: { code: "unauthenticated", message: "Ta session a expiré. Reconnecte-toi.", retryable: false, action: "session_issue" } });
    const flow = await setup();
    await openEdit(flow);
    act_(() => flow.current().setPerformedKind("AEROBIC_BASE"));
    act_(() => flow.current().updateField("performed_load", "MODERATE"));
    fillRestOfValidDone(flow);
    await submit(flow);
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("opens without a previous edit's answers while the day's decisions load", async () => {
    mockedLoadDecisions.mockReturnValue(new Promise(() => {}));
    const flow = await setup();
    act_(() => void flow.current().startEdit());
    expect(flow.current().mode).toBe("editing");
    expect(flow.current().form).toBeNull();
  });
});

describe("opaque field preservation", () => {
  it("a new session sends main_content null", async () => {
    mockedPut.mockResolvedValue(SAVED);
    const flow = await setup();
    await openEdit(flow);
    act_(() => flow.current().setPerformedKind("AEROBIC_BASE"));
    act_(() => flow.current().updateField("performed_load", "MODERATE"));
    fillRestOfValidDone(flow);
    await submit(flow);
    expect(lastPayload()).toMatchObject({ main_content: null });
  });

  it("editing an existing row round-trips main_content and intervention unchanged", async () => {
    mockedGet.mockResolvedValue({ ok: true, data: EXISTING_RECORD });
    mockedPut.mockResolvedValue({ ok: true, data: { completedSession: EXISTING_RECORD, warnings: [] } });
    const flow = await setup();
    await openEdit(flow);
    await submit(flow);
    expect(lastPayload()).toMatchObject({ intervention: EXISTING_RECORD.intervention, main_content: EXISTING_RECORD.main_content });
  });
});
