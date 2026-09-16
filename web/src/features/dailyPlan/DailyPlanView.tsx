import { PlanSection } from "../../components/PlanSection";
import { DecisionHero } from "./DecisionHero";
import { formatIntervention, isSameIntervention, TRAINING_KIND_LABELS, LOAD_PROFILE_LABELS } from "./dailyPlanLabels";
import {
  athleteSafeRuleDetail,
  athleteSafeMonitoring,
  athleteSafeProtection,
  athleteSafeTrainingObjective,
  hasActiveSafetyRule,
} from "./safetyPresentation";
import { formatDhSessionWindow, DH_SESSION_WINDOW_CAPTION } from "./dhPrescriptionLabels";
import type { DailyPlan, RecentRecoveryContext } from "./dailyPlanTypes";

// V0.3_008A — Previous-Day Recovery Continuity. A dedicated, purely factual
// read-only section — deliberately NEVER folded into `reasoning` (that
// string is a flat concatenation of independently-generated rule text,
// already documented as capable of self-contradiction — GAP-003, deferred
// separately). `change_reason` is locked to exactly "fatigue_control" in
// this slice (server/engine contract), so no broad label map is needed or
// imported here — one neutral French sentence per completion_status is
// enough. Never claims "tu es encore fatigué" or "tu as récupéré" — the
// heading/tense alone establishes this describes YESTERDAY, and today's
// own current-state sections (already rendered elsewhere on this page)
// remain the only source of truth about today.
const RECENT_RECOVERY_STATUS_COPY: Record<RecentRecoveryContext["completion_status"], string> = {
  partial: "Hier, ta séance a été écourtée pour fatigue ou perte de contrôle.",
  replaced: "Hier, ta séance a été remplacée pour fatigue ou perte de contrôle.",
  skipped: "Hier, la séance n'a pas été effectuée pour fatigue ou perte de contrôle.",
};

// V0.3_008B — Technical Continuity V1, DISPLAY ONLY. Kind-neutral wording
// ("séance technique", never "séance DH") — technical_outcome is valid for
// all 4 DH-family kinds (DH_TECHNICAL/DH_PERFORMANCE/DH_LIGHT/PUMPTRACK), so
// a Pumptrack-sourced fact must not be misdescribed as a DH session. No day
// count (age_days is never persisted — see PriorTaskReference's own doc),
// no claim that the prior kind is specifically relevant to today's kind (V1
// performs no cross-kind semantic matching).
const PRIOR_TECHNICAL_OUTCOME_COPY: Record<"yes" | "partial" | "no", string> = {
  yes: "Lors de ta dernière séance technique, cette tâche a été réussie.",
  partial: "Lors de ta dernière séance technique, cette tâche a été partiellement réussie.",
  no: "Lors de ta dernière séance technique, cette tâche n'a pas été réussie.",
};

function RecentRecoveryContextSection({ context }: { context: RecentRecoveryContext }) {
  // V0.3_008A final presentation gate — SKIPPED means no session was
  // performed, so no post-session fact can exist to report. Gated on
  // completion_status alone (never merely "are the values non-null"): a
  // legacy/malformed historical row must never have stray non-null
  // post_leg_fatigue/post_grip_fatigue misread as post-session facts for a
  // session that structurally never happened.
  const fatigueParts: string[] = [];
  if (context.completion_status !== "skipped") {
    if (context.post_leg_fatigue !== null) fatigueParts.push(`jambes ${context.post_leg_fatigue}/10`);
    if (context.post_grip_fatigue !== null) fatigueParts.push(`grip ${context.post_grip_fatigue}/10`);
  }

  return (
    <PlanSection title="Contexte récent">
      <p>{RECENT_RECOVERY_STATUS_COPY[context.completion_status]}</p>
      {fatigueParts.length > 0 && <p className="text-gray-500">Fatigue déclarée après la séance : {fatigueParts.join(" · ")}.</p>}
    </PlanSection>
  );
}

export interface DailyPlanViewProps {
  dailyPlan: DailyPlan;
  /**
   * Optional — a live daily-run response has warnings, a stored historical
   * decision does not. Never rendered to the athlete (V0.3_005C/NAL-002):
   * every current producer of this array is an internal adapter-boundary
   * diagnostic (e.g. an ambiguous legacy row that couldn't be perfectly
   * reconstructed), never athlete-authored copy — see
   * head-coach-engine/src/supabase/mapping/{plannedSessionIntervention,raceCalendarRow}.ts.
   * Kept on the type only so existing callers (DailyPlanResult) don't need
   * to change; still fully present in DailyRunResponse for logs/debugging.
   */
  warnings?: string[];
  /**
   * Whether to show the health banner. Computed by the caller from data it
   * actually has (e.g. a live response's healthFlagId, or a stored
   * decision's own persisted health_flag_to_create) — never re-derived
   * here from dailyPlan fields like triggered_rules or decision=REST. No
   * A1-A5 rule lives in this component.
   */
  hasHealthSignal: boolean;
  healthSignalReason?: string;
  /** Dev-only debug panel content — omitted entirely if not provided. */
  technicalMetadata?: { decisionId?: string; raw: unknown };
}

// Rendering-only: production display of a real, already-computed
// DailyPlan (live from daily-run, or read back from decisions.daily_plan
// for /history). Every value shown comes from the data passed in — this
// file only decides layout and French labels (dailyPlanLabels.ts) — it
// never classifies, diagnoses, or invents a coaching/safety recommendation.
export function DailyPlanView({ dailyPlan, hasHealthSignal, healthSignalReason, technicalMetadata }: DailyPlanViewProps) {
  // Only worth comparing when there was an actual prior planned session —
  // planned_session_before === null (e.g. a fresh RACE_ACTIVITY day, no
  // prior training block session) must never render as "Prévu: —", which
  // reads as a discrepancy even for a plain KEEP.
  const sessionChanged =
    dailyPlan.planned_session_before !== null && !isSameIntervention(dailyPlan.planned_session_before, dailyPlan.final_session);

  // V0.3_006A1 — presentation precedence only: when an active Safety-layer
  // (A) rule is present, "À éviter" (the Safety-driven restriction) must
  // read as primary and must not appear to be overridden by the
  // domain-generic "Récupération" suggestions below it — so it renders
  // first. Never changes which activities are considered allowed, and never
  // hides/alters Récupération's own content.
  const safetyActive = hasActiveSafetyRule(dailyPlan);

  // V0.3_006B — Session Prescription V1 (DH-first). `dh_or_technical.active`
  // is already exactly true iff the final session is DH-family (same gate
  // computeTechniqueDomain itself uses) — reused here rather than a second
  // kind check. When true, session/load/duration/focus/terrain are
  // consolidated into ONE card below instead of the generic "Entraînement"
  // card + a separate "Technique" card, to avoid rendering the same
  // recommendation twice.
  const isDhPrescription = dailyPlan.dh_or_technical.active;
  // V0.3_006C1 — sanitized (raw pain_location_code replaced by its French
  // label) rather than the raw arrays — see safetyPresentation.ts. The
  // underlying dailyPlan.protection/monitoring are never mutated.
  const safeProtection = athleteSafeProtection(dailyPlan);
  const safeMonitoring = athleteSafeMonitoring(dailyPlan);
  // V0.3.012 — "Pourquoi cette décision ?" must show exactly the rules that
  // explain the FINAL decision, the same set already joined into
  // `reasoning`/`training.objective` above — never the full, unfiltered
  // `triggered_rules` audit trail (which also carries monitoring-only rules
  // like C3.7 and rules whose own claim was since superseded, e.g. a stale
  // "nature préservée" after a later rule changed the kind). Falls back to
  // `triggered_rules` only for a decision persisted before this field
  // existed (`decision_reasoning === undefined`) — see dailyPlanTypes.ts.
  const decisionReasoningRules = dailyPlan.decision_reasoning ?? dailyPlan.triggered_rules;
  const protectionSection = safeProtection.length > 0 && (
    <PlanSection title="À éviter">
      <ul className="list-disc pl-4 text-red-700">
        {safeProtection.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </PlanSection>
  );

  return (
    <div className="flex flex-col gap-3">
      <DecisionHero dailyPlan={dailyPlan} />

      {hasHealthSignal && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3">
          <p className="text-sm font-semibold text-red-700">Attention santé</p>
          <p className="mt-0.5 text-xs text-red-600">{healthSignalReason ?? "Le coach a généré un signal de santé pour cette décision."}</p>
        </div>
      )}

      {sessionChanged && (
        <PlanSection title="Séance">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-gray-400">Prévu</p>
              <p className="font-medium text-gray-900">
                {dailyPlan.planned_session_before ? formatIntervention(dailyPlan.planned_session_before) : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Aujourd'hui</p>
              <p className="font-medium text-gray-900">{formatIntervention(dailyPlan.final_session)}</p>
            </div>
          </div>
        </PlanSection>
      )}

      {dailyPlan.training.active && !isDhPrescription && (
        <PlanSection title="Entraînement">
          {dailyPlan.training.session_type && <p className="font-medium text-gray-900">{formatIntervention(dailyPlan.training.session_type)}</p>}
          {/*
           * V0.3_006C1 (A5 copy-leak hotfix) — the engine sets this field to
           * the last triggered rule's raw detail, which for A5 leaked "Flag
           * concussion_suspect actif non résolu..." verbatim (never covered
           * by the existing triggered_rules/reasoning sanitization). See
           * safetyPresentation.ts#athleteSafeTrainingObjective.
           */}
          {dailyPlan.training.objective && <p className="text-gray-600">{athleteSafeTrainingObjective(dailyPlan)}</p>}
        </PlanSection>
      )}

      {/*
       * V0.3_006B — Session Prescription V1. One consolidated card for a
       * DH-family session: what (kind), how hard (qualitative load,
       * clarified), how long (total session window — uplift/pauses/recon
       * included, never continuous riding time), what to focus on, and
       * terrain guidance. All values come from already-authoritative fields
       * (final_session, dh_or_technical).
       *
       * V0.3_006C1 (final correction) — the riding-behavior copy for a given
       * load_profile is substantive coaching prescription, so it is rendered
       * ONLY from the persisted `dh_or_technical.load_guidance` (engine-
       * emitted), never recomputed here from `load_profile` alone — a
       * historical DailyPlan predating this field falls back to the neutral
       * load label instead, so it never retroactively gains a coaching
       * instruction the engine never actually prescribed at generation time
       * (docs/03_COACHING_MODEL.md §DH Execution Guidance — invariant
       * d'historique).
       */}
      {isDhPrescription && (
        <PlanSection title="Séance DH">
          <p className="font-medium text-gray-900">{TRAINING_KIND_LABELS[dailyPlan.final_session.kind] ?? dailyPlan.final_session.kind}</p>
          {dailyPlan.dh_or_technical.load_guidance ? (
            <p className="text-gray-600">{dailyPlan.dh_or_technical.load_guidance}</p>
          ) : (
            dailyPlan.final_session.load_profile && (
              <p className="text-gray-600 capitalize">{LOAD_PROFILE_LABELS[dailyPlan.final_session.load_profile]}</p>
            )
          )}
          {dailyPlan.final_session.duration_min !== undefined && (
            <>
              <p className="text-gray-600">Fenêtre de session : {formatDhSessionWindow(dailyPlan.final_session.duration_min)}</p>
              <p className="text-xs text-gray-400">{DH_SESSION_WINDOW_CAPTION}</p>
            </>
          )}
          {/*
           * V0.3_008B0 — focus (theme/attention) and execution_task (today's
           * concrete, kind-only execution instruction) can now coexist (a
           * personal focus no longer suppresses the generic task — see
           * dhPrescription.ts#resolveDhExecutionTask). Explicit labels avoid
           * the task line being misread as an interpretation/elaboration of
           * the personal focus above it — it never is.
           */}
          {dailyPlan.dh_or_technical.focus && <p className="mt-1 font-medium text-gray-900">Focus : {dailyPlan.dh_or_technical.focus}</p>}
          {dailyPlan.dh_or_technical.execution_task && (
            <p className="text-gray-600">Tâche du jour : {dailyPlan.dh_or_technical.execution_task}</p>
          )}
          {dailyPlan.dh_or_technical.spot_hint && <p className="text-gray-600">{dailyPlan.dh_or_technical.spot_hint}</p>}
          {/*
           * V0.3_008B — historical fact from an earlier day, visually
           * distinct from today's "Focus"/"Tâche du jour" above (its own
           * label + italic task quote) so it never reads as today's
           * instruction. Never mutates/replaces/suppresses execution_task
           * above.
           */}
          {dailyPlan.dh_or_technical.prior_task_reference && (
            <div className="mt-2 border-t border-gray-100 pt-2">
              <p className="text-xs uppercase tracking-wide text-gray-400">Tâche précédente</p>
              <p className="italic text-gray-600">« {dailyPlan.dh_or_technical.prior_task_reference.execution_task} »</p>
              <p className="text-gray-600">{PRIOR_TECHNICAL_OUTCOME_COPY[dailyPlan.dh_or_technical.prior_task_reference.technical_outcome]}</p>
            </div>
          )}
        </PlanSection>
      )}

      {dailyPlan.mental.active && (
        <PlanSection title="Mental">
          {dailyPlan.mental.focus && <p className="font-medium text-gray-900">{dailyPlan.mental.focus}</p>}
          {dailyPlan.mental.action_hint && <p className="text-gray-600">{dailyPlan.mental.action_hint}</p>}
        </PlanSection>
      )}

      {safetyActive && protectionSection}

      {/*
       * V0.3_008A presentation gate — placed strictly AFTER both Safety-
       * relevant elements above (the "Attention santé" banner and, when
       * active, the Safety-driven "À éviter" card): Safety-relevant
       * guidance must always retain visual precedence over ordinary
       * recovery/context information, never compete with or appear above
       * it. Purely a DOM-order decision — no Safety behavior/logic touched.
       */}
      {dailyPlan.recent_recovery_context && <RecentRecoveryContextSection context={dailyPlan.recent_recovery_context} />}

      {dailyPlan.recovery.active && dailyPlan.recovery.actions.length > 0 && (
        <PlanSection title="Récupération">
          <ul className="list-disc pl-4">
            {dailyPlan.recovery.actions.map((action, index) => (
              <li key={index}>{action}</li>
            ))}
          </ul>
        </PlanSection>
      )}

      {dailyPlan.sleep.active && (
        <PlanSection title="Sommeil">
          {dailyPlan.sleep.target_hours !== undefined && (
            <p className="font-medium text-gray-900">Objectif : {dailyPlan.sleep.target_hours} h</p>
          )}
          {dailyPlan.sleep.bedtime_hint && <p className="text-gray-600">{dailyPlan.sleep.bedtime_hint}</p>}
          {/*
           * V0.3_005C (NAL-002) — dailyPlan.sleep.notes currently always
           * carries an internal-provenance string (implementation
           * placeholder + doc reference), never athlete copy — see
           * head-coach-engine/src/engine/buildDailyPlan.ts. The underlying
           * field is untouched (still fully present for debugging/audit,
           * e.g. in decisions.daily_plan); only the presentation boundary
           * changes: a fixed, athlete-appropriate line replaces it,
           * preserving the same meaning (this target is generic, not yet
           * personalized) without the internal wording.
           */}
          {dailyPlan.sleep.notes && <p className="text-gray-600">Repère générique, pas encore individualisé pour toi.</p>}
        </PlanSection>
      )}

      {dailyPlan.nutrition.active && (
        <PlanSection title="Nutrition">
          {dailyPlan.nutrition.focus && <p className="font-medium text-gray-900">{dailyPlan.nutrition.focus}</p>}
          {dailyPlan.nutrition.hydration_target_l !== undefined && <p>Hydratation : {dailyPlan.nutrition.hydration_target_l} L</p>}
          {dailyPlan.nutrition.notes && <p className="text-gray-600">{dailyPlan.nutrition.notes}</p>}
        </PlanSection>
      )}

      {!safetyActive && protectionSection}

      {safeMonitoring.length > 0 && (
        <PlanSection title="À surveiller">
          <ul className="list-disc pl-4">
            {safeMonitoring.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </PlanSection>
      )}

      {dailyPlan.overrode_race_protocol && (
        <PlanSection title="Protocole de course">
          <p className="text-gray-900">Le protocole standard a été modifié pour aujourd'hui.</p>
          {dailyPlan.override_reason && <p className="text-gray-600">{dailyPlan.override_reason}</p>}
        </PlanSection>
      )}

      {decisionReasoningRules.length > 0 && (
        <details className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-600">
          <summary className="cursor-pointer font-medium text-gray-900">Pourquoi cette décision ?</summary>
          {/*
           * V0.3_006A1 — athlete-facing "why" must never render raw
           * internal identifiers (rule.layer/rule.rule_id, e.g. "A · A5")
           * or an internal HealthFlagType slug embedded in rule.detail
           * (e.g. "concussion_suspect"). Both remain fully present in
           * technicalMetadata's raw JSON dump below (dev-only) and in the
           * persisted decisions.daily_plan for audit — only this athlete
           * copy is sanitized. See safetyPresentation.ts.
           *
           * V0.3.012 — source is decisionReasoningRules (see above), never
           * the raw triggered_rules audit array, so this panel can never
           * contradict the `reasoning` summary shown in DecisionHero.
           */}
          <ul className="mt-2 flex flex-col gap-2">
            {decisionReasoningRules.map((rule, index) => (
              <li key={index} className="border-t border-gray-100 pt-2 first:border-t-0 first:pt-0">
                <p>{athleteSafeRuleDetail(rule)}</p>
              </li>
            ))}
          </ul>
        </details>
      )}

      {import.meta.env.DEV && technicalMetadata && (
        <details className="text-xs text-gray-400">
          <summary>Détails techniques</summary>
          {technicalMetadata.decisionId && <p className="mt-1">decisionId : {technicalMetadata.decisionId}</p>}
          <p className={technicalMetadata.decisionId ? "" : "mt-1"}>engine_version : {dailyPlan.engine_version}</p>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(technicalMetadata.raw, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}
