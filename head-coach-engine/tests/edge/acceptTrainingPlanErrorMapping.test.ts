// UX-11R.9 (F-4) — unit tests for supabase/functions/accept-training-plan/errorMapping.ts
// and the SQLSTATE carried by AcceptTrainingPlanVersionRpcError. Pure, no DB/network.
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mapAcceptError } from "../../../supabase/functions/accept-training-plan/errorMapping.js";
import {
  acceptTrainingPlanVersionRpc,
  AcceptTrainingPlanVersionRpcError,
  InvalidAcceptTrainingPlanVersionResultError,
  STALE_PLAN_VERSION_SQLSTATE,
} from "../../dist/supabase/acceptTrainingPlanVersionRpc.js";

function clientFailingWith(error: { message: string; code?: string }): SupabaseClient {
  return { rpc: async () => ({ data: null, error }) } as unknown as SupabaseClient;
}

describe("mapAcceptError (UX-11R.9)", () => {
  it("maps the stale-plan SQLSTATE (NX102) to 409 stale_plan_version, by code only", () => {
    expect(STALE_PLAN_VERSION_SQLSTATE).toBe("NX102");
    const mapped = mapAcceptError(new AcceptTrainingPlanVersionRpcError("anything at all", "NX102"));
    expect(mapped.status).toBe(409);
    expect(mapped.code).toBe("stale_plan_version");
  });

  it("never classifies by message text: the words 'stale_plan_version' without the SQLSTATE stay accept_rejected", () => {
    expect(mapAcceptError(new AcceptTrainingPlanVersionRpcError("stale_plan_version", "P0001")).code).toBe("accept_rejected");
    expect(mapAcceptError(new AcceptTrainingPlanVersionRpcError("stale_plan_version")).code).toBe("accept_rejected");
  });

  it("keeps the existing mapping for every other failure", () => {
    expect(mapAcceptError(new AcceptTrainingPlanVersionRpcError("not in draft state", "P0001"))).toMatchObject({ status: 409, code: "accept_rejected" });
    expect(mapAcceptError(new InvalidAcceptTrainingPlanVersionResultError("bad", null))).toMatchObject({ status: 500, code: "internal_error" });
    expect(mapAcceptError(new Error("boom"))).toMatchObject({ status: 500, code: "internal_error" });
  });
});

describe("acceptTrainingPlanVersionRpc carries the SQLSTATE (UX-11R.9)", () => {
  it("copies the PostgREST error code onto the thrown error", async () => {
    await expect(acceptTrainingPlanVersionRpc(clientFailingWith({ message: "stale_plan_version", code: "NX102" }), "a", "p")).rejects.toMatchObject({
      name: "AcceptTrainingPlanVersionRpcError",
      code: "NX102",
    });
  });

  it("no code → null (never derived from the message)", async () => {
    await expect(acceptTrainingPlanVersionRpc(clientFailingWith({ message: "stale_plan_version" }), "a", "p")).rejects.toMatchObject({ code: null });
  });
});
