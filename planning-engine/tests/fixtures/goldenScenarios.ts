/**
 * Golden coaching scenarios (M0 §H / M1 §8). Architectural fixtures, not
 * snapshot tests of an algorithm that doesn't exist yet — each scenario
 * states an input context, the principles a future deterministic planner
 * (M3) must follow, and outcomes it must never produce. Where an invariant
 * is mechanically checkable today (tests/fixtures/invariants.ts), the
 * scenario references the checker by name so M3's planner test suite can
 * wire real generated output straight into it.
 */
import type { PlanInputAvailability, PlanInputSnapshot } from "../../src/types/planInputSnapshot.js";

const FULL_WEEK_AVAILABILITY: PlanInputAvailability = {
  windows: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    dayOfWeek: dayOfWeek as PlanInputAvailability["windows"][number]["dayOfWeek"],
    startTime: "16:00",
    endTime: "20:00",
    label: "evening",
  })),
  exceptions: [],
};

function baseSnapshot(overrides: Partial<PlanInputSnapshot> = {}): PlanInputSnapshot {
  return {
    discipline: "Downhill",
    competitionLevel: "Amateur racer",
    seasonObjective: "General development, no imminent race",
    races: [],
    availability: FULL_WEEK_AVAILABILITY,
    equipment: ["barbell", "squat_rack", "dumbbells", "bench", "pull_up_bar", "cable_machine", "resistance_bands"],
    terrainAccess: ["flow_trail", "bermed_trail", "technical_trail", "rock_garden", "root_rock_trail", "bike_park_jump_line", "full_dh_track"],
    strengthExperienceTier: "intermediate",
    declaredLimitations: [],
    technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: [] },
    lockedDates: [],
    recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 300 },
    ...overrides,
  };
}

export interface GoldenScenario {
  id: string;
  title: string;
  inputSnapshot: PlanInputSnapshot;
  /** Additional narrative context not representable in PlanInputSnapshot alone (e.g. race dates for a race-week scenario). */
  contextNote: string;
  expectedPrinciples: string[];
  forbiddenOutcomes: string[];
  /** Names of invariants.ts functions a future M3 test should apply to this scenario's generated output — documentation only, not invoked here. */
  applicableInvariantCheckers: string[];
}

export const GOLDEN_SCENARIOS: readonly GoldenScenario[] = [
  {
    id: "A",
    title: "Normal development week",
    inputSnapshot: baseSnapshot(),
    contextNote: "No race within the taper window; full equipment and availability.",
    expectedPrinciples: [
      "Development week_type template applies: strength x2, DH-technical x2, aerobic x1, remainder rest/recovery.",
      "No relaxed constraints recorded — every hard constraint is satisfiable.",
    ],
    forbiddenOutcomes: [
      "Two HEAVY strength sessions on consecutive days (recovery spacing violated).",
      "Volume exceeding the athlete's competitionLevel-derived ceiling.",
    ],
    applicableInvariantCheckers: ["noBackToBackHeavyStrength", "loadProfilePresenceMatchesKind"],
  },
  {
    id: "B",
    title: "Race week",
    inputSnapshot: baseSnapshot({
      races: [{ eventName: "Swiss Cup Round 3", startDate: "2026-10-24", endDate: "2026-10-25", priority: "A" }],
      seasonObjective: "Peak for Swiss Cup Round 3",
    }),
    contextNote: "Race falls within the current generated week (2026-10-24).",
    expectedPrinciples: [
      "RACE week_type overrides the development template entirely.",
      "Taper logic applies: reduced volume, no new-stimulus strength work, freshness protected.",
    ],
    forbiddenOutcomes: ["Any HEAVY session within 48h of race start (non-negotiable, mirrors SAFETY-adjacent seriousness)."],
    applicableInvariantCheckers: ["noHeavySessionBeforeRace"],
  },
  {
    id: "C",
    title: "Taper week (week before race)",
    inputSnapshot: baseSnapshot({
      races: [{ eventName: "Swiss Cup Round 3", startDate: "2026-10-31", endDate: "2026-11-01", priority: "A" }],
      seasonObjective: "Peak for Swiss Cup Round 3",
    }),
    contextNote: "Race is one week after the generated week — progressive taper, not full taper yet.",
    expectedPrinciples: [
      "Volume reduced by a fixed step versus a normal development week.",
      "Technical work may shift toward race-specific terrain if declared.",
    ],
    forbiddenOutcomes: ["Introducing a novel exercise/drill the athlete hasn't done recently, this close to a race."],
    applicableInvariantCheckers: ["noHeavySessionBeforeRace"],
  },
  {
    id: "D",
    title: "Limited gym equipment",
    inputSnapshot: baseSnapshot({ equipment: [] }),
    contextNote: "Bodyweight-only — no barbell/dumbbells/rack/bench/pull-up bar/cable/bands declared.",
    expectedPrinciples: [
      "Strength slots still exist in the week — never silently dropped.",
      "Exercise selection filters to bodyweight-compatible catalogue entries only.",
      "If variety is insufficient, a relaxed_constraint is recorded explicitly (never silent repetition with no trace).",
    ],
    forbiddenOutcomes: ["Replacing a strength SLOT with a different session KIND (e.g. extra DH/aerobic) to dodge the equipment constraint."],
    applicableInvariantCheckers: ["strengthSlotsStayStrength"],
  },
  {
    id: "E",
    title: "One weekday suddenly unavailable",
    inputSnapshot: baseSnapshot({
      availability: {
        windows: FULL_WEEK_AVAILABILITY.windows,
        exceptions: [{ date: "2026-10-20", available: false, note: "unplanned late shift" }],
      },
    }),
    contextNote: "A dated exception added to an otherwise-normal week, after a plan may already be accepted (triggers generation_trigger='availability_changed').",
    expectedPrinciples: [
      "The affected date's slot is dropped or moved to a valid day within the same week if capacity allows.",
      "If it cannot be repositioned, a relaxed_constraint is recorded (session count reduced, explicitly noted).",
    ],
    forbiddenOutcomes: [
      "Silently dropping the session with no trace.",
      "Pushing it into a date that is already locked or manually-edited.",
    ],
    applicableInvariantCheckers: ["noSessionOnBlockedDates"],
  },
  {
    id: "F",
    title: "DH access only on weekends",
    inputSnapshot: baseSnapshot({ terrainAccess: ["bike_park_jump_line"] }),
    contextNote: "Terrain access declared as weekend-only (bike park), no weekday DH terrain declared.",
    expectedPrinciples: ["All DH-technical/DH-performance slots concentrate on Saturday/Sunday, overriding the template's default weekday placement."],
    forbiddenOutcomes: ["Scheduling a DH-technical session on a weekday \"because the template usually puts one there\" — terrain hard constraint always wins over template defaults."],
    applicableInvariantCheckers: ["dhSessionsOnlyOnAllowedDates"],
  },
  {
    id: "G",
    title: "Recent missed strength sessions",
    inputSnapshot: baseSnapshot({
      recentHistory: { recentSessionKinds: ["STRENGTH_LOWER", "STRENGTH_LOWER", "STRENGTH_UPPER"], recentMissedOrReplacedCount: 3, trailingVolumeMinutes: 60 },
    }),
    contextNote: "3+ recent strength sessions logged as skipped/replaced.",
    expectedPrinciples: [
      "Next week's strength volume/intensity holds flat or steps down one tier versus what un-adjusted progression would suggest.",
      "rationale explicitly cites the missed-session pattern.",
    ],
    forbiddenOutcomes: ["Escalating volume as if the missed sessions had actually happened — the exact black-box self-modifying-planner failure mode both M0 and this milestone explicitly forbid."],
    applicableInvariantCheckers: ["strengthVolumeDidNotEscalate"],
  },
  {
    id: "H",
    title: "Coach-controlled locked day",
    inputSnapshot: baseSnapshot({ lockedDates: [{ date: "2026-10-22", reason: "external coach session" }] }),
    contextNote: "A specific date flagged locked/coach-controlled.",
    expectedPrinciples: [
      "The locked date is fully off-limits from generation — never a candidate, never counted as an available slot to fill.",
      "Its existence still factors into recovery-spacing rules for the athlete's OWN generated sessions on adjacent days.",
    ],
    forbiddenOutcomes: [
      "Generating anything on the locked date.",
      "Ignoring the locked date's existence when computing spacing for adjacent days.",
    ],
    applicableInvariantCheckers: ["noSessionOnBlockedDates"],
  },
  {
    id: "I",
    title: "Manual override changes session kind",
    inputSnapshot: baseSnapshot(),
    contextNote:
      "A GeneratedPlanSession for a given date has kind=STRENGTH_LOWER with a PlannedPrescription. The athlete manually edits planned_sessions for that date to DH_TECHNICAL (M0 Issue 3).",
    expectedPrinciples: [
      "The immutable generated plan (GeneratedPlanSession, PlannedPrescription) is never modified — history stays exactly as originally generated.",
      "The active coarse session for that date now differs from the plan (origin='manual').",
      "FinalPrescription.activeSessionOrigin = 'manual_override_new_kind', reconciliationAction = 'keep' (Head Coach agrees with the athlete's chosen DH_TECHNICAL kind); a fresh prescription is generated via the shared Prescription module.",
      "FinalPrescription.plannedPrescriptionId is undefined — the original strength prescription is not compatible/executed.",
    ],
    forbiddenOutcomes: [
      "Mutating GeneratedPlanSession or PlannedPrescription to reflect the override.",
      "A FinalPrescription with activeSessionOrigin='manual_override_new_kind' carrying a plannedPrescriptionId (see validateFinalPrescriptionProvenance).",
    ],
    applicableInvariantCheckers: [],
  },
  {
    id: "J",
    title: "Missing availability",
    inputSnapshot: baseSnapshot({ availability: { windows: [], exceptions: [] } }),
    contextNote: "Recurring availability was never declared (M0 Issue 4) — distinct from an athlete explicitly declaring full/generous availability.",
    expectedPrinciples: [
      "Generation is BLOCKED — refuses to run, raises GenerationBlockedError('missing_availability').",
      "Missing availability is never interpreted as full/unlimited availability.",
    ],
    forbiddenOutcomes: ["Producing any GeneratedPlanSession/TrainingPlanVersion at all when availability.windows is empty."],
    applicableInvariantCheckers: [],
  },
];
