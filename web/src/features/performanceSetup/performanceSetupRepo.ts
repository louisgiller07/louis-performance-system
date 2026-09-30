// V0.5_021 — Performance Setup. Same discipline as athleteOnboardingRepo.ts:
// the authenticated user's own Supabase client only, RLS
// (athlete_performance_profiles_own_data) is the sole authority on which
// athlete_id a write can target — never a service/secret key, never an Edge
// Function, never a RPC. head-coach-engine's athletePerformanceProfileRepo.ts
// already has an equivalent upsertPerformanceProfileFor() function, but it
// runs under the privileged admin client (used for fixture/admin population)
// — this file is the athlete-facing, RLS-scoped equivalent, the same split
// already established between web/ repos and head-coach-engine/ repos
// (web never imports head-coach-engine, no shared build boundary).
import { supabase } from "../../lib/supabase";
import {
  EQUIPMENT_OPTIONS,
  TERRAIN_OPTIONS,
  TECHNICAL_PRIORITY_OPTIONS,
  STRENGTH_EXPERIENCE_TIER_OPTIONS,
  DH_TECHNICAL_TIER_OPTIONS,
  MAX_PRIORITY_AREAS,
  type Equipment,
  type Terrain,
  type TechnicalPriority,
  type StrengthExperienceTier,
  type DhTechnicalTier,
} from "./performanceSetupOptions";

export class PerformanceSetupError extends Error {
  constructor() {
    super("Impossible d'enregistrer ton profil de performance. Réessaie dans un instant.");
    this.name = "PerformanceSetupError";
  }
}

export interface PerformanceSetupAnswers {
  equipment: Equipment[];
  terrainAccess: Terrain[];
  strengths: TechnicalPriority[];
  weaknesses: TechnicalPriority[];
  priorityAreas: TechnicalPriority[];
  strengthExperienceTier: StrengthExperienceTier | null;
  /** UX-11A.5a.2b — declared by the rider, never inferred; null for legacy profiles. */
  dhTechnicalTier: DhTechnicalTier | null;
  seasonObjective: string | null;
}

/**
 * Keeps only the members of `value` that are still real options — same
 * "membership, not just presence" reasoning as athleteOnboardingRepo's
 * `asOption`: a previously-saved value could in principle no longer match a
 * since-renamed/removed option, and this UI must never crash or silently
 * re-save a stale value as if the athlete had just chosen it.
 */
function filterKnown<T extends string>(options: readonly T[], value: unknown): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is T => (options as readonly string[]).includes(item));
}

function asOption<T extends string>(options: readonly T[], value: unknown): T | null {
  return typeof value === "string" && (options as readonly string[]).includes(value) ? (value as T) : null;
}

/**
 * Reads back whatever has already been saved. No `athleteId` parameter and
 * no `.eq(...)` filter — same RLS-only-scoping idiom as
 * athleteOnboardingRepo.loadOnboardingAnswers()/AuthContext.ts's
 * resolveAthlete(): RLS already restricts athlete_performance_profiles to at
 * most the caller's own single row (athlete_id is the table's PK), so
 * indexing `data?.[0]` is exactly as scoped as an explicit filter would be.
 * A brand-new athlete with no row yet resolves to all-empty/null answers,
 * never an error.
 */
export async function loadPerformanceSetupAnswers(): Promise<PerformanceSetupAnswers> {
  const { data, error } = await supabase
    .from("athlete_performance_profiles")
    .select("equipment, terrain_access, strength_experience_tier, season_objective, technical_priorities, dh_technical_tier");

  if (error) {
    console.error("performanceSetupRepo.loadPerformanceSetupAnswers failed", error.code);
    throw new PerformanceSetupError();
  }

  const row = data?.[0] as
    | {
        equipment: unknown;
        terrain_access: unknown;
        strength_experience_tier: unknown;
        season_objective: unknown;
        technical_priorities: unknown;
        dh_technical_tier: unknown;
      }
    | undefined;
  const technicalPriorities = (row?.technical_priorities ?? {}) as Record<string, unknown>;

  return {
    equipment: filterKnown(EQUIPMENT_OPTIONS, row?.equipment),
    terrainAccess: filterKnown(TERRAIN_OPTIONS, row?.terrain_access),
    strengths: filterKnown(TECHNICAL_PRIORITY_OPTIONS, technicalPriorities.strengths),
    weaknesses: filterKnown(TECHNICAL_PRIORITY_OPTIONS, technicalPriorities.weaknesses),
    priorityAreas: filterKnown(TECHNICAL_PRIORITY_OPTIONS, technicalPriorities.priorityAreas),
    strengthExperienceTier: asOption(STRENGTH_EXPERIENCE_TIER_OPTIONS, row?.strength_experience_tier),
    dhTechnicalTier: asOption(DH_TECHNICAL_TIER_OPTIONS, row?.dh_technical_tier),
    seasonObjective: typeof row?.season_objective === "string" ? row.season_objective : null,
  };
}

export interface SavePerformanceSetupInput {
  equipment: Equipment[];
  terrainAccess: Terrain[];
  strengths: TechnicalPriority[];
  weaknesses: TechnicalPriority[];
  priorityAreas: TechnicalPriority[];
  strengthExperienceTier: StrengthExperienceTier | null;
  dhTechnicalTier: DhTechnicalTier | null;
  seasonObjective: string | null;
}

/**
 * UX-11A.5a.2b — the RAW technical_priorities object currently saved (the
 * caller's own row through RLS), so a write can update some of its keys and
 * keep everything else exactly as it is: keys unknown to this UI, and values
 * the load filtered out as no longer known, are never silently dropped.
 */
async function loadRawTechnicalPriorities(): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.from("athlete_performance_profiles").select("technical_priorities");
  if (error) {
    console.error("performanceSetupRepo.loadRawTechnicalPriorities failed", error.code);
    throw new PerformanceSetupError();
  }
  const raw = (data?.[0] as { technical_priorities?: unknown } | undefined)?.technical_priorities;
  return raw !== null && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
}

/**
 * Upserts the athlete's entire Performance Setup in one write — a single
 * form submitted together, unlike athleteOnboardingRepo's per-step saves
 * (which exist specifically for its multi-step wizard's resume-after-refresh
 * behavior; this form has no equivalent step sequence to resume, V0.5_021
 * UX decision — see PerformanceSetup.tsx's own module doc).
 *
 * `seasonObjective`: an empty/blank string is normalized to `null` before
 * the write — the DB CHECK constraint
 * (athlete_performance_profiles_season_objective_not_blank) rejects a
 * present-but-blank string, never a NULL. `strengthExperienceTier: null` is
 * written as-is (the column is nullable) — full completeness is
 * `buildPlanInputSnapshot()`'s concern (GenerationBlockedError), never
 * re-enforced here.
 */
export async function savePerformanceSetup(athleteId: string, answers: SavePerformanceSetupInput): Promise<void> {
  const trimmedObjective = answers.seasonObjective?.trim() ?? "";
  const rawPriorities = await loadRawTechnicalPriorities();

  const { error } = await supabase.from("athlete_performance_profiles").upsert(
    {
      athlete_id: athleteId,
      equipment: answers.equipment,
      terrain_access: answers.terrainAccess,
      strength_experience_tier: answers.strengthExperienceTier,
      dh_technical_tier: answers.dhTechnicalTier,
      season_objective: trimmedObjective.length > 0 ? trimmedObjective : null,
      // UX-11A.5a.2b — merged into the saved object: any other key is kept.
      technical_priorities: {
        ...rawPriorities,
        strengths: answers.strengths,
        weaknesses: answers.weaknesses,
        priorityAreas: answers.priorityAreas,
      },
    },
    { onConflict: "athlete_id" }
  );

  if (error) {
    console.error("performanceSetupRepo.savePerformanceSetup failed", error.code);
    throw new PerformanceSetupError();
  }
}

export interface SaveDhTechnicalProfileInput {
  dhTechnicalTier: DhTechnicalTier;
  /** Ordered: index 0 is priority n°1. 1 to 3 distinct known priorities. */
  priorityAreas: TechnicalPriority[];
}

/**
 * UX-11A.5a.2b — first run: saves the declared DH technical tier and the 1–3
 * ordered priorities, and ONLY those. `technical_priorities` is read back
 * raw and only its `priorityAreas` key is replaced: `strengths`,
 * `weaknesses` and any other key stay exactly as saved. No other column is
 * written (a first write gets the columns' own defaults). Nothing is
 * derived from the strength tier, the competition level or the discipline.
 */
export async function saveDhTechnicalProfile(athleteId: string, input: SaveDhTechnicalProfileInput): Promise<void> {
  const unique = new Set(input.priorityAreas);
  const known = input.priorityAreas.every((p) => (TECHNICAL_PRIORITY_OPTIONS as readonly string[]).includes(p));
  if (
    !(DH_TECHNICAL_TIER_OPTIONS as readonly string[]).includes(input.dhTechnicalTier) ||
    input.priorityAreas.length < 1 ||
    input.priorityAreas.length > MAX_PRIORITY_AREAS ||
    unique.size !== input.priorityAreas.length ||
    !known
  ) {
    throw new PerformanceSetupError();
  }

  const rawPriorities = await loadRawTechnicalPriorities();
  const { error } = await supabase.from("athlete_performance_profiles").upsert(
    {
      athlete_id: athleteId,
      dh_technical_tier: input.dhTechnicalTier,
      technical_priorities: { ...rawPriorities, priorityAreas: [...input.priorityAreas] },
    },
    { onConflict: "athlete_id" }
  );

  if (error) {
    console.error("performanceSetupRepo.saveDhTechnicalProfile failed", error.code);
    throw new PerformanceSetupError();
  }
}
