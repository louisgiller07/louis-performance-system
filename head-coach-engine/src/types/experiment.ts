/**
 * ActiveExperiment — voir docs/03_COACHING_MODEL.md §Experiments actifs et
 * docs/07_GLOSSARY.md. Concept documenté en M1 ; l'implémentation runtime
 * (influence effective sur le moteur, tests T9.1/T9.2) est P1, PAS M1 —
 * voir docs/10_TEST_PLAN.md §T9 et docs/12_BACKLOG.md.
 *
 * Le type existe dès M1 pour que RawContext/ContextState respectent la forme
 * canonique, mais buildDailyPlan() n'en tient pas encore compte.
 */
export type ExperimentStatus = "active" | "expired" | "validated" | "rejected";

export interface ActiveExperiment {
  id: string;
  hypothesis: string;
  start_date: string; // ISO date
  intervention: string;
  metrics: string[];
  review_date?: string; // ISO date
  status: ExperimentStatus;
}
