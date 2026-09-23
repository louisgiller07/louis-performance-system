// V0.5_012/V0.5_014 — Deno tests for accept-training-plan.
//
// IMPORTANT — NOT EXECUTED IN THIS SESSION: this Edge Function runs on Deno
// (deno.json resolves "@supabase/server" via an "npm:" import-map specifier,
// never installed as an actual npm package anywhere in this repo's
// node_modules) and Deno itself is not installed in this environment ("deno"
// command not found). Vitest/Node cannot import index.ts at all — the bare
// "@supabase/server" specifier fails module resolution outside Deno. No
// Edge Function in this repo (daily-run, completed-session,
// abandon-training-plan, refresh-longitudinal, get-insights, submit-review)
// has ever had a test file before this one — this is a genuine, pre-existing
// gap in this project's tooling, not something specific to this ticket.
// This file is written to be correct, idiomatic Deno test code, but it has
// NOT been run or type-checked here. Verify with `deno test` /
// `deno check index.test.ts` as soon as Deno is available (local machine or
// CI), before relying on it.
//
// V0.5_014 — the 3 tests that previously stubbed the imported ESM namespace
// object (`stub(acceptModule, "acceptTrainingPlanVersion", ...)`) now pass a
// plain fake function through `handleAcceptTrainingPlan`'s own injectable
// `deps` parameter instead. No import binding is mutated anywhere in this
// file — this removes the "TypeError: Cannot redefine property" risk the
// V0.5_013 audit identified (real ESM named-export bindings from a
// `tsc`-compiled module are non-configurable), not just works around it.
// No mock framework: each fake is a closure that records its own call
// arguments in a plain local variable.
import { assertEquals, assertObjectMatch } from "jsr:@std/assert";
import { handleAcceptTrainingPlan, type HandleAcceptTrainingPlanDeps } from "./index.ts";
import { AcceptTrainingPlanVersionRpcError } from "../../../head-coach-engine/dist/supabase/acceptTrainingPlanVersionRpc.js";
import type { AcceptTrainingPlanVersionOutcome } from "../../../head-coach-engine/dist/supabase/acceptTrainingPlanVersion.js";

const VALID_PLAN_VERSION_ID = "11111111-1111-4111-8111-111111111111";
const ATHLETE_ID = "athlete-1";

function jsonRequest(body: unknown, method = "POST"): Request {
  return new Request("http://localhost/accept-training-plan", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function ctxWithAthletes(athleteRows: { id: string }[] | null, athleteError: { code?: string; message: string } | null = null) {
  return {
    supabase: {
      from: (_table: string) => ({
        select: async (_columns: string) => ({ data: athleteRows, error: athleteError }),
      }),
    },
    // Never actually dereferenced in these tests — acceptTrainingPlanVersion
    // itself is replaced via `deps`, so any placeholder value is fine here;
    // only its identity (not its shape) matters.
    supabaseAdmin: {} as never,
  };
}

/** Records every call's (client, athleteId, planVersionId, windowStart, windowEnd) — a plain closure, no mock framework. */
function fakeAcceptDeps(
  impl: (...args: Parameters<HandleAcceptTrainingPlanDeps["acceptTrainingPlanVersion"]>) => ReturnType<HandleAcceptTrainingPlanDeps["acceptTrainingPlanVersion"]>
): { deps: HandleAcceptTrainingPlanDeps; calls: Parameters<HandleAcceptTrainingPlanDeps["acceptTrainingPlanVersion"]>[] } {
  const calls: Parameters<HandleAcceptTrainingPlanDeps["acceptTrainingPlanVersion"]>[] = [];
  return {
    calls,
    deps: {
      acceptTrainingPlanVersion: (...args) => {
        calls.push(args);
        return impl(...args);
      },
    },
  };
}

Deno.test("rejects a non-POST method with 405", async () => {
  const res = await handleAcceptTrainingPlan(jsonRequest({ planVersionId: VALID_PLAN_VERSION_ID }, "GET"), ctxWithAthletes([{ id: ATHLETE_ID }]));
  assertEquals(res.status, 405);
});

Deno.test("rejects a body containing an unknown key (e.g. athleteId supplied by the client) with 400 — proves athleteId can never come from the body", async () => {
  const res = await handleAcceptTrainingPlan(
    jsonRequest({ planVersionId: VALID_PLAN_VERSION_ID, athleteId: "attacker-supplied-id" }),
    ctxWithAthletes([{ id: ATHLETE_ID }])
  );
  assertEquals(res.status, 400);
  const payload = await res.json();
  assertEquals(payload.error.code, "invalid_request");
});

Deno.test("rejects a missing planVersionId with 400", async () => {
  const res = await handleAcceptTrainingPlan(jsonRequest({}), ctxWithAthletes([{ id: ATHLETE_ID }]));
  assertEquals(res.status, 400);
});

Deno.test("rejects a malformed (non-UUID) planVersionId with 400", async () => {
  const res = await handleAcceptTrainingPlan(jsonRequest({ planVersionId: "not-a-uuid" }), ctxWithAthletes([{ id: ATHLETE_ID }]));
  assertEquals(res.status, 400);
});

Deno.test("resolves no athlete for the authenticated user -> 403, never calls acceptTrainingPlanVersion", async () => {
  const { deps, calls } = fakeAcceptDeps(() => {
    throw new Error("must never be called");
  });

  const res = await handleAcceptTrainingPlan(jsonRequest({ planVersionId: VALID_PLAN_VERSION_ID }), ctxWithAthletes([]), deps);

  assertEquals(res.status, 403);
  assertEquals(calls.length, 0);
});

Deno.test("a valid payload calls acceptTrainingPlanVersion with the RLS-resolved athleteId and the exact planVersionId from the body", async () => {
  const outcome: AcceptTrainingPlanVersionOutcome = {
    acceptance: { planVersionId: VALID_PLAN_VERSION_ID, idempotentReplay: false, acceptedTransitionId: "transition-1" },
    projection: undefined,
    warnings: [],
  };
  const { deps, calls } = fakeAcceptDeps(async () => outcome);

  const res = await handleAcceptTrainingPlan(jsonRequest({ planVersionId: VALID_PLAN_VERSION_ID }), ctxWithAthletes([{ id: ATHLETE_ID }]), deps);

  assertEquals(res.status, 200);
  assertEquals(calls.length, 1);
  // args: (client, athleteId, planVersionId, windowStart, windowEnd)
  assertEquals(calls[0][1], ATHLETE_ID);
  assertEquals(calls[0][2], VALID_PLAN_VERSION_ID);

  const payload = await res.json();
  assertObjectMatch(payload, { planVersionId: VALID_PLAN_VERSION_ID, idempotentReplay: false });
});

Deno.test("maps AcceptTrainingPlanVersionRpcError (business rejection) to 409", async () => {
  const { deps } = fakeAcceptDeps(async () => {
    throw new AcceptTrainingPlanVersionRpcError("plan_version_id is not in draft state");
  });

  const res = await handleAcceptTrainingPlan(jsonRequest({ planVersionId: VALID_PLAN_VERSION_ID }), ctxWithAthletes([{ id: ATHLETE_ID }]), deps);

  assertEquals(res.status, 409);
  const payload = await res.json();
  assertEquals(payload.error.code, "accept_rejected");
});

Deno.test("maps an unknown/unforeseen error to 500 — never a silent success", async () => {
  const { deps } = fakeAcceptDeps(async () => {
    throw new Error("unexpected");
  });

  const res = await handleAcceptTrainingPlan(jsonRequest({ planVersionId: VALID_PLAN_VERSION_ID }), ctxWithAthletes([{ id: ATHLETE_ID }]), deps);

  assertEquals(res.status, 500);
  const payload = await res.json();
  assertEquals(payload.error.code, "internal_error");
});

// Auth — exercises the real, wrapped `fetch` export (withSupabase itself),
// not `handleAcceptTrainingPlan` directly, since unauthenticated rejection
// is withSupabase's own responsibility, never reimplemented in this file.
// No custom 401 code exists anywhere in this codebase's Edge Functions
// (confirmed by reading daily-run/completed-session/abandon-training-plan)
// — this test documents the expected, relied-upon behavior of the shared
// wrapper rather than a status code this file itself decides. Unaffected by
// the V0.5_014 deps refactor: the default export never supplies `deps`, so
// this still exercises the real acceptTrainingPlanVersion import path
// (never reached here, since withSupabase is expected to reject first).
Deno.test("an unauthenticated request is rejected before handleAcceptTrainingPlan ever runs (withSupabase's own behavior)", async () => {
  const mod = await import("./index.ts");
  const res = await mod.default.fetch(jsonRequest({ planVersionId: VALID_PLAN_VERSION_ID }));
  assertEquals(res.status, 401);
});
