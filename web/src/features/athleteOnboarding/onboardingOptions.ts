// V0.3_008A — Athlete Onboarding V1 (Niveau 1). Closed option lists only —
// no free-text input for any of these four questions. Values are persisted
// verbatim as the DB's `text`/`jsonb` payload (see athleteOnboardingRepo.ts)
// — the DB itself only enforces "non-blank", the closed list lives here so
// the wording can evolve without a migration (same reasoning as the
// migration's own comment).

export const DISCIPLINE_OPTIONS = ["Downhill", "Enduro", "Freeride", "Other"] as const;
export type Discipline = (typeof DISCIPLINE_OPTIONS)[number];

export const COMPETITION_LEVEL_OPTIONS = [
  "Beginner",
  "Amateur racer",
  "National level",
  "European Cup",
  "World Cup",
] as const;
export type CompetitionLevel = (typeof COMPETITION_LEVEL_OPTIONS)[number];

export const PRIMARY_GOAL_OPTIONS = [
  "Race performance",
  "Consistency",
  "Technical skills",
  "Fitness",
  "Injury prevention",
] as const;
export type PrimaryGoal = (typeof PRIMARY_GOAL_OPTIONS)[number];

export const WEEKLY_TRAINING_HOURS_OPTIONS = ["Less than 5h", "5-10h", "10-15h", "15h+"] as const;
export type WeeklyTrainingHours = (typeof WEEKLY_TRAINING_HOURS_OPTIONS)[number];

export const RIDING_DAY_OPTIONS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;
export type RidingDay = (typeof RIDING_DAY_OPTIONS)[number];
