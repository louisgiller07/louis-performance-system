// V0.5_023 — generate-training-plan Edge Function. Same architecture as
// accept-training-plan/index.ts (V0.5_012/014) and abandon-training-plan/
// index.ts (V0.4_102): withSupabase auth boundary, athleteId resolved via
// the RLS-scoped client, the actual service call made through the admin
// client, errors mapped via a sibling errorMapping.ts. No new Edge Function
// architecture, no new authentication mechanism.
//
// Composes head-coach-engine's already-existing, already-tested
// generateAndPersistTrainingPlan() (V0.5_010, contract minimized V0.5_032) —
// never reimplements buildPlanInputSnapshot/runGenerationEngine/persistence
// logic, never mints generationRequestId or athleteId, never calls a
// Supabase RPC directly from this file, never builds an inputSnapshot
// itself, never constructs a TrainingPlanBlock itself (V0.5_031 lock: block
// construction belongs to generateAndPersistTrainingPlan, not the HTTP
// boundary).
//
// `handleGenerateTrainingPlan` is exported separately from the wrapped
// `fetch` purely for testability — withSupabase's own auth wrapping is not
// re-implemented or bypassed for real traffic; this only lets tests invoke
// the inner handler directly with a hand-built `ctx`/`deps`, without needing
// a real JWT/session or mutating any ESM import binding (V0.5_014 fix,
// applied here from the start rather than retrofitted).
import { withSupabase } from "@supabase/server";
import { generateAndPersistTrainingPlan } from "../../../head-coach-engine/dist/edge/generateTrainingPlan.bundle.js";
import { recordPilotEvent, errorNameOf } from "../../../head-coach-engine/dist/supabase/observability/pilotEvents.js";
import { mapGenerateTrainingPlanError } from "./errorMapping.ts";

/** Structural minimum this handler actually uses from withSupabase's real context — not the full, unavailable @supabase/server type (not installed as an npm package in this repo, only resolved via deno.json's npm: specifier at Deno runtime). */
interface GenerateTrainingPlanRequestContext {
  supabase: { from(table: string): { select(columns: string): Promise<{ data: { id: string }[] | null; error: { code?: string; message: string } | null }> } };
  supabaseAdmin: Parameters<typeof generateAndPersistTrainingPlan>[0]["client"];
}

const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// V0.5_031 lock: the minimal user-intent contract — generationRequestId +
// durationWeeks only. block/sequenceNumber/name/mode/primaryFocus/startDate/
// endDate are never accepted from the client anymore.
const ALLOWED_BODY_KEYS = ["generationRequestId", "durationWeeks"];

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

/**
 * Structural validation only — presence, type, and the one bound V0.5_031
 * found actually derivable from the code (`durationWeeks >= 1`; below that,
 * WeekSequenceBuilder produces an empty week sequence). No upper bound is
 * validated here — none is locked yet (V0.5_031 §2: "décision produit
 * encore nécessaire"), so none is invented.
 */
function validateDurationWeeks(value: unknown): { ok: true; durationWeeks: number } | { ok: false; message: string } {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return { ok: false, message: "durationWeeks is required and must be a positive integer." };
  }
  return { ok: true, durationWeeks: value };
}

/**
 * Injectable seam — same reasoning as head-coach-engine's own
 * RunDailyForDeps/AcceptTrainingPlanVersionDeps and, in this same Edge
 * Function family, accept-training-plan/index.ts's HandleAcceptTrainingPlanDeps
 * (V0.5_014 fix): a plain object defaulting to the real implementation,
 * letting tests supply a fake `generateAndPersistTrainingPlan` and inspect
 * its call arguments/control its result, without mutating any import
 * binding — never an ESM namespace stub.
 */
export interface HandleGenerateTrainingPlanDeps {
  generateAndPersistTrainingPlan: typeof generateAndPersistTrainingPlan;
}

const DEFAULT_DEPS: HandleGenerateTrainingPlanDeps = { generateAndPersistTrainingPlan };

export async function handleGenerateTrainingPlan(
  req: Request,
  ctx: GenerateTrainingPlanRequestContext,
  deps: HandleGenerateTrainingPlanDeps = DEFAULT_DEPS
): Promise<Response> {
  if (req.method !== "POST") {
    return Response.json(
      { error: { code: "method_not_allowed", message: "Only POST is supported on this endpoint." } },
      { status: 405, headers: { Allow: "POST" } }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "invalid_request", "Request body must be valid JSON.");
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return errorResponse(400, "invalid_request", "Request body must be a JSON object.");
  }

  const bodyKeys = Object.keys(body as Record<string, unknown>);
  const unknownKeys = bodyKeys.filter((key) => !ALLOWED_BODY_KEYS.includes(key));
  if (unknownKeys.length > 0) {
    return errorResponse(
      400,
      "invalid_request",
      `Unknown propert${unknownKeys.length === 1 ? "y" : "ies"}: ${unknownKeys.join(", ")}.`
    );
  }

  const generationRequestIdValue = (body as Record<string, unknown>).generationRequestId;
  if (typeof generationRequestIdValue !== "string" || !UUID_FORMAT.test(generationRequestIdValue)) {
    return errorResponse(400, "invalid_request", "generationRequestId is required and must be a valid UUID.");
  }

  const durationWeeksResult = validateDurationWeeks((body as Record<string, unknown>).durationWeeks);
  if (!durationWeeksResult.ok) {
    return errorResponse(400, "invalid_request", durationWeeksResult.message);
  }

  // Athlete resolution goes through the RLS-scoped `ctx.supabase` client,
  // never `ctx.supabaseAdmin` — same reasoning as every other Edge Function
  // in this project: prove the caller's athlete is resolved via RLS, never
  // a client-supplied id.
  const { data: athletes, error: athleteError } = await ctx.supabase.from("athletes").select("id");

  if (athleteError) {
    console.error(`generate-training-plan: athlete resolution failed [${athleteError.code}]`);
    return errorResponse(500, "internal_error", "Failed to resolve athlete for the authenticated user.");
  }

  if (!athletes || athletes.length === 0) {
    return errorResponse(403, "no_athlete_for_user", "No athlete record exists for the authenticated user.");
  }

  if (athletes.length > 1) {
    // Defensive: athletes.user_id is UNIQUE, so this should be
    // unreachable. Refuse to arbitrarily pick a row rather than silently
    // proceeding with the wrong athlete.
    console.error("generate-training-plan: multiple athletes resolved for a single user; refusing to pick one");
    return errorResponse(500, "internal_error", "Ambiguous athlete resolution for the authenticated user.");
  }

  const athleteId = athletes[0].id as string;

  try {
    // ctx.supabaseAdmin only — athleteId came exclusively from the
    // RLS-scoped ctx.supabase query above, never from client input.
    // generationRequestId is transmitted exactly as received — never
    // minted here. today is the server clock — never accepted from the
    // client. The TrainingPlanBlock itself is constructed inside
    // generateAndPersistTrainingPlan from durationWeeks + today
    // (V0.5_031/032 lock) — never built in this file.
    const result = await deps.generateAndPersistTrainingPlan({
      client: ctx.supabaseAdmin,
      athleteId,
      generationRequestId: generationRequestIdValue,
      durationWeeks: durationWeeksResult.durationWeeks,
      today: todayUtc(),
    });

    await recordPilotEvent(ctx.supabaseAdmin, {
      eventType: "plan_generation_succeeded",
      athleteId,
      planVersionId: result.planVersionId,
      generationRequestId: generationRequestIdValue,
      idempotentReplay: result.idempotentReplay,
      durationWeeks: durationWeeksResult.durationWeeks,
    });

    // Deliberately minimal — never inputSnapshot, catalogVersion, or full
    // prescriptions: those are internal generation details, never part of
    // this endpoint's response contract (V0.5_011/022 lock).
    return Response.json({ planVersionId: result.planVersionId, idempotentReplay: result.idempotentReplay }, { status: 200 });
  } catch (error) {
    const mapped = mapGenerateTrainingPlanError(error);
    console.error(`generate-training-plan: generateAndPersistTrainingPlan failed [${error instanceof Error ? error.name : typeof error}] -> ${mapped.code}`);
    // mapGenerateTrainingPlanError returns 422 only for GenerationBlockedError (code = blockedReason).
    await recordPilotEvent(
      ctx.supabaseAdmin,
      mapped.status === 422
        ? { eventType: "plan_generation_blocked", athleteId, generationRequestId: generationRequestIdValue, blockedReason: mapped.code }
        : { eventType: "plan_generation_failed", athleteId, generationRequestId: generationRequestIdValue, errorName: errorNameOf(error), errorCode: mapped.code }
    );
    return errorResponse(mapped.status, mapped.code, mapped.message);
  }
}

export default {
  fetch: withSupabase({ auth: "user" }, handleGenerateTrainingPlan),
};
