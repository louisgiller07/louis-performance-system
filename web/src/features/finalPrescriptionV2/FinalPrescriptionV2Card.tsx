// UX-11A.5c.4 — read-only rendering of a daily final prescription V2.
// Generic over the V2 structure (blocks → exercise / drill items), never one
// hand-written page per session type. Strictly read only: no start button,
// no set or pass input, no execution call (UX-11C).
import { PlanSection } from "../../components/PlanSection";
import { PRESCRIPTION_UNAVAILABLE_MESSAGE } from "../prescriptions/prescriptionRead";
import type { BlockView, DrillItemView, ExerciseItemView, FinalPrescriptionV2State, FinalPrescriptionV2View } from "./finalPrescriptionV2Types";
import { BLOCKED_FALLBACK_MESSAGE, BLOCKED_MESSAGES, MANUAL_BLOCKED_MESSAGES, MANUAL_INTERVALS_LOAD_MESSAGE, REASON_BLOCKED_MESSAGES, formatMeasure, formatSeconds, INVALID_MESSAGE, MISSING_MESSAGE, REST_MESSAGE, setsLabel, span } from "./finalPrescriptionV2Copy";
import { enduranceRpeHint, intervalsSummary, intervalsSummaryLine, type IntervalsSummary } from "./enduranceCoachingCopy";
import { EnduranceGuidanceNote } from "./EnduranceGuidanceNote";
import { POWER_QUALITY_GUIDANCE, strengthExtrasLine, strengthSummary, strengthSummaryLine, WORK_BLOCK_ROLES, WORK_ROLE_LABELS } from "./strengthSummary";
import { LoadGuidanceNote } from "./LoadGuidanceNote";

function Vigilances({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="text-sm text-muted">
      {items.map((v) => (
        <li key={v}>Vigilance : {v}</li>
      ))}
    </ul>
  );
}

function ExerciseItem({ item, work }: { item: ExerciseItemView; work: boolean }) {
  const role = work ? WORK_ROLE_LABELS[item.role] : undefined;
  return (
    <li className="border-t border-white/10 pt-2 first:border-t-0 first:pt-0" data-item-id={item.prescriptionItemId}>
      <p className="font-medium text-ink">
        {item.name}
        {role && <span className="ml-2 text-xs uppercase tracking-wide text-muted">{role}</span>}
      </p>
      <p className="text-ink/80">
        {setsLabel(item.sets)} × {formatMeasure(item.measure)}
        {item.rpeTarget && ` — RPE ${span(item.rpeTarget)}`}
      </p>
      {item.restSeconds && <p className="text-sm text-muted">Repos : {formatSeconds(item.restSeconds)}</p>}
      {work && <LoadGuidanceNote item={item} />}
      {item.rampUp && (
        <p className="text-sm text-muted">
          Montée en charge : {span(item.rampUp.sets)} {item.rampUp.sets.max > 1 ? "séries" : "série"} — {item.rampUp.instruction}
        </p>
      )}
      <p className="text-sm text-ink/80">Consigne : {item.cue}</p>
      <Vigilances items={item.vigilances} />
    </li>
  );
}

function DrillItem({ item }: { item: DrillItemView }) {
  return (
    <li className="border-t border-white/10 pt-2 first:border-t-0 first:pt-0" data-item-id={item.prescriptionItemId}>
      <p className="font-medium text-ink">{item.name}</p>
      {/* Passages of this drill only — never a total number of runs for the day. */}
      <p className="text-ink/80">{item.passes} passages</p>
      <p className="text-sm text-ink/80">Consigne : {item.cue}</p>
      <p className="text-sm text-ink/80">Réussite : {item.successCriterion}</p>
      <Vigilances items={item.vigilances} />
    </li>
  );
}

function Block({ block, endurance }: { block: BlockView; endurance: boolean }) {
  const facts = [block.durationMinutes && span(block.durationMinutes, " min"), block.rpeTarget && `RPE ${span(block.rpeTarget)}`].filter(Boolean);
  return (
    <section className="flex flex-col gap-1.5" data-block-role={block.role}>
      <p className="text-xs uppercase tracking-wide text-muted">
        {block.roleLabel}
        {facts.length > 0 && ` · ${facts.join(" · ")}`}
      </p>
      {endurance && block.rpeTarget && (
        <p className="text-sm text-ink/80" data-testid="rpe-hint">
          {enduranceRpeHint(block.rpeTarget)}
        </p>
      )}
      {block.instructions.map((instruction) => (
        <p key={instruction} className="text-sm text-ink/80">
          {instruction}
        </p>
      ))}
      {block.talkTest && <p className="text-sm text-ink/80">{block.talkTest}</p>}
      {block.items.length > 0 && (
        <ul className="flex flex-col gap-3">
          {block.items.map((item) =>
            item.kind === "exercise" ? (
              <ExerciseItem key={item.prescriptionItemId} item={item} work={(WORK_BLOCK_ROLES as readonly string[]).includes(block.role)} />
            ) : (
              <DrillItem key={item.prescriptionItemId} item={item} />
            )
          )}
        </ul>
      )}
    </section>
  );
}

/** PHYS-02 — the intervals of an intervals session, as one part: the repetitions, then each step in order. */
function IntervalsPart({ intervals }: { intervals: IntervalsSummary }) {
  return (
    <section className="flex flex-col gap-1.5" data-block-role="main" data-testid="intervals">
      <p className="text-xs uppercase tracking-wide text-muted">Fractionné · {intervals.totalMinutes} min</p>
      <p className="text-sm font-semibold text-ink">{intervalsSummaryLine(intervals)}</p>
      <p className="text-sm text-ink/80" data-testid="rpe-hint">
        {enduranceRpeHint(intervals.workRpe)}
      </p>
      <p className="text-sm text-ink/80">{intervals.workInstruction}</p>
      <p className="text-sm text-ink/80">{intervals.easyInstruction}</p>
      <ol className="flex flex-col gap-0.5 text-sm text-ink/80" aria-label="Déroulé des répétitions">
        {Array.from({ length: intervals.repetitions }, (_, i) => (
          <li key={i}>
            Répétition {i + 1} : {intervals.workMinutes} min à RPE {span(intervals.workRpe)}
            {i < intervals.repetitions - 1 ? `, puis ${intervals.easyMinutes} min faciles` : ""}
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * A02 — the content of a V2 prescription (Today, Program): its intent, for a
 * Force session what the counts mean (work exercises and work sets, warm-up
 * and ramp-up shown apart), then every block in order. PHYS-02 — an
 * endurance session also says what its RPE means, the rider's last session
 * of the same protocol, and an intervals session shows its repetitions as one
 * part (warm-up, intervals, cool-down).
 */
export function PrescriptionV2Details({ prescription, title = "Ta séance" }: { prescription: FinalPrescriptionV2View; title?: string }) {
  const summary = strengthSummary(prescription);
  const extras = summary ? strengthExtrasLine(summary) : null;
  const endurance = prescription.family === "endurance";
  const intervals = endurance ? intervalsSummary(prescription) : null;
  const firstMain = prescription.blocks.findIndex((b) => b.role === "main");
  return (
    <PlanSection title={title}>
      <p className="font-medium text-ink">{prescription.intent}</p>
      {summary && (
        <div data-testid="strength-summary">
          <p className="text-sm font-semibold text-ink">{strengthSummaryLine(summary, prescription.family === "power")}</p>
          {extras && <p className="text-xs text-muted">{extras}</p>}
          {prescription.family === "power" && (
            <p className="text-sm text-ink/80" data-testid="power-guidance">
              {POWER_QUALITY_GUIDANCE}
            </p>
          )}
        </div>
      )}
      {prescription.activities && <p className="text-sm text-ink/80">Activité au choix : {prescription.activities.join(", ")}</p>}
      {prescription.enduranceGuidance && <EnduranceGuidanceNote guidance={prescription.enduranceGuidance} intervals={intervals !== null} />}
      <div className="flex flex-col gap-4">
        {prescription.blocks.map((block, index) =>
          intervals && block.role === "main" ? (
            index === firstMain ? <IntervalsPart key={block.blockId} intervals={intervals} /> : null
          ) : (
            <Block key={block.blockId} block={block} endurance={endurance} />
          )
        )}
      </div>
    </PlanSection>
  );
}

/** P0-3 — the precise refusal of a manual session, from the blocked decision's detail.reason; null otherwise. */
function manualBlockedMessage(detail: Record<string, unknown> | null): string | null {
  const reason = detail?.reason;
  // PHYS-02.1 — the load refusal of a manual intervals session is not the Force one.
  if (reason === "manual_load_not_supported" && detail?.target === "AEROBIC_INTERVALS") return MANUAL_INTERVALS_LOAD_MESSAGE;
  return typeof reason === "string" && Object.prototype.hasOwnProperty.call(MANUAL_BLOCKED_MESSAGES, reason) ? MANUAL_BLOCKED_MESSAGES[reason]! : null;
}

/** PHYS-02 — the precise reason an intervals session has no daily document; null otherwise. */
function reasonBlockedMessage(detail: Record<string, unknown> | null): string | null {
  const reason = detail?.reason;
  return typeof reason === "string" && Object.prototype.hasOwnProperty.call(REASON_BLOCKED_MESSAGES, reason) ? REASON_BLOCKED_MESSAGES[reason]! : null;
}

/** Read-only view of today's V2 final prescription state (created, REST, blocked, or a fail-closed state). */
export function FinalPrescriptionV2Card({ state }: { state: FinalPrescriptionV2State }) {
  switch (state.kind) {
    case "created":
      return <PrescriptionV2Details prescription={state.prescription} />;
    case "not_required":
      return (
        <PlanSection title="Ta séance">
          <p className="text-ink/80">{REST_MESSAGE}</p>
        </PlanSection>
      );
    case "blocked":
      return (
        <PlanSection title="Ta séance">
          <p className="text-ink/80" data-code={state.code}>
            {manualBlockedMessage(state.detail) ?? reasonBlockedMessage(state.detail) ?? BLOCKED_MESSAGES[state.code] ?? BLOCKED_FALLBACK_MESSAGE}
          </p>
        </PlanSection>
      );
    case "final_prescription_missing":
      return (
        <PlanSection title="Ta séance">
          <p className="text-ink/80" data-code="final_prescription_missing">
            {MISSING_MESSAGE}
          </p>
        </PlanSection>
      );
    case "unsupported_schema_or_catalog":
      return (
        <PlanSection title="Ta séance">
          <p className="text-ink/80" data-code="unsupported_schema_or_catalog">
            {PRESCRIPTION_UNAVAILABLE_MESSAGE}
          </p>
        </PlanSection>
      );
    case "invalid":
      return (
        <PlanSection title="Ta séance">
          <p className="text-ink/80" data-code="invalid">
            {INVALID_MESSAGE}
          </p>
        </PlanSection>
      );
  }
}
