/**
 * P0-SAFE (HPM 2026-10-12) — explicit, rider-initiated closure of an open health signal.
 *
 * SAFETY A7 keeps protecting the days after an injury / illness / persistent-pain signal until the
 * rider closes it; this is the only closing path. It is NOT a medical validation: the rider declares
 * that the pain or the symptoms are gone (and, optionally, that a health professional was consulted),
 * NALYNT records that declaration and never claims anything more.
 *
 * Audit: the existing `health_flags` row keeps its declaration (date, type, description) and receives
 * the closure (status `resolved`, `resolved_at`, `resolution_note`, `professional_consulted`,
 * `updated_at` by trigger). The update is conditional on the row still being open, so a double tap
 * or two devices can never close twice or reopen anything. No migration: every column already exists.
 *
 * A concussion signal is never closed here (A5: medical validation required, V0.3_006A2 still deferred).
 * Service-role client only; `athleteId` must come from the caller's RLS-scoped resolution, never from input.
 *
 * Self-contained on purpose (no head-coach-engine/dist import): pure TypeScript, no Deno API, so the
 * function adds no bind mount to `functions serve` (Windows ENAMETOOLONG limit) and the module is
 * tested under Node (vitest) by head-coach-engine/tests/supabase/p0SafeHealthContinuity.integration.test.ts.
 */

// deno-lint-ignore no-explicit-any
type ServiceClient = { from: (table: string) => any };

/** Current calendar date (`YYYY-MM-DD`) in Europe/Zurich — same rule as head-coach-engine productToday(). */
export function zurichToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  const [year, month, day] = [part("year"), part("month"), part("day")];
  if (!year || !month || !day) throw new Error("zurichToday: failed to compute the current Europe/Zurich calendar date.");
  return `${year}-${month}-${day}`;
}

export type ResolveHealthFlagOutcome =
  | { status: "resolved"; flagId: string; flagType: string; resolvedAt: string }
  | { status: "not_found" }
  | { status: "already_resolved" }
  | { status: "medical_validation_required" };

export class HealthFlagResolutionError extends Error {
  constructor(detail: string) {
    super(`health flag resolution failed: ${detail}`);
    this.name = "HealthFlagResolutionError";
  }
}

const OPEN_STATUSES = ["active", "monitoring"] as const;

export function healthFlagResolutionNote(resolvedAt: string, professionalConsulted: boolean): string {
  return (
    `Clôturé par le rider dans l'application le ${resolvedAt} : plus de douleur ni de symptôme déclarés` +
    (professionalConsulted ? " ; professionnel de santé consulté (déclaré)" : "") +
    ". Aucune validation médicale par NALYNT."
  );
}

export async function resolveHealthFlag(
  serviceClient: ServiceClient,
  athleteId: string,
  flagId: string,
  input: { professionalConsulted: boolean; resolvedAt: string }
): Promise<ResolveHealthFlagOutcome> {
  const { data: row, error: readError } = await serviceClient
    .from("health_flags")
    .select("id, flag_type, status, professional_consulted")
    .eq("id", flagId)
    .eq("athlete_id", athleteId)
    .maybeSingle();
  if (readError) throw new HealthFlagResolutionError(readError.code ?? "read_failed");
  if (!row) return { status: "not_found" };

  const flag = row as { id: string; flag_type: string; status: string; professional_consulted: boolean };
  if (flag.status === "resolved") return { status: "already_resolved" };
  if (flag.flag_type === "concussion_suspect") return { status: "medical_validation_required" };

  const { data: updated, error: updateError } = await serviceClient
    .from("health_flags")
    .update({
      status: "resolved",
      resolved_at: input.resolvedAt,
      resolution_note: healthFlagResolutionNote(input.resolvedAt, input.professionalConsulted),
      // A consultation already recorded is never erased by a later "no".
      professional_consulted: flag.professional_consulted || input.professionalConsulted,
    })
    .eq("id", flag.id)
    .eq("athlete_id", athleteId)
    .in("status", [...OPEN_STATUSES])
    .select("id");
  if (updateError) throw new HealthFlagResolutionError(updateError.code ?? "update_failed");
  if (!updated || updated.length === 0) return { status: "already_resolved" };

  return { status: "resolved", flagId: flag.id, flagType: flag.flag_type, resolvedAt: input.resolvedAt };
}
