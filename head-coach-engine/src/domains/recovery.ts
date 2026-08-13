import type { TrainingIntervention } from "../types/trainingIntervention.js";
import type { EventContext, SoftConstraint } from "../types/context.js";
import type { RecoverySection } from "../types/dailyPlan.js";

/**
 * Couche C — Domaine Sommeil et récupération (minimal en M1, voir
 * docs/12_BACKLOG.md). Ne consomme aucun signal déjà consommé par le
 * domaine training (évite le double-counting, voir docs/03_COACHING_MODEL.md §3) :
 * ce domaine réagit uniquement à la nature de la séance finale et au
 * contexte (mode, event), pas aux dimensions déjà utilisées ailleurs.
 */
export function computeRecoveryDomain(params: {
  finalSession: TrainingIntervention;
  modeConstraints: SoftConstraint[];
  eventContext?: EventContext;
}): RecoverySection {
  const { finalSession, modeConstraints, eventContext } = params;
  const actions: string[] = [];

  // C4.4 — post-DH intense : rouleau/massage avant-bras.
  if (finalSession.kind === "DH_TECHNICAL" || finalSession.kind === "DH_PERFORMANCE") {
    actions.push("5 min de rouleau/massage avant-bras après la session DH");
  }

  // protect_sleep (RACE_CLUSTER) — voir docs/04_DAILY_DECISION_ENGINE.md §3.
  if (modeConstraints.some((c) => c.type === "protect_sleep")) {
    actions.push("Protéger la récupération : coucher à l'heure habituelle, éviter les écrans tardifs");
  }

  // Post-event utile — debrief physique/récupération.
  if (eventContext && eventContext.phase === "POST_EVENT") {
    actions.push("Récupération post-course : hydratation, étirements légers, sommeil prioritaire");
  }

  if (finalSession.kind === "REST" || finalSession.kind === "RECOVERY_ACTIVE") {
    actions.push("Journée orientée récupération : mobilité douce, marche, pas de charge structurée");
  }

  return { active: actions.length > 0, actions };
}
