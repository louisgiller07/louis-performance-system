import { useEffect, useRef, useState } from "react";
import { todayLocal } from "../../lib/date";
import {
  CLOSING_OUTCOMES,
  DATED_OUTCOMES,
  allowedOutcomes,
  loadConcussionFollowUp,
  recordConcussionAttestation,
  type ConcussionFollowUp,
  type ConcussionOutcome,
  type ProfessionalCategory,
} from "./concussionFollowUpRepo";

// SPORT-SAFE-02 A5 (HPM 2026-10-22) — the rider declares the outcome of the medical assessment of a concussion
// signal. Declarative, never verified by NALYNT, no document. Only the server's transitions are offered; the server
// state is read again before any declaration is sent; « in progress » and « confirmed » never reopen the coaching.

export const OUTCOME_LABELS: Record<ConcussionOutcome, string> = {
  assessment_in_progress: "Une évaluation médicale est en cours",
  concussion_confirmed: "Un professionnel de santé a confirmé une commotion",
  ruled_out: "Un professionnel de santé a écarté la commotion",
  full_return_authorised: "Un professionnel de santé m'a autorisé à reprendre complètement l'entraînement",
  entered_in_error: "J'ai déclaré une suspicion de commotion par erreur",
};

const CATEGORY_LABELS: Record<ProfessionalCategory, string> = {
  physician: "Médecin",
  sports_physician: "Médecin du sport",
  physiotherapist: "Physiothérapeute",
  other: "Autre professionnel de santé",
};

export const DECLARATIVE_NOTICE =
  "Ta déclaration est enregistrée telle quelle : NALYNT ne la vérifie pas, et elle ne remplace pas l'avis d'un professionnel de santé.";
const KEEPS_SUSPENSION = "NALYNT continue de suspendre ses propositions d'entraînement.";
const CLOSES =
  "Après ta déclaration, NALYNT refait l'analyse de ta journée avant de te proposer une séance. Ton check-in quotidien reste pris en compte.";
const ERROR_CONFIRMATION = "Je confirme n'avoir eu ni choc à la tête ni symptôme : j'ai répondu « Oui » par erreur.";

const MESSAGES: Record<string, string> = {
  assessed_on_required: "Indique la date de cette décision.",
  assessed_on_out_of_range: "La date doit être comprise entre la déclaration du signal et aujourd'hui.",
  invalid_transition: "Cette déclaration n'est plus possible à ce stade de ton suivi.",
  entered_in_error_after_assessment: "Une évaluation a déjà été déclarée : ce suivi se clôt par la décision d'un professionnel de santé.",
  entered_in_error_after_training: "Une séance a été enregistrée depuis ce signal : ce suivi se clôt par la décision d'un professionnel de santé.",
  entered_in_error_confirmation_required: "Confirme que tu as déclaré cette suspicion par erreur.",
  flag_not_open: "Ce suivi est déjà clôturé.",
  flag_not_found: "Ce suivi n'existe plus.",
  rider_attestation_required: "Reconnecte-toi pour enregistrer ta déclaration.",
  id_conflict: "Ta déclaration a changé : enregistre-la à nouveau.",
  network: "Impossible d'enregistrer ta déclaration pour l'instant. Réessaie dans un instant.",
};
const FALLBACK = "Impossible d'enregistrer ta déclaration. Réessaie dans un instant.";
const LOAD_FAILED = "Impossible de charger ton suivi pour l'instant. Réessaie dans un instant.";
const CHANGED = "Ton suivi a changé entre-temps : vérifie ta déclaration.";

const newId = () => crypto.randomUUID();

export function ConcussionFollowUpForm({ flagId, onResolved }: { flagId: string; onResolved?: () => void }) {
  const [opened, setOpened] = useState(false);
  const [state, setState] = useState<ConcussionFollowUp | null>(null);
  const [outcome, setOutcome] = useState<ConcussionOutcome | null>(null);
  const [assessedOn, setAssessedOn] = useState("");
  const [category, setCategory] = useState<ProfessionalCategory | "">("");
  const [errorConfirmed, setErrorConfirmed] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<string | null>(null);
  // One id per declaration content: a retry of the same declaration resends the same id (idempotent).
  const attemptId = useRef(newId());
  const today = todayLocal();

  useEffect(() => {
    attemptId.current = newId();
  }, [outcome, assessedOn, category, errorConfirmed]);

  async function refresh(): Promise<ConcussionFollowUp | null> {
    try {
      const current = await loadConcussionFollowUp(flagId);
      setState(current);
      return current;
    } catch {
      setMessage(LOAD_FAILED);
      return null;
    }
  }

  async function open() {
    setOpened(true);
    setMessage(null);
    setRecorded(null);
    const current = await refresh();
    if (current && !current.open) onResolved?.();
  }

  const choices = state ? allowedOutcomes(state.lastOutcome) : [];
  const dated = outcome !== null && DATED_OUTCOMES.has(outcome);
  const ready =
    outcome !== null &&
    choices.includes(outcome) &&
    (!dated || (assessedOn !== "" && state !== null && assessedOn >= state.flagDate && assessedOn <= today)) &&
    (outcome !== "entered_in_error" || errorConfirmed);

  async function submit() {
    if (sending || !ready || !state || !outcome) return;
    setSending(true);
    setMessage(null);
    // Read the server state again: never a declaration on a state the screen no longer reflects.
    const current = await refresh();
    if (!current) {
      setSending(false);
      return;
    }
    if (!current.open) {
      setSending(false);
      setMessage(MESSAGES.flag_not_open);
      onResolved?.();
      return;
    }
    if (current.lastOutcome !== state.lastOutcome || !allowedOutcomes(current.lastOutcome).includes(outcome)) {
      setSending(false);
      setMessage(CHANGED);
      if (!allowedOutcomes(current.lastOutcome).includes(outcome)) setOutcome(null);
      return;
    }
    const result = await recordConcussionAttestation({
      id: attemptId.current,
      flagId,
      outcome,
      assessedOn: dated ? assessedOn : null,
      professionalCategory: outcome === "entered_in_error" || category === "" ? null : category,
      enteredInErrorConfirmation: errorConfirmed,
    });
    setSending(false);
    if (result.ok) {
      if (result.closed) {
        onResolved?.();
        return;
      }
      setRecorded(`Déclaration enregistrée. ${KEEPS_SUSPENSION}`);
      setOutcome(null);
      setAssessedOn("");
      setCategory("");
      await refresh();
      return;
    }
    if (result.code === "id_conflict") attemptId.current = newId();
    setMessage(MESSAGES[result.code] ?? FALLBACK);
    if (!result.retryable) await refresh();
  }

  if (!opened) {
    return (
      <button
        type="button"
        onClick={() => void open()}
        className="ux-press mt-3 min-h-11 rounded border border-amber-300/70 px-4 py-2 text-sm font-semibold text-amber-100 hover:border-amber-200"
        data-testid="concussion-follow-up-open"
      >
        Déclarer l'issue de mon évaluation
      </button>
    );
  }

  return (
    <div className="mt-3 rounded border border-amber-300/40 p-3" data-testid="concussion-follow-up">
      <p className="text-xs text-amber-100/90" data-testid="concussion-declarative">
        {DECLARATIVE_NOTICE}
      </p>
      {recorded && (
        <p role="status" className="mt-2 text-sm text-amber-100" data-testid="concussion-follow-up-recorded">
          {recorded}
        </p>
      )}
      {state === null ? (
        message ? null : <p className="mt-2 text-sm text-amber-100/80">Chargement…</p>
      ) : (
        <fieldset className="mt-3">
          <legend className="text-sm font-semibold text-amber-100">Où en est ton évaluation ?</legend>
          {choices.map((choice) => (
            <label key={choice} className="mt-2 flex min-h-11 items-start gap-3 text-sm text-amber-100">
              <input type="radio" name={`concussion-outcome-${flagId}`} value={choice} checked={outcome === choice} onChange={() => setOutcome(choice)} className="mt-0.5 h-5 w-5 shrink-0" />
              <span>{OUTCOME_LABELS[choice]}</span>
            </label>
          ))}
        </fieldset>
      )}
      {outcome !== null && (
        <div className="mt-3 flex flex-col gap-3">
          {dated && (
            <>
              <label className="flex flex-col gap-1 text-sm text-amber-100">
                Date de cette décision
                <input
                  type="date"
                  value={assessedOn}
                  min={state?.flagDate}
                  max={today}
                  onChange={(e) => setAssessedOn(e.target.value)}
                  className="min-h-11 rounded border border-amber-300/50 bg-transparent px-3 text-amber-50"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-amber-100">
                Professionnel consulté (facultatif)
                <select value={category} onChange={(e) => setCategory(e.target.value as ProfessionalCategory | "")} className="min-h-11 rounded border border-amber-300/50 bg-transparent px-3 text-amber-50">
                  <option value="">Ne pas préciser</option>
                  {(Object.keys(CATEGORY_LABELS) as ProfessionalCategory[]).map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {outcome === "entered_in_error" && (
            <label className="flex min-h-11 items-start gap-3 text-sm text-amber-100">
              <input type="checkbox" checked={errorConfirmed} onChange={(e) => setErrorConfirmed(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0" />
              <span>{ERROR_CONFIRMATION}</span>
            </label>
          )}
          <p className="text-xs text-amber-100/80" data-testid="concussion-follow-up-effect">
            {CLOSING_OUTCOMES.has(outcome) ? CLOSES : KEEPS_SUSPENSION}
          </p>
        </div>
      )}
      {message && (
        <p role="alert" className="mt-3 text-sm text-amber-200">
          {message}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!ready || sending}
          className="ux-press min-h-11 rounded bg-amber-300 px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
        >
          {sending ? "Enregistrement…" : "Enregistrer ma déclaration"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpened(false);
            setOutcome(null);
            setMessage(null);
          }}
          className="ux-press min-h-11 rounded border border-amber-300/50 px-4 py-2 text-sm text-amber-100"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}
