// UX-11C.1 — athlete-facing copy of the guided-session shell (UI labels only).
import type { ExecutionPhase } from "./executionState";
import type { UnavailableReason } from "./guidedSessionLoader";

export const PHASE_LABELS: Readonly<Record<ExecutionPhase, string>> = {
  not_started: "pas encore commencée",
  active: "en cours",
  paused: "en pause",
  completed: "terminée",
  abandoned: "arrêtée",
};

export const UNSUPPORTED_SESSION_MESSAGE = "Cette séance n'est pas prise en charge par cette version de l'application.";

export const UNAVAILABLE_MESSAGES: Readonly<Record<UnavailableReason, string>> = {
  no_decision: "Prépare d'abord ta séance du jour sur Aujourd'hui.",
  stale_decision: "Ton plan du jour a changé. Génère un nouveau plan sur Aujourd'hui.",
  rest: "Repos aujourd'hui : pas de séance guidée.",
  blocked: "Pas de séance guidée pour cette recommandation.",
  not_v2: "La séance guidée n'est pas disponible pour ce plan.",
  missing_prescription: "Le détail de ta séance est momentanément indisponible.",
  unsupported: UNSUPPORTED_SESSION_MESSAGE,
  invalid: "Le détail de cette séance n'est pas disponible.",
};

export const ACTION_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  final_prescription_not_current: "Ta séance du jour a changé : vérifie la prescription affichée avant de commencer.",
  active_execution_exists: "Une séance est déjà en cours aujourd'hui : elle est affichée ici.",
  network_error: "Ton action n'a pas été confirmée (connexion). L'état affiché est le dernier enregistré.",
  refused: "Action refusée. L'état affiché est celui enregistré.",
  id_conflict: "Ce résultat a déjà été enregistré avec d'autres valeurs : les valeurs enregistrées sont affichées.",
  invalid_correction: "Ce résultat a déjà été corrigé : un résultat ne se corrige qu'une fois.",
  result_slot_exists: "Un résultat a déjà été enregistré ici (autre appareil ou onglet) : la valeur enregistrée est affichée.",
  execution_terminal: "Cette séance est terminée : ses résultats ne peuvent plus changer.",
  activity_result_exists: "Une activité a déjà été enregistrée pour cette séance (autre appareil ou onglet) : la valeur enregistrée est affichée.",
  activity_result_required: "Enregistre l'activité réalisée avant de terminer la séance.",
  // UX-11R.9 — server invariants (migration 20261005120000).
  dh_pass_required: "Enregistre au moins un passage avant de terminer la séance.",
  // F-6C — server invariant (migration 20261006120000), same wording as the Force screen's own rule.
  strength_set_required: "Enregistre au moins une série de travail pour pouvoir terminer la séance.",
  session_already_completed: "Une séance est déjà terminée aujourd'hui : une nouvelle séance ne peut pas être commencée.",
};

export const PARTIAL_COMPLETION_MESSAGE =
  "Certaines séries prévues n'ont pas de résultat enregistré. Terminer quand même la séance avec les résultats actuellement enregistrés ?";

export const COMPLETION_NOT_READY_MESSAGE = "Tu pourras terminer la séance une fois tes résultats saisis.";
