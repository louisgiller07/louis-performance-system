import { Card } from "../../../components/Card";
import { Badge } from "../../../components/Badge";
import type { TrainingPlanReviewSession } from "../trainingPlanReviewTypes";
import { humanizeLabel, formatShortDate } from "../trainingPlanReviewFormat";

interface StrengthBlockLike {
  exerciseId?: unknown;
  sets?: unknown;
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
    const blocks = (structure as Record<string, unknown>).blocks as StrengthBlockLike[];
    return (
      <ul className="flex flex-col gap-1">
        {blocks.map((block, index) => (
          <li key={index} className="text-sm text-ink/90">
            {typeof block.exerciseId === "string" ? humanizeLabel(block.exerciseId) : "Exercice"}
            {typeof block.sets === "number" && <span className="text-muted"> — {block.sets} séries</span>}
          </li>
        ))}
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
