/**
 * BUG-V2-2 — V2 block progression: the role, template and executable dose of
 * every week of a block, decided for the whole block at once (races ahead,
 * position in the build cycle, recent history, fixed sessions, availability).
 *
 * Roles (PLAN_ROLE_DOSES_V2), in priority order for each week:
 *   1. a race in the week           → race (no session);
 *   2. a race next week             → taper;
 *   3. a race in two weeks          → race_specific (riding first, strength
 *      maintained, no overload);
 *   4. otherwise a development week: introduction first (block start without
 *      recent training, or the week after a race), then the build cycle
 *      build → build+ → consolidation, repeated with cycle + 1.
 *
 * Holds (never a mechanical increase): ≥ PLAN_MISSED_SESSIONS_HOLD_V2 recent
 * missed / replaced sessions hold the first build+ at build; a week with a
 * fixed (locked) date stays at build, cycle-0 dose; a beginner's Force never
 * goes beyond MODERATE.
 *
 * Availability (BUG-V2-1) stays the top constraint: when a session of the
 * week does not fit any window at its target duration, the domain steps down
 * its own ladder (Force 60 → LIGHT 45, DH 90 → 75 → 60 with fewer passes,
 * endurance −15 min down to 45) as long as that places more sessions; never
 * a session created to follow the curve.
 *
 * Pure and deterministic: no clock, no randomness.
 */
import {
  PLAN_DH_DURATION_STEPS_V2,
  PLAN_DOSE_POLICY_V2_VERSION,
  PLAN_MISSED_SESSIONS_HOLD_V2,
  PLAN_PROGRESSION_CAPS_V2,
  PLAN_RECENT_TRAINING_MINUTES_V2,
  PLAN_ROLE_DOSES_V2,
  type PlanDosedRoleV2,
  type PlanLoadV2,
} from "../../catalog/planDosePolicyV2.js";
import { STRENGTH_DOSE_STEP_LOAD_V2, type StrengthDoseStepV2 } from "../../catalog/strengthDoseCatalogV2.js";
import { WEEK_TEMPLATE_CATALOG, type WeekTemplateCatalogEntry } from "../../catalog/weekTemplateCatalog.js";
import { segmentWeek, type SessionDomain } from "../../pipeline/weekSegmenter.js";
import type { BlockShapingInput, WeekShape } from "../../pipeline/sessionDoseModel.js";
import type { WeekProgressionReasonCode, WeekProgressionRole, WeekType } from "../../types/planWeek.js";
import type { PlanInputRace } from "../../types/planInputSnapshot.js";
import { SessionModelV2ContractError } from "../generationErrors.js";

/** Week type and template of each role (a role is never a new week type). */
const ROLE_WEEK: Readonly<Record<WeekProgressionRole, { weekType: WeekType; templateId: string }>> = {
  introduction: { weekType: "development", templateId: "development" },
  build: { weekType: "development", templateId: "development" },
  build_plus: { weekType: "development", templateId: "development" },
  consolidation: { weekType: "deload", templateId: "deload" },
  race_specific: { weekType: "development", templateId: "development_race_specific" },
  taper: { weekType: "taper", templateId: "taper" },
  race: { weekType: "race", templateId: "race" },
};

const BUILD_CYCLE: readonly PlanDosedRoleV2[] = ["build", "build_plus", "consolidation"];

/**
 * Closed English phrases (translated by the web, never free text). Race and
 * taper reuse the planner's existing phrases.
 */
export const BLOCK_PROGRESSION_PHRASES_V2 = {
  introduction: "Introduction week: baseline doses to start the block.",
  reprise: "Return week after the race: back to baseline doses.",
  build: "Build week: standard development load.",
  buildNextCycle: "Build week: load raised from the previous cycle.",
  build_plus: "Overload week: the highest load of the cycle.",
  consolidation: "Consolidation week: reduced load to absorb the previous weeks.",
  race_specific: "Race-specific week, two weeks before the race: riding first, strength maintained without overload.",
  taper: "Taper week ahead of an upcoming race: reduced volume versus a normal development week.",
  race: "Race week: minimal structured volume, no new strength stimulus.",
  recent_training_history: "Recent training history: the block starts at build level.",
  recent_missed_sessions_hold: "Overload postponed: several recent sessions were missed or replaced.",
  fixed_sessions_hold: "Fixed sessions this week: load held, no increase.",
  beginner_strength_cap: "Strength volume kept moderate for a beginner level.",
  adapted_to_availability: "Sessions shortened to fit the available time.",
} as const;

interface DomainOption {
  durationMin: number;
  load: PlanLoadV2;
  forceDoseStep?: StrengthDoseStepV2;
  dhPasses?: number;
}

interface ShapedWeekDoseV2 {
  strength: DomainOption;
  dh_technical: DomainOption;
  aerobic: DomainOption;
}

/** Session load of a domain in a shaped week: Force from its dose step, DH / endurance from the role (availability never changes them). */
export function shapedLoadV2(shape: WeekShape, domain: SessionDomain): PlanLoadV2 {
  const { role, targets } = shape.progression;
  if (role === "race") throw new SessionModelV2ContractError("no session expected in a race week");
  if (domain === "strength") {
    if (targets.forceDoseStep === null) throw new SessionModelV2ContractError(`no Force target in a ${role} week`);
    return STRENGTH_DOSE_STEP_LOAD_V2[targets.forceDoseStep];
  }
  return domain === "dh_technical" ? PLAN_ROLE_DOSES_V2[role].dhLoad : PLAN_ROLE_DOSES_V2[role].aerobicLoad;
}

function overlaps(start: string, end: string, race: PlanInputRace): boolean {
  return race.startDate <= end && race.endDate >= start;
}

function template(id: string): WeekTemplateCatalogEntry {
  const entry = WEEK_TEMPLATE_CATALOG[id];
  if (entry === undefined || entry.deprecated) throw new SessionModelV2ContractError(`week template "${id}" missing from the catalog`);
  return entry;
}

interface PlannedRole {
  role: WeekProgressionRole;
  /** The block's build cycle (0-based). */
  cycle: number;
  /** The cycle the dose is computed at (0 when a fixed session holds the week). */
  doseCycle: number;
  reasons: WeekProgressionReasonCode[];
  phrases: string[];
}

/** Step 1 — the role of every week (races, cycle position, holds); no availability yet. */
function planRoles(input: BlockShapingInput): PlannedRole[] {
  const { weeks, races } = input;
  const raceIn = (i: number) => i < weeks.length && races.some((r) => overlaps(weeks[i]!.startDate, weeks[i]!.endDate, r));
  const recentlyTrained = input.recentHistory.trailingVolumeMinutes >= PLAN_RECENT_TRAINING_MINUTES_V2;
  const missedHold = input.recentHistory.recentMissedOrReplacedCount >= PLAN_MISSED_SESSIONS_HOLD_V2;

  let introductionDue = !recentlyTrained;
  let afterRace = false;
  let cyclePosition = 0;
  let cycle = 0;
  let firstDevelopmentWeek = true;

  return weeks.map((week, i) => {
    if (raceIn(i)) {
      afterRace = true;
      return { role: "race", cycle, doseCycle: cycle, reasons: ["race_in_week"], phrases: [BLOCK_PROGRESSION_PHRASES_V2.race] };
    }
    if (raceIn(i + 1)) return { role: "taper", cycle, doseCycle: 0, reasons: ["race_in_next_week"], phrases: [BLOCK_PROGRESSION_PHRASES_V2.taper] };
    if (raceIn(i + 2)) return { role: "race_specific", cycle, doseCycle: 0, reasons: ["race_in_two_weeks"], phrases: [BLOCK_PROGRESSION_PHRASES_V2.race_specific] };

    const hasFixedSession = input.lockedDates.some((d) => d.date >= week.startDate && d.date <= week.endDate);
    if (afterRace) {
      // After a race the block restarts from baseline.
      afterRace = false;
      introductionDue = false;
      firstDevelopmentWeek = false;
      cyclePosition = 0;
      cycle = 0;
      return { role: "introduction", cycle, doseCycle: 0, reasons: ["post_race_reprise"], phrases: [BLOCK_PROGRESSION_PHRASES_V2.reprise] };
    }
    if (introductionDue) {
      introductionDue = false;
      firstDevelopmentWeek = false;
      return { role: "introduction", cycle, doseCycle: 0, reasons: ["block_start_baseline"], phrases: [BLOCK_PROGRESSION_PHRASES_V2.introduction] };
    }

    const reasons: WeekProgressionReasonCode[] = [];
    const phrases: string[] = [];
    if (firstDevelopmentWeek && recentlyTrained) {
      reasons.push("recent_training_history");
      phrases.push(BLOCK_PROGRESSION_PHRASES_V2.recent_training_history);
    }
    firstDevelopmentWeek = false;

    let role: WeekProgressionRole = BUILD_CYCLE[cyclePosition]!;
    const weekCycle = cycle;
    cyclePosition += 1;
    if (cyclePosition === BUILD_CYCLE.length) {
      cyclePosition = 0;
      cycle += 1;
    }

    const phraseFor = (r: WeekProgressionRole) =>
      r === "build" ? (weekCycle > 0 ? BLOCK_PROGRESSION_PHRASES_V2.buildNextCycle : BLOCK_PROGRESSION_PHRASES_V2.build) : BLOCK_PROGRESSION_PHRASES_V2[r as "build_plus" | "consolidation"];
    reasons.unshift(role === "consolidation" ? "cycle_unload" : "cycle_progression");

    if (role === "build_plus" && weekCycle === 0 && missedHold) {
      role = "build";
      reasons.push("recent_missed_sessions_hold");
      phrases.push(BLOCK_PROGRESSION_PHRASES_V2.recent_missed_sessions_hold);
    }
    let doseCycle = weekCycle;
    if (hasFixedSession && (role === "build" || role === "build_plus")) {
      role = "build";
      doseCycle = 0;
      reasons.push("fixed_sessions_hold");
      phrases.push(BLOCK_PROGRESSION_PHRASES_V2.fixed_sessions_hold);
    }
    return { role, cycle: weekCycle, doseCycle, reasons, phrases: [phraseFor(role), ...phrases] };
  });
}

/** Target dose of a role at a cycle (one lever per domain, capped). */
function targetDose(role: PlanDosedRoleV2, cycle: number, beginner: boolean): { dose: ShapedWeekDoseV2; beginnerCapped: boolean } {
  const base = PLAN_ROLE_DOSES_V2[role];
  const beginnerCapped = beginner && base.forceDoseStep === "MODERATE_PLUS";
  const forceDoseStep: StrengthDoseStepV2 = beginnerCapped ? "MODERATE" : base.forceDoseStep;
  return {
    beginnerCapped,
    dose: {
      strength: { durationMin: base.forceDurationMin, load: STRENGTH_DOSE_STEP_LOAD_V2[forceDoseStep], forceDoseStep },
      dh_technical: { durationMin: base.dhDurationMin, load: base.dhLoad, dhPasses: Math.min(base.dhFocusedPasses + base.dhPassesPerCycle * cycle, PLAN_PROGRESSION_CAPS_V2.dhPassesMax) },
      aerobic: { durationMin: Math.min(base.aerobicBaseDurationMin + base.aerobicMinPerCycle * cycle, PLAN_PROGRESSION_CAPS_V2.aerobicMaxMin), load: base.aerobicLoad },
    },
  };
}

/** Each domain's availability ladder, from the target down (target first). */
function ladders(target: ShapedWeekDoseV2): Record<SessionDomain, DomainOption[]> {
  const strength: DomainOption[] = [target.strength];
  if (target.strength.forceDoseStep !== "LIGHT") {
    const light = PLAN_ROLE_DOSES_V2.consolidation;
    strength.push({ durationMin: light.forceDurationMin, load: "LIGHT", forceDoseStep: "LIGHT" });
  }
  const dh: DomainOption[] = [target.dh_technical];
  for (const step of PLAN_DH_DURATION_STEPS_V2) {
    if (step.durationMin < target.dh_technical.durationMin) {
      dh.push({ durationMin: step.durationMin, load: target.dh_technical.load, dhPasses: Math.min(target.dh_technical.dhPasses ?? 0, step.maxPasses) });
    }
  }
  const aerobic: DomainOption[] = [target.aerobic];
  for (let d = target.aerobic.durationMin - PLAN_PROGRESSION_CAPS_V2.aerobicStepMin; d >= PLAN_PROGRESSION_CAPS_V2.aerobicMinMin; d -= PLAN_PROGRESSION_CAPS_V2.aerobicStepMin) {
    aerobic.push({ ...target.aerobic, durationMin: d });
  }
  return { strength, dh_technical: dh, aerobic };
}

const FIT_ORDER: readonly SessionDomain[] = ["dh_technical", "strength", "aerobic"];

/** Step 2 — fit the week's durations to the real windows (same placement as the pipeline's WeekSegmenter). */
function fitToAvailability(
  input: BlockShapingInput,
  week: BlockShapingInput["weeks"][number],
  entry: WeekTemplateCatalogEntry,
  target: ShapedWeekDoseV2
): { dose: ShapedWeekDoseV2; adapted: boolean } {
  const options = ladders(target);
  const level: Record<SessionDomain, number> = { strength: 0, dh_technical: 0, aerobic: 0 };
  const placedWith = (lv: Record<SessionDomain, number>) =>
    segmentWeek({
      weekStartDate: week.startDate,
      weekEndDate: week.endDate,
      template: entry,
      availability: input.availability,
      terrainAccess: input.terrainAccess,
      lockedDates: input.lockedDates,
      sessionDurationMinByDomain: {
        strength: options.strength[lv.strength]!.durationMin,
        dh_technical: options.dh_technical[lv.dh_technical]!.durationMin,
        aerobic: options.aerobic[lv.aerobic]!.durationMin,
      },
    });

  const placedOf = (r: ReturnType<typeof placedWith>, domain: SessionDomain) => r.placedSlots.filter((s) => s.domain === domain).length;
  let current = placedWith(level);
  for (const domain of FIT_ORDER) {
    let candidate = level[domain] + 1;
    while (candidate < options[domain].length && current.unplaceable.some((u) => u.domain === domain && u.reason === "insufficient_available_time")) {
      const trial = { ...level, [domain]: candidate };
      const next = placedWith(trial);
      // A shorter dose only when it really places more sessions of this
      // domain, never fewer in total (priority DH > Force > endurance, the
      // segmenter's own order).
      if (placedOf(next, domain) > placedOf(current, domain) && next.placedSlots.length >= current.placedSlots.length) {
        level[domain] = candidate;
        current = next;
      }
      candidate += 1;
    }
  }
  const adapted = FIT_ORDER.some((d) => level[d] > 0);
  return {
    adapted,
    dose: { strength: options.strength[level.strength]!, dh_technical: options.dh_technical[level.dh_technical]!, aerobic: options.aerobic[level.aerobic]! },
  };
}

export function shapeBlockWeeksV2(input: BlockShapingInput): WeekShape[] {
  const roles = planRoles(input);
  const beginner = input.strengthExperienceTier === "beginner";

  return input.weeks.map((week, i): WeekShape => {
    const planned = roles[i]!;
    const { weekType, templateId } = ROLE_WEEK[planned.role];
    const entry = template(templateId);
    const reasons = [...planned.reasons];
    const phrases = [...planned.phrases];

    if (planned.role === "race") {
      return {
        weekType,
        template: entry,
        rationale: phrases.join(" "),
        placementDurationMinByDomain: null,
        progression: {
          model: PLAN_DOSE_POLICY_V2_VERSION,
          role: planned.role,
          cycle: planned.cycle,
          reasonCodes: reasons,
          targets: { forceDoseStep: null, forceDurationMin: null, dhDurationMin: null, dhPasses: null, aerobicDurationMin: null },
        },
      };
    }

    const { dose: target, beginnerCapped } = targetDose(planned.role, planned.doseCycle, beginner);
    if (beginnerCapped && entry.strengthSlotCount > 0) {
      reasons.push("beginner_strength_cap");
      phrases.push(BLOCK_PROGRESSION_PHRASES_V2.beginner_strength_cap);
    }
    const { dose, adapted } = fitToAvailability(input, week, entry, target);
    if (adapted) {
      reasons.push("adapted_to_availability");
      phrases.push(BLOCK_PROGRESSION_PHRASES_V2.adapted_to_availability);
    }

    return {
      weekType,
      template: entry,
      rationale: phrases.join(" "),
      placementDurationMinByDomain: { strength: dose.strength.durationMin, dh_technical: dose.dh_technical.durationMin, aerobic: dose.aerobic.durationMin },
      progression: {
        model: PLAN_DOSE_POLICY_V2_VERSION,
        role: planned.role,
        cycle: planned.cycle,
        reasonCodes: reasons,
        targets: {
          forceDoseStep: entry.strengthSlotCount > 0 ? dose.strength.forceDoseStep! : null,
          forceDurationMin: entry.strengthSlotCount > 0 ? dose.strength.durationMin : null,
          dhDurationMin: entry.dhTechnicalSlotCount > 0 ? dose.dh_technical.durationMin : null,
          dhPasses: entry.dhTechnicalSlotCount > 0 ? dose.dh_technical.dhPasses! : null,
          aerobicDurationMin: entry.aerobicSlotCount > 0 ? dose.aerobic.durationMin : null,
        },
      },
    };
  });
}
