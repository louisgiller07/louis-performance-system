/**
 * UX-11A.5b.3 — pure DH technical prescription builder (Session Model V2).
 *
 * Content only: no id, no UUID, no I/O, no clock. Not wired into any engine.
 *
 * Selection rules (docs/03 §Technique DH — règles V2, ADR UX-11A.5b.0.1):
 * - skill = priorityAreas[dhSessionOrdinal % priorityAreas.length] — only
 *   the declared priorities, in their declared order, and the session's
 *   ordinal in the plan version (never an id, the date, history, strengths,
 *   weaknesses, ranking or competition level);
 * - intent = DH_SKILL_TO_INTENT_V2[skill], or the skill's non-race intent
 *   when that intent demands race intensity and the drill carries none
 *   (dhIntentForDrillV2, P0 replace stale copy);
 * - drill = THE reference drill of (skill, declared dhTechnicalTier) when one of
 *   its compatible terrains (catalogue `compatibleTerrains`, P0 first
 *   generation) is declared; otherwise its ONE explicit alternative (P0-2,
 *   HPM option E: `alternativeFor`, same skill and tier) when one of the
 *   alternative's terrains is declared (selectDhDrill); otherwise the plan is
 *   blocked — no other priority, no other tier, no easier or harder drill;
 * - the frame is sessionFrameV2: only the `main` block holds the counted
 *   drill (`pass` = focusedRunsCount, 4–8); every other block carries
 *   instructions only — never a number of runs for the day.
 *
 * P0 adapted-session coherence — the dose shapes the mission: for a LIGHT
 * DH dose, a catalogue drill that demands race intensity (its validated cue
 * or criterion asks for « mode course » / « vitesse course »:
 * RACE_SPEED_DRILL_IDS_V2) is replaced by following the catalogue's own
 * regression link (`regressesTo`) until a drill without race intensity is
 * reached — never an invented drill. The same rule serves the planner and
 * the daily adaptations (dhDrillForLoad).
 *
 * Blocks (locked codes): missing_dh_technical_tier,
 * missing_dh_priority_areas, too_many_dh_priority_areas,
 * duplicate_dh_priority_areas, dh_passes_out_of_range,
 * unavailable_dh_drill_terrain. No automatic correction.
 */
import { DH_SKILLS_V2, DH_DRILL_PASSES_RANGE_V2, SESSION_DRILL_CATALOG_V2, SESSION_DRILL_CATALOG_V2_ENTRIES, type DhSkillV2, type DhTechnicalTierV2, type SessionDrillV2 } from "../../catalog/sessionDrillCatalogV2.js";
import type { LoadProfile } from "../../types/sharedVocabulary.js";
import { DH_DRILL_INTENT_V2, DH_SKILL_NON_RACE_INTENT_V2, DH_SKILL_TO_INTENT_V2, INTENT_CATALOG_V2 } from "../../catalog/intentCatalogV2.js";
import { DH_SESSION_FRAME_V2 } from "../../catalog/sessionFrameV2.js";
import type { SessionKind } from "../../types/sharedVocabulary.js";
import type { SessionModelV2CatalogManifest } from "../catalogManifest.js";
import type { BlockV2Content, PrescriptionV2Content } from "../prescriptionV2.js";
import { SessionModelV2ContractError, SessionModelV2GenerationBlockedError } from "../generationErrors.js";

/** The only DH session kind the current Planning Engine produces. */
export const DH_V2_SESSION_KIND: SessionKind = "DH_TECHNICAL";

/** Maximum number of declared DH priorities (docs/03, first run). */
export const MAX_DH_PRIORITY_AREAS = 3;

/**
 * Exactly what the DH builder may read. Strengths, weaknesses, competition
 * level and the strength tier are deliberately absent.
 */
export interface DhPrescriptionV2Input {
  sessionKind: SessionKind;
  /** 0-based position of this session among the DH sessions of the plan version (deriveDhSessionOrdinals). */
  dhSessionOrdinal: number;
  dhTechnicalTier: DhTechnicalTierV2 | null;
  /** technicalPriorities.priorityAreas, in declared order. */
  priorityAreas: readonly string[];
  terrainAccess: readonly string[];
  /** The planned session's doseTarget.focusedRunsCount: passages of the session's single technical drill. */
  focusedRunsCount: number;
  catalog: SessionModelV2CatalogManifest;
  /** P0 — the session's load: a LIGHT dose never carries a race-intensity drill (dhDrillForLoad). Absent = as before. */
  loadProfile?: LoadProfile;
}

/**
 * P0 — drills whose validated texts demand race intensity (cue / criterion:
 * « mode course » or « vitesse course »). Locked against the text catalogue
 * by test: a drill is in this set iff its texts say so.
 */
export const RACE_SPEED_DRILL_IDS_V2: ReadonlySet<string> = new Set([
  "braking_marked_zone_at_speed",
  "line_choice_fast_line_compare",
  "roots_rocks_committed",
  "race_execution_split_pace",
  "race_execution_full_run_sim",
]);

/**
 * P0 — the drill a dose can honestly carry. Any load but LIGHT: the drill
 * itself. LIGHT: the catalogue regression chain (`regressesTo`) until the
 * first drill without race intensity — never an invented drill.
 *
 * Terrain: the regression is ridden on its own terrain or on the terrain of
 * the drill it regresses from. A regression lowers the demand of the same
 * skill; it never asks for a harder terrain than the session's own, which
 * the rider declared (onboarding terrains are independent: a rider may hold
 * full_dh_track without any_groomed_trail). The regression texts are
 * terrain-agnostic (« choisis une courte section », « juste avant l'entrée
 * du virage »). null only when neither terrain is declared (the caller blocks).
 */
export function dhDrillForLoad(drill: SessionDrillV2, load: LoadProfile | undefined, terrainAccess: readonly string[]): SessionDrillV2 | null {
  if (load !== "LIGHT" || !RACE_SPEED_DRILL_IDS_V2.has(drill.drillId)) return drill;
  let current: SessionDrillV2 | undefined = drill;
  while (current && RACE_SPEED_DRILL_IDS_V2.has(current.drillId)) {
    current = current.regressesTo !== undefined ? SESSION_DRILL_CATALOG_V2[current.regressesTo] : undefined;
  }
  if (!current) return null;
  return ridesOn(current, terrainAccess) || ridesOn(drill, terrainAccess) ? current : null;
}

/** P0 first generation — the rider declared at least one terrain on which the drill can be ridden as written. */
export function ridesOn(drill: SessionDrillV2, terrainAccess: readonly string[]): boolean {
  return drill.compatibleTerrains.some((t) => terrainAccess.includes(t));
}

/**
 * P0 replace stale copy — the intent follows the drill actually prescribed:
 * the skill's intent, except when that intent demands race intensity and the
 * drill carries none (a LIGHT regression, the beginner drill), which takes
 * the skill's non-race intent (DH_SKILL_NON_RACE_INTENT_V2).
 */
export function dhIntentForDrillV2(drill: SessionDrillV2): string {
  // P0-2 — a drill with its own intent (cornering_advanced_line_exit: no imposed speed increase).
  const own = DH_DRILL_INTENT_V2[drill.drillId];
  if (own !== undefined) return own;
  const nonRace = DH_SKILL_NON_RACE_INTENT_V2[drill.skill];
  return nonRace !== undefined && !RACE_SPEED_DRILL_IDS_V2.has(drill.drillId) ? nonRace : DH_SKILL_TO_INTENT_V2[drill.skill];
}

const isDhSkill = (value: string): value is DhSkillV2 => (DH_SKILLS_V2 as readonly string[]).includes(value);

/**
 * THE reference drill of (skill, tier). The catalogue holds exactly one per pair (alternatives excluded); any
 * other count is a catalogue / development error — never "take the first".
 */
export function canonicalDhDrill(skill: DhSkillV2, tier: DhTechnicalTierV2): SessionDrillV2 {
  const matches = SESSION_DRILL_CATALOG_V2_ENTRIES.filter((drill) => drill.skill === skill && drill.technicalTier === tier && drill.alternativeFor === undefined);
  if (matches.length !== 1) {
    throw new SessionModelV2ContractError(`expected exactly one DH drill for (${skill}, ${tier}), found ${matches.length}`);
  }
  return matches[0]!;
}

/**
 * P0-2 (HPM option E) — the explicit alternative of a reference drill, or null. At most one, of the same skill
 * and tier, never a race-intensity drill: anything else is a catalogue / development error.
 */
export function alternativeDhDrill(reference: SessionDrillV2): SessionDrillV2 | null {
  const matches = SESSION_DRILL_CATALOG_V2_ENTRIES.filter((drill) => drill.alternativeFor === reference.drillId);
  if (matches.length === 0) return null;
  const alt = matches[0]!;
  if (matches.length > 1 || alt.skill !== reference.skill || alt.technicalTier !== reference.technicalTier || RACE_SPEED_DRILL_IDS_V2.has(alt.drillId)) {
    throw new SessionModelV2ContractError(`invalid alternative(s) for ${reference.drillId}: ${matches.map((d) => d.drillId).join(", ")}`);
  }
  return alt;
}

/**
 * P0-2 — the drill of (skill, tier) for the declared terrains: the reference drill when it can be ridden there,
 * otherwise its explicit alternative when that one can; null when neither (the caller blocks). Deterministic;
 * the specific drill always wins.
 */
export function selectDhDrill(skill: DhSkillV2, tier: DhTechnicalTierV2, terrainAccess: readonly string[]): SessionDrillV2 | null {
  const reference = canonicalDhDrill(skill, tier);
  if (ridesOn(reference, terrainAccess)) return reference;
  const alt = alternativeDhDrill(reference);
  return alt !== null && ridesOn(alt, terrainAccess) ? alt : null;
}

export function buildDhPrescriptionV2Content(input: DhPrescriptionV2Input): PrescriptionV2Content {
  if (input.sessionKind !== DH_V2_SESSION_KIND) {
    throw new SessionModelV2ContractError(`the DH builder only builds ${DH_V2_SESSION_KIND}, got ${input.sessionKind}`);
  }
  if (!Number.isInteger(input.dhSessionOrdinal) || input.dhSessionOrdinal < 0) {
    throw new SessionModelV2ContractError(`dhSessionOrdinal must be an integer >= 0, got ${input.dhSessionOrdinal}`);
  }

  // Declared data first (locked codes, in this order), then the dose.
  const tier = input.dhTechnicalTier;
  if (tier === null) throw new SessionModelV2GenerationBlockedError("missing_dh_technical_tier");
  const priorities = input.priorityAreas;
  if (priorities.length === 0) throw new SessionModelV2GenerationBlockedError("missing_dh_priority_areas");
  if (priorities.length > MAX_DH_PRIORITY_AREAS) {
    throw new SessionModelV2GenerationBlockedError("too_many_dh_priority_areas", { count: priorities.length });
  }
  if (new Set(priorities).size !== priorities.length) {
    throw new SessionModelV2GenerationBlockedError("duplicate_dh_priority_areas", { priorityAreas: [...priorities] });
  }
  const unknown = priorities.filter((p) => !isDhSkill(p));
  if (unknown.length > 0) throw new SessionModelV2ContractError(`unknown DH priority area(s): ${unknown.join(", ")}`);
  const passes = input.focusedRunsCount;
  if (!Number.isInteger(passes) || passes < DH_DRILL_PASSES_RANGE_V2.min || passes > DH_DRILL_PASSES_RANGE_V2.max) {
    throw new SessionModelV2GenerationBlockedError("dh_passes_out_of_range", { focusedRunsCount: passes, range: { ...DH_DRILL_PASSES_RANGE_V2 } });
  }

  const skill = priorities[input.dhSessionOrdinal % priorities.length] as DhSkillV2;

  const canonical = selectDhDrill(skill, tier, input.terrainAccess);
  if (canonical === null) {
    const reference = canonicalDhDrill(skill, tier);
    const alt = alternativeDhDrill(reference);
    throw new SessionModelV2GenerationBlockedError("unavailable_dh_drill_terrain", {
      skill,
      dhTechnicalTier: tier,
      drillId: reference.drillId,
      requiredTerrain: reference.requiredTerrain,
      // Every terrain that would make this priority possible (the reference drill's, then its alternative's).
      compatibleTerrains: [...new Set([...reference.compatibleTerrains, ...(alt?.compatibleTerrains ?? [])])],
    });
  }
  // P0 — the selected drill's terrain is declared, so its LIGHT regression always exists.
  const drill = dhDrillForLoad(canonical, input.loadProfile, input.terrainAccess);
  if (drill === null) throw new SessionModelV2ContractError(`no LIGHT regression for ${canonical.drillId}`);
  const intentId = dhIntentForDrillV2(drill);
  const intent = INTENT_CATALOG_V2[intentId];
  if (!intent || intent.family !== "dh_technical" || !intent.sessionKinds.includes("DH_TECHNICAL")) {
    throw new SessionModelV2ContractError(`no DH intent for skill ${skill}`);
  }

  const blocks: BlockV2Content[] = DH_SESSION_FRAME_V2.map((frame) => ({
    role: frame.role,
    instructionIds: [...frame.instructionIds],
    items: frame.countedItems
      ? [
          {
            kind: "drill" as const,
            drillId: drill.drillId,
            measure: { type: "pass" as const, count: passes },
            cueId: drill.cueId,
            successCriterionId: drill.criterionId,
            vigilanceIds: [...drill.vigilanceIds],
          },
        ]
      : [],
  }));

  return {
    schemaVersion: "v2",
    family: "dh_technical",
    sessionKind: input.sessionKind,
    intentId,
    catalog: input.catalog,
    blocks,
  };
}
