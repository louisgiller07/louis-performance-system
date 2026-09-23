// V0.5_023 — generate-training-plan Edge Function. Same architecture as
// accept-training-plan/index.ts (V0.5_012/014) and abandon-training-plan/
// index.ts (V0.4_102): withSupabase auth boundary, athleteId resolved via
// the RLS-scoped client, the actual service call made through the admin
// client, errors mapped via a sibling errorMapping.ts. No new Edge Function
// architecture, no new authentication mechanism.
//
// Composes head-coach-engine's already-existing, already-tested
// generateAndPersistTrainingPlan() (V0.5_010) — never reimplements
// buildPlanInputSnapshot/runGenerationEngine/persistence logic, never mints
// generationRequestId or athleteId, never calls a Supabase RPC directly from
// this file, never builds an inputSnapshot itself.
//
// `handleGenerateTrainingPlan` is exported separately from the wrapped
// `fetch` purely for testability — withSupabase's own auth wrapping is not
// re-implemented or bypassed for real traffic; this only lets tests invoke
// the inner handler directly with a hand-built `ctx`/`deps`, without needing
// a real JWT/session or mutating any ESM import binding (V0.5_014 fix,
// applied here from the start rather than retrofitted).
import { withSupabase } from "@supabase/server";
import { generateAndPersistTrainingPlan } from "../../../head-coach-engine/dist/supabase/generateAndPersistTrainingPlan.js";
import { parseTrainingMode, InvalidTrainingModeError } from "../../../head-coach-engine/dist/supabase/mapping/trainingMode.js";
import { mapGenerateTrainingPlanError } from "./errorMapping.ts";

/** Structural minimum this handler actually uses from withSupabase's real context — not the full, unavailable @supabase/server type (not installed as an npm package in this repo, only resolved via deno.json's npm: specifier at Deno runtime). */
interface GenerateTrainingPlanRequestContext {
  supabase: { from(table: string): { select(columns: string): Promise<{ data: { id: string }[] | null; error: { code?: string; message: string } | null }> } };
  supabaseAdmin: Parameters<typeof generateAndPersistTrainingPlan>[0]["client"];
}

const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_BODY_KEYS = ["generationRequestId", "block"];
const ALLOWED_BLOCK_KEYS = ["sequenceNumber", "name", "mode", "primaryFocus", "startDate", "endDate"];
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

function isValidCalendarDate(value: string): boolean {
  if (!DATE_FORMAT.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  // Round-trip through Date.UTC to reject roll-over dates (e.g. 2026-02-30
  // would silently become 2026-03-02 if we trusted the constructor alone) —
  // same discipline as daily-run/index.ts's own isValidCalendarDate.
  const date = new Date(Date.UTC(year as number, (month as number) - 1, day as number));
  return date.getUTCFullYear() === year && date.getUTCMonth() === (month as number) - 1 && date.getUTCDate() === day;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

/**
 * Structural validation only — presence, types, UUID format, calendar date
 * format, a recognized TrainingMode. Deliberately never validates
 * availability/performance profile/discipline/equipment/exercise
 * compatibility — that belongs to buildPlanInputSnapshot()/planning-engine
 * (GenerationBlockedError/PlanningEngineValidationError), never duplicated
 * here (ticket-locked scope).
 */
function validateBlock(value: unknown): { ok: true; block: Parameters<typeof generateAndPersistTrainingPlan>[0]["block"] } | { ok: false; message: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, message: "block is required and must be a JSON object." };
  }
  const body = value as Record<string, unknown>;

  const unknownKeys = Object.keys(body).filter((key) => !ALLOWED_BLOCK_KEYS.includes(key));
  if (unknownKeys.length > 0) {
    return { ok: false, message: `block has unknown propert${unknownKeys.length === 1 ? "y" : "ies"}: ${unknownKeys.join(", ")}.` };
  }

  if (typeof body.sequenceNumber !== "number" || !Number.isInteger(body.sequenceNumber) || body.sequenceNumber < 1) {
    return { ok: false, message: "block.sequenceNumber is required and must be a positive integer." };
  }
  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    return { ok: false, message: "block.name is required and must not be blank." };
  }
  if (typeof body.primaryFocus !== "string" || body.primaryFocus.trim().length === 0) {
    return { ok: false, message: "block.primaryFocus is required and must not be blank." };
  }
  if (typeof body.startDate !== "string" || !isValidCalendarDate(body.startDate)) {
    return { ok: false, message: "block.startDate is required and must be a valid calendar date in YYYY-MM-DD format." };
  }
  if (typeof body.endDate !== "string" || !isValidCalendarDate(body.endDate)) {
    return { ok: false, message: "block.endDate is required and must be a valid calendar date in YYYY-MM-DD format." };
  }

  let mode: ReturnType<typeof parseTrainingMode>;
  try {
    mode = parseTrainingMode(body.mode);
  } catch (err) {
    if (err instanceof InvalidTrainingModeError) {
      return { ok: false, message: "block.mode is required and must be a recognized training mode." };
    }
    throw err;
  }

  return {
    ok: true,
    block: {
      sequenceNumber: body.sequenceNumber,
      name: body.name,
      mode,
      primaryFocus: body.primaryFocus,
      startDate: body.startDate,
      endDate: body.endDate,
    },
  };
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

  const blockResult = validateBlock((body as Record<string, unknown>).block);
  if (!blockResult.ok) {
    return errorResponse(400, "invalid_request", blockResult.message);
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
    // client.
    const result = await deps.generateAndPersistTrainingPlan({
      client: ctx.supabaseAdmin,
      athleteId,
      generationRequestId: generationRequestIdValue,
      block: blockResult.block,
      today: todayUtc(),
    });

    // Deliberately minimal — never inputSnapshot, catalogVersion, or full
    // prescriptions: those are internal generation details, never part of
    // this endpoint's response contract (V0.5_011/022 lock).
    return Response.json({ planVersionId: result.planVersionId, idempotentReplay: result.idempotentReplay }, { status: 200 });
  } catch (error) {
    const mapped = mapGenerateTrainingPlanError(error);
    console.error(`generate-training-plan: generateAndPersistTrainingPlan failed [${error instanceof Error ? error.name : typeof error}] -> ${mapped.code}`);
    return errorResponse(mapped.status, mapped.code, mapped.message);
  }
}

export default {
  fetch: withSupabase({ auth: "user" }, handleGenerateTrainingPlan),
};
