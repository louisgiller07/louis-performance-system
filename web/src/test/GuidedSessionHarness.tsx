// UX-11C.1 / 11C.2 — test-only harness: the real hook + the real view.
import { MemoryRouter } from "react-router-dom";
import { GuidedSessionView } from "../features/guidedSession/GuidedSessionView";
import { useGuidedSession, type GuidedSessionDeps } from "../features/guidedSession/useGuidedSession";
import { DAY } from "./guidedSessionFakeBackend";

export function GuidedSessionHarness({ deps }: { deps: GuidedSessionDeps }) {
  const s = useGuidedSession("a", DAY, deps);
  return (
    <MemoryRouter>
      <GuidedSessionView
        load={s.load}
        busy={s.busy}
        actionError={s.actionError}
        onStart={(id) => void s.start(id)}
        onPause={(id) => void s.pause(id)}
        onResume={(id) => void s.resume(id)}
        onAbandon={(id) => void s.abandon(id)}
        onComplete={(id, pending) => void s.complete(id, pending)}
        onSubmit={s.submit}
        onRetry={() => void s.retry()}
        onReload={() => void s.reload()}
        newId={s.newId}
        now={s.now}
      />
    </MemoryRouter>
  );
}
