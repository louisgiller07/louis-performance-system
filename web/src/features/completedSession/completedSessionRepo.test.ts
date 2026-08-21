import { describe, expect, it, vi, beforeEach } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../../lib/supabase", () => ({
  supabase: { functions: { invoke } },
}));

import { getCompletedSession, putCompletedSession } from "./completedSessionRepo";
import type { CompletedSessionInput } from "./completedSessionTypes";

const VALID_RECORD = {
  id: "cs-1",
  session_date: "2026-08-12",
  decision_id: null,
  session_type: "RECOVERY",
  completion_status: "done",
  actual_duration_min: 42,
  rpe: 7,
  post_leg_fatigue: 4,
  post_grip_fatigue: 3,
  new_pain: false,
  new_pain_note: null,
  intervention: null,
  main_content: null,
  session_load: 29.4,
  updated_at: "2026-08-12T20:00:00.000Z",
};

const PUT_BODY: CompletedSessionInput = {
  session_date: "2026-08-12",
  decision_id: null,
  session_type: "RECOVERY",
  completion_status: "done",
  actual_duration_min: 42,
  rpe: 7,
  post_leg_fatigue: 4,
  post_grip_fatigue: 3,
  new_pain: false,
  new_pain_note: null,
  intervention: null,
  main_content: null,
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("getCompletedSession — response guard", () => {
  it("accepts a fully valid record", async () => {
    invoke.mockResolvedValue({ data: { completedSession: VALID_RECORD }, error: null });
    const result = await getCompletedSession("2026-08-12");
    expect(result).toEqual({ ok: true, data: VALID_RECORD });
  });

  it("accepts completedSession: null (normal absence)", async () => {
    invoke.mockResolvedValue({ data: { completedSession: null }, error: null });
    const result = await getCompletedSession("2026-08-12");
    expect(result).toEqual({ ok: true, data: null });
  });

  describe("intervention guard", () => {
    it("accepts intervention: null", async () => {
      invoke.mockResolvedValue({ data: { completedSession: { ...VALID_RECORD, intervention: null } }, error: null });
      const result = await getCompletedSession("2026-08-12");
      expect(result.ok).toBe(true);
    });

    it("accepts a plain intervention object", async () => {
      invoke.mockResolvedValue({ data: { completedSession: { ...VALID_RECORD, intervention: { kind: "RECOVERY_ACTIVE" } } }, error: null });
      const result = await getCompletedSession("2026-08-12");
      expect(result.ok).toBe(true);
    });

    it("rejects intervention as an array — an invalid_response, never trusted as-is", async () => {
      invoke.mockResolvedValue({ data: { completedSession: { ...VALID_RECORD, intervention: [1, 2, 3] } }, error: null });
      const result = await getCompletedSession("2026-08-12");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invalid_response");
    });

    it("rejects intervention as a string", async () => {
      invoke.mockResolvedValue({ data: { completedSession: { ...VALID_RECORD, intervention: "not an object" } }, error: null });
      const result = await getCompletedSession("2026-08-12");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invalid_response");
    });

    it("rejects a completedSession missing the intervention key entirely", async () => {
      const { intervention: _drop, ...withoutIntervention } = VALID_RECORD;
      invoke.mockResolvedValue({ data: { completedSession: withoutIntervention }, error: null });
      const result = await getCompletedSession("2026-08-12");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invalid_response");
    });
  });

  describe("main_content guard", () => {
    it("accepts main_content: null", async () => {
      invoke.mockResolvedValue({ data: { completedSession: { ...VALID_RECORD, main_content: null } }, error: null });
      const result = await getCompletedSession("2026-08-12");
      expect(result.ok).toBe(true);
    });

    it("accepts a plain main_content object", async () => {
      invoke.mockResolvedValue({ data: { completedSession: { ...VALID_RECORD, main_content: { notes: "x" } } }, error: null });
      const result = await getCompletedSession("2026-08-12");
      expect(result.ok).toBe(true);
    });

    it("rejects main_content as an array", async () => {
      invoke.mockResolvedValue({ data: { completedSession: { ...VALID_RECORD, main_content: [1, 2] } }, error: null });
      const result = await getCompletedSession("2026-08-12");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invalid_response");
    });

    it("rejects main_content as a string", async () => {
      invoke.mockResolvedValue({ data: { completedSession: { ...VALID_RECORD, main_content: "notes" } }, error: null });
      const result = await getCompletedSession("2026-08-12");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invalid_response");
    });

    it("rejects a completedSession missing the main_content key entirely", async () => {
      const { main_content: _drop, ...withoutMainContent } = VALID_RECORD;
      invoke.mockResolvedValue({ data: { completedSession: withoutMainContent }, error: null });
      const result = await getCompletedSession("2026-08-12");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invalid_response");
    });
  });
});

describe("putCompletedSession — response guard", () => {
  it("accepts a valid response with a valid opaque intervention/main_content", async () => {
    invoke.mockResolvedValue({
      data: { completedSession: { ...VALID_RECORD, intervention: { kind: "RECOVERY_ACTIVE" }, main_content: { a: 1 } }, warnings: [] },
      error: null,
    });
    const result = await putCompletedSession(PUT_BODY);
    expect(result.ok).toBe(true);
  });

  it("rejects a response whose intervention is malformed (array)", async () => {
    invoke.mockResolvedValue({ data: { completedSession: { ...VALID_RECORD, intervention: [] }, warnings: [] }, error: null });
    const result = await putCompletedSession(PUT_BODY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_response");
  });
});
