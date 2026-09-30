// V0.3_008B — Athlete Onboarding UX Enhancement. Presentation copy only —
// no persisted values, nothing consumed by athleteOnboardingRepo.ts or the
// wizard's step/save logic. Kept separate from onboardingOptions.ts (which
// defines the actual option values written to the DB) so a wording change
// here can never accidentally touch what gets persisted.
//
// PILOT_015 — French copy. The *_LABELS maps below are display-only: the
// option values themselves (e.g. "Downhill", "Amateur racer", "Saturday")
// remain exactly what is written to the DB.
import type { CompetitionLevel, Discipline, PrimaryGoal, RidingDay, WeeklyTrainingHours } from "./onboardingOptions";

// UX-09 — the step titles and questions now live in firstRun/firstRunPresentation.ts.

export const DISCIPLINE_LABELS: Record<Discipline, string> = {
  Downhill: "Descente (DH)",
  Enduro: "Enduro",
  Freeride: "Freeride",
  Other: "Autre",
};

export const COMPETITION_LEVEL_LABELS: Record<CompetitionLevel, string> = {
  Beginner: "Débutant",
  "Amateur racer": "Compétiteur amateur",
  "National level": "Niveau national",
  "European Cup": "Coupe d'Europe",
  "World Cup": "Coupe du monde",
};

export const PRIMARY_GOAL_LABELS: Record<PrimaryGoal, string> = {
  "Race performance": "Performance en course",
  Consistency: "Régularité",
  "Technical skills": "Technique",
  Fitness: "Condition physique",
  "Injury prevention": "Prévention des blessures",
};

export const PRIMARY_GOAL_DESCRIPTIONS: Record<PrimaryGoal, string> = {
  "Race performance": "Être plus rapide quand ça compte.",
  Consistency: "Faire moins d'erreurs et reproduire tes meilleurs runs.",
  "Technical skills": "Construire des bases solides et prendre confiance.",
  Fitness: "Améliorer ta force et ton endurance.",
  "Injury prevention": "T'entraîner plus intelligemment et rester sur le vélo.",
};

export const WEEKLY_TRAINING_HOURS_LABELS: Record<WeeklyTrainingHours, string> = {
  "Less than 5h": "Moins de 5 h",
  "5-10h": "5 à 10 h",
  "10-15h": "10 à 15 h",
  "15h+": "Plus de 15 h",
};

export const RIDING_DAY_LABELS: Record<RidingDay, string> = {
  Monday: "Lundi",
  Tuesday: "Mardi",
  Wednesday: "Mercredi",
  Thursday: "Jeudi",
  Friday: "Vendredi",
  Saturday: "Samedi",
  Sunday: "Dimanche",
};
