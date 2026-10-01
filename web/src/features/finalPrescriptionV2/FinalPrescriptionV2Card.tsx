// UX-11A.5c.4 — read-only rendering of a daily final prescription V2.
// Generic over the V2 structure (blocks → exercise / drill items), never one
// hand-written page per session type. Strictly read only: no start button,
// no set or pass input, no execution call (UX-11C).
import { PlanSection } from "../../components/PlanSection";
import { PRESCRIPTION_UNAVAILABLE_MESSAGE } from "../prescriptions/prescriptionRead";
import type { BlockView, DrillItemView, ExerciseItemView, FinalPrescriptionV2State, FinalPrescriptionV2View } from "./finalPrescriptionV2Types";
import { BLOCKED_FALLBACK_MESSAGE, BLOCKED_MESSAGES, formatMeasure, formatSeconds, INVALID_MESSAGE, MISSING_MESSAGE, REST_MESSAGE, setsLabel, span } from "./finalPrescriptionV2Copy";

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

function ExerciseItem({ item }: { item: ExerciseItemView }) {
  return (
    <li className="border-t border-white/10 pt-2 first:border-t-0 first:pt-0" data-item-id={item.prescriptionItemId}>
      <p className="font-medium text-ink">{item.name}</p>
      <p className="text-ink/80">
        {setsLabel(item.sets)} × {formatMeasure(item.measure)}
        {item.rpeTarget && ` — RPE ${span(item.rpeTarget)}`}
      </p>
      {item.restSeconds && <p className="text-sm text-muted">Repos : {formatSeconds(item.restSeconds)}</p>}
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

function Block({ block }: { block: BlockView }) {
  const facts = [block.durationMinutes && span(block.durationMinutes, " min"), block.rpeTarget && `RPE ${span(block.rpeTarget)}`].filter(Boolean);
  return (
    <section className="flex flex-col gap-1.5" data-block-role={block.role}>
      <p className="text-xs uppercase tracking-wide text-muted">
        {block.roleLabel}
        {facts.length > 0 && ` · ${facts.join(" · ")}`}
      </p>
      {block.instructions.map((instruction) => (
        <p key={instruction} className="text-sm text-ink/80">
          {instruction}
        </p>
      ))}
      {block.talkTest && <p className="text-sm text-ink/80">{block.talkTest}</p>}
      {block.items.length > 0 && (
        <ul className="flex flex-col gap-3">
          {block.items.map((item) => (item.kind === "exercise" ? <ExerciseItem key={item.prescriptionItemId} item={item} /> : <DrillItem key={item.prescriptionItemId} item={item} />))}
        </ul>
      )}
    </section>
  );
}

function Prescription({ prescription }: { prescription: FinalPrescriptionV2View }) {
  return (
    <PlanSection title="Ta séance">
      <p className="font-medium text-ink">{prescription.intent}</p>
      {prescription.activities && <p className="text-sm text-ink/80">Activité au choix : {prescription.activities.join(", ")}</p>}
      <div className="flex flex-col gap-4">
        {prescription.blocks.map((block) => (
          <Block key={block.blockId} block={block} />
        ))}
      </div>
    </PlanSection>
  );
}

/** Read-only view of today's V2 final prescription state (created, REST, blocked, or a fail-closed state). */
export function FinalPrescriptionV2Card({ state }: { state: FinalPrescriptionV2State }) {
  switch (state.kind) {
    case "created":
      return <Prescription prescription={state.prescription} />;
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
            {BLOCKED_MESSAGES[state.code] ?? BLOCKED_FALLBACK_MESSAGE}
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
