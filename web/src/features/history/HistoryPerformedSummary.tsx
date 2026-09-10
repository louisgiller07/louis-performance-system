// V0.3_007D — compact read-only "Réalisé" summary for a linked
// completed_sessions row. Deliberately mirrors CompletedSessionCard.tsx's
// own view-mode <dl> exactly (same labels, same null-guard-per-field
// discipline) rather than reusing that component directly — this is a
// simpler, permanently read-only rendering context (no edit affordance, no
// form state), so a small dedicated presentational component is the
// smallest correct piece, not a duplication of logic. No new label maps:
// every mapper here is imported from its single canonical source.
import { TRAINING_KIND_LABELS, LOAD_PROFILE_LABELS } from "../dailyPlan/dailyPlanLabels";
import { COMPLETION_STATUS_LABELS, SESSION_TYPE_LABELS, TECHNICAL_OUTCOME_LABELS, CHANGE_REASON_LABELS, type CompletedSessionRecord } from "../completedSession/completedSessionTypes";

export function HistoryPerformedSummary({ session }: { session: CompletedSessionRecord }) {
  // V0.3_007B — rich `intervention` is authoritative whenever present;
  // `session_type` (coarse) is only a fallback for a pre-007B legacy row
  // where `intervention` is NULL. Never synthesize a rich label from the
  // coarse value.
  const performedLabel =
    session.intervention &&
    (TRAINING_KIND_LABELS[session.intervention.kind] ?? session.intervention.kind) +
      (session.intervention.load_profile ? ` · ${LOAD_PROFILE_LABELS[session.intervention.load_profile]}` : "");

  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <dt className="text-gray-400">Statut</dt>
        <dd className="text-gray-900">{COMPLETION_STATUS_LABELS[session.completion_status]}</dd>

        {/* V0.3_007D presentation gate — for `skipped`, `intervention` is
            always NULL by contract (nothing was performed), so the coarse
            `session_type` fallback here would only ever describe what was
            PRESCRIBED and skipped, not what happened. Sitting right next to
            "Statut: Non faite" in a historical Réalisé block, that reads as
            a fabricated performed activity — so it's suppressed entirely for
            skipped. The same coarse fallback remains shown for any other
            (non-skipped) legacy row with a null intervention, where it
            legitimately describes what WAS performed. */}
        {session.completion_status !== "skipped" && (
          <>
            <dt className="text-gray-400">Activité</dt>
            <dd className="text-gray-900">{performedLabel ?? SESSION_TYPE_LABELS[session.session_type]}</dd>
          </>
        )}

        {session.actual_duration_min !== null && (
          <>
            <dt className="text-gray-400">Durée</dt>
            <dd className="text-gray-900">{session.actual_duration_min} min</dd>
          </>
        )}

        {session.rpe !== null && (
          <>
            <dt className="text-gray-400">RPE</dt>
            <dd className="text-gray-900">{session.rpe}/10</dd>
          </>
        )}

        {session.post_leg_fatigue !== null && (
          <>
            <dt className="text-gray-400">Fatigue jambes</dt>
            <dd className="text-gray-900">{session.post_leg_fatigue}/10</dd>
          </>
        )}

        {session.post_grip_fatigue !== null && (
          <>
            <dt className="text-gray-400">Fatigue grip</dt>
            <dd className="text-gray-900">{session.post_grip_fatigue}/10</dd>
          </>
        )}

        {/* V0.3_007C — never renders an outcome/score of any kind derived
            from the prescription; this is exclusively the athlete's own
            persisted answer, shown as-is or not at all. */}
        {session.technical_outcome !== null && (
          <>
            <dt className="text-gray-400">Tâche technique</dt>
            <dd className="text-gray-900">{TECHNICAL_OUTCOME_LABELS[session.technical_outcome]}</dd>
          </>
        )}

        {session.change_reason !== null && (
          <>
            <dt className="text-gray-400">Motif</dt>
            <dd className="text-gray-900">{CHANGE_REASON_LABELS[session.change_reason]}</dd>
          </>
        )}
      </dl>

      {session.change_reason_note && <p className="text-sm text-gray-700">{session.change_reason_note}</p>}

      {session.new_pain && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="text-sm font-medium text-gray-900">Une nouvelle douleur avait été indiquée ce jour-là.</p>
          {session.new_pain_note && <p className="mt-1 text-sm text-gray-700">{session.new_pain_note}</p>}
        </div>
      )}
    </div>
  );
}
