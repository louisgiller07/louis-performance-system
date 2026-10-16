import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { PageShell } from "../components/PageShell";
import { useEffectiveToday } from "../lib/simulationClock";
import { GuidedSessionView } from "../features/guidedSession/GuidedSessionView";
import { useGuidedSession } from "../features/guidedSession/useGuidedSession";

// UX-11C.1 — /today/session: the guided session of the rider's day. No id in
// the URL: everything (open execution, current decision, final prescription)
// is resolved from the authenticated rider's own rows (RLS) and every write
// is checked by the backend.
function GuidedSession({ athleteId }: { athleteId: string }) {
  const today = useEffectiveToday();
  // CONSISTENCY-02 (O-32) — the page follows the calendar day, except while a guided session is in progress (active
  // or paused): it keeps its own day until it ends, so its results, resume and safe stop stay reachable past
  // midnight. Nothing in progress: the new day — a session is never started from yesterday's prescription.
  const [day, setDay] = useState(today);
  const session = useGuidedSession(athleteId, day);
  const inProgress =
    session.load.status === "ready" &&
    session.load.snapshot.kind === "execution" &&
    (session.load.snapshot.phase === "active" || session.load.snapshot.phase === "paused");
  if (day !== today && !inProgress) setDay(today);
  return (
    <GuidedSessionView
      load={session.load}
      busy={session.busy}
      actionError={session.actionError}
      onStart={(id) => void session.start(id)}
      onPause={(id) => void session.pause(id)}
      onResume={(id) => void session.resume(id)}
      onAbandon={(id) => void session.abandon(id)}
      onComplete={(id, pending) => void session.complete(id, pending)}
      onSubmit={session.submit}
      onRetry={() => void session.retry()}
      onReload={() => void session.reload()}
      newId={session.newId}
      now={session.now}
    />
  );
}

export function GuidedSessionPage() {
  const { athleteId } = useAuth();
  return (
    <PageShell
      header={
        <header className="flex items-center gap-3 border-b border-white/5 bg-bg px-2 py-2">
          <Link to="/today" className="ux-press inline-flex min-h-11 items-center rounded px-2 text-sm font-medium text-ink/80 hover:text-gold">
            ← Aujourd'hui
          </Link>
        </header>
      }
    >
      {athleteId ? <GuidedSession athleteId={athleteId} /> : <p className="text-sm text-muted">Chargement…</p>}
    </PageShell>
  );
}
