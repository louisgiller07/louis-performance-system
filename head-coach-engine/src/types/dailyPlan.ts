import type { TrainingMode, EventContext } from "./context.js";
import type { TrainingIntervention, TrainingInterventionKind } from "./trainingIntervention.js";
import type { TriggeredRule } from "./triggeredRule.js";
import type { HealthFlagToCreate } from "./healthFlag.js";
import type { RecentRecoveryContext } from "./rawContext.js";

// Confidence qualitative — voir docs/04_DAILY_DECISION_ENGINE.md §6 et
// docs/11_DECISION_LOG.md (2026-08-11 — Confidence qualitative en V0.2).
// Tout score numérique de confidence est proscrit en V0.2.
export type Confidence = "LOW" | "MEDIUM" | "HIGH";

/**
 * Décision d'arbitrage KEEP/MODIFY/REPLACE/REST — voir
 * docs/04_DAILY_DECISION_ENGINE.md §5. Ce champ n'apparaît pas explicitement
 * dans le pseudo-schéma DailyPlan de la spec (implicite via comparaison
 * planned_session_before / final_session), mais docs/10_TEST_PLAN.md §T7
 * teste ces 4 libellés directement. Ajouté ici comme extension explicite
 * pour rendre l'arbitrage testable sans ambiguïté — voir résumé de session
 * pour Louis.
 */
export type ArbitrationDecision = "KEEP" | "MODIFY" | "REPLACE" | "REST";

export interface TrainingPlanSection {
  active: boolean;
  session_type?: TrainingIntervention;
  duration_min?: number;
  time_slot?: string;
  content_ref?: string;
  objective?: string;
}

/**
 * V0.3_008B — immutable snapshot of what today's coach actually surfaced
 * (as opposed to `RawContext.recent_technical_context`, which is merely
 * what the engine knew — see rawContext.ts). Same fields as
 * `RecentTechnicalContext` minus `age_days`: a frozen day-count would read
 * wrong when the plan is viewed weeks/months later, so athlete-facing copy
 * is deliberately non-dated (see docs/11_DECISION_LOG.md V0.3_008B).
 * `source_decision_id` is internal provenance only, never rendered
 * athlete-facing.
 */
export interface PriorTaskReference {
  source_decision_id: string;
  session_date: string;
  kind: TrainingInterventionKind;
  execution_task: string;
  technical_outcome: "yes" | "partial" | "no";
}

export interface DhTechnicalSection {
  active: boolean;
  focus?: string;
  /**
   * V0.3_006C1, corrected V0.3_008B0 — how to work on `focus` today. Fixed
   * generic task per DH-family `kind`, independent of `focus`: present
   * whenever the final session is DH-family, regardless of whether a
   * personal `technique_primary_focus` is configured. Never derived from
   * that personal free text (no LLM, no keyword/regex/taxonomy inference) —
   * see docs/11_DECISION_LOG.md V0.3_008B0.
   */
  execution_task?: string;
  /**
   * V0.3_006C1 (final correction) — deterministic riding-behavior guidance
   * for the FINAL `load_profile`, distinct from `execution_task` (how to
   * work the technical `focus`) and from `spot_hint` (terrain). This is
   * substantive coaching prescription, not a UI label — it must be
   * engine-emitted and persisted, never synthesized by the web layer, so a
   * historical DailyPlan predating this field never retroactively gains
   * this instruction merely because the web bundle changed. Populated only
   * for a DH-family final session with a resolved `load_profile`.
   */
  load_guidance?: string;
  spot_hint?: string;
  /**
   * V0.3_008B — the most recent valid technical fact (task + outcome) from
   * an earlier day, display-only. Populated ONLY when `active === true`
   * (today's final session is itself DH-family) AND
   * `RawContext.recent_technical_context` resolved a candidate — never
   * fabricated, never mutates/replaces/suppresses `execution_task` above.
   * Immutable once persisted (see docs/11_DECISION_LOG.md V0.3_008B).
   */
  prior_task_reference?: PriorTaskReference;
}

export interface MentalSection {
  active: boolean;
  focus?: string;
  action_hint?: string;
}

export interface RecoverySection {
  active: boolean;
  actions: string[];
}

export interface NutritionSection {
  active: boolean;
  focus?: string;
  hydration_target_l?: number;
  notes?: string;
}

export interface SleepSection {
  active: boolean;
  target_hours?: number;
  bedtime_hint?: string;
  notes?: string;
}

export interface ProtectionSection {
  do_not_do: string[];
}

export interface MonitoringSection {
  observe: string[];
}

/**
 * DailyPlan — sortie principale du moteur. Voir docs/04_DAILY_DECISION_ENGINE.md §6
 * et docs/07_GLOSSARY.md.
 */
export interface DailyPlan {
  date: string;
  active_mode: TrainingMode;
  event_context?: EventContext;

  training: TrainingPlanSection;
  dh_or_technical: DhTechnicalSection;
  mental: MentalSection;
  recovery: RecoverySection;
  nutrition: NutritionSection;
  sleep: SleepSection;
  protection: ProtectionSection;
  monitoring: MonitoringSection;

  reasoning: string;
  confidence: Confidence;

  triggered_rules: TriggeredRule[];

  /**
   * V0.3.012 — le sous-ensemble de `triggered_rules` qui explique
   * effectivement la décision finale (layer A dans reasoningBuilder.ts),
   * exactement les mêmes règles que celles jointes dans `reasoning` /
   * `training.objective` ci-dessus. Existe pour que le panneau athlète
   * "Pourquoi cette décision ?" (et l'historique, qui réutilise le même
   * composant) n'ait plus jamais à retomber sur `triggered_rules` brut
   * (qui inclut aussi les règles monitoring-only comme C3.7 et les
   * règles de domaine intermédiaires devenues obsolètes après une
   * décision REPLACE) — voir docs/11_DECISION_LOG.md V0.3.012.
   * Absent pour toute décision persistée avant ce jalon ; un consommateur
   * doit alors retomber sur `triggered_rules` (fallback legacy).
   */
  decision_reasoning?: TriggeredRule[];

  health_flag_to_create?: HealthFlagToCreate;

  planned_session_before: TrainingIntervention | null;
  final_session: TrainingIntervention;
  decision: ArbitrationDecision;

  overrode_race_protocol: boolean;
  override_reason?: string;

  /**
   * V0.3_008A — instantané immuable du contexte de récupération J-1
   * réellement consommé au moment de la génération de CETTE décision.
   * Jamais recalculé/reconstruit en aval (History/Today restaurent ce
   * champ tel quel) : si la session complétée source est corrigée plus
   * tard, cette décision déjà persistée continue de refléter ce que le
   * moteur a réellement vu — voir docs/11_DECISION_LOG.md V0.3_008A.
   * Absent pour toute décision antérieure à ce jalon, ou quand aucun
   * contexte J-1 éligible n'existait.
   */
  recent_recovery_context?: RecentRecoveryContext;

  engine_version: string;
}
