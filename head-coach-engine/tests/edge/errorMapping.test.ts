// M3_003 — unit tests for supabase/functions/daily-run/errorMapping.ts.
// Pure, deterministic, no DB/network: covers error classes that are real
// but awkward to provoke cleanly via a live DB fixture.
import { describe, expect, it } from "vitest";
import { mapDailyRunError } from "../../../supabase/functions/daily-run/errorMapping.js";
import { NoCurrentCheckinError } from "../../dist/supabase/buildRawContext.js";
import { IncompleteDailyCheckinError } from "../../dist/supabase/mapping/dailyCheckinRow.js";
import { IncompleteCheckinPainCriteriaError } from "../../dist/supabase/mapping/dailyCheckinPainCriteria.js";
import { PersistDailyRunRpcError, InvalidPersistDailyRunResultError } from "../../dist/supabase/persistDailyRun.js";
import { DailyPlanDateMismatchError } from "../../dist/supabase/runDailyFor.js";
import { UnsupportedPlanPrescriptionSchemaError } from "../../dist/supabase/dailyV2/dailyPrescriptionModel.js";
import { PersistDailyRunV2RpcError, InvalidPersistDailyRunV2ResultError } from "../../dist/supabase/dailyV2/persistDailyRunV2.js";

describe("mapDailyRunError", () => {
  it("maps NoCurrentCheckinError to 422 no_checkin_for_date", () => {
    const mapped = mapDailyRunError(new NoCurrentCheckinError("athlete-1", "2026-08-17"));
    expect(mapped).toEqual({ status: 422, code: "no_checkin_for_date", message: mapped.message });
  });

  it("maps IncompleteCheckinPainCriteriaError to 422 pain_criteria_missing", () => {
    const mapped = mapDailyRunError(new IncompleteCheckinPainCriteriaError(["pain_traumatic"]));
    expect(mapped.status).toBe(422);
    expect(mapped.code).toBe("pain_criteria_missing");
  });

  it("maps IncompleteDailyCheckinError to 422 checkin_incomplete", () => {
    const mapped = mapDailyRunError(new IncompleteDailyCheckinError(["sleep_hours"]));
    expect(mapped.status).toBe(422);
    expect(mapped.code).toBe("checkin_incomplete");
  });

  it("maps PersistDailyRunRpcError to 500 persistence_failed", () => {
    const mapped = mapDailyRunError(new PersistDailyRunRpcError("connection reset"));
    expect(mapped.status).toBe(500);
    expect(mapped.code).toBe("persistence_failed");
  });

  it("maps InvalidPersistDailyRunResultError to 500 internal_error", () => {
    const mapped = mapDailyRunError(new InvalidPersistDailyRunResultError("expected a JSON object", null));
    expect(mapped.status).toBe(500);
    expect(mapped.code).toBe("internal_error");
  });

  it("maps DailyPlanDateMismatchError to 500 internal_error", () => {
    const mapped = mapDailyRunError(new DailyPlanDateMismatchError("2026-08-17", "2026-08-18"));
    expect(mapped.status).toBe(500);
    expect(mapped.code).toBe("internal_error");
  });

  it("UX-11A.5c.3 — maps UnsupportedPlanPrescriptionSchemaError to 409 unsupported_plan_prescription_schema (fail-closed, nothing written)", () => {
    const mapped = mapDailyRunError(new UnsupportedPlanPrescriptionSchemaError("plan-1", "v999"));
    expect(mapped).toEqual({ status: 409, code: "unsupported_plan_prescription_schema", message: mapped.message });
    expect(mapped.message).not.toContain("v999");
  });

  it("UX-11A.5c.3 — maps the V2 persistence errors like the V1 ones", () => {
    expect(mapDailyRunError(new PersistDailyRunV2RpcError("boom"))).toMatchObject({ status: 500, code: "persistence_failed" });
    expect(mapDailyRunError(new InvalidPersistDailyRunV2ResultError("bad", {}))).toMatchObject({ status: 500, code: "internal_error" });
  });

  it("maps a generic/unforeseen Error to 500 internal_error", () => {
    const mapped = mapDailyRunError(new Error("something unexpected"));
    expect(mapped.status).toBe(500);
    expect(mapped.code).toBe("internal_error");
  });

  it("never leaks the original error message into the mapped message", () => {
    const secretish = new PersistDailyRunRpcError("column daily_checkins.sleep_hours does not exist");
    const mapped = mapDailyRunError(secretish);
    expect(mapped.message).not.toContain("sleep_hours");
    expect(mapped.message).not.toContain("column");
  });
});
