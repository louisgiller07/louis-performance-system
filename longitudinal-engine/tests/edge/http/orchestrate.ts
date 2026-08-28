/**
 * V0.3_001A versioned HTTP integration test for
 * `supabase/functions/refresh-longitudinal` and `supabase/functions/get-insights`.
 * Mirrors head-coach-engine/tests/edge/http/orchestrate.ts's own structure and
 * discipline (run via `npm run test:v3:http`).
 *
 * Requires the local Supabase stack already running (`supabase start`) and,
 * in the environment (never hardcoded here):
 *   - SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY
 *   - SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEY
 * Get both via `npx supabase status -o env`.
 *
 * This script builds nothing itself (the `test:v3:http` npm script runs
 * `npm run build:clean` first — a full `rm dist` + rebuild, so the Edge
 * Runtime always consumes a freshly compiled `dist/**`, never a stale one)
 * — it starts `supabase functions serve`, waits for it to accept
 * connections, runs every scenario against the real Edge Runtime with real
 * scratch users/athletes/fixtures, and exits non-zero if any assertion
 * failed. Never logs a JWT or service key.
 *
 * Cleanup convention: pattern_evidence_identities.athlete_id and
 * pattern_insight_identities.athlete_id are both ON DELETE RESTRICT (by
 * design — see patternEvidenceSchema.integration.test.ts's own comment).
 * Once a scratch athlete here has real evidence persisted via
 * refresh-longitudinal, it becomes structurally undeletable — not even
 * service_role can remove it. Scratch data from athletes that received
 * evidence is deliberately left behind for the next `supabase db reset`,
 * the same convention every other integration suite in this project already
 * relies on. Only the bare "no athlete" user (never receives evidence) is
 * cleaned up here.
 */
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, insertCheckin, insertCompletedSession, insertDecision, type TestAthlete } from "../../supabase/testDb.js";
import { acquireReviewAdvisoryLockForTest } from "../../supabase/reviewAdvisoryLock.js";
import { PAIN_PERSISTENCE_RULE_ID, RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID, SLEEP_ENERGY_RULE_ID } from "../../../src/detectors/index.js";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, "$1");
const LOCAL_URL = "http://127.0.0.1:54321";
const SUPABASE_URL = process.env.SUPABASE_URL ?? LOCAL_URL;
const REFRESH_URL = `${SUPABASE_URL}/functions/v1/refresh-longitudinal`;
const INSIGHTS_URL = `${SUPABASE_URL}/functions/v1/get-insights`;
const SUBMIT_REVIEW_URL = `${SUPABASE_URL}/functions/v1/submit-review`;

class MissingAnonKeyError extends Error {
  constructor() {
    super(
      "No Supabase anon/publishable key found in the environment. Set SUPABASE_ANON_KEY or " +
        "SUPABASE_PUBLISHABLE_KEY to your local stack's key before running this script — get it via " +
        "`npx supabase status -o env`. No key is hardcoded here."
    );
    this.name = "MissingAnonKeyError";
  }
}

const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
if (!ANON_KEY) throw new MissingAnonKeyError();

// --- result tracking -------------------------------------------------------

interface Result {
  name: string;
  pass: boolean;
  detail?: string;
}
const results: Result[] = [];
function record(name: string, pass: boolean, detail?: string): void {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
}

const cleanupErrors: { what: string; message: string }[] = [];

// --- HTTP helpers ------------------------------------------------------------

interface HttpResult {
  status: number;
  headers: Headers;
  json: Record<string, any> | null;
  text: string;
}

async function rawRequest(url: string, method: string, headers: Record<string, string>, bodyText?: string): Promise<HttpResult> {
  const res = await fetch(url, { method, headers, body: bodyText });
  const text = await res.text();
  let json: Record<string, any> | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, headers: res.headers, json, text };
}

function refreshPost(token: string | null, body: unknown): Promise<HttpResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  return rawRequest(REFRESH_URL, "POST", headers, JSON.stringify(body));
}

function insightsGet(token: string | null): Promise<HttpResult> {
  const headers: Record<string, string> = {};
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  return rawRequest(INSIGHTS_URL, "GET", headers);
}

function submitReviewPost(token: string | null, body: unknown): Promise<HttpResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  return rawRequest(SUBMIT_REVIEW_URL, "POST", headers, JSON.stringify(body));
}

// --- diagnostic-output sanitization -----------------------------------------
// Assertions below always inspect the FULL real response/row object — these
// helpers only shrink what gets printed to the console/report as a `record()`
// detail string, so a human/log reader never sees athlete UUIDs, full
// candidateSnapshot/sourceEvidenceRefs, or identity/revision UUIDs. No
// assertion strength changes; this is output hygiene only.
function summarizeCandidateForLog(candidate: any): string {
  if (!candidate) return "null";
  return JSON.stringify({
    detectorRuleId: candidate.snapshot?.detectorRuleId,
    detectorRuleVersion: candidate.snapshot?.detectorRuleVersion,
    insightKind: candidate.snapshot?.insightKind,
    direction: candidate.snapshot?.direction,
    evidenceCount: candidate.snapshot?.evidenceCount,
    sourceEvidenceRefsCount: candidate.snapshot?.sourceEvidenceRefs?.length,
    reviewState: candidate.reviewState,
  });
}

function summarizeReviewForLog(review: any): string {
  if (!review) return "null";
  return JSON.stringify({
    detectorRuleId: review.detectorRuleId,
    decision: review.decision,
    reviewNumber: review.reviewNumber,
    hasReviewerNote: review.reviewerNote !== null && review.reviewerNote !== undefined,
  });
}

// Canonical (key-order-independent) JSON serialization — JSONB round-trips
// through Postgres do not guarantee preserving the original JS object's key
// insertion order, so a naive JSON.stringify comparison between an
// in-memory candidate snapshot and one read back from the DB can produce a
// false mismatch even when the two are genuinely deeply equal. Recurses
// into arrays/objects; primitives pass through JSON.stringify unchanged.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function freshnessTokenFrom(snapshot: any, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    detectorRuleId: snapshot.detectorRuleId,
    detectorRuleVersion: snapshot.detectorRuleVersion,
    insightKind: snapshot.insightKind,
    insightProjectorVersion: snapshot.insightProjectorVersion,
    rangeFromDate: snapshot.rangeFromDate,
    rangeToDate: snapshot.rangeToDate,
    sourceEvidenceRefs: snapshot.sourceEvidenceRefs,
    decision: "accepted_as_insight",
    ...overrides,
  };
}

// --- server lifecycle --------------------------------------------------------

function startFunctionsServer(): ChildProcess {
  const child = spawn("npx supabase functions serve", [], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "ignore", "ignore"],
    shell: true,
  });
  return child;
}

async function waitForFunctionsReady(url: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  let consecutiveOk = 0;
  let lastStatus: number | null = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      lastStatus = res.status;
      if (![502, 503, 504].includes(res.status)) {
        consecutiveOk += 1;
        if (consecutiveOk >= 3) return;
      } else {
        consecutiveOk = 0;
      }
    } catch {
      consecutiveOk = 0;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`function at ${url} did not become ready within ${timeoutMs}ms (last status: ${lastStatus})`);
}

function stopFunctionsServer(child: ChildProcess): void {
  if (child.pid != null && child.exitCode === null) {
    if (process.platform === "win32") {
      try {
        execSync(`taskkill /T /PID ${child.pid}`, { stdio: "ignore" });
      } catch {
        /* already dead */
      }
    } else {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        try {
          child.kill("SIGTERM");
        } catch {
          /* already dead */
        }
      }
    }
  }

  const filter = '--filter "name=supabase_edge_runtime_louis-performance-system" --format "{{.Names}}"';
  try {
    const name = execSync(`docker ps ${filter}`).toString().trim();
    if (name) execSync(`docker stop ${name}`, { stdio: "ignore" });
  } catch (e) {
    cleanupErrors.push({ what: "edge-runtime container", message: e instanceof Error ? e.message : String(e) });
    return;
  }
  try {
    const stillRunning = execSync(`docker ps ${filter}`).toString().trim();
    if (stillRunning) cleanupErrors.push({ what: "edge-runtime container", message: "container still running after stop attempt" });
  } catch {
    /* docker unavailable for the verification step */
  }
}

// --- fixtures ----------------------------------------------------------------

async function createScratchUserWithToken(admin: SupabaseClient, label: string): Promise<TestAthlete & { token: string }> {
  const athlete = await createTestAthlete(admin, `V0.3_001A HTTP scratch — ${label}`);
  const { data: userData, error: getError } = await admin.auth.admin.getUserById(athlete.userId);
  if (getError || !userData.user?.email) throw new Error(`could not resolve scratch user email: ${getError?.message}`);

  const password = `Sc${randomUUID().replace(/-/g, "").slice(0, 20)}Aa1!`;
  const { error: pwError } = await admin.auth.admin.updateUserById(athlete.userId, { password });
  if (pwError) throw new Error(`set scratch password failed: ${pwError.message}`);

  const anon = createClient(SUPABASE_URL, ANON_KEY as string, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: signedIn, error: signInError } = await anon.auth.signInWithPassword({ email: userData.user.email, password });
  if (signInError || !signedIn.session) throw new Error(`sign-in failed for scratch user ${label}: ${signInError?.message}`);

  return { ...athlete, token: signedIn.session.access_token };
}

async function cleanupBareUser(admin: SupabaseClient, userId: string, label: string): Promise<void> {
  try {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) cleanupErrors.push({ what: `user(${label}) delete call`, message: error.message });
  } catch (e) {
    cleanupErrors.push({ what: `user(${label}) delete call`, message: e instanceof Error ? e.message : String(e) });
  }
  try {
    const { data: userCheck } = await admin.auth.admin.getUserById(userId);
    if (userCheck?.user) cleanupErrors.push({ what: `user(${label})`, message: "auth user still present after cleanup" });
  } catch (e) {
    cleanupErrors.push({ what: `user(${label}) verification`, message: e instanceof Error ? e.message : String(e) });
  }
}

// --- main ----------------------------------------------------------------

async function main(): Promise<void> {
  const admin = createTestClient();

  try {
    await admin.auth.admin.listUsers({ perPage: 1 });
  } catch (e) {
    throw new Error(`Local Supabase stack unreachable at ${SUPABASE_URL} — run \`supabase start\` first. (${(e as Error).message})`);
  }

  let noAthleteUserId: string | undefined;
  const server = startFunctionsServer();
  try {
    await waitForFunctionsReady(REFRESH_URL);

    // ---------- seed ----------
    const userA = await createScratchUserWithToken(admin, "a");
    const decisionDateA = "2026-06-20";
    const decisionIdA = await insertDecision(admin, userA.athleteId, decisionDateA, { final_session: "STRENGTH_A" });
    await insertCompletedSession(admin, userA.athleteId, decisionDateA, { decision_id: decisionIdA, session_type: "STRENGTH_A", completion_status: "done" });
    await insertCheckin(admin, userA.athleteId, decisionDateA, { sleep_quality: 8, energy: 8 });

    const userB = await createScratchUserWithToken(admin, "b");
    const decisionDateB = "2026-06-21";
    const decisionIdB = await insertDecision(admin, userB.athleteId, decisionDateB, { final_session: "REST" });
    // no completed_session for B -> no_evidence for the recommendation detector.

    const { data: noAthleteUser, error: noAthleteErr } = await admin.auth.admin.createUser({
      email: `v3-http-noathlete-${randomUUID()}@example.invalid`,
      email_confirm: true,
      password: "NoAthleteScratch1!",
    });
    if (noAthleteErr || !noAthleteUser.user) throw new Error(`createUser(no-athlete) failed: ${noAthleteErr?.message}`);
    noAthleteUserId = noAthleteUser.user.id;
    const anonForNoAthlete = createClient(SUPABASE_URL, ANON_KEY as string, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: noAthleteSignIn, error: noAthleteSignInErr } = await anonForNoAthlete.auth.signInWithPassword({
      email: noAthleteUser.user.email!,
      password: "NoAthleteScratch1!",
    });
    if (noAthleteSignInErr || !noAthleteSignIn.session) throw new Error(`sign-in(no-athlete) failed: ${noAthleteSignInErr?.message}`);
    const noAthleteToken = noAthleteSignIn.session.access_token;

    // ================= auth boundary — refresh-longitudinal =================
    {
      const r = await refreshPost(null, {});
      record("refresh. no Authorization header -> 401", r.status === 401, `status=${r.status}`);
    }
    {
      const r = await refreshPost("not.a.valid.jwt", {});
      record("refresh. invalid JWT -> 401", r.status === 401, `status=${r.status}`);
    }
    {
      const r = await refreshPost(noAthleteToken, {});
      record("refresh. no athlete -> 403 no_athlete_for_user", r.status === 403 && r.json?.error?.code === "no_athlete_for_user", `status=${r.status}`);
    }
    {
      const res = await fetch(REFRESH_URL, { method: "GET", headers: { Authorization: `Bearer ${userA.token}` } });
      const allow = res.headers.get("allow");
      record("refresh. GET -> 405 + Allow: POST", res.status === 405 && allow === "POST", `status=${res.status} allow=${allow}`);
    }
    {
      const r = await refreshPost(userA.token, { athleteId: userB.athleteId });
      record("refresh. unknown field (athleteId injection) -> 400 invalid_request", r.status === 400 && r.json?.error?.code === "invalid_request", `status=${r.status}`);
    }
    {
      const r = await rawRequest(REFRESH_URL, "POST", { Authorization: `Bearer ${userA.token}`, "Content-Type": "application/json" }, "not json");
      record("refresh. malformed JSON body -> 400 invalid_request", r.status === 400 && r.json?.error?.code === "invalid_request", `status=${r.status}`);
    }

    // ================= real success — refresh-longitudinal for A =================
    const before = await admin.from("pattern_evidence_identities").select("id", { count: "exact", head: true }).eq("athlete_id", userA.athleteId);
    let firstRun: HttpResult;
    {
      firstRun = await refreshPost(userA.token, {});
      const ok =
        firstRun.status === 200 &&
        (firstRun.json?.status === "complete" || firstRun.json?.status === "partial_failure") &&
        /^\d{4}-\d{2}-\d{2}$/.test(firstRun.json?.processingDate ?? "") &&
        typeof firstRun.json?.outcomes === "object" &&
        typeof firstRun.json?.detectors === "object" &&
        Array.isArray(firstRun.json?.errors);
      record("refresh. real success -> 200, well-shaped summary", ok, `status=${firstRun.status} body=${firstRun.text.slice(0, 300)}`);
      record("refresh. real success -> status complete (no orchestration errors)", firstRun.json?.status === "complete" && (firstRun.json?.errors ?? []).length === 0, JSON.stringify(firstRun.json));
    }
    {
      const detectors = firstRun.json?.detectors ?? {};
      const hasAllThreeRuleKeys =
        typeof detectors[RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID] === "object" &&
        typeof detectors[SLEEP_ENERGY_RULE_ID] === "object" &&
        typeof detectors[PAIN_PERSISTENCE_RULE_ID] === "object";
      const recSummary = detectors[RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID];
      const requiredKeys = ["attempted", "inserted", "superseded", "unchanged", "withdrawn", "unchangedWithdrawal", "skippedNoPrior", "errorCount"];
      const recHasAllKeys = recSummary !== undefined && requiredKeys.every((k) => typeof recSummary[k] === "number");
      record("refresh. per-detector summary keyed by exact rule ids, all 3 present", hasAllThreeRuleKeys, JSON.stringify(detectors));
      record("refresh. per-detector summary has all 8 required numeric keys", recHasAllKeys, JSON.stringify(recSummary));
      record(
        "refresh. recommendation detector summary reflects the real inserted evidence (attempted=1, inserted=1)",
        recSummary?.attempted === 1 && recSummary?.inserted === 1 && recSummary?.errorCount === 0,
        JSON.stringify(recSummary)
      );
    }
    {
      const { data: evidenceRow, error } = await admin
        .from("pattern_evidence_current")
        .select("event_type, athlete_id")
        .eq("evidence_key", `decision:${decisionIdA}`)
        .maybeSingle();
      record(
        "refresh. real pattern_evidence row persisted for A's decision",
        !error && evidenceRow?.event_type === "supporting" && evidenceRow?.athlete_id === userA.athleteId,
        JSON.stringify({ event_type: evidenceRow?.event_type, athlete_matches_expected: evidenceRow?.athlete_id === userA.athleteId })
      );
    }
    {
      const after = await admin.from("pattern_evidence_identities").select("id", { count: "exact", head: true }).eq("athlete_id", userA.athleteId);
      record("refresh. identity count increased from zero", (before.count ?? 0) === 0 && (after.count ?? 0) > 0, `before=${before.count} after=${after.count}`);
    }

    // ================= idempotent rerun =================
    {
      const identityCountBefore = await admin.from("pattern_evidence_identities").select("id", { count: "exact", head: true }).eq("athlete_id", userA.athleteId);
      const secondRun = await refreshPost(userA.token, {});
      const identityCountAfter = await admin.from("pattern_evidence_identities").select("id", { count: "exact", head: true }).eq("athlete_id", userA.athleteId);
      record(
        "refresh. second identical call -> 200, zero new identities",
        secondRun.status === 200 && identityCountBefore.count === identityCountAfter.count,
        `before=${identityCountBefore.count} after=${identityCountAfter.count}`
      );
    }

    // ================= no-input contract =================
    {
      const r1 = await refreshPost(userA.token, { date: "2026-06-20" });
      record("refresh. date field rejected -> 400 invalid_request (server computes its own processing date)", r1.status === 400 && r1.json?.error?.code === "invalid_request", `status=${r1.status}`);
    }

    // ================= auth boundary — get-insights =================
    {
      const r = await insightsGet(null);
      record("insights. no Authorization header -> 401", r.status === 401, `status=${r.status}`);
    }
    {
      const r = await insightsGet("not.a.valid.jwt");
      record("insights. invalid JWT -> 401", r.status === 401, `status=${r.status}`);
    }
    {
      const r = await insightsGet(noAthleteToken);
      record("insights. no athlete -> 403 no_athlete_for_user", r.status === 403 && r.json?.error?.code === "no_athlete_for_user", `status=${r.status}`);
    }
    {
      const res = await fetch(INSIGHTS_URL, { method: "POST", headers: { Authorization: `Bearer ${userA.token}`, "Content-Type": "application/json" }, body: "{}" });
      const allow = res.headers.get("allow");
      record("insights. POST -> 405 + Allow: GET", res.status === 405 && allow === "GET", `status=${res.status} allow=${allow}`);
    }

    // ================= real read — get-insights for A =================
    let insightsA: HttpResult;
    {
      insightsA = await insightsGet(userA.token);
      const ok =
        insightsA.status === 200 &&
        insightsA.json?.range?.fromDate === "1900-01-01" &&
        insightsA.json?.range?.toDate === "9999-12-31" &&
        Array.isArray(insightsA.json?.candidates);
      record(
        "insights. real read -> 200, static domain-wide range",
        ok,
        `status=${insightsA.status} range=${JSON.stringify(insightsA.json?.range)} candidateCount=${(insightsA.json?.candidates ?? []).length}`
      );
    }
    {
      const candidates: any[] = insightsA.json?.candidates ?? [];
      const recCandidate = candidates.find((c) => c.snapshot?.insightKind === "recommendation_execution_alignment");
      const ok =
        recCandidate !== undefined &&
        recCandidate.snapshot.athleteId === userA.athleteId &&
        recCandidate.snapshot.direction === "supporting" &&
        recCandidate.reviewState === "unreviewed" &&
        recCandidate.currentReview === null;
      record("insights. recommendation_execution_alignment candidate present, correctly shaped, unreviewed", ok, summarizeCandidateForLog(recCandidate));
    }

    // ================= cross-athlete isolation =================
    {
      await refreshPost(userB.token, {}); // B's own refresh — no_evidence only, no completed_session linked
      const insightsB = await insightsGet(userB.token);
      const candidatesB: any[] = insightsB.json?.candidates ?? [];
      const leaksIntoB = candidatesB.some((c: any) => c.snapshot?.athleteId === userA.athleteId);
      record("insights. B never sees A's athleteId in any candidate", insightsB.status === 200 && !leaksIntoB, `count=${candidatesB.length}`);

      const candidatesAAfter = (await insightsGet(userA.token)).json?.candidates ?? [];
      const leaksIntoA = candidatesAAfter.some((c: any) => c.snapshot?.athleteId === userB.athleteId);
      record("insights. A never sees B's athleteId in any candidate", !leaksIntoA, `count=${candidatesAAfter.length}`);
    }

    // ================= get-insights strict query contract =================
    // Real deterministic proof (no placeholder): every one of these must be
    // REJECTED outright with 400 invalid_request — never silently ignored,
    // and never allowed to influence athlete/range/candidate selection.
    {
      const cases: Array<[string, string]> = [
        ["athleteId query rejected", `?athleteId=${userB.athleteId}`],
        ["range query rejected", "?range=whatever"],
        ["fromDate query rejected", "?fromDate=2026-01-01"],
        ["unknown query rejected", "?foo=bar"],
      ];
      for (const [label, qs] of cases) {
        // `qs` (the real query string, including userB.athleteId's raw UUID
        // for the first case) is what's actually SENT — required to prove
        // the endpoint genuinely rejects it. Only the query PARAMETER NAME,
        // never its value, is printed in the diagnostic detail below.
        const res = await fetch(`${INSIGHTS_URL}${qs}`, { method: "GET", headers: { Authorization: `Bearer ${userA.token}` } });
        const body = await res.text();
        let json: any = null;
        try {
          json = JSON.parse(body);
        } catch {
          /* not JSON */
        }
        const paramName = qs.replace(/^\?/, "").split("=")[0] || qs;
        record(`insights. ${label} -> 400 invalid_request`, res.status === 400 && json?.error?.code === "invalid_request", `query=${paramName} status=${res.status} code=${json?.error?.code}`);
      }
    }
    {
      // athleteId query param must never override the JWT-resolved athlete
      // — confirmed by the 400 rejection above (never reaching candidate
      // calculation at all), reconfirmed here: A's real read still only
      // ever returns A's own athleteId in every candidate.
      const stillOnlyA = (insightsA.json?.candidates ?? []).every((c: any) => c.snapshot?.athleteId === userA.athleteId);
      record("insights. athleteId query cannot influence athlete selection (real read still A-only)", stillOnlyA, "");
    }

    // ================= submit-review =================
    let submitReviewSuccess: HttpResult;
    let submitReviewStale: HttpResult;
    {
      // ---------- auth/method boundary ----------
      {
        const r = await submitReviewPost(null, {});
        record("submit-review. no Authorization header -> 401", r.status === 401, `status=${r.status}`);
      }
      {
        const r = await submitReviewPost("not.a.valid.jwt", {});
        record("submit-review. invalid JWT -> 401", r.status === 401, `status=${r.status}`);
      }
      {
        // A well-formed (but arbitrary) body — must pass request validation
        // so the athlete-resolution check (which runs AFTER validation,
        // same order as refresh-longitudinal/get-insights) is what actually
        // produces the response here, not an earlier 400.
        const r = await submitReviewPost(
          noAthleteToken,
          freshnessTokenFrom({
            detectorRuleId: RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID,
            detectorRuleVersion: "1.0.0",
            insightKind: "recommendation_execution_alignment",
            insightProjectorVersion: "1.0.0",
            rangeFromDate: "1900-01-01",
            rangeToDate: "9999-12-31",
            sourceEvidenceRefs: [],
          })
        );
        record("submit-review. no athlete -> 403 no_athlete_for_user", r.status === 403 && r.json?.error?.code === "no_athlete_for_user", `status=${r.status}`);
      }
      for (const method of ["GET", "PUT", "DELETE"]) {
        const res = await fetch(SUBMIT_REVIEW_URL, { method, headers: { Authorization: `Bearer ${userA.token}` } });
        const allow = res.headers.get("allow");
        record(`submit-review. ${method} -> 405 + Allow: POST`, res.status === 405 && allow === "POST", `status=${res.status} allow=${allow}`);
      }

      // ---------- request validation ----------
      {
        const r = await rawRequest(SUBMIT_REVIEW_URL, "POST", { Authorization: `Bearer ${userA.token}`, "Content-Type": "application/json" }, "not json");
        record("submit-review. malformed JSON body -> 400 invalid_request", r.status === 400 && r.json?.error?.code === "invalid_request", `status=${r.status}`);
      }
      {
        const r = await rawRequest(SUBMIT_REVIEW_URL, "POST", { Authorization: `Bearer ${userA.token}`, "Content-Type": "application/json" }, "null");
        record("submit-review. null body -> 400 invalid_request", r.status === 400 && r.json?.error?.code === "invalid_request", `status=${r.status}`);
      }
      {
        const r = await rawRequest(SUBMIT_REVIEW_URL, "POST", { Authorization: `Bearer ${userA.token}`, "Content-Type": "application/json" }, "[]");
        record("submit-review. array body -> 400 invalid_request", r.status === 400 && r.json?.error?.code === "invalid_request", `status=${r.status}`);
      }
      {
        const r = await submitReviewPost(userA.token, { detectorRuleId: "x" });
        record("submit-review. missing required fields -> 400 invalid_request", r.status === 400 && r.json?.error?.code === "invalid_request", `status=${r.status}`);
      }
      {
        const validCandidate = (insightsA.json?.candidates ?? []).find((c: any) => c.snapshot?.insightKind === "recommendation_execution_alignment");
        const r = await submitReviewPost(userA.token, freshnessTokenFrom(validCandidate.snapshot, { unknownField: "x" }));
        record("submit-review. unknown top-level field -> 400 invalid_request", r.status === 400 && r.json?.error?.code === "invalid_request", `status=${r.status}`);
      }
      {
        const validCandidate = (insightsA.json?.candidates ?? []).find((c: any) => c.snapshot?.insightKind === "recommendation_execution_alignment");
        const r = await submitReviewPost(userA.token, freshnessTokenFrom(validCandidate.snapshot, { athleteId: userB.athleteId }));
        record("submit-review. athleteId injection -> 400 invalid_request (unknown field, never used to override server resolution)", r.status === 400 && r.json?.error?.code === "invalid_request", `status=${r.status}`);
      }
      {
        const validCandidate = (insightsA.json?.candidates ?? []).find((c: any) => c.snapshot?.insightKind === "recommendation_execution_alignment");
        const r = await submitReviewPost(userA.token, freshnessTokenFrom(validCandidate.snapshot, { candidateSnapshot: validCandidate.snapshot }));
        record("submit-review. candidateSnapshot injection -> 400 invalid_request", r.status === 400 && r.json?.error?.code === "invalid_request", `status=${r.status}`);
      }
      {
        const validCandidate = (insightsA.json?.candidates ?? []).find((c: any) => c.snapshot?.insightKind === "recommendation_execution_alignment");
        const r = await submitReviewPost(userA.token, freshnessTokenFrom(validCandidate.snapshot, { decision: "activated" }));
        record("submit-review. invalid decision value -> 400 invalid_request", r.status === 400 && r.json?.error?.code === "invalid_request", `status=${r.status}`);
      }
      {
        const validCandidate = (insightsA.json?.candidates ?? []).find((c: any) => c.snapshot?.insightKind === "recommendation_execution_alignment");
        const cases: Array<[string, unknown]> = [
          ["empty string", ""],
          ["whitespace-only", "   "],
          ["leading/trailing whitespace", " note "],
          ["too long (2001 chars)", "a".repeat(2001)],
          ["wrong type (number)", 42],
        ];
        for (const [label, reviewerNote] of cases) {
          const r = await submitReviewPost(userA.token, freshnessTokenFrom(validCandidate.snapshot, { reviewerNote }));
          record(`submit-review. reviewerNote ${label} -> 400 invalid_request`, r.status === 400 && r.json?.error?.code === "invalid_request", `status=${r.status}`);
        }
      }

      // ---------- candidate_not_found (B has no recommendation-alignment candidate: no completed_session ever linked) ----------
      const reviewCountBefore = await admin.from("pattern_insight_reviews").select("id", { count: "exact", head: true });
      {
        const bogusToken = freshnessTokenFrom({
          detectorRuleId: RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID,
          detectorRuleVersion: "1.0.0",
          insightKind: "recommendation_execution_alignment",
          insightProjectorVersion: "1.0.0",
          rangeFromDate: "1900-01-01",
          rangeToDate: "9999-12-31",
          sourceEvidenceRefs: [],
        });
        const r = await submitReviewPost(userB.token, bogusToken);
        record("submit-review. candidate_not_found -> 404, no write", r.status === 404 && r.json?.error?.code === "candidate_not_found", `status=${r.status} body=${r.text.slice(0, 200)}`);
      }
      {
        const reviewCountAfterNotFound = await admin.from("pattern_insight_reviews").select("id", { count: "exact", head: true });
        record("submit-review. candidate_not_found writes zero review rows", reviewCountBefore.count === reviewCountAfterNotFound.count, `before=${reviewCountBefore.count} after=${reviewCountAfterNotFound.count}`);
      }

      // ---------- stale_candidate: genuine evidence mutation between "browser load" and submit ----------
      const staleToken = freshnessTokenFrom((insightsA.json?.candidates ?? []).find((c: any) => c.snapshot?.insightKind === "recommendation_execution_alignment").snapshot);
      {
        // A second decision+completed_session for A, then a real refresh —
        // adds a second sourceEvidenceRef to the SAME detectorRuleId,
        // changing its fingerprint. The token above was captured BEFORE
        // this mutation, exactly modeling "browser loaded candidate, then
        // evidence changed before submit".
        const decisionDateA2 = "2026-06-25";
        const decisionIdA2 = await insertDecision(admin, userA.athleteId, decisionDateA2, { final_session: "STRENGTH_A" });
        await insertCompletedSession(admin, userA.athleteId, decisionDateA2, { decision_id: decisionIdA2, session_type: "STRENGTH_A", completion_status: "done" });
        const mutateRun = await refreshPost(userA.token, {});
        record("submit-review setup. second refresh after new evidence -> 200", mutateRun.status === 200, `status=${mutateRun.status}`);
      }
      const reviewCountBeforeStale = await admin.from("pattern_insight_reviews").select("id", { count: "exact", head: true });
      {
        submitReviewStale = await submitReviewPost(userA.token, staleToken);
        const ok = submitReviewStale.status === 409 && submitReviewStale.json?.error?.code === "stale_candidate" && submitReviewStale.json?.candidate?.snapshot?.detectorRuleId === RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID;
        record(
          "submit-review. stale token (evidence mutated after load) -> 409 stale_candidate, fresh candidate returned",
          ok,
          `status=${submitReviewStale.status} code=${submitReviewStale.json?.error?.code} freshCandidate=${summarizeCandidateForLog(submitReviewStale.json?.candidate)}`
        );
      }
      {
        const freshRefs = submitReviewStale.json?.candidate?.snapshot?.sourceEvidenceRefs ?? [];
        const staleRefs = (staleToken as any).sourceEvidenceRefs;
        record("submit-review. stale response's fresh candidate has a DIFFERENT sourceEvidenceRefs than the stale token", JSON.stringify(freshRefs) !== JSON.stringify(staleRefs), `freshCount=${freshRefs.length} staleCount=${staleRefs.length}`);
      }
      {
        const reviewCountAfterStale = await admin.from("pattern_insight_reviews").select("id", { count: "exact", head: true });
        record("submit-review. stale_candidate writes zero review rows", reviewCountBeforeStale.count === reviewCountAfterStale.count, `before=${reviewCountBeforeStale.count} after=${reviewCountAfterStale.count}`);
      }

      // ---------- version/kind mismatch resolve to stale_candidate, never candidate_not_found ----------
      const currentInsightsA = await insightsGet(userA.token);
      const currentCandidate = (currentInsightsA.json?.candidates ?? []).find((c: any) => c.snapshot?.insightKind === "recommendation_execution_alignment");
      {
        const r = await submitReviewPost(userA.token, freshnessTokenFrom(currentCandidate.snapshot, { detectorRuleVersion: "0.0.1-does-not-exist" }));
        record("submit-review. detectorRuleVersion mismatch -> 409 stale_candidate, NOT 404", r.status === 409 && r.json?.error?.code === "stale_candidate", `status=${r.status} code=${r.json?.error?.code}`);
      }
      {
        const r = await submitReviewPost(userA.token, freshnessTokenFrom(currentCandidate.snapshot, { insightKind: "sleep_energy_same_day_association" }));
        record("submit-review. insightKind mismatch -> 409 stale_candidate, NOT 404", r.status === 409 && r.json?.error?.code === "stale_candidate", `status=${r.status} code=${r.json?.error?.code}`);
      }

      // ---------- real success: inserted -> unchanged -> superseded ----------
      {
        submitReviewSuccess = await submitReviewPost(userA.token, freshnessTokenFrom(currentCandidate.snapshot, { decision: "accepted_as_insight", reviewerNote: null }));
        const ok = submitReviewSuccess.status === 200 && submitReviewSuccess.json?.review?.action === "inserted" && submitReviewSuccess.json?.review?.reviewNumber === 1;
        record("submit-review. fresh candidate + real success -> 200, action=inserted, reviewNumber=1", ok, `status=${submitReviewSuccess.status} body=${submitReviewSuccess.text.slice(0, 300)}`);
      }
      {
        const keys = Object.keys(submitReviewSuccess.json?.review ?? {});
        record("submit-review. success response contains ONLY {action, reviewNumber} — no identityId/reviewId/athleteId/candidate_snapshot", JSON.stringify(keys.sort()) === JSON.stringify(["action", "reviewNumber"]), JSON.stringify(submitReviewSuccess.json));
      }
      {
        const { data: reviewRow, error } = await admin
          .from("pattern_insight_review_current")
          .select("decision, reviewer_note, athlete_id, detector_rule_id")
          .eq("athlete_id", userA.athleteId)
          .eq("detector_rule_id", RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID)
          .maybeSingle();
        record(
          "submit-review. real pattern_insight_reviews row persisted, decision=accepted_as_insight, reviewer_note NULL",
          !error && reviewRow?.decision === "accepted_as_insight" && reviewRow?.reviewer_note === null && reviewRow?.athlete_id === userA.athleteId,
          JSON.stringify({ decision: reviewRow?.decision, reviewer_note_is_null: reviewRow?.reviewer_note === null, detector_rule_id: reviewRow?.detector_rule_id, athlete_matches_expected: reviewRow?.athlete_id === userA.athleteId })
        );
      }
      {
        const identicalResubmit = await submitReviewPost(userA.token, freshnessTokenFrom(currentCandidate.snapshot, { decision: "accepted_as_insight", reviewerNote: null }));
        const ok = identicalResubmit.status === 200 && identicalResubmit.json?.review?.action === "unchanged" && identicalResubmit.json?.review?.reviewNumber === 1;
        record("submit-review. identical resubmit -> 200, action=unchanged, same reviewNumber, no new row (RPC-native idempotency)", ok, `status=${identicalResubmit.status} body=${identicalResubmit.text.slice(0, 300)}`);
      }
      {
        const changedDecision = await submitReviewPost(userA.token, freshnessTokenFrom(currentCandidate.snapshot, { decision: "dismissed", reviewerNote: "changed my mind" }));
        const ok = changedDecision.status === 200 && changedDecision.json?.review?.action === "superseded" && changedDecision.json?.review?.reviewNumber === 2;
        record("submit-review. different decision on the same candidate -> 200, action=superseded, reviewNumber=2", ok, `status=${changedDecision.status} body=${changedDecision.text.slice(0, 300)}`);
      }
      {
        const insightsAfterReview = await insightsGet(userA.token);
        const reviewedCandidate = (insightsAfterReview.json?.candidates ?? []).find((c: any) => c.snapshot?.insightKind === "recommendation_execution_alignment");
        record(
          "submit-review. get-insights after review -> reviewState=reviewed_current, decision=dismissed",
          reviewedCandidate?.reviewState === "reviewed_current" && reviewedCandidate?.currentReview?.decision === "dismissed",
          `reviewState=${reviewedCandidate?.reviewState} review=${summarizeReviewForLog(reviewedCandidate?.currentReview)}`
        );
      }
    }

    // ================= V0.3_001C-2: real API race / concurrency / isolation =================
    // Each scenario uses a dedicated fresh scratch athlete for isolated,
    // easy-to-reason-about starting state (never reusing userA/userB's
    // already-evolved review history from the block above).
    {
      // ---------- A. freshness linearization (semantics A) through the REAL API ----------
      const raceUser = await createScratchUserWithToken(admin, "001C-2 race-semantics-a");
      const raceDecisionId1 = await insertDecision(admin, raceUser.athleteId, "2026-07-01", { final_session: "STRENGTH_A" });
      await insertCompletedSession(admin, raceUser.athleteId, "2026-07-01", { decision_id: raceDecisionId1, session_type: "STRENGTH_A", completion_status: "done" });
      const raceSetupRefresh = await refreshPost(raceUser.token, {});
      record("001C-2. race setup: initial refresh -> 200", raceSetupRefresh.status === 200, `status=${raceSetupRefresh.status}`);

      const raceInsightsBefore = await insightsGet(raceUser.token);
      const raceCandidateAtComparison = (raceInsightsBefore.json?.candidates ?? []).find((c: any) => c.snapshot?.insightKind === "recommendation_execution_alignment");
      record(
        "001C-2. race setup: exactly one fresh unreviewed candidate found before submit",
        raceCandidateAtComparison !== undefined && raceCandidateAtComparison.reviewState === "unreviewed",
        summarizeCandidateForLog(raceCandidateAtComparison)
      );

      const raceToken = freshnessTokenFrom(raceCandidateAtComparison.snapshot, { decision: "accepted_as_insight", reviewerNote: null });

      const heldLock = await acquireReviewAdvisoryLockForTest({
        athleteId: raceUser.athleteId,
        detectorRuleId: RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID,
        detectorRuleVersion: "1.0.0",
        insightKind: "recommendation_execution_alignment",
      });

      // Fire the REAL submit-review request. It reaches candidate
      // reconstruction + the freshness comparison (both succeed — evidence
      // hasn't mutated yet) and then genuinely blocks inside
      // persist_pattern_insight_review, waiting for the identity advisory
      // lock this test already holds.
      const submitPromise = submitReviewPost(raceUser.token, raceToken);

      let waitObserved = false;
      let waitError = "";
      try {
        await heldLock.waitUntilAnotherSessionIsWaiting();
        waitObserved = true;
      } catch (e) {
        waitError = e instanceof Error ? e.message : String(e);
      }
      record("001C-2. real submit-review request objectively observed blocked on the identity advisory lock (pg_locks, not a sleep+assume)", waitObserved, waitError);

      // Mutate effective evidence for the SAME identity WHILE submit-review
      // is still blocked — a real second decision+completed_session,
      // committed via a genuinely separate refresh-longitudinal call.
      // Evidence writers lock on evidence_key, never insight_kind (see
      // docs/06_ARCHITECTURE.md's locked "Sélecteur de candidat et
      // cardinalité"), so this commits successfully even while the review
      // lock is held.
      const raceDecisionId2 = await insertDecision(admin, raceUser.athleteId, "2026-07-05", { final_session: "STRENGTH_A" });
      await insertCompletedSession(admin, raceUser.athleteId, "2026-07-05", { decision_id: raceDecisionId2, session_type: "STRENGTH_A", completion_status: "done" });
      const raceMutationRefresh = await refreshPost(raceUser.token, {});
      record("001C-2. evidence mutation committed WHILE submit-review is still blocked on the review lock", raceMutationRefresh.status === 200, `status=${raceMutationRefresh.status}`);

      await heldLock.release();

      const submitResult = await submitPromise;
      record(
        "001C-2. blocked submit-review completes successfully once the lock is released -> 200, action=inserted, NO retroactive stale_candidate",
        submitResult.status === 200 && submitResult.json?.review?.action === "inserted" && submitResult.json?.review?.reviewNumber === 1,
        `status=${submitResult.status} body=${submitResult.text.slice(0, 200)}`
      );

      const raceInsightsAfter = await insightsGet(raceUser.token);
      const raceCandidateAfter = (raceInsightsAfter.json?.candidates ?? []).find((c: any) => c.snapshot?.insightKind === "recommendation_execution_alignment");
      record(
        "001C-2. post-comparison evidence mutation is real: get-insights now reconstructs a DIFFERENT candidate (C2)",
        raceCandidateAfter?.snapshot?.evidenceCount === 2 && raceCandidateAtComparison?.snapshot?.evidenceCount === 1,
        `evidenceCountBefore=${raceCandidateAtComparison?.snapshot?.evidenceCount} evidenceCountAfter=${raceCandidateAfter?.snapshot?.evidenceCount}`
      );
      record(
        "001C-2. semantics A through the REAL API: the review persisted for C1 now projects reviewed_stale; historical review unchanged, decision still accepted_as_insight",
        raceCandidateAfter?.reviewState === "reviewed_stale" && raceCandidateAfter?.currentReview?.decision === "accepted_as_insight",
        `reviewState=${raceCandidateAfter?.reviewState} review=${summarizeReviewForLog(raceCandidateAfter?.currentReview)}`
      );

      // ---------- server-snapshot DB proof ----------
      {
        const { data: storedReview } = await admin
          .from("pattern_insight_review_current")
          .select("candidate_snapshot")
          .eq("athlete_id", raceUser.athleteId)
          .eq("detector_rule_id", RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID)
          .maybeSingle();
        const snapshotMatchesExpected = canonicalJson(storedReview?.candidate_snapshot) === canonicalJson(raceCandidateAtComparison.snapshot);
        record("001C-2. DB-stored candidate_snapshot deep-equals the SERVER candidate reviewed (C1), never the browser body or C2", snapshotMatchesExpected, `snapshot_matches_expected=${snapshotMatchesExpected}`);
      }

      // ---------- append-only integrity (single-review case) ----------
      {
        const { data: historyRows } = await admin
          .from("pattern_insight_review_history")
          .select("review_number, supersedes_id")
          .eq("athlete_id", raceUser.athleteId)
          .eq("detector_rule_id", RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID);
        const rows = historyRows ?? [];
        record(
          "001C-2. append-only: exactly one history row, review_number=1, supersedes_id NULL",
          rows.length === 1 && rows[0]?.review_number === 1 && rows[0]?.supersedes_id === null,
          `rowCount=${rows.length}`
        );
      }
    }

    {
      // ---------- B. concurrent IDENTICAL first submissions ----------
      const identUser = await createScratchUserWithToken(admin, "001C-2 concurrent-identical");
      const identDecisionId = await insertDecision(admin, identUser.athleteId, "2026-07-10", { final_session: "STRENGTH_A" });
      await insertCompletedSession(admin, identUser.athleteId, "2026-07-10", { decision_id: identDecisionId, session_type: "STRENGTH_A", completion_status: "done" });
      await refreshPost(identUser.token, {});

      const identInsights = await insightsGet(identUser.token);
      const identCandidate = (identInsights.json?.candidates ?? []).find((c: any) => c.snapshot?.insightKind === "recommendation_execution_alignment");
      const identToken = freshnessTokenFrom(identCandidate.snapshot, { decision: "accepted_as_insight", reviewerNote: null });

      const [respX, respY] = await Promise.all([submitReviewPost(identUser.token, identToken), submitReviewPost(identUser.token, identToken)]);

      const bothSucceeded = respX.status === 200 && respY.status === 200;
      const actions = [respX.json?.review?.action, respY.json?.review?.action].sort();
      const reviewNumbers = [respX.json?.review?.reviewNumber, respY.json?.review?.reviewNumber];
      record(
        "001C-2. two concurrent IDENTICAL real submissions -> both 200, exactly one inserted + one unchanged, same reviewNumber=1 (order-independent)",
        bothSucceeded && JSON.stringify(actions) === JSON.stringify(["inserted", "unchanged"]) && reviewNumbers[0] === 1 && reviewNumbers[1] === 1,
        `actions=${JSON.stringify(actions)} reviewNumbers=${JSON.stringify(reviewNumbers)}`
      );

      // pattern_insight_reviews (the raw table) has no athlete_id/detector_rule_id
      // columns of its own (only via its parent identity row) — query the
      // read view, which already joins them in, instead.
      const identReviewRowCount = await admin
        .from("pattern_insight_review_history")
        .select("review_id", { count: "exact", head: true })
        .eq("athlete_id", identUser.athleteId)
        .eq("detector_rule_id", RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID);
      record("001C-2. DB has exactly ONE review row for this identity after the identical race (no duplicate insert)", identReviewRowCount.count === 1, `count=${identReviewRowCount.count}`);

      const identCurrentCount = await admin
        .from("pattern_insight_review_current")
        .select("athlete_id", { count: "exact", head: true })
        .eq("athlete_id", identUser.athleteId)
        .eq("detector_rule_id", RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID);
      record("001C-2. pattern_insight_review_current has exactly ONE current row for this identity", identCurrentCount.count === 1, `count=${identCurrentCount.count}`);
    }

    {
      // ---------- C. concurrent DIFFERING first submissions ----------
      const diffUser = await createScratchUserWithToken(admin, "001C-2 concurrent-differing");
      const diffDecisionId = await insertDecision(admin, diffUser.athleteId, "2026-07-15", { final_session: "STRENGTH_A" });
      await insertCompletedSession(admin, diffUser.athleteId, "2026-07-15", { decision_id: diffDecisionId, session_type: "STRENGTH_A", completion_status: "done" });
      await refreshPost(diffUser.token, {});

      const diffInsights = await insightsGet(diffUser.token);
      const diffCandidate = (diffInsights.json?.candidates ?? []).find((c: any) => c.snapshot?.insightKind === "recommendation_execution_alignment");
      const diffTokenA = freshnessTokenFrom(diffCandidate.snapshot, { decision: "accepted_as_insight", reviewerNote: null });
      const diffTokenB = freshnessTokenFrom(diffCandidate.snapshot, { decision: "dismissed", reviewerNote: "second reviewer's note" });

      const submissions = [
        { decision: (diffTokenA as any).decision as string, request: submitReviewPost(diffUser.token, diffTokenA) },
        { decision: (diffTokenB as any).decision as string, request: submitReviewPost(diffUser.token, diffTokenB) },
      ];
      const responses = await Promise.all(submissions.map((s) => s.request));
      const paired = responses.map((response, i) => ({ response, decision: submissions[i]!.decision }));

      const bothSucceeded = paired.every((p) => p.response.status === 200);
      const actions = paired.map((p) => p.response.json?.review?.action).sort();
      record(
        "001C-2. two concurrent DIFFERING real submissions -> both 200, exactly one inserted + one superseded",
        bothSucceeded && JSON.stringify(actions) === JSON.stringify(["inserted", "superseded"]),
        `actions=${JSON.stringify(actions)}`
      );

      const supersededPair = paired.find((p) => p.response.json?.review?.action === "superseded");
      const insertedPair = paired.find((p) => p.response.json?.review?.action === "inserted");
      record(
        "001C-2. inserted response has reviewNumber=1, superseded response has reviewNumber=2 (winner derived by reported action, never by Promise order)",
        insertedPair?.response.json?.review?.reviewNumber === 1 && supersededPair?.response.json?.review?.reviewNumber === 2,
        `inserted=${insertedPair?.response.json?.review?.reviewNumber} superseded=${supersededPair?.response.json?.review?.reviewNumber}`
      );

      const { data: historyRows } = await admin
        .from("pattern_insight_review_history")
        .select("review_id, review_number, supersedes_id")
        .eq("athlete_id", diffUser.athleteId)
        .eq("detector_rule_id", RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID)
        .order("review_number", { ascending: true });
      const rows = historyRows ?? [];
      record("001C-2. DB has exactly 2 review rows, review_number set = {1,2}", rows.length === 2 && rows[0]?.review_number === 1 && rows[1]?.review_number === 2, `rowCount=${rows.length}`);
      record(
        "001C-2. append-only chain intact: review #2 supersedes review #1, review #1 supersedes nothing (no lost update)",
        rows.length === 2 && rows[1]?.supersedes_id === rows[0]?.review_id && rows[0]?.supersedes_id === null,
        ""
      );

      const { data: currentRow } = await admin
        .from("pattern_insight_review_current")
        .select("decision")
        .eq("athlete_id", diffUser.athleteId)
        .eq("detector_rule_id", RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID)
        .maybeSingle();
      record(
        "001C-2. exactly one current head, decision matches whichever request reported superseded",
        currentRow?.decision === supersededPair?.decision,
        `current_decision=${currentRow?.decision}`
      );
    }

    {
      // ---------- D. cross-athlete submit isolation via real token reuse ----------
      const isoOwner = await createScratchUserWithToken(admin, "001C-2 isolation-owner");
      const isoDecisionId = await insertDecision(admin, isoOwner.athleteId, "2026-07-20", { final_session: "STRENGTH_A" });
      await insertCompletedSession(admin, isoOwner.athleteId, "2026-07-20", { decision_id: isoDecisionId, session_type: "STRENGTH_A", completion_status: "done" });
      await refreshPost(isoOwner.token, {});
      const isoInsights = await insightsGet(isoOwner.token);
      const isoCandidate = (isoInsights.json?.candidates ?? []).find((c: any) => c.snapshot?.insightKind === "recommendation_execution_alignment");
      const isoOwnerToken = freshnessTokenFrom(isoCandidate.snapshot, { decision: "accepted_as_insight", reviewerNote: null });

      const isoOther = await createScratchUserWithToken(admin, "001C-2 isolation-other"); // zero evidence of its own

      const reviewCountBeforeIso = await admin.from("pattern_insight_reviews").select("id", { count: "exact", head: true });

      // isoOther's authenticated request, carrying isoOwner's REAL freshness
      // token (real evidence identity/revision UUIDs included). athleteId is
      // still resolved server-side from isoOther's own JWT — never
      // influenced by the token's content.
      const crossResult = await submitReviewPost(isoOther.token, isoOwnerToken);
      record(
        "001C-2. cross-athlete token reuse never succeeds as a write attributed to the token's original owner -> candidate_not_found (isoOther has zero evidence for this detector)",
        crossResult.status === 404 && crossResult.json?.error?.code === "candidate_not_found",
        `status=${crossResult.status} code=${crossResult.json?.error?.code}`
      );

      const reviewCountAfterIso = await admin.from("pattern_insight_reviews").select("id", { count: "exact", head: true });
      record("001C-2. cross-athlete submit attempt writes zero review rows anywhere", reviewCountBeforeIso.count === reviewCountAfterIso.count, `before=${reviewCountBeforeIso.count} after=${reviewCountAfterIso.count}`);

      const ownerReviewCount = await admin.from("pattern_insight_review_history").select("review_id", { count: "exact", head: true }).eq("athlete_id", isoOwner.athleteId);
      record("001C-2. the token's original owner still has zero reviews of their own (never silently created)", ownerReviewCount.count === 0, `count=${ownerReviewCount.count}`);
    }

    // ================= sensitive-response check =================
    {
      const serverKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
      const forbidden = [serverKey, userA.token, userB.token, "Authorization"].filter(Boolean);
      const bodies = [firstRun.text, insightsA.text, submitReviewSuccess.text, submitReviewStale.text];
      const leaked = bodies.some((body) => forbidden.some((s) => body.includes(s)));
      record("responses never leak the JWT or service key", !leaked, "");
    }
    {
      // submit-review's success response never carries identityId/reviewId
      // (server-internal review-ledger row ids — the exact success shape is
      // already pinned above as {action, reviewNumber} only). The stale
      // response legitimately embeds a fresh PatternInsightCandidate,
      // including its own sourceEvidenceRefs[].identityId (per-evidence
      // provenance — the SAME locked shape get-insights already returns,
      // never a leak), so a blind substring search for "identityId" would
      // false-positive on that expected field. Structural proof instead:
      // the stale response's top-level keys are exactly {error, candidate},
      // and `candidate` itself has exactly {snapshot, reviewState,
      // currentReview} — the locked PatternInsightCandidate shape, nothing
      // extra (no ledger row id ever attached to the candidate object).
      const staleTopKeys = Object.keys(submitReviewStale.json ?? {}).sort();
      const staleCandidateKeys = Object.keys(submitReviewStale.json?.candidate ?? {}).sort();
      record(
        "submit-review. stale response shape is exactly {error, candidate}, candidate is exactly {snapshot, reviewState, currentReview}",
        JSON.stringify(staleTopKeys) === JSON.stringify(["candidate", "error"]) && JSON.stringify(staleCandidateKeys) === JSON.stringify(["currentReview", "reviewState", "snapshot"]),
        `topKeys=${JSON.stringify(staleTopKeys)} candidateKeys=${JSON.stringify(staleCandidateKeys)}`
      );
    }
    {
      // Deterministic proof that internal-error text is sanitized before it
      // ever reaches the browser lives at the unit level
      // (tests/edge/refreshLongitudinal/responseShaping.test.ts and
      // tests/edge/getInsights/errorMapping.test.ts), exercising the EXACT
      // production transport-builder/error-mapper functions against
      // synthetic sentinel-carrying errors — not a placeholder here, and
      // not a production debug backdoor forcing a real 500 over HTTP.
    }
  } finally {
    if (noAthleteUserId) {
      await cleanupBareUser(admin, noAthleteUserId, "no-athlete");
    }
    stopFunctionsServer(server);
  }

  if (cleanupErrors.length > 0) {
    console.log(`\nCLEANUP FAILURES (${cleanupErrors.length}):`);
    for (const issue of cleanupErrors) console.log(`  - ${issue.what}: ${issue.message}`);
  }
  record("cleanup: bare no-athlete user + edge-runtime container removed", cleanupErrors.length === 0, cleanupErrors.length > 0 ? `${cleanupErrors.length} issue(s) — see log above` : undefined);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} scenarios passed.`);
  if (failed.length > 0) {
    console.log("FAILURES:", failed.map((f) => f.name));
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error("HARNESS ERROR:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => {
    process.exit(process.exitCode ?? 0);
  });
