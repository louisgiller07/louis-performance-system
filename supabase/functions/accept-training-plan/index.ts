// V0.5_012 — accept-training-plan Edge Function. Exact same architecture as
// abandon-training-plan/index.ts (V0.4_102): withSupabase auth boundary,
// athleteId resolved via the RLS-scoped client, the actual service call made
// through the admin client, errors mapped via a sibling errorMapping.ts. No
// new Edge Function architecture, no new authentication mechanism.
//
// Composes head-coach-engine's already-existing, already-tested
// acceptTrainingPlanVersion() (ADR V0.4_014) — never reimplements accept or
// projection logic, never calls a Supabase RPC directly from this file.
//
// Projection window: acceptTrainingPlanVersion() requires windowStart/
// windowEnd. ADR V0.4_014 explicitly left this undecided ("aucune décision
// sur la taille de la fenêtre glissante... jamais une valeur par défaut
// inventée ici") because no real caller existed yet — this Edge Function is
// that caller. Decision (confirmed with the architect, V0.5_012): reuse
// TRAINING_PLAN_PROJECTION_WINDOW_DAYS (the same env var already governing
// runDailyFor.ts's best-effort pre-compute step, resolveTrainingPlanProjectionWindow)
// when configured; otherwise fall back to a fixed FALLBACK_PROJECTION_WINDOW_DAYS
// — unlike runDailyFor's pre-compute step, projection here is not a pure
// optimization the caller can silently skip: an accepted plan with nothing
// projected onto planned_sessions would be a materially incomplete result
// for this specific endpoint's whole purpose.
//
// `handleAcceptTrainingPlan` is exported separately from the wrapped
// `fetch` purely for testability — withSupabase's own auth wrapping is not
// re-implemented or bypassed for real traffic (the default export below
// still wires it exactly as every other Edge Function does); this only lets
// tests invoke the inner handler directly with a hand-built `ctx`, without
// needing a real JWT/session.
//
// V0.5_014 — `deps.acceptTrainingPlanVersion` (defaulting to the real
// import) replaces the V0.5_012 approach of stubbing the imported ESM
// namespace object directly in tests. That approach (`stub(acceptModule,
// "acceptTrainingPlanVersion", ...)`, V0.5_013 audit) redefines a property
// on a real ESM module namespace object — under strict ESM, named exports
// from a `tsc`-compiled module are non-configurable/non-writable bindings,
// so that stub had a real, concrete risk of throwing `TypeError: Cannot
// redefine property` at runtime, not just "unverified without Deno." A
// plain optional parameter with a default value has no such risk — no
// mutation of any import, no runtime hack, same technique already used
// throughout head-coach-engine (RunDailyForDeps/ProjectTrainingPlanDeps/
// AcceptTrainingPlanVersionDeps). Production behavior is unchanged: the
// default export below never supplies `deps` explicitly, so it always runs
// against the real `acceptTrainingPlanVersion`.
import { withSupabase } from "@supabase/server";
import { acceptTrainingPlanVersion } from "../../../head-coach-engine/dist/supabase/acceptTrainingPlanVersion.js";
import { resolveTrainingPlanProjectionWindow } from "../../../head-coach-engine/dist/supabase/trainingPlanProjectionConfig.js";
import { recordPilotEvent, errorNameOf } from "../../../head-coach-engine/dist/supabase/observability/pilotEvents.js";
import { mapAcceptError } from "./errorMapping.ts";

/** Structural minimum this handler actually uses from withSupabase's real context — not the full, unavailable @supabase/server type (not installed as an npm package in this repo, only resolved via deno.json's npm: specifier at Deno runtime). */
interface AcceptTrainingPlanRequestContext {
  supabase: { from(table: string): { select(columns: string): Promise<{ data: { id: string }[] | null; error: { code?: string; message: string } | null }> } };
  supabaseAdmin: Parameters<typeof acceptTrainingPlanVersion>[0];
}

const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_BODY_KEYS = ["planVersionId"];
/** Used only when TRAINING_PLAN_PROJECTION_WINDOW_DAYS is unset/invalid — see module doc above. */
const FALLBACK_PROJECTION_WINDOW_DAYS = 14;

/** ADR V0.4_015A's own manual UTC date-math discipline (never `new Date(isoString)`), same as runDailyFor.ts's local addDays — this file has no import path back to that non-exported helper. */
function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const shifted = new Date(Date.UTC(year as number, (month as number) - 1, (day as number) + days));
  const yyyy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

/**
 * Injectable seam — same reasoning as head-coach-engine's own
 * RunDailyForDeps/ProjectTrainingPlanDeps/AcceptTrainingPlanVersionDeps: a
 * plain object defaulting to the real implementation, letting tests supply
 * a fake `acceptTrainingPlanVersion` and inspect its call arguments/control
 * its result, without mutating any import binding. No DI framework.
 */
export interface HandleAcceptTrainingPlanDeps {
  acceptTrainingPlanVersion: typeof acceptTrainingPlanVersion;
}

const DEFAULT_DEPS: HandleAcceptTrainingPlanDeps = { acceptTrainingPlanVersion };

export async function handleAcceptTrainingPlan(
  req: Request,
  ctx: AcceptTrainingPlanRequestContext,
  deps: HandleAcceptTrainingPlanDeps = DEFAULT_DEPS
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

  const planVersionIdValue = (body as Record<string, unknown>).planVersionId;
  if (typeof planVersionIdValue !== "string" || !UUID_FORMAT.test(planVersionIdValue)) {
    return errorResponse(400, "invalid_request", "planVersionId is required and must be a valid UUID.");
  }

  // Athlete resolution goes through the RLS-scoped `ctx.supabase` client,
  // never `ctx.supabaseAdmin` — same reasoning as every other Edge Function
  // in this project: prove the caller's athlete is resolved via RLS, never
  // a client-supplied id (planVersionId's own ownership is re-verified by
  // the RPC itself regardless — defense in depth, never relied on alone).
  const { data: athletes, error: athleteError } = await ctx.supabase.from("athletes").select("id");

  if (athleteError) {
    console.error(`accept-training-plan: athlete resolution failed [${athleteError.code}]`);
    return errorResponse(500, "internal_error", "Failed to resolve athlete for the authenticated user.");
  }

  if (!athletes || athletes.length === 0) {
    return errorResponse(403, "no_athlete_for_user", "No athlete record exists for the authenticated user.");
  }

  if (athletes.length > 1) {
    // Defensive: athletes.user_id is UNIQUE, so this should be
    // unreachable. Refuse to arbitrarily pick a row rather than silently
    // proceeding with the wrong athlete.
    console.error("accept-training-plan: multiple athletes resolved for a single user; refusing to pick one");
    return errorResponse(500, "internal_error", "Ambiguous athlete resolution for the authenticated user.");
  }

  const athleteId = athletes[0].id as string;

  const projectionConfig = resolveTrainingPlanProjectionWindow();
  const windowDays = projectionConfig.enabled ? projectionConfig.windowDays : FALLBACK_PROJECTION_WINDOW_DAYS;
  const windowStart = todayUtc();
  const windowEnd = addDays(windowStart, windowDays);

  try {
    // ctx.supabaseAdmin only — athleteId came exclusively from the
    // RLS-scoped ctx.supabase query above, never from client input.
    const outcome = await deps.acceptTrainingPlanVersion(ctx.supabaseAdmin, athleteId, planVersionIdValue, windowStart, windowEnd);

    await recordPilotEvent(ctx.supabaseAdmin, {
      eventType: "plan_acceptance_succeeded",
      athleteId,
      planVersionId: outcome.acceptance.planVersionId,
      idempotentReplay: outcome.acceptance.idempotentReplay,
      ...(outcome.projection
        ? {
            projectedSessionCount: outcome.projection.plannedSessions.filter((s) => s.outcome === "projected").length,
            trainingBlockOutcome: outcome.projection.trainingBlock.outcome,
          }
        : {}),
    });
    if (outcome.warnings.length > 0) {
      await recordPilotEvent(ctx.supabaseAdmin, {
        eventType: "plan_acceptance_projection_warning",
        athleteId,
        planVersionId: outcome.acceptance.planVersionId,
        warnings: outcome.warnings,
      });
    }

    return Response.json(
      {
        planVersionId: outcome.acceptance.planVersionId,
        idempotentReplay: outcome.acceptance.idempotentReplay,
        warnings: outcome.warnings,
      },
      { status: 200 }
    );
  } catch (error) {
    const mapped = mapAcceptError(error);
    console.error(`accept-training-plan: acceptTrainingPlanVersion failed [${error instanceof Error ? error.name : typeof error}] -> ${mapped.code}`);
    await recordPilotEvent(ctx.supabaseAdmin, {
      eventType: "plan_acceptance_failed",
      athleteId,
      planVersionId: planVersionIdValue,
      errorName: errorNameOf(error),
      errorCode: mapped.code,
    });
    return errorResponse(mapped.status, mapped.code, mapped.message);
  }
}

export default {
  fetch: withSupabase({ auth: "user" }, handleAcceptTrainingPlan),
};
