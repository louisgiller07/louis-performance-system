import { Card } from "../../../components/Card";
import { Badge } from "../../../components/Badge";
import type { TrainingPlanReviewSession } from "../trainingPlanReviewTypes";
import { humanizeLabel, formatShortDate } from "../trainingPlanReviewFormat";

interface StrengthBlockLike {
  exerciseId?: unknown;
  sets?: unknown;
  repScheme?: unknown;
  intensity?: unknown;
  restSeconds?: unknown;
}
interface DhDrillLike {
  drillId?: unknown;
  runs?: unknown;
  executionCue?: unknown;
}

function readDomain(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const domain = (value as Record<string, unknown>).domain;
  return typeof domain === "string" ? domain : null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Same output strings as dailyPlan/ExecutablePrescriptionCard's own
 * formatRepScheme/formatIntensity (Today), duplicated locally rather than
 * cross-imported (sibling feature folders stay decoupled). Unlike Today's
 * typed payload, `structure` is `unknown` here — each variant is checked
 * field by field and anything unrecognized/malformed returns `null`
 * (rendered as nothing), never a default value.
 */
function formatRepScheme(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const repScheme = value as Record<string, unknown>;
  switch (repScheme.type) {
    case "fixed":
      return isFiniteNumber(repScheme.reps) ? `${repScheme.reps} reps` : null;
    case "range":
      return isFiniteNumber(repScheme.min) && isFiniteNumber(repScheme.max) ? `${repScheme.min}-${repScheme.max} reps` : null;
    case "time":
      return isFiniteNumber(repScheme.seconds) ? `${repScheme.seconds} s` : null;
    case "amrap":
      return "AMRAP";
    default:
      return null;
  }
}

function formatIntensity(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const intensity = value as Record<string, unknown>;
  switch (intensity.type) {
    case "rpe":
      return isFiniteNumber(intensity.target) ? `RPE ${intensity.target}` : null;
    case "rir":
      return isFiniteNumber(intensity.target) ? `RIR ${intensity.target}` : null;
    case "percent_1rm":
      return isFiniteNumber(intensity.value) ? `${intensity.value}% 1RM` : null;
    case "fixed_load_kg":
      return isFiniteNumber(intensity.value) ? `${intensity.value} kg` : null;
    case "training_max_percent":
      return isFiniteNumber(intensity.value) ? `${intensity.value}% TM` : null;
    case "bodyweight":
      return "Poids de corps";
    default:
      return null;
  }
}

/** "12 × 8-12 reps — RPE 7" (Today's layout); falls back to "12 séries" when no valid repScheme exists. `null` when nothing valid is left to show. */
function formatStrengthDose(block: StrengthBlockLike): string | null {
  const sets = isFiniteNumber(block.sets) ? block.sets : null;
  const reps = formatRepScheme(block.repScheme);
  const volume = sets !== null && reps !== null ? `${sets} × ${reps}` : sets !== null ? `${sets} séries` : reps;
  const parts = [volume, formatIntensity(block.intensity)].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" — ") : null;
}

/**
 * Presentational-only narrowing of `prescription.structure` — typed
 * `unknown` at the repository layer deliberately (V0.5_027: a discriminated
 * union, not the read layer's concern). Reads only fields that genuinely
 * exist in the real payload (StrengthPrescription/DhTechnicalPrescription,
 * planning-engine — mirrored here by convention, never imported); an
 * unrecognized/malformed shape renders nothing extra, never a fabricated
 * value. Exercise/drill names are humanized catalogue ids (no human-readable
 * name is available to web/ — see trainingPlanReviewFormat.ts's own doc).
 */
function PrescriptionStructure({ structure }: { structure: unknown }) {
  const domain = readDomain(structure);
  if (domain === "strength" && typeof structure === "object" && structure !== null && Array.isArray((structure as Record<string, unknown>).blocks)) {
    const blocks = (structure as Record<string, unknown>).blocks as unknown[];
    return (
      <ul className="flex flex-col gap-1">
        {blocks.map((rawBlock, index) => {
          const block: StrengthBlockLike = typeof rawBlock === "object" && rawBlock !== null ? (rawBlock as StrengthBlockLike) : {};
          const dose = formatStrengthDose(block);
          return (
            <li key={index} className="text-sm text-ink/90">
              <p>{typeof block.exerciseId === "string" ? humanizeLabel(block.exerciseId) : "Exercice"}</p>
              {dose && <p className="text-muted">{dose}</p>}
              {isFiniteNumber(block.restSeconds) && <p className="text-xs text-muted">Repos : {block.restSeconds} s</p>}
            </li>
          );
        })}
      </ul>
    );
  }
  if (domain === "dh_technical" && typeof structure === "object" && structure !== null && Array.isArray((structure as Record<string, unknown>).drills)) {
    const drills = (structure as Record<string, unknown>).drills as DhDrillLike[];
    return (
      <ul className="flex flex-col gap-1">
        {drills.map((drill, index) => (
          <li key={index} className="text-sm text-ink/90">
            {typeof drill.drillId === "string" ? humanizeLabel(drill.drillId) : "Drill"}
            {typeof drill.runs === "number" && <span className="text-muted"> — {drill.runs} passages</span>}
            {typeof drill.executionCue === "string" && <p className="text-xs text-muted">{drill.executionCue}</p>}
          </li>
        ))}
      </ul>
    );
  }
  return null;
}

/**
 * One generated session. Displays date/kind/duration/rationale, and — only
 * when `session.prescription` is present — the prescription structure.
 * Never renders a prescription placeholder for aerobic/rest/recovery
 * sessions (`prescription: null`, V0.4_119 lock — never generated for
 * those domains) — ticket-locked behavior, not an omission.
 */
export function TrainingPlanSessionCard({ session }: { session: TrainingPlanReviewSession }) {
  const domain = readDomain(session.doseTarget);

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-widest text-muted">{formatShortDate(session.date)}</span>
        <Badge>{humanizeLabel(session.kind)}</Badge>
      </div>
      {session.durationMin !== null && <p className="text-sm text-ink/80">{session.durationMin} min</p>}
      {domain && <p className="text-xs text-muted">{humanizeLabel(domain)}</p>}
      <p className="text-sm text-ink/90">{session.rationale}</p>
      {session.prescription && (
        <div className="mt-1 border-t border-white/5 pt-2">
          <PrescriptionStructure structure={session.prescription.structure} />
        </div>
      )}
    </Card>
  );
}
