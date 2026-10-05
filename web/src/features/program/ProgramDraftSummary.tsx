import { Link } from "react-router-dom";
import type { TrainingPlanDraftSummary, TrainingPlanReview } from "../trainingPlanReview/trainingPlanReviewTypes";
import { AcceptTrainingPlanButton } from "../trainingPlanReview/components/AcceptTrainingPlanButton";
import type { AcceptTrainingPlanResponse } from "../trainingPlanReview/acceptTrainingPlan";
import { READY } from "../firstRun/firstRunPresentation";
import { isGeneratedAfter } from "../trainingPlanReview/planVersionOrder";

// UX-06 — drafts, honestly. A draft is a new, complete generation of the plan
// (created when the athlete runs "Générer mon plan"), never an adaptation
// NALYNT applied on its own: nothing changes until the athlete accepts it.
// - Viewing the active plan: one card for the newest draft, older ones folded.
// - Viewing a draft: it says it is not active yet, with the (unchanged)
//   acceptance flow, and a way back to the active plan.
// UX-11R.9 (F-4) — with an active plan, a draft is a "new version" only when
// it was generated strictly after the active plan (generated_at, the server's
// stale_plan_version rule). Older drafts are never offered as new and never
// show "Accepter ce plan"; they stay listed as older versions.
const GENERATED = new Intl.DateTimeFormat("fr-CH", { day: "numeric", month: "long" });

function generatedOn(draft: Pick<TrainingPlanDraftSummary, "generatedAt">): string {
  const [y, m, d] = draft.generatedAt.slice(0, 10).split("-").map(Number);
  return `Générée le ${GENERATED.format(new Date(y!, m! - 1, d!))}`;
}

function OlderVersions({ drafts, onSelect, label }: { drafts: TrainingPlanDraftSummary[]; onSelect: (id: string) => void; label: string }) {
  if (drafts.length === 0) return null;
  return (
    <details className="group mt-4 border-t border-line pt-3">
      <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between text-sm text-ink/80 [&::-webkit-details-marker]:hidden">
        {label}
        <span className="text-gold transition-transform duration-300 group-open:rotate-90" aria-hidden="true">
          →
        </span>
      </summary>
      <ul className="mt-2 flex flex-col">
        {drafts.map((draft) => (
          <li key={draft.id}>
            <button type="button" onClick={() => onSelect(draft.id)} className="ux-press flex min-h-11 w-full items-center justify-between gap-3 border-b border-line py-2 text-left text-sm text-ink/80 last:border-b-0 hover:text-ink">
              <span>{generatedOn(draft)}</span>
              <span className="text-gold" aria-hidden="true">
                →
              </span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function ProgramDraftSummary({
  drafts,
  review,
  hasActivePlan,
  activeGeneratedAt = null,
  onSelect,
  onAccepted,
}: {
  drafts: TrainingPlanDraftSummary[];
  review: TrainingPlanReview;
  hasActivePlan: boolean;
  /** generated_at of the active plan (null: no active plan, or not known). */
  activeGeneratedAt?: string | null;
  onSelect: (planVersionId: string) => void;
  onAccepted: (result: AcceptTrainingPlanResponse) => void;
}) {
  if (review.lifecycleState === "draft" && !hasActivePlan) {
    // UX-09 — a rider's very first plan is never a "draft" or a "version".
    const others = drafts.filter((draft) => draft.id !== review.version.id);
    return (
      <section aria-labelledby="draft-title" className="ux-enter rounded-xl border border-gold/50 bg-card p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gold">{READY.kicker}</p>
        <h2 id="draft-title" className="mt-2 font-display text-2xl font-extrabold uppercase leading-tight text-ink">
          {READY.title}
        </h2>
        <p className="mt-3 font-display text-lg font-extrabold uppercase leading-tight text-ink">
          {READY.promise[0]} <span className="text-gold">{READY.promise[1]}</span>
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <AcceptTrainingPlanButton review={review} hasActivePlan={false} onAccepted={onAccepted} label={READY.start} />
        </div>
        <OlderVersions drafts={others} onSelect={onSelect} label={`${others.length} autre${others.length > 1 ? "s" : ""} version${others.length > 1 ? "s" : ""}`} />
      </section>
    );
  }

  if (review.lifecycleState === "draft" && hasActivePlan && (activeGeneratedAt === null || !isGeneratedAfter(review.version.generatedAt, activeGeneratedAt))) {
    // Stale draft (or the active plan's date is unknown: fail closed): readable, never acceptable here.
    const others = drafts.filter((draft) => draft.id !== review.version.id);
    return (
      <section aria-labelledby="draft-title" className="ux-enter rounded-xl border border-line bg-card p-5" data-testid="stale-draft">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted">Ancienne version</p>
        <h2 id="draft-title" className="mt-2 font-display text-2xl font-extrabold uppercase leading-tight text-ink">
          Version plus ancienne que ton plan actif
        </h2>
        <p className="mt-1 text-sm text-muted">{generatedOn(review.version)}</p>
        <p className="mt-3 text-sm leading-relaxed text-ink/80">Une version plus récente de ton plan est déjà active : cette version ne peut plus être acceptée.</p>
        <Link to="/training-plan" className="ux-press mt-4 inline-flex min-h-11 items-center text-sm text-ink/80 underline-offset-4 hover:text-ink hover:underline">
          ← Revenir à mon plan actif
        </Link>
        <OlderVersions drafts={others} onSelect={onSelect} label={`${others.length} autre${others.length > 1 ? "s" : ""} version${others.length > 1 ? "s" : ""}`} />
      </section>
    );
  }

  if (review.lifecycleState === "draft") {
    const others = drafts.filter((draft) => draft.id !== review.version.id);
    return (
      <section aria-labelledby="draft-title" className="ux-enter rounded-xl border border-gold/50 bg-card p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gold">Version non active</p>
        <h2 id="draft-title" className="mt-2 font-display text-2xl font-extrabold uppercase leading-tight text-ink">
          Nouvelle version de ton plan
        </h2>
        <p className="mt-1 text-sm text-muted">{generatedOn(review.version)}</p>
        <p className="mt-3 text-sm leading-relaxed text-ink/80">Rien ne change dans ton programme tant que tu ne l'acceptes pas.</p>
        <div className="mt-4 flex flex-col gap-2">
          <AcceptTrainingPlanButton review={review} hasActivePlan={hasActivePlan} onAccepted={onAccepted} />
          {hasActivePlan && (
            <Link to="/training-plan" className="ux-press inline-flex min-h-11 items-center text-sm text-ink/80 underline-offset-4 hover:text-ink hover:underline">
              ← Revenir à mon plan actif
            </Link>
          )}
        </div>
        <OlderVersions drafts={others} onSelect={onSelect} label={`${others.length} autre${others.length > 1 ? "s" : ""} version${others.length > 1 ? "s" : ""}`} />
      </section>
    );
  }

  if (drafts.length === 0) return null;
  // Only drafts generated strictly after the active plan (else after the plan on screen) are new versions.
  const reference = activeGeneratedAt ?? review.version.generatedAt;
  const newer = drafts.filter((draft) => isGeneratedAfter(draft.generatedAt, reference));
  const stale = drafts.filter((draft) => !newer.includes(draft));
  if (newer.length === 0) {
    return stale.length > 0 ? (
      <section aria-label="Anciennes versions" className="rounded-xl border border-line bg-card px-5 pb-3" data-testid="older-drafts-only">
        <OlderVersions drafts={stale} onSelect={onSelect} label={`${stale.length} ancienne${stale.length > 1 ? "s" : ""} version${stale.length > 1 ? "s" : ""}`} />
      </section>
    ) : null;
  }
  const [latest, ...olderNewer] = newer;
  const older = [...olderNewer, ...stale];
  return (
    <section aria-labelledby="draft-title" className="ux-enter rounded-xl border border-line bg-card p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gold">Nouvelle version disponible</p>
      <h2 id="draft-title" className="mt-2 font-display text-2xl font-extrabold uppercase leading-tight text-ink">
        Nouvelle version de ton plan prête
      </h2>
      <p className="mt-1 text-sm text-muted">{generatedOn(latest!)}</p>
      <p className="mt-3 text-sm leading-relaxed text-ink/80">Ton plan actuel reste actif tant que tu ne l'acceptes pas.</p>
      <button
        type="button"
        onClick={() => onSelect(latest!.id)}
        className="ux-press mt-4 min-h-11 rounded border border-gold/60 px-4 py-2 text-sm font-semibold uppercase tracking-[0.12em] text-gold hover:bg-gold/10"
      >
        Voir la nouvelle version
      </button>
      <OlderVersions drafts={older} onSelect={onSelect} label={`${older.length} ancienne${older.length > 1 ? "s" : ""} version${older.length > 1 ? "s" : ""}`} />
    </section>
  );
}
