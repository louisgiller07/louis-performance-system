import { describe, expect, it } from "vitest";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { mapCompletedSessionError } from "./completedSessionErrors";

// INT-01 (HPM 2026-10-13) — the debrief's server refusals reach the rider as clear, non-retryable messages; an
// unknown code stays the generic error.
function httpError(status: number, code: string): FunctionsHttpError {
  return new FunctionsHttpError(new Response(JSON.stringify({ error: { code, message: "server text never shown" } }), { status }));
}

describe("mapCompletedSessionError — health guard refusals", () => {
  it.each([
    ["health_suspended", /signal de santé suspend l'entraînement/],
    ["daily_decision_not_current", /relance l'analyse du jour/],
    ["guided_results_exist", /résultats de ta séance guidée sont déjà enregistrés/],
    ["completed_session_v2_exists", /séance guidée/],
  ])("409 %s → its message, no retry", async (code, message) => {
    const mapped = await mapCompletedSessionError(httpError(409, code));
    expect(mapped).toMatchObject({ code, retryable: false, action: "user_fixable" });
    expect(mapped.message).toMatch(message);
    expect(mapped.message).not.toMatch(/server text|Réessaie/);
  });

  it("an unknown code stays the generic, retryable error", async () => {
    expect(await mapCompletedSessionError(httpError(409, "something_new"))).toMatchObject({ code: "something_new", retryable: true, action: "retry" });
  });
});
