/**
 * Versioned, code-based week-template registry (V0.4_103). Selected by
 * `WeekType` alone (`planning-engine/src/types/planWeek.ts`) — deliberately
 * NOT a `TrainingMode` x `WeekType` product. `TrainingMode` remains
 * context information for a future consumer (TemplateSelector); no current
 * golden scenario differentiates by mode, and no such consumer exists yet
 * (V0.4_103 architect decision, 2026-09-22).
 *
 * Slot-based, not session-based: each entry describes HOW MANY slots exist
 * per domain this week — never which dates, which weekday, which exact
 * exercise/drill, or exact duration. Those remain the exclusive
 * responsibility of downstream, not-yet-built modules (TemplateSelector /
 * WeekSegmenter for placement, the Prescription Engine for exercise/drill
 * selection) — see planning-engine/README.md's own module-ownership
 * discipline, extended here to this catalogue.
 *
 * IDs are permanent — same rule as exerciseCatalog/drillCatalog (see
 * README.md "Catalogue versioning rules"). `weekType` is the current
 * selection key and must stay unique among non-deprecated entries (checked
 * by a test assertion, not a new validator — validateCatalogConsistency
 * already covers id-uniqueness and deprecation-consistency generically).
 *
 * `weekType` reuses `WeekType` from ../types/planWeek.js directly rather
 * than redeclaring the same 5-value union locally — unlike
 * sharedVocabulary.ts's deliberate cross-PACKAGE duplication (which exists
 * specifically so planning-engine never depends on head-coach-engine),
 * catalog/ and types/ are the same package; importing here is the normal
 * case, not the one that duplication precedent was written for.
 */
import type { WeekType } from "../types/planWeek.js";

export const WEEK_TEMPLATE_CATALOG_VERSION = "v1";

export interface WeekTemplateCatalogEntry {
  id: string;
  weekType: WeekType;

  /** Slot count for STRENGTH_LOWER/STRENGTH_UPPER/STRENGTH_FULL_LIGHT/POWER-family sessions this week. */
  strengthSlotCount: number;
  /** Slot count for DH_TECHNICAL/DH_PERFORMANCE/DH_LIGHT-family sessions this week. */
  dhTechnicalSlotCount: number;
  /** Slot count for AEROBIC_BASE/AEROBIC_INTERVALS-family sessions this week. */
  aerobicSlotCount: number;
  /**
   * True when rest/recovery IS this template's purpose, not merely the
   * leftover days after the three slot counts above are placed (every
   * template has "remainder" days by construction — this flag is the only
   * additional "nature récupération/repos" signal this V1 catalogue
   * carries, deliberately not a numeric rest-day count: which specific
   * days end up as rest is a downstream placement decision, never declared
   * here).
   */
  restEmphasis: boolean;

  /** Why these counts — must cite the golden scenario this entry satisfies, or say plainly that none specifies it. */
  rationale: string;

  deprecated?: boolean;
  replacedBy?: string;
}

const ENTRIES: WeekTemplateCatalogEntry[] = [
  {
    id: "development",
    weekType: "development",
    strengthSlotCount: 2,
    dhTechnicalSlotCount: 2,
    aerobicSlotCount: 1,
    restEmphasis: false,
    rationale:
      'Golden Scenario A ("Normal development week"): "Development week_type template applies: strength x2, DH-technical x2, aerobic x1, remainder rest/recovery." Counts taken verbatim from the already-committed scenario text.',
  },
  {
    id: "race",
    weekType: "race",
    strengthSlotCount: 0,
    dhTechnicalSlotCount: 0,
    aerobicSlotCount: 0,
    restEmphasis: false,
    rationale:
      'Golden Scenario B ("Race week"): "RACE week_type overrides the development template entirely... reduced volume, no new-stimulus strength work, freshness protected." Zero slots in every domain is the most conservative reading of "no new stimulus" and "reduced volume" — it does not itself describe race-day content (e.g. a RACE_ACTIVITY session), which stays a downstream placement decision, out of this catalogue\'s scope. restEmphasis is false because this week\'s purpose is racing, not resting, even though structured training volume is minimal.',
  },
  {
    id: "taper",
    weekType: "taper",
    strengthSlotCount: 1,
    dhTechnicalSlotCount: 1,
    aerobicSlotCount: 1,
    restEmphasis: false,
    rationale:
      'Golden Scenario C ("Taper week"): "Volume reduced by a fixed step versus a normal development week." One slot per domain (vs. development\'s 2/2/1) is a minimal, explicit reduction — the scenario does not specify an exact step size, so this is the smallest reduction that is still clearly less than development in every domain, not a derived coaching formula.',
  },
  {
    id: "deload",
    weekType: "deload",
    strengthSlotCount: 1,
    dhTechnicalSlotCount: 1,
    aerobicSlotCount: 0,
    restEmphasis: false,
    rationale:
      "No golden scenario specifies deload-week content. Minimal placeholder only: reduced relative to development in every populated domain, aerobic dropped entirely — deliberately not a distinct coaching formula from taper's own reduction, per the instruction not to invent complex rules for this weekType.",
  },
  {
    id: "recovery",
    weekType: "recovery",
    strengthSlotCount: 0,
    dhTechnicalSlotCount: 0,
    aerobicSlotCount: 0,
    restEmphasis: true,
    rationale:
      "No golden scenario specifies recovery-week content. Minimal placeholder only: zero slots in every tracked domain, restEmphasis=true because rest IS this template's stated purpose (distinct from race, which also has zero tracked-domain slots but for a different reason — see that entry's own rationale).",
  },
];

/** Raw entry list, preserved separately from the id-keyed record below so a duplicate id can actually be detected (a Record built from a duplicate-key list silently drops the earlier entry) — see validation/validateCatalog.ts. */
export const WEEK_TEMPLATE_CATALOG_ENTRIES: readonly WeekTemplateCatalogEntry[] = ENTRIES;

export const WEEK_TEMPLATE_CATALOG: Readonly<Record<string, WeekTemplateCatalogEntry>> = Object.freeze(
  Object.fromEntries(ENTRIES.map((entry) => [entry.id, entry]))
);
