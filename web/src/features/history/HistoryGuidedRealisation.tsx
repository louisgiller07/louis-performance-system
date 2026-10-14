// P0-4 (HPM 2026-10-13) — History's "Réalisé" for a guided V2 session: each attempt started from the decision
// consulted, its real status, its OWN frozen final prescription and the active results (corrections applied),
// rendered read only by the guided-session modules themselves (no second rendering of sets / passes /
// activities). When the prescription can no longer be read (older catalogue, missing row), the recorded values
// stay readable with a neutral note — the session is never hidden. Nothing absent is invented.
import { Link } from "react-router-dom";
import { formatLocalTime } from "../../lib/date";
import { FinalPrescriptionV2Card } from "../finalPrescriptionV2/FinalPrescriptionV2Card";
import { resolveSessionModule } from "../guidedSession/sessionModules";
import { ReadOnlySessionModule } from "../guidedSession/ReadOnlySessionModule";
import { activeActivityResult, activeResultsBySlot } from "../guidedSession/results/activeResults";
import type { ExecutionRow, SetResultRow } from "../guidedSession/executionState";
import { formatResult } from "../guidedSession/strength/strengthCopy";
import { DH_COPY, SUCCESS_LABELS } from "../guidedSession/dh/dhCopy";
import { choiceOf } from "../guidedSession/dh/dhPasses";
import { formatDistance, formatDuration } from "../guidedSession/endurance/enduranceActivity";
import { guidedStatusLabel, type GuidedAttempt } from "./guidedHistory";

export const PRESCRIPTION_NO_LONGER_READABLE = "Le détail de cette séance n'est plus disponible dans cette version de l'application. Voici les résultats enregistrés.";
export const NO_RESULT_RECORDED = "Aucun résultat enregistré.";
export const OTHER_DECISION_COPY = "Une séance guidée a été enregistrée ce jour-là depuis une autre recommandation de la journée.";

const noop = () => {};
const ignored = async () => "ignored" as const;
const none = () => "";

/** The active set / pass results (corrections applied), grouped by prescribed item in recording order. */
function activeSetsByItem(rows: readonly SetResultRow[]): SetResultRow[][] {
  const active = [...activeResultsBySlot(rows).values()];
  const superseded = new Set(rows.filter((r) => r.supersedes_id).map((r) => r.supersedes_id!.toLowerCase()));
  const others = rows.filter((r) => r.prescription_item_id === null && !superseded.has(r.id.toLowerCase()));
  const groups = new Map<string, SetResultRow[]>();
  for (const r of [...active, ...others].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))) {
    const key = r.prescription_item_id ?? `other:${r.other_exercise_name ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()].map((g) => g.sort((a, b) => a.set_number - b.set_number));
}

/** The recorded values alone, when the prescription cannot be read: labelled neutrally, never hidden. */
function RecordedValues({ execution }: { execution: ExecutionRow }) {
  const groups = activeSetsByItem(execution.exercise_set_results);
  const activity = activeActivityResult(execution.session_activity_results);
  if (groups.length === 0 && !activity) return <p className="text-sm text-muted">{NO_RESULT_RECORDED}</p>;
  return (
    <div className="flex flex-col gap-3" data-testid="history-recorded-values">
      {groups.map((rows, i) => (
        <section key={rows[0]!.id} className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-ink">{rows[0]!.other_exercise_name ?? `Exercice ${i + 1}`}</h3>
          <ul className="flex flex-col gap-0.5">
            {rows.map((r) => (
              <li key={r.id} className="text-sm text-ink/80">
                {r.measure_type === "pass"
                  ? `Passage ${r.set_number} · ${DH_COPY.recorded} · Critère atteint : ${SUCCESS_LABELS[choiceOf(r.success)]}`
                  : `Série ${r.set_number} · ${formatResult(r, false)}`}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {activity && (
        <p className="text-sm text-ink/80">
          {["Activité enregistrée", formatDuration(activity.duration_seconds), activity.distance_m !== null ? formatDistance(activity.distance_m) : null, activity.rpe_actual !== null ? `RPE ${activity.rpe_actual}` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
    </div>
  );
}

function Attempt({ attempt, index, count }: { attempt: GuidedAttempt; index: number; count: number }) {
  const { execution, phase, prescription } = attempt;
  const created = prescription?.kind === "created" ? prescription.prescription : null;
  const module = created ? resolveSessionModule(created) : null;
  return (
    <section className="flex flex-col gap-3" data-testid="history-guided-attempt" data-phase={phase} data-execution-id={execution.id}>
      <div>
        {count > 1 && <p className="text-xs uppercase tracking-[0.14em] text-muted">{`Tentative ${index + 1} sur ${count}`}</p>}
        <p className={`text-sm font-semibold ${phase === "completed" ? "text-gold" : "text-ink"}`} data-testid="history-guided-status">
          {phase === "completed" ? `✓ ${guidedStatusLabel(phase)}` : guidedStatusLabel(phase)}
        </p>
        <p className="text-xs text-muted">{`Commencée à ${formatLocalTime(execution.started_at)}`}</p>
      </div>
      {created && module && module.Content !== ReadOnlySessionModule ? (
        <module.Content
          prescription={created}
          executionId={execution.id}
          phase={phase}
          setResults={execution.exercise_set_results}
          activityResults={execution.session_activity_results}
          uiState={null}
          editable={false}
          busy={false}
          setUiState={noop}
          submit={ignored}
          newId={none}
          now={none}
        />
      ) : created ? (
        <>
          <FinalPrescriptionV2Card state={{ kind: "created", prescription: created }} />
          <RecordedValues execution={execution} />
        </>
      ) : (
        <>
          <p className="text-sm text-muted" data-testid="history-prescription-unavailable">
            {PRESCRIPTION_NO_LONGER_READABLE}
          </p>
          <RecordedValues execution={execution} />
        </>
      )}
    </section>
  );
}

export function HistoryGuidedRealisation({ attempts }: { attempts: readonly GuidedAttempt[] }) {
  return (
    <div className="flex flex-col gap-5">
      {attempts.map((attempt, i) => (
        <Attempt key={attempt.execution.id} attempt={attempt} index={i} count={attempts.length} />
      ))}
    </div>
  );
}

/** A guided session of the day was recorded from another decision: say so and link to it (never "nothing recorded"). */
export function HistoryOtherDecisionRealisation({ decisionIds }: { decisionIds: readonly string[] }) {
  return (
    <div className="flex flex-col gap-1" data-testid="history-other-decision">
      <p>{OTHER_DECISION_COPY}</p>
      {decisionIds.map((id, i) => (
        <Link key={id} to={`/history/${id}`} className="ux-press inline-flex min-h-11 items-center text-sm text-gold underline-offset-4 hover:underline">
          {decisionIds.length > 1 ? `Voir la séance enregistrée (${i + 1})` : "Voir la séance enregistrée"}
        </Link>
      ))}
    </div>
  );
}
