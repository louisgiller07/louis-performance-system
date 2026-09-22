/**
 * LoadDerivation (V0.4_109) — pure function computing a session's
 * reference (pre-history) load: loadProfile, durationMin, doseTarget.
 * Receives `kind` already decided by SessionKindAssignment and never
 * modifies it. Never reads recentHistory, equipment, or races — not part
 * of this module's input at all. Never calls SessionKindAssignment,
 * HistoryAdjuster, or ConstraintResolver. Never produces exercise/drill
 * detail — that stays the Prescription Engine's job.
 *
 * The numeric values below are a deliberately minimal V1 placeholder: no
 * golden scenario specifies exact figures, only the qualitative direction
 * "taper reduces load/volume versus a normal development week" (Golden
 * Scenario C). `strengthExperienceTier` is accepted as part of the fixed
 * input contract but is NOT used by any rule below — no evidence justifies
 * how it should differentiate output, so none is invented; the field stays
 * ready for a future rule, not wired to one yet. Every weekType other than
 * "taper" (development, deload, race, recovery) uses the same baseline —
 * nothing distinguishes them at this level beyond the slot counts already
 * handled upstream by the template/WeekSegmenter, and "race" in particular
 * is not expected to reach this function at all today (the race template
 * carries zero slots in every domain).
 */
import type { SessionKind, LoadProfile } from "../types/sharedVocabulary.js";
import { LOAD_VARIABLE_SESSION_KINDS } from "../types/sharedVocabulary.js";
import type { SessionDoseTarget } from "../types/generatedSession.js";
import type { StrengthExperienceTier } from "../types/planInputSnapshot.js";
import type { WeekType } from "../types/planWeek.js";
import type { WeekTemplateCatalogEntry } from "../catalog/weekTemplateCatalog.js";

export interface LoadDerivationInput {
  kind: SessionKind;
  template: WeekTemplateCatalogEntry;
  strengthExperienceTier: StrengthExperienceTier;
  weekType: WeekType;
}

export interface LoadDerivationOutput {
  loadProfile?: LoadProfile;
  durationMin: number;
  doseTarget: SessionDoseTarget;
}

export class UnsupportedSessionKindError extends Error {
  constructor(public readonly kind: SessionKind) {
    super(`LoadDerivation: unsupported SessionKind "${kind}" — no domain-level derivation rule exists for it`);
    this.name = "UnsupportedSessionKindError";
  }
}

/**
 * Mirrors the strength/DH partitions already used by constraintResolver.ts
 * (in turn mirroring tests/fixtures/invariants.ts) — duplicated
 * deliberately, never imported across pipeline files.
 */
const STRENGTH_KINDS: ReadonlySet<SessionKind> = new Set(["STRENGTH_LOWER", "STRENGTH_UPPER", "STRENGTH_FULL_LIGHT", "POWER"]);
const DH_KINDS: ReadonlySet<SessionKind> = new Set(["DH_TECHNICAL", "DH_PERFORMANCE", "DH_LIGHT"]);
const AEROBIC_KINDS: ReadonlySet<SessionKind> = new Set(["AEROBIC_BASE", "AEROBIC_INTERVALS"]);

type SupportedDomain = "strength" | "dh_technical" | "aerobic";

function domainForKind(kind: SessionKind): SupportedDomain {
  if (STRENGTH_KINDS.has(kind)) return "strength";
  if (DH_KINDS.has(kind)) return "dh_technical";
  if (AEROBIC_KINDS.has(kind)) return "aerobic";
  throw new UnsupportedSessionKindError(kind);
}

// V1 placeholder figures only — see module doc. Ready to be replaced by
// real coaching values; never an algorithm, always a flat lookup.
const BASE_DURATION_MIN: Record<SupportedDomain, number> = { strength: 60, dh_technical: 90, aerobic: 45 };
const TAPER_DURATION_MIN: Record<SupportedDomain, number> = { strength: 45, dh_technical: 60, aerobic: 30 };

const BASE_LOAD_PROFILE: LoadProfile = "MODERATE";
const TAPER_LOAD_PROFILE: LoadProfile = "LIGHT";

const BASE_STRENGTH_SET_VOLUME = 12;
const TAPER_STRENGTH_SET_VOLUME = 8;
const BASE_STRENGTH_RPE = 7;
const TAPER_STRENGTH_RPE = 6;

const BASE_DH_FOCUSED_RUNS = 6;
const TAPER_DH_FOCUSED_RUNS = 4;

function isTaper(weekType: WeekType): boolean {
  return weekType === "taper";
}

function deriveDoseTarget(domain: SupportedDomain, weekType: WeekType): SessionDoseTarget {
  const taper = isTaper(weekType);
  switch (domain) {
    case "strength":
      return {
        domain: "strength",
        setVolume: taper ? TAPER_STRENGTH_SET_VOLUME : BASE_STRENGTH_SET_VOLUME,
        targetRpeOrRir: taper ? TAPER_STRENGTH_RPE : BASE_STRENGTH_RPE,
      };
    case "dh_technical":
      // skillTargets intentionally empty: which skills to focus is derived
      // from PlanInputSnapshot.technicalPriorities, not part of this
      // module's input — left for the Prescription Engine to populate.
      return { domain: "dh_technical", skillTargets: [], focusedRunsCount: taper ? TAPER_DH_FOCUSED_RUNS : BASE_DH_FOCUSED_RUNS };
    case "aerobic":
      return { domain: "aerobic", intensityZone: taper ? "easy" : "moderate" };
  }
}

export function deriveLoad(input: LoadDerivationInput): LoadDerivationOutput {
  const domain = domainForKind(input.kind);
  const taper = isTaper(input.weekType);

  const durationMin = taper ? TAPER_DURATION_MIN[domain] : BASE_DURATION_MIN[domain];
  const doseTarget = deriveDoseTarget(domain, input.weekType);
  const loadProfile: LoadProfile | undefined = LOAD_VARIABLE_SESSION_KINDS.has(input.kind)
    ? taper
      ? TAPER_LOAD_PROFILE
      : BASE_LOAD_PROFILE
    : undefined;

  return {
    ...(loadProfile !== undefined ? { loadProfile } : {}),
    durationMin,
    doseTarget,
  };
}
