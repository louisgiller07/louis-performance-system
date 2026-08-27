/**
 * M5_007 — the locked projector registry: which (detectorRuleId,
 * detectorRuleVersion) pairs are supported, which PatternInsightKind each
 * maps to, and the exact human-readable copy (title/statement per
 * direction/caveats) for each kind. Every string here is locked verbatim by
 * the M5_007 spec — do not paraphrase, reformat, or "improve" wording here;
 * a wording change is a spec change, not a refactor.
 */
import {
  RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID,
  RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_VERSION,
} from "../detectors/constants.js";
import { SLEEP_ENERGY_RULE_ID, SLEEP_ENERGY_RULE_VERSION } from "../detectors/sleepEnergyConstants.js";
import { PAIN_PERSISTENCE_RULE_ID, PAIN_PERSISTENCE_RULE_VERSION } from "../detectors/painPersistenceConstants.js";
import type { PatternInsightDirection, PatternInsightKind } from "./types.js";

export const PATTERN_INSIGHT_PROJECTOR_VERSION = "1.0.0";

function registryKey(detectorRuleId: string, detectorRuleVersion: string): string {
  return `${detectorRuleId}@${detectorRuleVersion}`;
}

/** Exact three supported pairs (M5_007 lock) — no other detector/version is recognized. */
export const SUPPORTED_INSIGHT_PROJECTORS: ReadonlyMap<string, PatternInsightKind> = new Map([
  [registryKey(RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID, RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_VERSION), "recommendation_execution_alignment"],
  [registryKey(SLEEP_ENERGY_RULE_ID, SLEEP_ENERGY_RULE_VERSION), "sleep_energy_same_day_association"],
  [registryKey(PAIN_PERSISTENCE_RULE_ID, PAIN_PERSISTENCE_RULE_VERSION), "pain_persistence_between_recent_checkins"],
]);

export function resolveInsightKind(detectorRuleId: string, detectorRuleVersion: string): PatternInsightKind | undefined {
  return SUPPORTED_INSIGHT_PROJECTORS.get(registryKey(detectorRuleId, detectorRuleVersion));
}

interface InsightCopy {
  readonly title: string;
  readonly statements: Readonly<Record<PatternInsightDirection, string>>;
  readonly caveats: readonly string[];
}

export const INSIGHT_COPY: Readonly<Record<PatternInsightKind, InsightCopy>> = {
  recommendation_execution_alignment: {
    title: "Exécution des recommandations",
    statements: {
      supporting: "Parmi les observations directionnelles disponibles, les séances recommandées sont le plus souvent réalisées comme prévu.",
      contradicting:
        "Parmi les observations directionnelles disponibles, les séances recommandées sont plus souvent remplacées ou sautées qu’exécutées comme prévu.",
      mixed: "L’exécution réelle des séances recommandées est partagée entre concordance et divergence.",
      neutral: "Les observations disponibles sont uniquement neutres pour l’exécution des recommandations.",
    },
    caveats: ["Décrit l’exécution observée, pas la qualité de la recommandation ni le comportement de l’athlète."],
  },
  sleep_energy_same_day_association: {
    title: "Sommeil et énergie",
    statements: {
      supporting:
        "Parmi les observations directionnelles disponibles, elles vont le plus souvent dans le sens d’une association positive entre qualité du sommeil et énergie le même jour.",
      contradicting:
        "Parmi les observations directionnelles disponibles, elles vont le plus souvent à l’encontre d’une association positive entre qualité du sommeil et énergie le même jour.",
      mixed: "Les observations sommeil-énergie sont partagées entre soutien et contradiction.",
      neutral: "Les observations sommeil-énergie disponibles sont uniquement neutres.",
    },
    caveats: ["Association descriptive uniquement ; aucune causalité n’est inférée."],
  },
  pain_persistence_between_recent_checkins: {
    title: "Persistance de la douleur",
    statements: {
      supporting:
        "Parmi les observations directionnelles disponibles, la même douleur est le plus souvent encore signalée au check-in suivant observé, dans un intervalle maximal de 3 jours.",
      contradicting:
        "Parmi les observations directionnelles disponibles, la douleur est plus souvent résolue au check-in suivant observé qu’encore signalée au même endroit.",
      mixed: "Les observations de persistance de la douleur sont partagées entre continuation et résolution.",
      neutral: "Les observations disponibles de persistance de la douleur sont uniquement neutres ou ambiguës.",
    },
    caveats: [
      "Ne prouve pas une douleur continue pendant les jours sans check-in.",
      "Ne remplace jamais les règles Safety, un diagnostic ou un avis professionnel.",
    ],
  },
};
