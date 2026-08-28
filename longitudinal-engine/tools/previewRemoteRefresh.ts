/**
 * V0.3_001B — operator-only, read-only canonical preview for the first
 * `refresh-longitudinal` invocation. NOT imported by
 * `supabase/functions/**`/`web/**`/`head-coach-engine/**`, and does not
 * alter production runtime behavior in any way — it is a standalone CLI
 * script an operator runs manually in their own terminal.
 *
 * Executes the REAL production code path end to end — real
 * `assembleAthleteTimeline` (authenticated RLS reads), real
 * `calculateAndPersistOutcomes`, real `runDetectors`, real pure detectors —
 * with ONLY the final RPC layer substituted for an in-memory
 * `RecordingRpcClient` (see its own doc for exactly what that guarantees:
 * zero network writes, zero `.from().insert/update/delete`, zero real
 * `.rpc()` calls). No orchestration loop is reimplemented; no
 * classification is duplicated; nothing is reimplemented in SQL.
 *
 * Usage (run by the OPERATOR, in their own terminal — never by Claude
 * Code, see below):
 *   cd longitudinal-engine
 *   npm run build:clean
 *   SUPABASE_URL=https://uvolpldwwyvadlamulvr.supabase.co \
 *   SUPABASE_ANON_KEY=<the project's public anon/publishable key> \
 *   npx tsx tools/previewRemoteRefresh.ts
 * Add `--local` to point at the local Supabase stack instead (used only by
 * this package's own parity tests, and by a developer manually exercising
 * the tool against local fixtures).
 *
 * SECURITY: this script prompts for email (visible) and password (hidden,
 * echo suppressed, never accepted as a CLI argument — see operatorAuth.ts)
 * directly on the terminal it runs in. It requires a real interactive TTY
 * on stdin; if none is available (exactly the situation when Claude Code
 * runs a command through its own tool, which captures output
 * non-interactively) it prints this same usage block and exits WITHOUT
 * ever prompting — Claude Code must never attempt to supply or receive
 * Louis's password through any channel. The resulting session lives only
 * in this process's memory (no `persistSession`, no `autoRefreshToken`)
 * and is signed out best-effort on exit.
 *
 * Output is the sanitized PreviewReport JSON only (see buildPreviewReport.ts
 * for its full privacy contract) — safe to paste back for review.
 */
import { execSync } from "node:child_process";
import { assembleAthleteTimeline } from "../src/supabase/assembleAthleteTimeline.js";
import { calculateAndPersistOutcomes } from "../src/supabase/outcomeOrchestrator.js";
import { runDetectors } from "../src/supabase/detectorOrchestrator.js";
import { currentLongitudinalProcessingDate } from "../src/timeline/index.js";
import { buildPreviewReport } from "./buildPreviewReport.js";
import { createRecordingRpcClient } from "./recordingRpcClient.js";
import {
  checkOwnEvidenceLedgerEmpty,
  NoInteractiveTtyError,
  resolveOperatorSupabaseConfig,
  resolveOwnAthleteId,
  signInInteractive,
  signOutBestEffort,
} from "./operatorAuth.js";

function resolveCanonicalHead(): string {
  try {
    return execSync("git rev-parse HEAD").toString().trim();
  } catch {
    return "unknown";
  }
}

function manualCommandFor(mode: "remote" | "local"): string {
  const flag = mode === "local" ? " --local" : "";
  return [
    "  cd longitudinal-engine",
    "  npm run build:clean",
    "  SUPABASE_URL=<project url> SUPABASE_ANON_KEY=<public anon/publishable key> \\",
    `    npx tsx tools/previewRemoteRefresh.ts${flag}`,
  ].join("\n");
}

async function main(): Promise<void> {
  const mode: "remote" | "local" = process.argv.includes("--local") ? "local" : "remote";
  const canonicalHead = resolveCanonicalHead();
  const config = resolveOperatorSupabaseConfig(mode);

  let session;
  try {
    session = await signInInteractive(config);
  } catch (err) {
    if (err instanceof NoInteractiveTtyError) {
      console.error(err.message);
      console.error("\nRun this command yourself, directly in a normal local terminal:\n");
      console.error(manualCommandFor(mode));
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  try {
    const athleteId = await resolveOwnAthleteId(session.client);
    const emptyLedgerPrecondition = await checkOwnEvidenceLedgerEmpty(session.client, athleteId);
    const processingDate = currentLongitudinalProcessingDate();

    const timeline = await assembleAthleteTimeline({ client: session.client, athleteId, longitudinalProcessingDate: processingDate });

    const recording = createRecordingRpcClient();
    const outcomesResult = await calculateAndPersistOutcomes({ supabaseAdmin: recording.client, timeline, observedThroughDate: processingDate });
    const detectorsResult = await runDetectors({ supabaseAdmin: recording.client, timeline });

    const report = buildPreviewReport({
      canonicalHead,
      processingDate,
      emptyLedgerPrecondition,
      timeline,
      outcomesResult,
      detectorsResult,
      outcomeCalls: recording.outcomeCalls,
      evidenceCalls: recording.evidenceCalls,
      lifecycleCalls: recording.lifecycleCalls,
    });

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await signOutBestEffort(session.client);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
