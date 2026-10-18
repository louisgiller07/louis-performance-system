// PARTIAL-01 (HPM 2026-10-18) — loadExecutionsForDates carries the realisation of COMPLETED executions, read from
// their own frozen prescription and set results (RLS-scoped client, grouped reads, no N+1; set results paged against
// an exact count). Best effort: a failed or incomplete read, or a prescription that no longer decodes, leaves the
// execution without a realisation and never fails the load.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadExecutionsForDates } from "../history/historyRepo";
import { keepFinalPrescription } from "../../test/fixtures/finalPrescriptionV2Fixtures";
import { prescriptionView } from "../../test/guidedSessionFakeBackend";
import { workItems } from "../guidedSession/strength/strengthSets";

vi.mock("../../lib/supabase", () => ({ supabase: { from: vi.fn() } }));
import { supabase } from "../../lib/supabase";
const mockedFrom = supabase.from as unknown as ReturnType<typeof vi.fn>;

type Result = { data: unknown; error: unknown; count?: number | null };
type Fn = ReturnType<typeof vi.fn>;
type Chain = { select: Fn; eq: Fn; in: Fn; order: Fn; range: Fn; then: (ok: (r: Result) => unknown, ko: (e: unknown) => unknown) => Promise<unknown> };
function chain(result: Result): Chain {
  const c = { then: (ok: (r: Result) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result).then(ok, ko) } as Chain;
  for (const method of ["select", "eq", "in", "order", "range"] as const) c[method] = vi.fn(() => c);
  return c;
}

const FP = keepFinalPrescription("STRENGTH_LOWER").row;
const WORK = workItems(prescriptionView("STRENGTH_LOWER")).map((w) => w.item);
const set = (executionId: string, prescriptionItemId: string, n: number) => ({
  id: `${executionId}-${prescriptionItemId}-${n}`, execution_id: executionId, prescription_item_id: prescriptionItemId, other_exercise_name: null, set_number: n, done: true,
  measure_type: "reps", measure_value: "8", load_kg: null, rpe_actual: "7", success: null, supersedes_id: null, occurred_at: "2026-10-20T17:10:00Z", recorded_at: "2026-10-20T17:10:00Z",
});
const everySet = (executionId: string) => WORK.flatMap((item) => Array.from({ length: item.sets }, (_, i) => set(executionId, item.prescriptionItemId, i + 1)));
const execution = (id: string, date: string, events: string[]) => ({ id, session_date: date, decision_id: `d-${date}`, final_prescription_id: FP.id, started_at: `${date}T17:00:00Z`, execution_events: events.map((event_type) => ({ event_type })) });

/** Each table answers its results in turn (one per read: pages of exercise_set_results); `calls` keeps every chain. */
let calls: Record<string, Chain[]>;
function mockTables(results: Record<string, Result | Result[]>) {
  calls = {};
  const queues = Object.fromEntries(Object.entries(results).map(([table, r]) => [table, Array.isArray(r) ? [...r] : [r]]));
  mockedFrom.mockImplementation((table: string) => {
    const queue = queues[table];
    if (!queue || queue.length === 0) throw new Error(`unexpected read of ${table}`);
    const c = chain(queue.length > 1 ? queue.shift()! : queue[0]!);
    (calls[table] ??= []).push(c);
    return c;
  });
}
const sets = (data: unknown[], count: number | null = data.length): Result => ({ data, error: null, count });

beforeEach(() => vi.resetAllMocks());

describe("PARTIAL-01 — loadExecutionsForDates: realisation of completed executions", () => {
  it("complete / partial from the execution's own prescription and active results; never for an abandoned attempt", async () => {
    mockTables({
      session_executions: { data: [execution("e-full", "2026-10-19", ["started", "completed"]), execution("e-part", "2026-10-20", ["started", "completed"]), execution("e-stop", "2026-10-21", ["started", "abandoned"])], error: null },
      decision_final_prescriptions: { data: [FP], error: null },
      exercise_set_results: sets([...everySet("e-full"), set("e-part", WORK[0]!.prescriptionItemId, 1)]),
    });
    const rows = await loadExecutionsForDates("athlete-1", ["2026-10-19", "2026-10-20", "2026-10-21"]);
    expect(rows.map((r) => [r.executionId, r.realisation ?? null])).toEqual([
      ["e-full", "complete"],
      ["e-part", "partial"],
      ["e-stop", null],
    ]);
    // One read per table for all the executions, the rider's own rows only, the completed executions only.
    expect(calls.decision_final_prescriptions).toHaveLength(1);
    expect(calls.decision_final_prescriptions![0]!.in).toHaveBeenCalledWith("id", [FP.id]);
    expect(calls.exercise_set_results).toHaveLength(1);
    expect(calls.exercise_set_results![0]!.eq).toHaveBeenCalledWith("athlete_id", "athlete-1");
    expect(calls.exercise_set_results![0]!.in).toHaveBeenCalledWith("execution_id", ["e-full", "e-part"]);
  });

  it("set results capped per page by the server: read page after page up to the exact count, never a false partial", async () => {
    const all = everySet("e-full");
    mockTables({
      session_executions: { data: [execution("e-full", "2026-10-19", ["started", "completed"])], error: null },
      decision_final_prescriptions: { data: [FP], error: null },
      exercise_set_results: [sets(all.slice(0, 2), all.length), sets(all.slice(2), all.length)],
    });
    const rows = await loadExecutionsForDates("athlete-1", ["2026-10-19"]);
    expect(rows[0]!.realisation).toBe("complete");
    expect(calls.exercise_set_results).toHaveLength(2);
    expect(calls.exercise_set_results![1]!.range).toHaveBeenCalledWith(2, 1001);
  });

  it("an incomplete set read (fewer rows than counted): no realisation, never a guessed partial", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const all = everySet("e-full");
    mockTables({
      session_executions: { data: [execution("e-full", "2026-10-19", ["started", "completed"])], error: null },
      decision_final_prescriptions: { data: [FP], error: null },
      exercise_set_results: [sets(all.slice(0, 2), all.length), sets([], all.length)],
    });
    const rows = await loadExecutionsForDates("athlete-1", ["2026-10-19"]);
    expect(rows[0]!.realisation).toBeUndefined();
    errSpy.mockRestore();
  });

  it("no completed execution: no further read", async () => {
    mockTables({ session_executions: { data: [execution("e-stop", "2026-10-21", ["started", "abandoned"])], error: null } });
    const rows = await loadExecutionsForDates("athlete-1", ["2026-10-21"]);
    expect(rows).toHaveLength(1);
    expect(mockedFrom).toHaveBeenCalledTimes(1);
  });

  it("a failed read: the executions are returned, without a realisation (never fully done, never a failed screen)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockTables({
      session_executions: { data: [execution("e-part", "2026-10-20", ["started", "completed"])], error: null },
      decision_final_prescriptions: { data: null, error: { code: "42501" } },
      exercise_set_results: sets([]),
    });
    const rows = await loadExecutionsForDates("athlete-1", ["2026-10-20"]);
    expect(rows).toEqual([expect.objectContaining({ executionId: "e-part", events: ["started", "completed"] })]);
    expect(rows[0]!.realisation).toBeUndefined();
    errSpy.mockRestore();
  });

  it("a prescription that no longer decodes (older schema): no realisation", async () => {
    mockTables({
      session_executions: { data: [execution("e-part", "2026-10-20", ["started", "completed"])], error: null },
      decision_final_prescriptions: { data: [{ ...FP, schema_version: "v1" }], error: null },
      exercise_set_results: sets([set("e-part", WORK[0]!.prescriptionItemId, 1)]),
    });
    const rows = await loadExecutionsForDates("athlete-1", ["2026-10-20"]);
    expect(rows[0]!.realisation).toBeUndefined();
  });
});
