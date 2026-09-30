import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { PageShell } from "../components/PageShell";
import { SubPageLink } from "../components/SubPageLink";
import { AppHeader } from "../components/AppHeader";
import { StateCard, StateSkeleton } from "../components/StateCard";
import { PAGE, RESPONSE } from "../features/insights/insightsPresentation";
import { InsightCard, type InsightCardNotice } from "../features/insights/InsightCard";
import { buildSubmitReviewBody, getInsights, submitReview } from "../features/insights/insightsRepo";
import type { GetInsightsResponse, PatternInsightCandidate, PatternInsightReviewDecision } from "../features/insights/insightsTypes";
import type { InsightsError } from "../features/insights/insightsErrors";

type PageState = { status: "loading" } | { status: "error"; error: InsightsError } | { status: "loaded"; response: GetInsightsResponse };

interface PageNotice {
  readonly id: string;
  readonly message: string;
}

function newNoticeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// V0.3_001C-3 — minimal authenticated Insights surface: loads get-insights
// (never refresh-longitudinal — there is no scheduler/automatic refresh
// caller, and this page never becomes one), renders candidates, and lets
// the athlete submit an explicit human review via submit-review. The
// success response is never trusted as authoritative review state — every
// outcome (success, stale_candidate, candidate_not_found) is followed by a
// fresh get-insights read, and only that fresh server response is rendered.
// accepted_as_insight never triggers any daily-run/coaching action here —
// V0.3_001 locks zero coaching influence.
export function InsightsPage() {
  const { signOut } = useAuth();
  const [state, setState] = useState<PageState>({ status: "loading" });
  const [submittingKeys, setSubmittingKeys] = useState<ReadonlySet<string>>(new Set());
  const [cardNotices, setCardNotices] = useState<Readonly<Record<string, InsightCardNotice>>>({});
  const [pageNotices, setPageNotices] = useState<readonly PageNotice[]>([]);

  const load = useCallback(async () => {
    const result = await getInsights();
    if (!result.ok) {
      setState({ status: "error", error: result.error });
      // Mirrors useCompletedSessionFlow's existing convention: a session_issue
      // error is the app's one established signal that the JWT is no
      // longer valid.
      if (result.error.action === "session_issue") void signOut();
      return;
    }
    setState({ status: "loaded", response: result.data });
  }, [signOut]);

  useEffect(() => {
    void load();
  }, [load]);

  function setSubmitting(key: string, value: boolean) {
    setSubmittingKeys((prev) => {
      const next = new Set(prev);
      if (value) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function clearCardNotice(key: string) {
    setCardNotices((prev) => {
      if (!(key in prev)) return prev;
      const { [key]: _removed, ...rest } = prev;
      return rest;
    });
  }

  function setCardNotice(key: string, notice: InsightCardNotice) {
    setCardNotices((prev) => ({ ...prev, [key]: notice }));
  }

  function dismissPageNotice(id: string) {
    setPageNotices((prev) => prev.filter((n) => n.id !== id));
  }

  async function handleReview(candidate: PatternInsightCandidate, decision: PatternInsightReviewDecision, reviewerNote: string | null) {
    const key = candidate.snapshot.detectorRuleId;
    setSubmitting(key, true);
    clearCardNotice(key);

    const body = buildSubmitReviewBody(candidate.snapshot, decision, reviewerNote);
    const result = await submitReview(body);

    if (result.ok) {
      // Authoritative state comes ONLY from a fresh read — never from
      // {action, reviewNumber} alone (never locally set reviewState here).
      await load();
      setCardNotice(key, { kind: "success", message: RESPONSE.saved });
      setSubmitting(key, false);
      return;
    }

    if (result.kind === "stale_candidate") {
      // Refetch immediately — the fresh candidate the 409 body carried is
      // never trusted directly, and reviewerNote/decision are never
      // resubmitted automatically. A new explicit human click is required.
      await load();
      setCardNotice(key, { kind: "stale", message: "Cette tendance a changé depuis ta dernière visite. Relis-la, puis réponds à nouveau si besoin." });
      setSubmitting(key, false);
      return;
    }

    if (result.kind === "candidate_not_found") {
      await load();
      setPageNotices((prev) => [...prev, { id: newNoticeId(), message: "Cette tendance n'est plus disponible." }]);
      setSubmitting(key, false);
      return;
    }

    setCardNotice(key, { kind: "error", message: result.error.message });
    if (result.error.action === "session_issue") void signOut();
    setSubmitting(key, false);
  }

  return (
    <PageShell header={<AppHeader />}>
      <SubPageLink to="/history" label={PAGE.back} back />
      {/* UX-10B-2A — what NALYNT observed, in a rider's words; responses never change the plan. */}
      <section aria-labelledby="insights-title" className="ux-enter">
        <h1 id="insights-title" className="font-display text-[clamp(2.25rem,10vw,3rem)] font-extrabold uppercase leading-[0.95] text-ink">
          {PAGE.title}
        </h1>
        <p className="mt-2 text-base text-ink/80">{PAGE.subtitle}</p>
      </section>

      {pageNotices.map((notice) => (
        <div key={notice.id} role="status" className="flex items-center justify-between gap-2 rounded-lg border border-line bg-card px-4 py-3 text-sm text-ink/85">
          <span>{notice.message}</span>
          <button type="button" onClick={() => dismissPageNotice(notice.id)} className="ux-press min-h-11 shrink-0 px-2 text-sm font-medium text-gold">
            {PAGE.close}
          </button>
        </div>
      ))}

      {state.status === "loading" && <StateSkeleton blocks={[48, 48]} />}

      {state.status === "error" && (
        <StateCard tone="error" title={PAGE.loadErrorTitle} action={{ label: PAGE.retry, onClick: () => void load() }}>
          {state.error.message}
        </StateCard>
      )}

      {state.status === "loaded" && state.response.candidates.length === 0 && <StateCard title={PAGE.emptyTitle}>{PAGE.empty}</StateCard>}

      {state.status === "loaded" &&
        state.response.candidates.map((candidate) => (
          <InsightCard
            key={candidate.snapshot.detectorRuleId}
            candidate={candidate}
            submitting={submittingKeys.has(candidate.snapshot.detectorRuleId)}
            notice={cardNotices[candidate.snapshot.detectorRuleId] ?? null}
            onReview={(decision, reviewerNote) => void handleReview(candidate, decision, reviewerNote)}
          />
        ))}
    </PageShell>
  );
}
