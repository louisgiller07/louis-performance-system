/**
 * M3 versioned HTTP integration test for `supabase/functions/daily-run`.
 * The durable replacement for the scratch harnesses used during
 * M3_002/M3_003 development — run via `npm run test:m3:http`.
 *
 * Requires the local Supabase stack already running (`supabase start`) and,
 * in the environment (never hardcoded here):
 *   - SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY
 *   - SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEY
 * Get both via `npx supabase status -o env`.
 *
 * This script builds nothing itself (the `test:m3:http` npm script runs
 * `npm run build` first) — it starts `supabase functions serve`, waits for
 * it to accept connections, runs every scenario against the real Edge
 * Runtime with real scratch users/athletes/fixtures, always tears down the
 * fixtures and the server process (even on failure), and exits non-zero if
 * any assertion failed. Never logs a JWT or service key.
 */
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  createTestAthlete,
  createTestClient,
  deleteTestAthlete,
  insertCheckin,
  insertTrainingBlock,
  type TestAthlete,
} from "../../supabase/testDb.js";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, "$1");
const LOCAL_URL = "http://127.0.0.1:54321";
const SUPABASE_URL = process.env.SUPABASE_URL ?? LOCAL_URL;
const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1/daily-run`;

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

// Cleanup never stops at the first failure — every fixture gets its own
// attempt regardless of whether an earlier one failed, and every failure is
// recorded here (never swallowed) so the run fails loudly instead of
// silently leaving scratch data behind. Messages come only from Supabase
// SDK error objects / docker CLI output — never a JWT or key.
interface CleanupIssue {
  what: string;
  message: string;
}
const cleanupErrors: CleanupIssue[] = [];

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  const ka = Object.keys(a as object).sort();
  const kb = Object.keys(b as object).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every((k) => deepEqual((a as never)[k], (b as never)[k]));
}

// --- HTTP helpers ------------------------------------------------------------

interface PostResult {
  status: number;
  json: Record<string, any> | null;
  text: string;
}

async function rawPost(headers: Record<string, string>, bodyText?: string): Promise<PostResult> {
  const res = await fetch(FUNCTIONS_URL, { method: "POST", headers, body: bodyText });
  const text = await res.text();
  let json: Record<string, any> | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, text };
}

function post(token: string, body: unknown): Promise<PostResult> {
  return rawPost({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, JSON.stringify(body));
}

/** Runs a POST and records a single status+code assertion — the common case. */
async function expectPost(
  name: string,
  token: string,
  body: unknown,
  expectedStatus: number,
  expectedCode?: string
): Promise<PostResult> {
  const r = await post(token, body);
  const codeOk = expectedCode === undefined || r.json?.error?.code === expectedCode;
  record(name, r.status === expectedStatus && codeOk, `status=${r.status} body=${r.text.slice(0, 220)}`);
  return r;
}

// --- server lifecycle --------------------------------------------------------

function startFunctionsServer(): ChildProcess {
  // Command passed as a single string (no separate `args`) — avoids Node's
  // shell-arg-escaping deprecation warning; there is no user input here.
  const child = spawn("npx supabase functions serve", [], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "ignore", "ignore"], // drained silently — the CLI never prints secrets, but keep output out of test logs
    shell: true, // npx/supabase are shell shims on Windows
  });
  return child;
}

async function waitForFunctionsReady(timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  let consecutiveOk = 0;
  let lastStatus: number | null = null;
  // Require 3 consecutive non-gateway-error responses, not just one — a
  // freshly-recreated container can answer one probe cleanly and then
  // still 503 the very next real request while workers finish warming up
  // (proven flaky in practice with a single-probe check).
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(FUNCTIONS_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      lastStatus = res.status;
      if (![502, 503, 504].includes(res.status)) {
        consecutiveOk += 1;
        if (consecutiveOk >= 3) return;
      } else {
        consecutiveOk = 0;
      }
    } catch {
      consecutiveOk = 0; // connection refused — not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`daily-run function did not become ready within ${timeoutMs}ms (last status: ${lastStatus})`);
}

function stopFunctionsServer(child: ChildProcess): void {
  if (child.pid != null && child.exitCode === null) {
    if (process.platform === "win32") {
      try {
        execSync(`taskkill /T /PID ${child.pid}`, { stdio: "ignore" });
      } catch {
        /* already dead, or the shim process rejected a graceful signal */
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

  // The CLI manages the Edge Runtime as a separate long-lived Docker
  // container, decoupled from the CLI process's own lifecycle — killing
  // the CLI process tree does not reliably stop it (proven empirically: a
  // forceful taskkill left the container running). Stop it explicitly by
  // name instead of relying on signal propagation through a shell-spawned
  // process tree. Scoped to this project's own container name only.
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
    /* docker unavailable for the verification step — not treated as a leftover */
  }
}

// --- fixtures ----------------------------------------------------------------

async function createScratchUserWithToken(admin: SupabaseClient, label: string): Promise<TestAthlete & { token: string }> {
  const athlete = await createTestAthlete(admin, `M3 HTTP scratch — ${label}`);
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

/** Deletes an athlete+user fixture, then independently verifies both rows are actually gone — never trusts a silent success. */
async function cleanupAthlete(admin: SupabaseClient, athlete: TestAthlete, label: string): Promise<void> {
  try {
    await deleteTestAthlete(admin, athlete);
  } catch (e) {
    cleanupErrors.push({ what: `athlete(${label}) delete call`, message: e instanceof Error ? e.message : String(e) });
  }
  try {
    const { data: athleteRow } = await admin.from("athletes").select("id").eq("id", athlete.athleteId).maybeSingle();
    if (athleteRow) cleanupErrors.push({ what: `athlete(${label})`, message: "athletes row still present after cleanup" });
    const { data: userCheck } = await admin.auth.admin.getUserById(athlete.userId);
    if (userCheck?.user) cleanupErrors.push({ what: `user(${label})`, message: "auth user still present after cleanup" });
  } catch (e) {
    cleanupErrors.push({ what: `athlete(${label}) verification`, message: e instanceof Error ? e.message : String(e) });
  }
}

/** Deletes a bare auth user (no athlete row), then independently verifies it is actually gone. */
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

const WRITE_AUDIT_TABLES = [
  "decisions",
  "health_flags",
  "completed_sessions",
  "planned_sessions",
  "daily_checkins",
  "training_blocks",
  "athletes",
] as const;

// A named union of literal keys (not `string`) gives every property of
// Record<AuditTable, number> a known type — unlike Record<string, number>,
// which is an index signature and forces every access to `number |
// undefined` under noUncheckedIndexedAccess. countsFor is only ever called
// with the full WRITE_AUDIT_TABLES list, so every key is genuinely always
// present; the single assertion at the return makes that real invariant
// explicit instead of scattering `?? 0` fallbacks at each read site, which
// would silently hide a real bug (e.g. a table dropped from the list).
type AuditTable = (typeof WRITE_AUDIT_TABLES)[number];

async function countsFor(admin: SupabaseClient, tables: readonly AuditTable[]): Promise<Record<AuditTable, number>> {
  const counts: Partial<Record<AuditTable, number>> = {};
  for (const t of tables) {
    const { count, error } = await admin.from(t).select("*", { count: "exact", head: true });
    if (error) throw new Error(`count(${t}) failed: ${error.message}`);
    counts[t] = count ?? 0;
  }
  return counts as Record<AuditTable, number>;
}

// --- main ----------------------------------------------------------------

async function main(): Promise<void> {
  const admin = createTestClient();

  // Precondition: the local Supabase DB/API must already be up. We only
  // start `functions serve` ourselves, never the whole stack.
  try {
    await admin.auth.admin.listUsers({ perPage: 1 });
  } catch (e) {
    throw new Error(`Local Supabase stack unreachable at ${SUPABASE_URL} — run \`supabase start\` first. (${(e as Error).message})`);
  }

  const createdAthletes: { athlete: TestAthlete; label: string }[] = [];
  // Tracked the instant the user exists — independent of createdAthletes,
  // so cleanup does not depend on reaching any particular later line.
  let noAthleteUserId: string | undefined;
  const server = startFunctionsServer();
  try {
    await waitForFunctionsReady();

    // ---------- seed ----------
    const userA = await createScratchUserWithToken(admin, "a");
    createdAthletes.push({ athlete: userA, label: "a" });
    await insertTrainingBlock(admin, userA.athleteId, "IN_SEASON");
    await insertCheckin(admin, userA.athleteId, "2026-08-17"); // neutral
    await insertCheckin(admin, userA.athleteId, "2026-08-18", { suspected_concussion: true }); // A1

    const userB = await createScratchUserWithToken(admin, "b");
    createdAthletes.push({ athlete: userB, label: "b" });
    await insertTrainingBlock(admin, userB.athleteId, "IN_SEASON");
    await insertCheckin(admin, userB.athleteId, "2026-08-20"); // only exists for B

    const userD = await createScratchUserWithToken(admin, "d"); // no training block
    createdAthletes.push({ athlete: userD, label: "d" });
    await insertCheckin(admin, userD.athleteId, "2026-08-17");

    const userE = await createScratchUserWithToken(admin, "e"); // incomplete checkins
    createdAthletes.push({ athlete: userE, label: "e" });
    await insertTrainingBlock(admin, userE.athleteId, "IN_SEASON");
    await insertCheckin(admin, userE.athleteId, "2026-08-17", { pain_traumatic: null }); // -> pain_criteria_missing
    await insertCheckin(admin, userE.athleteId, "2026-08-18", { sleep_hours: null }); // -> checkin_incomplete

    // user with NO athlete at all — for the 403 scenario. Created via the
    // raw admin API (createTestAthlete always creates an athlete row too).
    const { data: noAthleteUser, error: noAthleteErr } = await admin.auth.admin.createUser({
      email: `m3-http-noathlete-${randomUUID()}@example.invalid`,
      email_confirm: true,
      password: "NoAthleteScratch1!",
    });
    if (noAthleteErr || !noAthleteUser.user) throw new Error(`createUser(no-athlete) failed: ${noAthleteErr?.message}`);
    noAthleteUserId = noAthleteUser.user.id; // tracked now, regardless of what happens next
    const anonForNoAthlete = createClient(SUPABASE_URL, ANON_KEY as string, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: noAthleteSignIn, error: noAthleteSignInErr } = await anonForNoAthlete.auth.signInWithPassword({
      email: noAthleteUser.user.email!,
      password: "NoAthleteScratch1!",
    });
    if (noAthleteSignInErr || !noAthleteSignIn.session) throw new Error(`sign-in(no-athlete) failed: ${noAthleteSignInErr?.message}`);
    const noAthleteToken = noAthleteSignIn.session.access_token;

    const before = await countsFor(admin, WRITE_AUDIT_TABLES);

    // ================= M3_002 auth boundary (merged in) =================
    {
      const r = await rawPost({ "Content-Type": "application/json" }, JSON.stringify({ date: "2026-08-17" }));
      record("auth. no Authorization header -> 401", r.status === 401, `status=${r.status}`);
    }
    {
      const r = await rawPost(
        { Authorization: "Bearer not.a.valid.jwt", "Content-Type": "application/json" },
        JSON.stringify({ date: "2026-08-17" })
      );
      record("auth. invalid JWT -> 401", r.status === 401, `status=${r.status}`);
    }
    await expectPost("auth. no athlete for user -> 403 no_athlete_for_user", noAthleteToken, { date: "2026-08-17" }, 403, "no_athlete_for_user");
    {
      const res = await fetch(FUNCTIONS_URL, { method: "GET", headers: { Authorization: `Bearer ${userA.token}` } });
      const allow = res.headers.get("allow");
      record("auth. GET with valid auth -> 405 + Allow: POST", res.status === 405 && allow === "POST", `status=${res.status} allow=${allow}`);
    }
    await expectPost("auth. unknown field -> 400 invalid_request", userA.token, { date: "2026-08-17", whatever: true }, 400, "invalid_request");
    await expectPost("auth. invalid date (2026-02-30) -> 400 invalid_request", userA.token, { date: "2026-02-30" }, 400, "invalid_request");

    // ================= 1-4. Neutral success =================
    let decisionIdA: string | undefined;
    {
      const r = await post(userA.token, { date: "2026-08-17" });
      const ok =
        r.status === 200 &&
        typeof r.json?.dailyPlan === "object" &&
        typeof r.json?.decisionId === "string" &&
        r.json?.healthFlagId === null &&
        Array.isArray(r.json?.warnings);
      record("1. neutral success -> 200 real DailyPlan", ok, `status=${r.status} body=${r.text.slice(0, 260)}`);
      decisionIdA = r.json?.decisionId;

      if (decisionIdA) {
        record("2. response decisionId is a real UUID", /^[0-9a-f-]{36}$/i.test(decisionIdA), decisionIdA);

        const { data: row, error } = await admin
          .from("decisions")
          .select("athlete_id, daily_plan, confidence, confidence_level")
          .eq("id", decisionIdA)
          .single();
        if (error) throw error;
        record("3. DB decision.daily_plan == HTTP dailyPlan", deepEqual(row.daily_plan, r.json!.dailyPlan), "");
        record("4. legacy decisions.confidence stays NULL, confidence_level set", row.confidence === null && typeof row.confidence_level === "string", `confidence_level=${row.confidence_level}`);
      }
    }

    // ================= 5-7. SAFETY A1 + repeated call + flag reuse =================
    let flagId1: string | null | undefined;
    let decisionIdB1: string | undefined;
    {
      const r1 = await post(userA.token, { date: "2026-08-18" });
      decisionIdB1 = r1.json?.decisionId;
      flagId1 = r1.json?.healthFlagId;
      record("5. SAFETY A1 -> 200, healthFlagId real", r1.status === 200 && typeof flagId1 === "string", `status=${r1.status}`);

      if (flagId1) {
        const { data: flagRow, error } = await admin.from("health_flags").select("id, athlete_id, status").eq("id", flagId1).single();
        if (error) throw error;
        record("5. health_flags row open, belongs to athlete A", flagRow.athlete_id === userA.athleteId && ["active", "monitoring"].includes(flagRow.status), JSON.stringify(flagRow));
      }

      const r2 = await post(userA.token, { date: "2026-08-18" });
      record("6. repeated call -> 200, decisionId #2 != #1", r2.status === 200 && r2.json?.decisionId !== decisionIdB1, `id1=${decisionIdB1} id2=${r2.json?.decisionId}`);
      record("7. same open health flag reused across calls", r2.json?.healthFlagId === flagId1, `flag1=${flagId1} flag2=${r2.json?.healthFlagId}`);

      const { data: openFlags, error: flagsErr } = await admin.from("health_flags").select("id").eq("athlete_id", userA.athleteId).in("status", ["active", "monitoring"]);
      if (flagsErr) throw flagsErr;
      record("7. exactly one open health_flags row for athlete A", openFlags.length === 1, `open=${openFlags.length}`);
    }

    // ================= 8-11. Error mapping over real fixtures =================
    await expectPost("8. missing checkin -> 422 no_checkin_for_date", userA.token, { date: "2026-08-19" }, 422, "no_checkin_for_date");
    await expectPost("9. no current training block -> 422 no_current_training_block", userD.token, { date: "2026-08-17" }, 422, "no_current_training_block");
    await expectPost("10. pain criteria missing -> 422 pain_criteria_missing", userE.token, { date: "2026-08-17" }, 422, "pain_criteria_missing");
    await expectPost("11. incomplete checkin -> 422 checkin_incomplete", userE.token, { date: "2026-08-18" }, 422, "checkin_incomplete");

    // ================= 12. Cross-user isolation =================
    {
      await expectPost("12. JWT A on B-only date -> 422 (never consumes B's data)", userA.token, { date: "2026-08-20" }, 422, "no_checkin_for_date");
      const { count: decisionsForB } = await admin.from("decisions").select("*", { count: "exact", head: true }).eq("athlete_id", userB.athleteId);
      const { count: flagsForB } = await admin.from("health_flags").select("*", { count: "exact", head: true }).eq("athlete_id", userB.athleteId);
      record("12. zero decisions/health_flags for athlete B", (decisionsForB ?? 0) === 0 && (flagsForB ?? 0) === 0, `decisions=${decisionsForB} flags=${flagsForB}`);
    }

    // ================= 13. Injection =================
    await expectPost("13. athlete_id injection -> 400 invalid_request", userA.token, { date: "2026-08-17", athlete_id: userB.athleteId }, 400, "invalid_request");

    // ================= 14. Sensitive response =================
    {
      const r = await post(userA.token, { date: "2026-08-17" });
      const serverKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
      const forbidden = ["rawContext", "athleteId", "userId", "Authorization", userA.token, serverKey].filter(Boolean);
      const leaked = forbidden.filter((s) => r.text.includes(s));
      record("14. success response has no sensitive fields", r.status === 200 && leaked.length === 0, `leaked_count=${leaked.length}`);
    }

    // ================= 15. Allowed-write audit =================
    {
      const after = await countsFor(admin, WRITE_AUDIT_TABLES);
      const untouched: readonly AuditTable[] = ["athletes", "daily_checkins", "training_blocks", "completed_sessions", "planned_sessions"];
      record("15. non-decision/health_flag tables untouched", untouched.every((t) => before[t] === after[t]), JSON.stringify({ before, after }));
      record("15. decisions increased, health_flags increased by exactly 1", after.decisions > before.decisions && after.health_flags === before.health_flags + 1, `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
    }
  } finally {
    // Every fixture gets its own cleanup attempt, unconditionally — one
    // failure never skips the rest, and every failure is recorded (see
    // cleanupAthlete/cleanupBareUser), never swallowed.
    for (const { athlete, label } of createdAthletes) {
      await cleanupAthlete(admin, athlete, label);
    }
    if (noAthleteUserId) {
      await cleanupBareUser(admin, noAthleteUserId, "no-athlete");
    }
    stopFunctionsServer(server);
  }

  if (cleanupErrors.length > 0) {
    console.log(`\nCLEANUP FAILURES (${cleanupErrors.length}):`);
    for (const issue of cleanupErrors) console.log(`  - ${issue.what}: ${issue.message}`);
  }
  record("cleanup: all scratch fixtures + edge-runtime container removed", cleanupErrors.length === 0, cleanupErrors.length > 0 ? `${cleanupErrors.length} issue(s) — see log above` : undefined);

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
    // The Supabase admin client keeps an open handle (realtime/fetch) that
    // otherwise leaves the process hanging after cleanup is already done —
    // force the exit explicitly rather than let it dangle.
    process.exit(process.exitCode ?? 0);
  });
