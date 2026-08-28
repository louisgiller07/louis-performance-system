/**
 * V0.3_001B — operator-only, read-only canary against the DEPLOYED
 * `get-insights` Edge Function. NOT imported by
 * `supabase/functions/**`/`web/**`/`head-coach-engine/**`, and cannot
 * write anything remotely: `get-insights` itself is a pure GET read path
 * with zero `service_role` use anywhere in its own code (confirmed by
 * inspection) — this tool calls it exactly as a real authenticated browser
 * would, nothing more.
 *
 * Reuses `repositoryGuard.ts`/`operatorAuth.ts` verbatim — no
 * authentication logic is duplicated here. Same TTY/credential contract as
 * `previewRemoteRefresh.ts`: Claude Code must never run this interactively
 * (see operatorAuth.ts's own doc); if stdin is not a real TTY, it fails
 * closed before any prompt.
 *
 * Usage (run by the OPERATOR, in their own terminal):
 *   cd longitudinal-engine
 *   SUPABASE_URL=https://uvolpldwwyvadlamulvr.supabase.co \
 *   SUPABASE_ANON_KEY=<the project's public anon/publishable key> \
 *   npx tsx tools/getInsightsCanary.ts
 *
 * Output is a small sanitized JSON object only — see CanaryReport below.
 * Never prints: JWT, refresh token, session object, email, password,
 * athleteId, raw candidate snapshots (which embed sourceEvidenceRefs —
 * identity/revision ids that are themselves non-secret but out of scope
 * for a canary's job of proving "did this respond correctly, and only
 * read"), or any service-role configuration (there is none in this file).
 */
import { runRepositoryGuard } from "./repositoryGuard.js";
import { NoInteractiveTtyError, resolveOperatorSupabaseConfig, signInInteractive, signOutBestEffort } from "./operatorAuth.js";

export interface CanaryReport {
  readonly canonicalHead: string;
  readonly status: "success" | "http_error" | "network_error";
  readonly httpStatus: number | null;
  readonly range: { readonly fromDate: string; readonly toDate: string } | null;
  readonly candidateCount: number;
  readonly candidateKinds: readonly string[];
  readonly errorCode: string | null;
}

interface RawInsightCandidate {
  readonly snapshot?: { readonly insightKind?: unknown };
}

interface RawGetInsightsBody {
  readonly range?: { readonly fromDate?: unknown; readonly toDate?: unknown };
  readonly candidates?: readonly RawInsightCandidate[];
  readonly error?: { readonly code?: unknown; readonly message?: unknown };
}

/**
 * Sanitizes a raw get-insights HTTP response body down to exactly the
 * fields this canary reports — never passes through raw candidate
 * snapshots (athleteId, sourceEvidenceRefs, statement text, etc.).
 */
export function sanitizeGetInsightsResponse(canonicalHead: string, httpStatus: number, rawBody: unknown): CanaryReport {
  const body = (rawBody ?? {}) as RawGetInsightsBody;

  if (httpStatus < 200 || httpStatus >= 300) {
    const code = typeof body.error?.code === "string" ? body.error.code : "unknown_error";
    return { canonicalHead, status: "http_error", httpStatus, range: null, candidateCount: 0, candidateKinds: [], errorCode: code };
  }

  const range =
    typeof body.range?.fromDate === "string" && typeof body.range?.toDate === "string" ? { fromDate: body.range.fromDate, toDate: body.range.toDate } : null;
  const candidates = Array.isArray(body.candidates) ? body.candidates : [];
  const candidateKinds = candidates.map((c) => (typeof c.snapshot?.insightKind === "string" ? c.snapshot.insightKind : "unknown"));

  return { canonicalHead, status: "success", httpStatus, range, candidateCount: candidates.length, candidateKinds, errorCode: null };
}

function manualCommand(): string {
  return [
    "  cd longitudinal-engine",
    "  SUPABASE_URL=<project url> SUPABASE_ANON_KEY=<public anon/publishable key> \\",
    "    npx tsx tools/getInsightsCanary.ts",
  ].join("\n");
}

async function main(): Promise<void> {
  // Repository guard — identical discipline to previewRemoteRefresh.ts:
  // clean tree, on main, HEAD === origin/main, before any auth or network
  // call at all.
  const guardState = runRepositoryGuard();
  const canonicalHead = guardState.head;

  const config = resolveOperatorSupabaseConfig("remote");

  let session;
  try {
    session = await signInInteractive(config);
  } catch (err) {
    if (err instanceof NoInteractiveTtyError) {
      console.error(err.message);
      console.error("\nRun this command yourself, directly in a normal local terminal:\n");
      console.error(manualCommand());
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  try {
    // functions.invoke attaches the current session's Authorization header
    // automatically — the raw JWT is never read, held, or printed by this
    // tool's own code at any point.
    const { data, error } = await session.client.functions.invoke("get-insights", { method: "GET" });

    if (error) {
      const context = (error as { context?: Response }).context;
      const httpStatus = context?.status ?? 0;
      let body: unknown = null;
      try {
        body = context ? await context.clone().json() : null;
      } catch {
        body = null;
      }
      const report = sanitizeGetInsightsResponse(canonicalHead, httpStatus || 599, body);
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = 1;
      return;
    }

    const report = sanitizeGetInsightsResponse(canonicalHead, 200, data);
    console.log(JSON.stringify(report, null, 2));
  } catch (err) {
    const report: CanaryReport = {
      canonicalHead,
      status: "network_error",
      httpStatus: null,
      range: null,
      candidateCount: 0,
      candidateKinds: [],
      errorCode: err instanceof Error ? err.name : "unknown_network_error",
    };
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } finally {
    await signOutBestEffort(session.client);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
