import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadLatestDecisionForDate } from "./historyRepo";

// UX-11A.5c.4 — the restore read carries the durable V2 status and tells
// whether the restored V2 decision is the day's newest row (the decision
// record_session_execution treats as current).

vi.mock("../../lib/supabase", () => ({ supabase: { from: vi.fn() } }));
import { supabase } from "../../lib/supabase";
const mockedFrom = supabase.from as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => vi.resetAllMocks());

const validDailyPlan = {
  decision: "KEEP",
  confidence: "MEDIUM",
  reasoning: "r",
  active_mode: "IN_SEASON",
  training: { active: true },
  dh_or_technical: { active: false },
  mental: { active: false },
  recovery: { active: true, actions: [] },
  nutrition: { active: false },
  sleep: { active: false },
  protection: { do_not_do: [] },
  monitoring: { observe: [] },
  triggered_rules: [],
  planned_session_before: null,
  final_session: { kind: "REST" },
  overrode_race_protocol: false,
  engine_version: "test",
};
const row = (id: string, createdAt: string, dailyPlan: unknown, v2: Record<string, unknown> = {}) => ({
  id,
  decision_date: "2026-10-07",
  created_at: createdAt,
  final_session: "REST",
  active_mode: null,
  confidence_level: "MEDIUM",
  daily_plan: dailyPlan,
  final_prescription_status: null,
  final_prescription_status_code: null,
  final_prescription_status_detail: null,
  ...v2,
});
function mockRows(data: unknown[]) {
  const order = vi.fn().mockResolvedValue({ data, error: null });
  const eq2 = vi.fn(() => ({ order }));
  const select = vi.fn((_columns: string) => ({ eq: vi.fn(() => ({ eq: eq2 })) }));
  mockedFrom.mockReturnValue({ select });
  return { select };
}

describe("loadLatestDecisionForDate — V2 status (UX-11A.5c.4)", () => {
  it("selects the three status columns", async () => {
    const { select } = mockRows([]);
    await loadLatestDecisionForDate("a", "2026-10-07");
    expect(select.mock.calls[0]![0]).toMatch(/final_prescription_status, final_prescription_status_code, final_prescription_status_detail/);
  });

  it("maps the V2 status of the newest row and marks it as the day's latest", async () => {
    mockRows([row("d2", "2026-10-07T09:00:00Z", validDailyPlan, { final_prescription_status: "blocked", final_prescription_status_code: "final_prescription_no_lineage", final_prescription_status_detail: { reason: "no_planned_session" } })]);
    expect(await loadLatestDecisionForDate("a", "2026-10-07")).toMatchObject({
      id: "d2",
      finalPrescriptionStatus: "blocked",
      finalPrescriptionStatusCode: "final_prescription_no_lineage",
      finalPrescriptionStatusDetail: { reason: "no_planned_session" },
      isLatestOfDay: true,
    });
  });

  it("a V2 decision restored behind a newer invalid row is flagged as not the latest", async () => {
    mockRows([row("d-newer-invalid", "2026-10-07T09:00:00Z", { decision: "BROKEN" }), row("d1", "2026-10-07T08:00:00Z", validDailyPlan, { final_prescription_status: "created" })]);
    expect(await loadLatestDecisionForDate("a", "2026-10-07")).toMatchObject({ id: "d1", finalPrescriptionStatus: "created", isLatestOfDay: false });
  });

  it("V1 / historical rows (NULL status) keep exactly their previous shape", async () => {
    mockRows([row("d-v1", "2026-10-07T08:00:00Z", validDailyPlan)]);
    const result = await loadLatestDecisionForDate("a", "2026-10-07");
    expect(result).not.toHaveProperty("finalPrescriptionStatus");
    expect(result).not.toHaveProperty("isLatestOfDay");
  });
});
