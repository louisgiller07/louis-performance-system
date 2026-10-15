/**
 * A04 — the daily final prescription V2 for EVERY Head Coach decision
 * (ADR UX-11A.5c.0 §3–§9, completed by ADR A04).
 *
 * - KEEP → the verbatim copy (buildKeepFinalPrescriptionV2, unchanged).
 * - REST → no document (`none / rest`).
 * - MODIFY (same session kind, M1 lowered the load) → the planned session,
 *   adjusted, with real executable content:
 *     Force: the SAME template and exercises at the LIGHT dose of
 *       strengthDoseCatalogV2 (rebuilt by the Force builder with the plan's
 *       own tier and equipment; the composition must be identical — §5);
 *     DH: the SAME drill, cue and success criterion, fewer passages (the
 *       plan dose policy's LIGHT DH dose);
 *     endurance: the SAME protocol and activity choice, shorter (the plan
 *       dose policy's LIGHT endurance duration).
 *   Items get new ids and `derivedFromItemId` = the planned id (§3).
 *   A MODIFY that does not lower the planned load is never a document (§6):
 *   upward → `upward_modify_not_supported`, no load change → `modify_not_supported`
 *   (a "modified" session whose content is just the planned dose is never produced).
 * - REPLACE (another session kind) → a really prescribed session of the new
 *   kind, built by the V2 builders (Force, DH, endurance, recovery), all ids
 *   new, no item lineage (§3): STRENGTH_* from the plan's tier and equipment,
 *   DH from the planned drill (same skill) at the target's dose, AEROBIC_BASE
 *   with the day's riding availability (BUG-V2-1), RECOVERY_ACTIVE from the
 *   recovery protocol.
 *
 * MODIFY and REPLACE need real plan lineage (a planned session of the
 * current generated version), like KEEP. MODIFY adapts the planned document
 * with the CURRENT catalogues, so a planned prescription written under
 * another Session Model aggregate is a catalogue mismatch (§9), never an
 * adaptation with the wrong tables. REPLACE uses the current manifest.
 *
 * Only a target kind the V2 builders cannot produce (e.g. RACE_ACTIVITY,
 * MOBILITY — never produced by M1 against a V2 planned session) keeps
 * `final_prescription_adaptation_not_defined`.
 *
 * P0-3 (HPM 2026-10-13) — a MANUAL session (planned_sessions.source = 'manual', the rider's own choice in
 * /plan) has no planned prescription. For any non-REST decision it gets a session of M1's final kind built by
 * the same V2 builders as REPLACE, from the current plan version's snapshot (tier, equipment, DH tier,
 * priorities, terrain, riding availability): never another kind, never an invented dose. Contract (HPM P1,
 * persist_daily_run_v2 20261013120000): origin `manual_override_new_kind`, action = M1's decision (keep with no
 * adaptation rule / modify / replace), no planned prescription, the current plan version — only when that
 * version covers the date. A kind or load the builders cannot honour (POWER, GRIP_WORK,
 * PUMPTRACK, STRENGTH_FULL_LIGHT, AEROBIC_INTERVALS, MOBILITY, DH_PERFORMANCE…, a HEAVY Force) is an
 * explicit refusal, never an empty session. A10 applies as for any REPLACE.
 *
 * A10 — `timeLimitMin` (the rider's time today, chosen by
 * buildFinalPrescriptionWithinTodayTimeV2) allows the validated time
 * adaptations only, never an invented dose:
 *   DH: the planner's availability windows (PLAN_DH_DURATION_STEPS_V2: the
 *     window and its maximum passages), same drill;
 *   endurance: the same protocol and activity choice, at the requested
 *     duration (the protocol's own range);
 *   active recovery: the protocol's ranges narrowed to fit (main block upper
 *     bound lowered, optional blocks left out when they do not fit), never
 *     below the protocol's minimum.
 * Force has no time variant: only its validated doses (LIGHT 45 / MODERATE 60).
 *
 * PHYS-01 — under a time limit, a Force session's duration is its content's
 * estimate (estimateStrengthDurationMinutesV2), and one more Force step exists:
 * the short Force (`strengthVariant: "short"`, LIGHT, same template and
 * exercises, fewer items). A short MODIFY keeps lineage by exercise: each of
 * its items derives from the planned item of the same block role and
 * exercise, never by position.
 */
import type { LoadProfile } from "../../types/sharedVocabulary.js";
import { PLAN_DH_DURATION_STEPS_V2, PLAN_ROLE_DOSES_V2 } from "../../catalog/planDosePolicyV2.js";
import { PROTOCOL_CATALOG_V2 } from "../../catalog/protocolCatalogV2.js";
import { buildSessionModelV2CatalogManifest, SESSION_MODEL_V2_AGGREGATE_VERSION } from "../catalogManifest.js";
import { assignPrescriptionIds } from "../assignPrescriptionIds.js";
import { SessionModelV2ContractError, SessionModelV2GenerationBlockedError } from "../generationErrors.js";
import { toSessionModelV2Input, type PlanInputSnapshotV2, type SessionModelV2Input } from "../planInputSnapshotV2.js";
import { isActivityAvailableOn } from "../../pipeline/availabilityActivity.js";
import type { BlockV2, DrillItemV2Content, ExerciseItemV2Content, PrescriptionItemV2Content, PrescriptionV2, PrescriptionV2Content } from "../prescriptionV2.js";
import { validatePrescriptionV2 } from "../validatePrescriptionV2.js";
import { buildStrengthPrescriptionV2Content, type StrengthVariantV2 } from "../builders/strengthPrescriptionV2.js";
import { estimateStrengthDurationMinutesV2 } from "../strengthDurationV2.js";
import { buildDhPrescriptionV2Content, DH_V2_SESSION_KIND, dhDrillForLoad, dhIntentForDrillV2 } from "../builders/dhPrescriptionV2.js";
import { SESSION_DRILL_CATALOG_V2 } from "../../catalog/sessionDrillCatalogV2.js";
import { buildAerobicBasePrescriptionV2Content } from "../builders/aerobicBasePrescriptionV2.js";
import { buildRecoveryActivePrescriptionV2Content, RECOVERY_ACTIVE_PROTOCOL_ID } from "../builders/recoveryActivePrescriptionV2.js";
import { buildKeepFinalPrescriptionV2, lineageFailure, trustedPlannedStructure, type BuildKeepFinalPrescriptionV2Input } from "./buildKeepFinalPrescriptionV2.js";
import type { FinalPrescriptionV2, FinalPrescriptionV2Result } from "./finalPrescriptionV2.js";

/** What the daily adaptation may read besides the plan rows (from the current plan version's input snapshot). */
export interface DailyAdaptationContextV2 {
  /** The athlete facts the plan was generated with (tier, equipment, DH tier and priorities, terrain). */
  athlete: SessionModelV2Input;
  /** BUG-V2-1 — the decision date has a riding window (endurance outdoors, DH). */
  ridingAvailable: boolean;
  /** Identity strategy, injected (random at runtime, deterministic in tests). */
  mintId: () => string;
}

/**
 * The adaptation context of a decision date, from the current plan version's
 * input snapshot (never a live profile read): the athlete facts the plan was
 * built with, and that date's riding availability (BUG-V2-1).
 */
export function dailyAdaptationContextV2(snapshot: PlanInputSnapshotV2, date: string, mintId: () => string): DailyAdaptationContextV2 {
  return {
    athlete: toSessionModelV2Input(snapshot),
    ridingAvailable: isActivityAvailableOn(date, "riding", snapshot.availability, snapshot.lockedDates),
    mintId,
  };
}

export interface BuildFinalPrescriptionV2Input extends BuildKeepFinalPrescriptionV2Input {
  /** Needed for MODIFY / REPLACE; null → those decisions cannot be built (no plan snapshot). */
  adaptation: DailyAdaptationContextV2 | null;
  /** A10 — minutes available today when a time adaptation is requested (see buildFinalPrescriptionWithinTodayTimeV2). */
  timeLimitMin?: number;
  /** PHYS-01 — A10 only: the Force variant to build (absent = standard). */
  strengthVariant?: StrengthVariantV2;
}

/** Stable rule ids of a modify / replace document (`adaptation_rule_ids`, never empty for those actions). */
export const DAILY_ADAPTATION_RULES_V2 = {
  strengthLightDose: "v2.modify.strength_light_dose",
  dhLightPasses: "v2.modify.dh_light_passes",
  enduranceLightDuration: "v2.modify.endurance_light_duration",
  replaceStrength: "v2.replace.strength",
  replaceDh: "v2.replace.dh",
  replaceEndurance: "v2.replace.endurance",
  replaceRecovery: "v2.replace.recovery_active",
  /** A10 — the content was adapted to the rider's time today. */
  todayTimeLimit: "v2.time.today_limit",
  /** P0-3 — the content was built for the rider's manual session (no planned prescription). */
  manualSession: "v2.manual.session",
  /** PHYS-01 — A10: the short Force (same template and exercises, fewer items). */
  strengthShortVariant: "v2.time.strength_short",
} as const;

const LOAD_RANK: Readonly<Record<LoadProfile, number>> = { LIGHT: 0, MODERATE: 1, HEAVY: 2 };
const RIDING_ENDURANCE_ACTIVITIES = ["road_bike", "mtb_rolling"];
const STRENGTH_KINDS = ["STRENGTH_LOWER", "STRENGTH_UPPER"] as const;
const DH_REPLACE_KINDS = ["DH_TECHNICAL", "DH_LIGHT"];

/** A10 — the maximum DH passages of a planner availability window (null: not a supported window). */
function dhWindowMaxPasses(durationMin: number | undefined): number | null {
  return PLAN_DH_DURATION_STEPS_V2.find((s) => s.durationMin === durationMin)?.maxPasses ?? null;
}

/** A10 — the protocol's minimum: the main block's minimum plus every required block's. */
function requiredMinutes(blocks: readonly { optional?: boolean; durationMinutes?: { min: number } }[]): number {
  return blocks.filter((b) => !b.optional).reduce((sum, b) => sum + (b.durationMinutes?.min ?? 0), 0);
}

/**
 * A10 — active recovery inside `limit` minutes: the protocol's own ranges,
 * narrowed. Optional blocks are kept, in order, while the required minimum
 * plus their maximum still fits; the main block's upper bound is then
 * lowered to what remains. Never below the protocol's minimum.
 */
function recoveryWithin(content: PrescriptionV2Content, limit: number): PrescriptionV2Content | null {
  const protocolBlocks = PROTOCOL_CATALOG_V2[RECOVERY_ACTIVE_PROTOCOL_ID]!.blocks;
  const required = requiredMinutes(protocolBlocks);
  if (required > limit) return null;
  let budget = limit - required;
  const kept = content.blocks.filter((block, index) => {
    if (!protocolBlocks[index]!.optional) return true;
    const range = block.durationMinutes;
    if (range === undefined || range.max > budget) return false;
    budget -= range.max;
    return true;
  });
  return {
    ...content,
    blocks: kept.map((block, index) => {
      const range = block.durationMinutes;
      if (block.role !== "main" || range === undefined) return block;
      const otherMax = kept.reduce((sum, b, i) => (i === index ? sum : sum + (b.durationMinutes?.max ?? 0)), 0);
      return { ...block, durationMinutes: { min: range.min, max: Math.min(range.max, limit - otherMax) } };
    }),
  };
}

/** `durationMin` = the effective session duration the content was built for (absent: the decision's own, or a range). */
type Built = { content: PrescriptionV2Content; rule: string; durationMin?: number; lineageByExercise?: true } | { blocked: Record<string, unknown> };

function blocked(code: "final_prescription_no_lineage" | "final_prescription_adaptation_not_defined" | "final_prescription_catalog_mismatch", detail: Record<string, unknown>): FinalPrescriptionV2Result {
  return { status: "blocked", code, detail };
}

/** The sport content of a stored structure (ids and lineage removed). */
function contentOf(structure: PrescriptionV2): PrescriptionV2Content {
  const copy = JSON.parse(JSON.stringify(structure)) as PrescriptionV2;
  return {
    ...copy,
    blocks: copy.blocks.map(({ blockId: _blockId, ...block }) => ({
      ...block,
      items: block.items.map(({ prescriptionItemId: _id, derivedFromItemId: _from, ...item }) => item as PrescriptionItemV2Content),
    })),
  };
}

const flatItems = (blocks: readonly { items: readonly unknown[] }[]) => blocks.flatMap((b) => b.items);

/**
 * P0 adapted-session coherence — the DH drills of a content at the target
 * load: a LIGHT dose follows the catalogue regression of a race-intensity
 * drill (dhDrillForLoad), with that drill's own cue, criterion and
 * vigilances, and the intent of that drill (dhIntentForDrillV2: never the
 * replaced drill's « allure de course »). null when no declared-terrain
 * regression exists.
 */
function drillsForLoad(content: PrescriptionV2Content, load: LoadProfile | undefined, terrainAccess: readonly string[]): PrescriptionV2Content | null {
  let blockedDrill = false;
  let intentId = content.intentId;
  const blocks = content.blocks.map((b) => ({
    ...b,
    items: b.items.map((item) => {
      if (item.kind !== "drill") return item;
      const entry = SESSION_DRILL_CATALOG_V2[item.drillId];
      if (!entry) throw new SessionModelV2ContractError(`unknown DH drill ${item.drillId}`);
      const drill = dhDrillForLoad(entry, load, terrainAccess);
      if (drill === null) {
        blockedDrill = true;
        return item;
      }
      if (drill.drillId === item.drillId) return item;
      intentId = dhIntentForDrillV2(drill);
      return { ...item, drillId: drill.drillId, cueId: drill.cueId, successCriterionId: drill.criterionId, vigilanceIds: [...drill.vigilanceIds] } as DrillItemV2Content;
    }),
  }));
  return blockedDrill ? null : { ...content, intentId, blocks };
}

/** Endurance total = the sum of its blocks' fixed minutes. */
function enduranceMinutes(structure: PrescriptionV2): number {
  return structure.blocks.reduce((sum, b) => sum + (b.durationMinutes?.min ?? 0), 0);
}

const withPasses = (content: PrescriptionV2Content, passes: (count: number) => number): PrescriptionV2Content => ({
  ...content,
  blocks: content.blocks.map((b) => ({
    ...b,
    items: b.items.map((i) => (i.kind === "drill" ? ({ ...i, measure: { type: "pass" as const, count: passes(i.measure.count) } } as DrillItemV2Content) : i)),
  })),
});

const composition = (c: { templateId?: string; blocks: readonly { items: readonly unknown[] }[] }) =>
  JSON.stringify([c.templateId, flatItems(c.blocks).map((i) => (i as ExerciseItemV2Content).exerciseId)]);

/** MODIFY content: same session, lower dose (or the planned dose when M1 did not lower it). */
function modifiedContent(
  planned: PrescriptionV2,
  plannedLoad: LoadProfile | null,
  final: { loadProfile?: LoadProfile; durationMin?: number },
  context: DailyAdaptationContextV2,
  timeLimitMin: number | undefined,
  strengthVariant: StrengthVariantV2 | undefined
): Built {
  const finalLoad = final.loadProfile;
  const upward = finalLoad !== undefined && plannedLoad !== null && LOAD_RANK[finalLoad] > LOAD_RANK[plannedLoad];
  // §6 — never raise the planned dose automatically, never a "modified" copy of the planned dose.
  if (upward) return { blocked: { reason: "upward_modify_not_supported", planned: plannedLoad, final: finalLoad } };
  const downward = finalLoad !== undefined && plannedLoad !== null && LOAD_RANK[finalLoad] < LOAD_RANK[plannedLoad];
  // PHYS-01 — A10 short Force: the planned template and exercises, LIGHT, fewer items (same or lower load).
  if (timeLimitMin !== undefined && planned.family === "strength" && strengthVariant === "short") {
    if (finalLoad !== "LIGHT") return { blocked: { reason: "short_strength_light_only", final: finalLoad ?? null } };
    const short = buildStrengthPrescriptionV2Content({
      sessionKind: planned.sessionKind as (typeof STRENGTH_KINDS)[number],
      athleteTier: context.athlete.strengthExperienceTier,
      equipment: context.athlete.equipment,
      loadProfile: "LIGHT",
      catalog: planned.catalog,
      variant: "short",
    });
    if (short.templateId !== planned.templateId) throw new SessionModelV2ContractError(`short Force: template ${short.templateId} is not the planned ${planned.templateId}`);
    return { content: short, rule: DAILY_ADAPTATION_RULES_V2.strengthShortVariant, durationMin: estimateStrengthDurationMinutesV2(short), lineageByExercise: true };
  }
  // A10 — a shorter DH or endurance session for the rider's time today (same or lower load).
  if (timeLimitMin !== undefined && final.durationMin !== undefined && final.durationMin <= timeLimitMin && planned.family !== "strength") {
    return timeModifiedContent(planned, final.durationMin, downward, finalLoad, context.athlete.terrainAccess);
  }
  if (!downward) return { blocked: { reason: "modify_not_supported", planned: plannedLoad, final: finalLoad ?? null } };
  const light = PLAN_ROLE_DOSES_V2.consolidation;
  switch (planned.family) {
    case "strength": {
      const rebuilt = buildStrengthPrescriptionV2Content({
        sessionKind: planned.sessionKind as (typeof STRENGTH_KINDS)[number],
        athleteTier: context.athlete.strengthExperienceTier,
        equipment: context.athlete.equipment,
        loadProfile: "LIGHT",
        catalog: planned.catalog,
      });
      if (composition(rebuilt) !== composition(planned)) {
        throw new SessionModelV2ContractError(`MODIFY Force: the LIGHT rebuild changed the planned composition (${composition(planned)} → ${composition(rebuilt)})`);
      }
      // PHYS-01 — under the rider's time, the content's own duration (never the planner's slot).
      return { content: rebuilt, rule: DAILY_ADAPTATION_RULES_V2.strengthLightDose, durationMin: timeLimitMin !== undefined ? estimateStrengthDurationMinutesV2(rebuilt) : light.forceDurationMin };
    }
    case "dh_technical": {
      // P0 — fewer passages AND a mission the LIGHT dose can carry (no race-intensity drill).
      const content = drillsForLoad(withPasses(contentOf(planned), (count) => Math.min(count, light.dhFocusedPasses)), finalLoad, context.athlete.terrainAccess);
      return content === null ? { blocked: { reason: "no_light_dh_drill" } } : { content, rule: DAILY_ADAPTATION_RULES_V2.dhLightPasses };
    }
    case "endurance": {
      const minutes = Math.min(enduranceMinutes(planned), PLAN_ROLE_DOSES_V2.taper.aerobicBaseDurationMin);
      const ridingAvailable = (planned.activitySelection?.activityIds ?? []).some((a) => RIDING_ENDURANCE_ACTIVITIES.includes(a));
      return {
        content: buildAerobicBasePrescriptionV2Content({ sessionKind: planned.sessionKind, durationMin: minutes, catalog: planned.catalog, ridingAvailable }),
        rule: DAILY_ADAPTATION_RULES_V2.enduranceLightDuration,
        durationMin: minutes,
      };
    }
    default:
      return { blocked: { reason: "modify_family_not_supported", family: planned.family } };
  }
}

/** A10 — MODIFY for time: the same DH drill in a planner window, or the same endurance protocol, shorter. */
function timeModifiedContent(planned: PrescriptionV2, durationMin: number, downward: boolean, finalLoad: LoadProfile | undefined, terrainAccess: readonly string[]): Built {
  switch (planned.family) {
    case "dh_technical": {
      const maxPasses = dhWindowMaxPasses(durationMin);
      if (maxPasses === null) return { blocked: { reason: "dh_window_not_supported", durationMin } };
      const lightPasses = PLAN_ROLE_DOSES_V2.consolidation.dhFocusedPasses;
      const content = drillsForLoad(withPasses(contentOf(planned), (count) => Math.min(count, maxPasses, downward ? lightPasses : count)), finalLoad, terrainAccess);
      return content === null ? { blocked: { reason: "no_light_dh_drill" } } : { content, rule: DAILY_ADAPTATION_RULES_V2.dhLightPasses, durationMin };
    }
    case "endurance": {
      if (durationMin >= enduranceMinutes(planned)) return { blocked: { reason: "modify_not_supported", durationMin } };
      const ridingAvailable = (planned.activitySelection?.activityIds ?? []).some((a) => RIDING_ENDURANCE_ACTIVITIES.includes(a));
      return {
        content: buildAerobicBasePrescriptionV2Content({ sessionKind: planned.sessionKind, durationMin, catalog: planned.catalog, ridingAvailable }),
        rule: DAILY_ADAPTATION_RULES_V2.enduranceLightDuration,
        durationMin,
      };
    }
    default:
      return { blocked: { reason: "time_modify_not_supported", family: planned.family } };
  }
}

/** REPLACE content: a session of the target kind, really prescribed (planned: null for a P0-3 manual session). */
function replacementContent(
  planned: PrescriptionV2 | null,
  final: { kind: string; loadProfile?: LoadProfile; durationMin?: number },
  context: DailyAdaptationContextV2,
  timeLimitMin: number | undefined,
  strengthVariant: StrengthVariantV2 | undefined
): Built {
  const catalog = buildSessionModelV2CatalogManifest();
  const load: "LIGHT" | "MODERATE" = final.loadProfile === "LIGHT" ? "LIGHT" : "MODERATE";
  if ((STRENGTH_KINDS as readonly string[]).includes(final.kind)) {
    // PHYS-01 — the short Force exists under a time limit only, at the LIGHT dose.
    const variant = timeLimitMin !== undefined && strengthVariant === "short" ? "short" : "standard";
    if (variant === "short" && load !== "LIGHT") return { blocked: { reason: "short_strength_light_only", final: final.loadProfile ?? null } };
    const content = buildStrengthPrescriptionV2Content({
      sessionKind: final.kind as (typeof STRENGTH_KINDS)[number],
      athleteTier: context.athlete.strengthExperienceTier,
      equipment: context.athlete.equipment,
      loadProfile: load,
      catalog,
      variant,
    });
    const rule = variant === "short" ? DAILY_ADAPTATION_RULES_V2.strengthShortVariant : DAILY_ADAPTATION_RULES_V2.replaceStrength;
    // PHYS-01 — under the rider's time, the content's own duration (never the planner's slot).
    const durationMin =
      timeLimitMin !== undefined ? estimateStrengthDurationMinutesV2(content) : load === "LIGHT" ? PLAN_ROLE_DOSES_V2.consolidation.forceDurationMin : PLAN_ROLE_DOSES_V2.build.forceDurationMin;
    return { content, rule, durationMin };
  }
  if (DH_REPLACE_KINDS.includes(final.kind)) {
    const passes = load === "LIGHT" ? PLAN_ROLE_DOSES_V2.consolidation.dhFocusedPasses : PLAN_ROLE_DOSES_V2.build.dhFocusedPasses;
    // The planned drill keeps the session's technical skill; otherwise the first declared priority.
    const source =
      planned !== null && planned.family === "dh_technical"
        ? { ...contentOf(planned), catalog }
        : context.ridingAvailable
          ? buildDhPrescriptionV2Content({
              sessionKind: DH_V2_SESSION_KIND,
              dhSessionOrdinal: 0,
              dhTechnicalTier: context.athlete.dhTechnicalTier,
              priorityAreas: context.athlete.priorityAreas,
              terrainAccess: context.athlete.terrainAccess,
              focusedRunsCount: passes,
              catalog,
              loadProfile: load,
            })
          : null;
    if (source === null) return { blocked: { reason: "riding_not_available", target: final.kind } };
    // A10 — under a time limit the DH window must be a planner window, its passages capped accordingly.
    const windowPasses = timeLimitMin !== undefined ? dhWindowMaxPasses(final.durationMin) : null;
    if (timeLimitMin !== undefined && (windowPasses === null || final.durationMin! > timeLimitMin)) return { blocked: { reason: "dh_window_not_supported", durationMin: final.durationMin ?? null } };
    // P0 — the replacement DH carries a mission its load can honestly hold (LIGHT: no race-intensity drill).
    const content = drillsForLoad(
      withPasses({ ...source, sessionKind: final.kind as PrescriptionV2Content["sessionKind"] }, (count) => Math.min(load === "LIGHT" ? Math.min(count, passes) : count, windowPasses ?? count)),
      load,
      context.athlete.terrainAccess
    );
    if (content === null) return { blocked: { reason: "no_light_dh_drill", target: final.kind } };
    return { content, rule: DAILY_ADAPTATION_RULES_V2.replaceDh, durationMin: final.durationMin ?? (load === "LIGHT" ? PLAN_ROLE_DOSES_V2.consolidation.dhDurationMin : PLAN_ROLE_DOSES_V2.build.dhDurationMin) };
  }
  if (final.kind === "AEROBIC_BASE") {
    const minutes = Math.min(Math.max(final.durationMin ?? PLAN_ROLE_DOSES_V2.taper.aerobicBaseDurationMin, 45), 90);
    const content = buildAerobicBasePrescriptionV2Content({ sessionKind: "AEROBIC_BASE", durationMin: minutes, catalog, ridingAvailable: context.ridingAvailable });
    return { content, rule: DAILY_ADAPTATION_RULES_V2.replaceEndurance, durationMin: minutes };
  }
  if (final.kind === "RECOVERY_ACTIVE") {
    const content = buildRecoveryActivePrescriptionV2Content({ catalog });
    if (timeLimitMin === undefined) return { content, rule: DAILY_ADAPTATION_RULES_V2.replaceRecovery };
    const within = recoveryWithin(content, timeLimitMin);
    return within === null ? { blocked: { reason: "recovery_duration_not_supported", timeLimitMin } } : { content: within, rule: DAILY_ADAPTATION_RULES_V2.replaceRecovery };
  }
  return { blocked: { reason: "replace_target_not_supported", target: final.kind } };
}

/**
 * PHYS-01 — lineage of a short Force: each of its items derives from the
 * planned item of the same block role and exercise (first unused, in order).
 * An item without such a planned item is a contract error (the short Force
 * never adds an exercise).
 */
function lineageByExercise(planned: PrescriptionV2, content: PrescriptionV2Content): string[] {
  const used = new Set<string>();
  return content.blocks.flatMap((block) =>
    block.items.map((item) => {
      const id = item.kind === "exercise" ? item.exerciseId : item.drillId;
      const source = planned.blocks
        .filter((b) => b.role === block.role)
        .flatMap((b) => b.items)
        .find((p) => !used.has(p.prescriptionItemId) && (p.kind === "exercise" ? p.exerciseId : p.drillId) === id);
      if (!source) throw new SessionModelV2ContractError(`short Force: ${id} (${block.role}) is not in the planned session`);
      used.add(source.prescriptionItemId);
      return source.prescriptionItemId;
    })
  );
}

function identified(content: PrescriptionV2Content, mintId: () => string, derivedFrom: readonly string[] | null): PrescriptionV2 {
  const structure = assignPrescriptionIds(content, mintId);
  if (derivedFrom === null) return structure;
  let index = 0;
  const blocks: BlockV2[] = structure.blocks.map((b) => ({
    ...b,
    items: b.items.map((item) => {
      const from = derivedFrom[index++];
      return from !== undefined ? { ...item, derivedFromItemId: from } : item;
    }),
  }));
  return { ...structure, blocks };
}

/** P0-3 — the final prescription of a manual session (see the header). */
function buildManualFinalPrescriptionV2(input: BuildFinalPrescriptionV2Input): FinalPrescriptionV2Result {
  const { decision, lineage, adaptation } = input;
  const final = decision.finalSession;
  if (lineage!.currentPlanVersionId === null || lineage!.currentPlanCoversDate !== true) {
    return blocked("final_prescription_no_lineage", { reason: "manual_session_outside_current_plan" });
  }
  if (adaptation === null) return blocked("final_prescription_adaptation_not_defined", { reason: "no_adaptation_context" });
  // The validated V2 Force doses are LIGHT and MODERATE only: a HEAVY manual Force is refused, never silently lightened.
  if ((STRENGTH_KINDS as readonly string[]).includes(final.kind) && final.loadProfile === "HEAVY") {
    return blocked("final_prescription_adaptation_not_defined", { reason: "manual_load_not_supported", target: final.kind, loadProfile: "HEAVY" });
  }

  let built: Built;
  try {
    built = replacementContent(null, final, adaptation, input.timeLimitMin, input.strengthVariant);
  } catch (error) {
    if (error instanceof SessionModelV2GenerationBlockedError) return blocked("final_prescription_adaptation_not_defined", { reason: error.code, ...error.detail });
    throw error;
  }
  if ("blocked" in built) {
    const reason = built.blocked.reason === "replace_target_not_supported" ? "manual_kind_not_supported" : built.blocked.reason;
    return blocked("final_prescription_adaptation_not_defined", { ...built.blocked, reason, target: final.kind });
  }

  const action = decision.decision === "KEEP" ? "keep" : decision.decision === "MODIFY" ? "modify" : "replace";
  const structure = identified(built.content, adaptation.mintId, null);
  const validation = validatePrescriptionV2(structure, { stage: "final" });
  if (!validation.ok) {
    throw new SessionModelV2ContractError(`manual final prescription is invalid: ${validation.issues.map((i) => `${i.path} ${i.code}`).join(", ")}`);
  }
  const finalPrescription: FinalPrescriptionV2 = {
    id: input.finalPrescriptionId,
    decisionId: decision.decisionId,
    planVersionId: lineage!.currentPlanVersionId,
    activeSessionOrigin: "manual_override_new_kind",
    // P0-3 (HPM option P1) — the action mirrors M1's decision (persist_daily_run_v2); a KEEP carries no adaptation rule.
    reconciliationAction: action,
    adaptationRuleIds: action === "keep" ? [] : [DAILY_ADAPTATION_RULES_V2.manualSession, built.rule, ...(input.timeLimitMin !== undefined ? [DAILY_ADAPTATION_RULES_V2.todayTimeLimit] : [])],
    schemaVersion: "v2",
    catalogVersion: structure.catalog.aggregate,
    structure,
  };
  const effectiveDurationMin = built.durationMin ?? final.durationMin;
  return { status: "created", finalPrescription, ...(effectiveDurationMin !== undefined ? { effectiveDurationMin } : {}) };
}

export function buildFinalPrescriptionV2(input: BuildFinalPrescriptionV2Input): FinalPrescriptionV2Result {
  const { decision, lineage, plannedPrescription, adaptation } = input;
  // P0-3 — a manual session: built from the rider's V2 context for M1's final kind (REST stays REST below).
  if (decision.decision !== "REST" && lineage !== null && lineage.plannedSessionSource === "manual") return buildManualFinalPrescriptionV2(input);
  if (decision.decision === "REST" || decision.decision === "KEEP") return buildKeepFinalPrescriptionV2(input);

  const failure = lineageFailure(lineage, plannedPrescription);
  if (failure !== null) return blocked("final_prescription_no_lineage", { reason: failure });
  const generated = lineage!.generatedSession!;
  const planned = plannedPrescription!;
  const trusted = trustedPlannedStructure(planned, generated.kind);
  if ("catalogMismatch" in trusted) return blocked("final_prescription_catalog_mismatch", trusted.catalogMismatch);
  if (adaptation === null) return blocked("final_prescription_adaptation_not_defined", { reason: "no_adaptation_context" });

  const final = decision.finalSession;
  const isModify = decision.decision === "MODIFY";
  if (isModify && trusted.catalog.aggregate !== SESSION_MODEL_V2_AGGREGATE_VERSION) {
    // §9 — never adapt an older document with the current tables.
    return blocked("final_prescription_catalog_mismatch", { plannedAggregate: trusted.catalog.aggregate, runtimeAggregate: SESSION_MODEL_V2_AGGREGATE_VERSION });
  }
  if (isModify && final.kind !== generated.kind) {
    return blocked("final_prescription_adaptation_not_defined", { reason: "modify_kind_change_not_supported", planned: generated.kind, final: final.kind });
  }

  let built: Built;
  try {
    built = isModify
      ? modifiedContent(trusted, generated.loadProfile, final, adaptation, input.timeLimitMin, input.strengthVariant)
      : replacementContent(trusted, final, adaptation, input.timeLimitMin, input.strengthVariant);
  } catch (error) {
    // A V2 locked block (no compatible exercise for the declared equipment, DH data missing…) is an explicit refusal, never a fallback.
    if (error instanceof SessionModelV2GenerationBlockedError) return blocked("final_prescription_adaptation_not_defined", { reason: error.code, ...error.detail });
    throw error;
  }
  if ("blocked" in built) return blocked("final_prescription_adaptation_not_defined", built.blocked);

  const derivedFrom = !isModify
    ? null
    : built.lineageByExercise
      ? lineageByExercise(trusted, built.content)
      : flatItems(trusted.blocks).map((i) => (i as { prescriptionItemId: string }).prescriptionItemId);
  if (isModify && derivedFrom!.length !== flatItems(built.content.blocks).length) {
    throw new SessionModelV2ContractError(`MODIFY changed the number of items (${derivedFrom!.length} → ${flatItems(built.content.blocks).length})`);
  }
  const structure = identified(built.content, adaptation.mintId, derivedFrom);
  const validation = validatePrescriptionV2(structure, { stage: "final" });
  if (!validation.ok) {
    throw new SessionModelV2ContractError(`${decision.decision} final prescription is invalid: ${validation.issues.map((i) => `${i.path} ${i.code}`).join(", ")}`);
  }

  const finalPrescription: FinalPrescriptionV2 = {
    id: input.finalPrescriptionId,
    decisionId: decision.decisionId,
    planVersionId: lineage!.sourcePlanVersionId!,
    ...(isModify ? { plannedPrescriptionId: planned.id } : {}),
    activeSessionOrigin: "generated",
    reconciliationAction: isModify ? "modify" : "replace",
    adaptationRuleIds: input.timeLimitMin !== undefined ? [built.rule, DAILY_ADAPTATION_RULES_V2.todayTimeLimit] : [built.rule],
    schemaVersion: "v2",
    catalogVersion: structure.catalog.aggregate,
    structure,
  };
  // A07 — the effective duration: the content's own, else the decision's (a MODIFY DH keeps M1's window), else the planned one.
  const effectiveDurationMin = built.durationMin ?? final.durationMin ?? (isModify && generated.durationMin !== null ? generated.durationMin : undefined);
  return { status: "created", finalPrescription, ...(effectiveDurationMin !== undefined ? { effectiveDurationMin } : {}) };
}

