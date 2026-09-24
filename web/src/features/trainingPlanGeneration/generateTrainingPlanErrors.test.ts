import { describe, expect, it } from "vitest";
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";
import { mapGenerateTrainingPlanError } from "./generateTrainingPlanErrors";

function httpError(status: number, body: unknown): FunctionsHttpError {
  const response = new Response(JSON.stringify(body), { status });
  return new FunctionsHttpError(response);
}

describe("mapGenerateTrainingPlanError", () => {
  it("parses the canonical {error:{code,message}} body from a FunctionsHttpError", async () => {
    const mapped = await mapGenerateTrainingPlanError(httpError(422, { error: { code: "missing_availability", message: "No availability." } }));
    expect(mapped.code).toBe("missing_availability");
  });

  // The 4 canonical GenerationBlockedError reasons from
  // supabase/functions/generate-training-plan/errorMapping.ts, plus the two
  // PILOT_015 catalogue outcomes — every one must map to a user-fixable,
  // non-retryable, UX-exploitable error, never "Erreur serveur".
  it.each([
    ["missing_availability", "Ajoute au moins un jour de disponibilité."],
    ["missing_performance_profile", "Complète et enregistre ton profil de performance."],
    ["missing_discipline", "Sélectionne ta discipline."],
    ["missing_strength_experience_tier", "Indique ton expérience en préparation physique."],
    ["no_compatible_drill", /Choisis une autre priorité pour ce plan/],
    ["no_compatible_exercise", /Ajoute le matériel dont tu disposes/],
  ])("maps GenerationBlockedError reason %s to a user-fixable error with an exploitable message", async (reason, expectedMessage) => {
    const mapped = await mapGenerateTrainingPlanError(httpError(422, { error: { code: reason, message: "ignored" } }));
    expect(mapped.code).toBe(reason);
    expect(mapped.action).toBe("user_fixable");
    expect(mapped.retryable).toBe(false);
    expect(mapped.message).toMatch(expectedMessage);
  });

  it("maps an unrecognized 422 reason to a safe generic user-fixable message, never a crash", async () => {
    const mapped = await mapGenerateTrainingPlanError(httpError(422, { error: { code: "some_future_reason" } }));
    expect(mapped.action).toBe("user_fixable");
    expect(mapped.retryable).toBe(false);
    expect(mapped.message).toMatch(/configuration/i);
  });

  it("maps no_athlete_for_user (403) to a config_issue", async () => {
    const mapped = await mapGenerateTrainingPlanError(httpError(403, { error: { code: "no_athlete_for_user" } }));
    expect(mapped.action).toBe("config_issue");
    expect(mapped.retryable).toBe(false);
  });

  it("maps internal_error (500) to a generic retryable error", async () => {
    const mapped = await mapGenerateTrainingPlanError(httpError(500, { error: { code: "internal_error" } }));
    expect(mapped.retryable).toBe(true);
    expect(mapped.action).toBe("retry");
    expect(mapped.message).toBe("La génération du plan a rencontré une erreur. Réessaie ou contacte le support si le problème continue.");
  });

  it("maps invalid_request (400) to a non-retryable generic error", async () => {
    const mapped = await mapGenerateTrainingPlanError(httpError(400, { error: { code: "invalid_request" } }));
    expect(mapped.retryable).toBe(false);
    expect(mapped.action).toBe("generic");
  });

  it("maps any 401 to a session_issue, regardless of body shape (gateway body is flat {code,message})", async () => {
    const mapped = await mapGenerateTrainingPlanError(httpError(401, { code: "UNAUTHORIZED_NO_AUTH_HEADER", message: "Missing authorization header" }));
    expect(mapped.action).toBe("session_issue");
    expect(mapped.retryable).toBe(false);
  });

  it("never exposes a raw SQL/backend message — only the canonical mapped message", async () => {
    const mapped = await mapGenerateTrainingPlanError(
      httpError(500, { error: { code: "internal_error", message: "relation \"training_plan_blocks\" does not exist" } })
    );
    expect(mapped.message).not.toMatch(/relation|training_plan_blocks/i);
  });

  it("maps FunctionsRelayError to a retryable network error", async () => {
    const error = new FunctionsRelayError(new Response(null, { status: 502 }));
    const mapped = await mapGenerateTrainingPlanError(error);
    expect(mapped.code).toBe("network_error");
    expect(mapped.retryable).toBe(true);
    expect(mapped.action).toBe("retry");
  });

  it("maps FunctionsFetchError to a retryable network error", async () => {
    const error = new FunctionsFetchError(new TypeError("Failed to fetch"));
    const mapped = await mapGenerateTrainingPlanError(error);
    expect(mapped.code).toBe("network_error");
    expect(mapped.retryable).toBe(true);
    expect(mapped.action).toBe("retry");
  });

  it("falls back to a generic retryable error for an unrecognized exception", async () => {
    const mapped = await mapGenerateTrainingPlanError(new Error("something unexpected"));
    expect(mapped.code).toBe("unknown_error");
    expect(mapped.retryable).toBe(true);
  });
});
