/**
 * V0.3_011 — First Personalization Consumer: `primary_goal` → `DailyPlan.reasoning`.
 * See docs/11_DECISION_LOG.md ADR V0.3_011.
 *
 * Pure, closed mapping — no generation, no inference, no LLM. Exactly the
 * five onboarding goal options (web/src/features/athleteOnboarding/
 * onboardingOptions.ts's PRIMARY_GOAL_OPTIONS) map to one fixed sentence
 * each; anything else (absent, unrecognized, legacy) resolves to
 * `undefined` and changes nothing. Deliberately keyed on the exact strings
 * the onboarding UI persists (Title Case, e.g. "Race performance") — NOT
 * the snake_case illustrative keys from the original ticket brief, which
 * don't match any value `AthleteCoachingContext.primary_goal` can actually
 * hold (see this file's own test suite and the V0.3_011 decision-log
 * addendum). Same cross-package duplication precedent already used for
 * `athleteCoachingContextRepo.ts`'s discipline list.
 */
import type { DailyPlan } from "../types/index.js";

const GOAL_REASONING: Readonly<Record<string, string>> = {
  "Race performance": "Ton plan reste aligné avec ton objectif de performance en course : exécution régulière et préparation ciblée.",
  Consistency: "Ton plan vise à construire une performance répétable et à réduire la variabilité.",
  "Technical skills": "Ton plan soutient ta progression technique à travers un travail ciblé des compétences.",
  Fitness: "Ton plan soutient ton développement physique tout en respectant une progression maîtrisée.",
  "Injury prevention": "Ton plan soutient une progression durable et ta disponibilité à long terme.",
};

/** Returns the fixed sentence for a declared goal, or `undefined` for absent/unrecognized/legacy values — never a fabricated default. */
export function resolveGoalRationale(primaryGoal?: string): string | undefined {
  return primaryGoal ? GOAL_REASONING[primaryGoal] : undefined;
}

/**
 * Appends the goal sentence to `DailyPlan.reasoning` — strictly additive,
 * new paragraph (blank line), never touches any other field. Returns the
 * SAME object reference when there is nothing to add (no goal declared, or
 * unrecognized), so "reasoning unchanged" is provably true by identity, not
 * just by value.
 */
export function applyGoalPersonalization(dailyPlan: DailyPlan, primaryGoal?: string): DailyPlan {
  const sentence = resolveGoalRationale(primaryGoal);
  if (!sentence) return dailyPlan;
  return { ...dailyPlan, reasoning: `${dailyPlan.reasoning}\n\n${sentence}` };
}
