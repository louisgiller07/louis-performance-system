/**
 * P0-SAFE (HPM 2026-10-12) — explicit, rider-initiated closure of an open health signal.
 *
 * SAFETY A7 suspends NALYNT's training proposals while an injury / illness / persistent-pain signal is
 * open; this is the only closing path. NALYNT never verifies anything medically: it records what the
 * rider declares or attests, and says so in the stored note.
 *
 * Closure policy (HPM decision, 2026-10-12):
 * - simple signal (illness A3, provisional severe-pain trigger A6): the rider declares the symptoms fully
 *   gone; a consultation may be declared too, it never counts as a clearance;
 * - signal carrying a gravity criterion already defined by the Safety rules (A2 new severe pain, A4
 *   traumatic / function loss / worsening): the declared disappearance of the symptoms is NOT enough — the
 *   rider must attest that a health professional authorised the return to training (`professionalClearance`),
 *   recorded as an unverified attestation;
 * - several zones merged in one signal (health_flags keeps one open row per type): no closure unless the
 *   rider confirms EVERY listed zone explicitly (`confirmedZones` = the exact set) — never one complaint
 *   closing the others implicitly;
 * - concussion: never closed here (A5, medical validation, V0.3_006A2 deferred).
 *
 * Evidence comes from immutable data only: the append-only `decisions` whose persisted daily plan asked for
 * this signal type (`daily_plan.health_flag_to_create`) since the signal was opened — the open row is the
 * only one of its type, so every such decision was merged into it (persist_daily_run reuses it). The rule
 * of each (A2 / A3 / A4 / A6) and the zone suffix of its reason ("… — knee_R") give gravity and zones. No
 * evidence at all (a legacy or manual row): an injury / persistent pain is treated as grave (conservative).
 *
 * Audit: the row keeps its declaration and receives `status = resolved`, `resolved_at`, `resolution_note`
 * (what was declared / attested, zones, "aucune vérification médicale par NALYNT"),
 * `professional_consulted`, `updated_at`. Conditional update: never closed twice. No migration.
 *
 * Self-contained on purpose (no head-coach-engine/dist import): pure TypeScript, no Deno API, so the
 * function adds no bind mount to `functions serve` (Windows ENAMETOOLONG limit) and is tested under Node.
 * Service-role client only; `athleteId` comes from the caller's RLS-scoped resolution, never from input.
 */

// deno-lint-ignore no-explicit-any
type ServiceClient = { from: (table: string) => any };

/** Zone key of a signal declared without a location. */
export const UNSPECIFIED_ZONE = "unspecified";

const GRAVITY_RULES = new Set(["A2", "A4"]);
const OPEN_STATUSES = ["active", "monitoring"] as const;

export interface HealthFlagEvidence {
  flagType: string;
  /** Sorted zone keys (pain_location_code, or "unspecified"); empty for an illness. */
  zones: string[];
  /** A2 / A4 evidence (or an injury / persistent pain without any evidence): clearance attestation required. */
  requiresProfessionalClearance: boolean;
}

export type ResolveHealthFlagOutcome =
  | { status: "resolved"; flagId: string; flagType: string; resolvedAt: string }
  | { status: "not_found" }
  | { status: "already_resolved" }
  | { status: "medical_validation_required" }
  | { status: "professional_clearance_required"; evidence: HealthFlagEvidence }
  | { status: "zones_confirmation_required"; evidence: HealthFlagEvidence };

export interface ResolveHealthFlagInput {
  resolvedAt: string;
  /** The rider declares the pain / symptoms fully gone (the closing statement itself). */
  professionalConsulted?: boolean;
  /** The rider attests a health professional authorised the return to training (unverified by NALYNT). */
  professionalClearance?: boolean;
  /** Every zone of the signal, confirmed one by one by the rider. */
  confirmedZones?: string[];
}

export class HealthFlagResolutionError extends Error {
  constructor(detail: string) {
    super(`health flag resolution failed: ${detail}`);
    this.name = "HealthFlagResolutionError";
  }
}

/** Current calendar date (`YYYY-MM-DD`) in Europe/Zurich — same rule as head-coach-engine productToday(). */
export function zurichToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  const [year, month, day] = [part("year"), part("month"), part("day")];
  if (!year || !month || !day) throw new Error("zurichToday: failed to compute the current Europe/Zurich calendar date.");
  return `${year}-${month}-${day}`;
}

/** "… — knee_R" → "knee_R"; no suffix → unspecified. */
function zoneOf(reason: string): string {
  const parts = reason.split(" — ");
  const last = parts.length > 1 ? parts[parts.length - 1]!.trim() : "";
  return /^[A-Za-z_]+$/.test(last) ? last : UNSPECIFIED_ZONE;
}

interface FlagRow {
  id: string;
  flag_type: string;
  status: string;
  professional_consulted: boolean;
  created_at: string;
}

async function evidenceOf(client: ServiceClient, athleteId: string, flag: FlagRow): Promise<HealthFlagEvidence> {
  const { data, error } = await client
    .from("decisions")
    .select("daily_plan")
    .eq("athlete_id", athleteId)
    .gte("created_at", flag.created_at)
    .eq("daily_plan->health_flag_to_create->>type", flag.flag_type);
  if (error) throw new HealthFlagResolutionError(error.code ?? "evidence_read_failed");
  const plans = ((data ?? []) as { daily_plan: { health_flag_to_create?: { reason?: string }; triggered_rules?: { layer?: string; rule_id?: string }[] } | null }[])
    .map((row) => row.daily_plan)
    .filter((plan): plan is NonNullable<typeof plan> => plan !== null && plan.health_flag_to_create !== undefined);

  const zones = flag.flag_type === "illness" ? [] : [...new Set(plans.map((plan) => zoneOf(plan.health_flag_to_create?.reason ?? "")))].sort();
  const graveEvidence = plans.some((plan) => (plan.triggered_rules ?? []).some((rule) => rule.layer === "A" && GRAVITY_RULES.has(rule.rule_id ?? "")));
  const noEvidence = plans.length === 0;
  const requiresProfessionalClearance = graveEvidence || (noEvidence && flag.flag_type !== "illness");
  return { flagType: flag.flag_type, zones, requiresProfessionalClearance };
}

async function openFlag(client: ServiceClient, athleteId: string, flagId: string): Promise<FlagRow | null> {
  const { data, error } = await client
    .from("health_flags")
    .select("id, flag_type, status, professional_consulted, created_at")
    .eq("id", flagId)
    .eq("athlete_id", athleteId)
    .maybeSingle();
  if (error) throw new HealthFlagResolutionError(error.code ?? "read_failed");
  return (data as FlagRow | null) ?? null;
}

/** What the rider must provide to close this signal (read-only; same rules as the closure). */
export async function inspectHealthFlag(
  client: ServiceClient,
  athleteId: string,
  flagId: string
): Promise<{ status: "ok"; evidence: HealthFlagEvidence } | { status: "not_found" | "already_resolved" | "medical_validation_required" }> {
  const flag = await openFlag(client, athleteId, flagId);
  if (!flag) return { status: "not_found" };
  if (flag.status === "resolved") return { status: "already_resolved" };
  if (flag.flag_type === "concussion_suspect") return { status: "medical_validation_required" };
  return { status: "ok", evidence: await evidenceOf(client, athleteId, flag) };
}

export function healthFlagResolutionNote(resolvedAt: string, evidence: HealthFlagEvidence, input: ResolveHealthFlagInput): string {
  const statements = ["douleur ou symptômes entièrement disparus (déclaration du rider)"];
  if (evidence.zones.length > 1) statements.push(`zones confirmées une par une : ${evidence.zones.join(", ")}`);
  if (input.professionalClearance) statements.push("reprise de l'entraînement autorisée par un professionnel de santé (attestation du rider)");
  else if (input.professionalConsulted) statements.push("professionnel de santé consulté (déclaré ; ce n'est pas une autorisation de reprise)");
  return `Clôturé par le rider dans l'application le ${resolvedAt} : ${statements.join(" ; ")}. Aucune vérification médicale par NALYNT.`;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().every((value, i) => value === [...b].sort()[i]);
}

export async function resolveHealthFlag(
  client: ServiceClient,
  athleteId: string,
  flagId: string,
  input: ResolveHealthFlagInput
): Promise<ResolveHealthFlagOutcome> {
  const flag = await openFlag(client, athleteId, flagId);
  if (!flag) return { status: "not_found" };
  if (flag.status === "resolved") return { status: "already_resolved" };
  if (flag.flag_type === "concussion_suspect") return { status: "medical_validation_required" };

  const evidence = await evidenceOf(client, athleteId, flag);
  if (evidence.zones.length > 1 && !sameSet(input.confirmedZones ?? [], evidence.zones)) return { status: "zones_confirmation_required", evidence };
  if (evidence.requiresProfessionalClearance && input.professionalClearance !== true) return { status: "professional_clearance_required", evidence };

  const { data: updated, error: updateError } = await client
    .from("health_flags")
    .update({
      status: "resolved",
      resolved_at: input.resolvedAt,
      resolution_note: healthFlagResolutionNote(input.resolvedAt, evidence, input),
      // A consultation already recorded is never erased by a later "no"; an attested clearance implies one.
      professional_consulted: flag.professional_consulted || input.professionalConsulted === true || input.professionalClearance === true,
    })
    .eq("id", flag.id)
    .eq("athlete_id", athleteId)
    .in("status", [...OPEN_STATUSES])
    .select("id");
  if (updateError) throw new HealthFlagResolutionError(updateError.code ?? "update_failed");
  if (!updated || updated.length === 0) return { status: "already_resolved" };

  return { status: "resolved", flagId: flag.id, flagType: flag.flag_type, resolvedAt: input.resolvedAt };
}
