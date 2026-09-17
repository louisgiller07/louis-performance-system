import type { ReactNode } from "react";
import { PlanSection } from "../../components/PlanSection";
import { DecisionHero } from "./DecisionHero";
import {
  formatIntervention,
  isSameIntervention,
  TRAINING_KIND_LABELS,
  LOAD_PROFILE_LABELS,
  PRIOR_TECHNICAL_OUTCOME_COPY,
} from "./dailyPlanLabels";
import {
  athleteSafeRuleDetail,
  athleteSafeMonitoring,
  athleteSafeProtection,
  athleteSafeTrainingObjective,
  hasActiveSafetyRule,
} from "./safetyPresentation";
import { formatDhSessionWindow, formatDhSessionWindowCompact, DH_SESSION_WINDOW_CAPTION } from "./dhPrescriptionLabels";
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
      {fatigueParts.length > 0 && <p className="text-muted">Fatigue déclarée après la séance : {fatigueParts.join(" · ")}.</p>}
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
  /**
   * V0.3 UX PREMIUM REDESIGN — optional, rendered immediately after
   * DecisionHero. Lets TodayPage inject the Readiness card between
   * "Head Coach Decision" and the rest of the plan without this shared
   * component (also used by History's HistoryDetail) needing to know
   * anything about Readiness itself. Omitted entirely when absent —
   * zero effect on any existing caller that doesn't pass it.
   */
  readinessSlot?: ReactNode;
  /**
   * V0.3 UX PREMIUM REDESIGN — optional, rendered BEFORE DecisionHero (the
   * new "Mission du jour" lead card). When provided, this component
   * suppresses its own inline "Today's Mission" card (the same
   * focus/execution_task content, now hoisted to the top by the caller —
   * see MissionCard.tsx) to avoid showing it twice. When omitted (every
   * caller that doesn't pass it, e.g. History's HistoryDetail), the inline
   * card renders exactly as before — zero behavior change for History.
   */
  missionSlot?: ReactNode;
}

// Rendering-only: production display of a real, already-computed
// DailyPlan (live from daily-run, or read back from decisions.daily_plan
// for /history). Every value shown comes from the data passed in — this
// file only decides layout and French labels (dailyPlanLabels.ts) — it
// never classifies, diagnoses, or invents a coaching/safety recommendation.
export function DailyPlanView({
  dailyPlan,
  hasHealthSignal,
  healthSignalReason,
  technicalMetadata,
  readinessSlot,
  missionSlot,
}: DailyPlanViewProps) {
  const showInlineMission = missionSlot === undefined;
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
      <ul className="list-disc pl-4 text-red-400">
        {safeProtection.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </PlanSection>
  );

  return (
    <div className="flex flex-col gap-3">
      {missionSlot}

      <DecisionHero dailyPlan={dailyPlan} />

      {readinessSlot}

      {hasHealthSignal && (
        <div className="rounded-lg border border-red-500/40 bg-red-950/30 p-3">
          <p className="text-sm font-semibold text-red-400">Attention santé</p>
          <p className="mt-0.5 text-xs text-red-300">{healthSignalReason ?? "Le coach a généré un signal de santé pour cette décision."}</p>
        </div>
      )}

      {sessionChanged && (
        <PlanSection title="Séance">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-muted">Prévu</p>
              <p className="font-medium text-ink">
                {dailyPlan.planned_session_before ? formatIntervention(dailyPlan.planned_session_before) : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">Aujourd'hui</p>
              <p className="font-medium text-ink">{formatIntervention(dailyPlan.final_session)}</p>
            </div>
          </div>
        </PlanSection>
      )}

      {dailyPlan.training.active && !isDhPrescription && (
        <PlanSection title="Entraînement">
          {dailyPlan.training.session_type && <p className="font-medium text-ink">{formatIntervention(dailyPlan.training.session_type)}</p>}
          {/*
           * V0.3_006C1 (A5 copy-leak hotfix) — the engine sets this field to
           * the last triggered rule's raw detail, which for A5 leaked "Flag
           * concussion_suspect actif non résolu..." verbatim (never covered
           * by the existing triggered_rules/reasoning sanitization). See
           * safetyPresentation.ts#athleteSafeTrainingObjective.
           */}
          {/*
           * V0.3 UX PREMIUM REDESIGN — suppressed here (same missionSlot
           * pattern as the DH-family "Today's Mission" card above) whenever
           * the caller hoisted a Mission card of its own: MissionCard.tsx
           * shows this exact same training.objective text as its fallback
           * for a non-DH session, so this line would otherwise be a verbatim
           * duplicate for TodayPage. History (no missionSlot) is unaffected.
           */}
          {showInlineMission && dailyPlan.training.objective && <p className="text-ink/70">{athleteSafeTrainingObjective(dailyPlan)}</p>}
        </PlanSection>
      )}

      {/*
       * V0.3_006B — Session Prescription V1, split (V0.3 UX PREMIUM
       * REDESIGN) into two adjacent cards for a DH-family session:
       * "Today's Mission" (what to work on — focus/execution_task/terrain)
       * and "Session Plan" (what the session physically is — kind, load,
       * duration). Same underlying fields as before (final_session,
       * dh_or_technical), same values, only the visual grouping changed —
       * no new data, no reordering relative to each other or to the rest
       * of this list.
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
        <>
          {showInlineMission && (
            <PlanSection title="Today's Mission">
              {/*
               * V0.3_008B0 — focus (theme/attention) and execution_task
               * (today's concrete, kind-only execution instruction) can
               * coexist (a personal focus no longer suppresses the generic
               * task — see dhPrescription.ts#resolveDhExecutionTask).
               * Explicit labels avoid the task line being misread as an
               * interpretation/elaboration of the personal focus above it —
               * it never is.
               */}
              {dailyPlan.dh_or_technical.focus && <p className="font-medium text-ink">Focus : {dailyPlan.dh_or_technical.focus}</p>}
              {dailyPlan.dh_or_technical.execution_task && (
                <p className="text-ink/70">Tâche du jour : {dailyPlan.dh_or_technical.execution_task}</p>
              )}
              {dailyPlan.dh_or_technical.spot_hint && <p className="text-ink/70">{dailyPlan.dh_or_technical.spot_hint}</p>}
              {/*
               * V0.3_008B — historical fact from an earlier day, visually
               * distinct from today's "Focus"/"Tâche du jour" above (its own
               * label + italic task quote) so it never reads as today's
               * instruction. Never mutates/replaces/suppresses execution_task
               * above.
               */}
              {dailyPlan.dh_or_technical.prior_task_reference && (
                <div className="mt-2 border-t border-white/10 pt-2">
                  <p className="text-xs uppercase tracking-wide text-muted">Tâche précédente</p>
                  <p className="italic text-ink/70">« {dailyPlan.dh_or_technical.prior_task_reference.execution_task} »</p>
                  <p className="text-ink/70">{PRIOR_TECHNICAL_OUTCOME_COPY[dailyPlan.dh_or_technical.prior_task_reference.technical_outcome]}</p>
                </div>
              )}
            </PlanSection>
          )}

          {/*
           * V0.3 UX PREMIUM REDESIGN — kind headline + compact duration/load
           * badges (formatDhSessionWindowCompact, "<load_profile> LOAD" —
           * both purely derived from already-authoritative fields, no new
           * data), then the exact same load_guidance-or-neutral-label
           * fallback as before under a "Focus" subheading — CANONICAL
           * HISTORY INVARIANT preserved verbatim (a legacy plan without a
           * persisted load_guidance must still show only the neutral
           * LOAD_PROFILE_LABELS sentence, never a synthesized one). The
           * detailed session-window sentence + caption are kept, just
           * de-emphasized under the badges rather than the primary copy.
           */}
          <PlanSection title="Session Plan">
            <p className="text-xl font-bold uppercase tracking-tight text-ink">
              {TRAINING_KIND_LABELS[dailyPlan.final_session.kind] ?? dailyPlan.final_session.kind}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {dailyPlan.final_session.duration_min !== undefined && (
                <span className="rounded bg-gold/15 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-gold">
                  {formatDhSessionWindowCompact(dailyPlan.final_session.duration_min)}
                </span>
              )}
              {dailyPlan.final_session.load_profile && (
                <span className="rounded bg-white/5 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-ink/80">
                  {LOAD_PROFILE_LABELS[dailyPlan.final_session.load_profile]}
                </span>
              )}
            </div>
            {(dailyPlan.dh_or_technical.load_guidance || dailyPlan.final_session.load_profile) && (
              <div className="mt-3 border-t border-white/5 pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Focus</p>
                {dailyPlan.dh_or_technical.load_guidance ? (
                  <p className="mt-1 text-ink/70">{dailyPlan.dh_or_technical.load_guidance}</p>
                ) : (
                  dailyPlan.final_session.load_profile && (
                    <p className="mt-1 text-ink/70 capitalize">{LOAD_PROFILE_LABELS[dailyPlan.final_session.load_profile]}</p>
                  )
                )}
              </div>
            )}
            {dailyPlan.final_session.duration_min !== undefined && (
              <>
                <p className="mt-2 text-xs text-muted">Fenêtre de session : {formatDhSessionWindow(dailyPlan.final_session.duration_min)}</p>
                <p className="text-xs text-muted">{DH_SESSION_WINDOW_CAPTION}</p>
              </>
            )}
          </PlanSection>
        </>
      )}

      {dailyPlan.mental.active && (
        <PlanSection title="Mental">
          {dailyPlan.mental.focus && <p className="font-medium text-ink">{dailyPlan.mental.focus}</p>}
          {dailyPlan.mental.action_hint && <p className="text-ink/70">{dailyPlan.mental.action_hint}</p>}
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
            <p className="font-medium text-ink">Objectif : {dailyPlan.sleep.target_hours} h</p>
          )}
          {dailyPlan.sleep.bedtime_hint && <p className="text-ink/70">{dailyPlan.sleep.bedtime_hint}</p>}
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
          {dailyPlan.sleep.notes && <p className="text-ink/70">Repère générique, pas encore individualisé pour toi.</p>}
        </PlanSection>
      )}

      {dailyPlan.nutrition.active && (
        <PlanSection title="Nutrition">
          {dailyPlan.nutrition.focus && <p className="font-medium text-ink">{dailyPlan.nutrition.focus}</p>}
          {dailyPlan.nutrition.hydration_target_l !== undefined && <p>Hydratation : {dailyPlan.nutrition.hydration_target_l} L</p>}
          {dailyPlan.nutrition.notes && <p className="text-ink/70">{dailyPlan.nutrition.notes}</p>}
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
          <p className="text-ink">Le protocole standard a été modifié pour aujourd'hui.</p>
          {dailyPlan.override_reason && <p className="text-ink/70">{dailyPlan.override_reason}</p>}
        </PlanSection>
      )}

      {decisionReasoningRules.length > 0 && (
        <details className="rounded-lg border border-white/5 bg-card p-3 text-sm text-ink/70">
          <summary className="cursor-pointer font-medium text-ink">Pourquoi cette décision ?</summary>
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
              <li key={index} className="border-t border-white/10 pt-2 first:border-t-0 first:pt-0">
                <p>{athleteSafeRuleDetail(rule)}</p>
              </li>
            ))}
          </ul>
        </details>
      )}

      {import.meta.env.DEV && technicalMetadata && (
        <details className="text-xs text-muted">
          <summary>Détails techniques</summary>
          {technicalMetadata.decisionId && <p className="mt-1">decisionId : {technicalMetadata.decisionId}</p>}
          <p className={technicalMetadata.decisionId ? "" : "mt-1"}>engine_version : {dailyPlan.engine_version}</p>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(technicalMetadata.raw, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}
