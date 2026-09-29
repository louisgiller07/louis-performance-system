import { describe, expect, it } from "vitest";
import {
  DOMAIN_LABELS,
  formatRepetitionRange,
  formatRepetitions,
  translateDomain,
  translateSkill,
  translateTerrain,
  translateTrainingKind,
  translateWeekType,
  UNKNOWN_SESSION_LABEL,
  WEEK_TYPE_LABELS,
} from "./trainingLabels";
import { TRAINING_KIND_LABELS } from "../dailyPlan/dailyPlanLabels";
import { TECHNICAL_PRIORITY_LABELS, TERRAIN_LABELS } from "../performanceSetup/performanceSetupOptions";

// Every identifier the engines/DB can currently produce (DB enums plan_session_kind / plan_week_type,
// planning-engine SessionDoseTarget.domain, drill catalogue skillTarget / terrainRequirement).
const SESSION_KINDS = [
  "STRENGTH_LOWER", "STRENGTH_UPPER", "STRENGTH_FULL_LIGHT", "POWER", "GRIP_WORK", "AEROBIC_BASE", "AEROBIC_INTERVALS", "DH_TECHNICAL",
  "DH_PERFORMANCE", "DH_LIGHT", "PUMPTRACK", "MOBILITY", "RECOVERY_ACTIVE", "REST", "BIKE_MAINTENANCE", "RACE_ACTIVITY",
];
const DOMAINS = ["strength", "dh_technical", "aerobic", "recovery"];
const WEEK_TYPES = ["development", "deload", "taper", "race", "recovery"];
const SKILLS = ["braking", "cornering", "jumps", "line_choice", "race_execution", "roots_rocks", "steep_terrain"];
const TERRAINS = [
  "any_groomed_trail", "bermed_trail", "bike_park_jump_line", "flow_trail", "full_dh_track", "rock_garden", "root_rock_trail",
  "steep_technical_trail", "technical_trail",
];

const UNKNOWN_VALUES = ["UNKNOWN_DOMAIN_X", "strength_lower", "toString", "constructor", "", "   ", null, undefined, 42];

function expectFrenchLabel(label: string | null, id: string) {
  expect(label, id).not.toBeNull();
  expect(label, id).not.toBe(id);
  expect(label, id).not.toMatch(/_/);
}

describe("trainingLabels — every known identifier (REV-015.2)", () => {
  it("session kinds: all 16, reusing TRAINING_KIND_LABELS (no second table)", () => {
    for (const kind of SESSION_KINDS) {
      expectFrenchLabel(translateTrainingKind(kind), kind);
      expect(translateTrainingKind(kind)).toBe(TRAINING_KIND_LABELS[kind as keyof typeof TRAINING_KIND_LABELS]);
    }
    expect(Object.keys(TRAINING_KIND_LABELS).sort()).toEqual([...SESSION_KINDS].sort());
  });

  it("domains: all 4", () => {
    expect(DOMAINS.map(translateDomain)).toEqual(["Force", "DH", "Aérobie", "Récupération"]);
    expect(Object.keys(DOMAIN_LABELS).sort()).toEqual([...DOMAINS].sort());
  });

  it("week types: all 5 of plan_week_type", () => {
    expect(WEEK_TYPES.map(translateWeekType)).toEqual(["Développement", "Allègement", "Affûtage", "Course", "Récupération"]);
    expect(Object.keys(WEEK_TYPE_LABELS).sort()).toEqual([...WEEK_TYPES].sort());
  });

  it("skills: all 7 drill skill targets, reusing TECHNICAL_PRIORITY_LABELS", () => {
    for (const skill of SKILLS) {
      expectFrenchLabel(translateSkill(skill), skill);
      expect(translateSkill(skill)).toBe(TECHNICAL_PRIORITY_LABELS[skill as keyof typeof TECHNICAL_PRIORITY_LABELS]);
    }
  });

  it("terrains: all 9 drill terrain requirements, reusing TERRAIN_LABELS", () => {
    for (const terrain of TERRAINS) {
      expectFrenchLabel(translateTerrain(terrain), terrain);
      expect(translateTerrain(terrain)).toBe(TERRAIN_LABELS[terrain as keyof typeof TERRAIN_LABELS]);
    }
  });
});

describe("trainingLabels — unknown, empty, null, undefined (REV-015.2)", () => {
  it("every translate* returns null, never the raw identifier", () => {
    for (const fn of [translateTrainingKind, translateDomain, translateWeekType, translateSkill, translateTerrain]) {
      for (const value of UNKNOWN_VALUES) expect(fn(value), `${fn.name}(${String(value)})`).toBeNull();
    }
  });

  it("the neutral session wording is French", () => {
    expect(UNKNOWN_SESSION_LABEL).toBe("Séance d'entraînement");
  });
});

describe("repetition units (REV-015.2)", () => {
  it("'répétition(s)' replaces 'reps', singular for 1", () => {
    expect(formatRepetitions(1)).toBe("1 répétition");
    expect(formatRepetitions(8)).toBe("8 répétitions");
    expect(formatRepetitionRange(8, 12)).toBe("8-12 répétitions");
  });
});
