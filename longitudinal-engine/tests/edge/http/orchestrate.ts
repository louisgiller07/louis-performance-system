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
      record("refresh. real pattern_evidence row persisted for A's decision", !error && evidenceRow?.event_type === "supporting" && evidenceRow?.athlete_id === userA.athleteId, JSON.stringify(evidenceRow));
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
      record("insights. real read -> 200, static domain-wide range", ok, `status=${insightsA.status} body=${insightsA.text.slice(0, 300)}`);
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
      record("insights. recommendation_execution_alignment candidate present, correctly shaped, unreviewed", ok, JSON.stringify(recCandidate));
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
        const res = await fetch(`${INSIGHTS_URL}${qs}`, { method: "GET", headers: { Authorization: `Bearer ${userA.token}` } });
        const body = await res.text();
        let json: any = null;
        try {
          json = JSON.parse(body);
        } catch {
          /* not JSON */
        }
        record(`insights. ${label} -> 400 invalid_request`, res.status === 400 && json?.error?.code === "invalid_request", `status=${res.status} qs=${qs}`);
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
        record("submit-review. stale token (evidence mutated after load) -> 409 stale_candidate, fresh candidate returned", ok, `status=${submitReviewStale.status} body=${submitReviewStale.text.slice(0, 400)}`);
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
          JSON.stringify(reviewRow)
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
          JSON.stringify(reviewedCandidate?.currentReview)
        );
      }
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
