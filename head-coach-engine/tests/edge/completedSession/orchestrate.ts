/**
 * M5_003 versioned HTTP integration test for
 * `supabase/functions/completed-session`. Modeled closely on
 * tests/edge/http/orchestrate.ts (daily-run's own harness) — deliberately
 * NOT sharing its server-lifecycle code (see docs/11_DECISION_LOG.md,
 * M5_003: avoids any risk of touching daily-run's frozen, already-passing
 * 26/26 suite for the sake of a small amount of shared plumbing).
 *
 * Requires the local Supabase stack already running (`supabase start`) and,
 * in the environment (never hardcoded here):
 *   - SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY
 *   - SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEY
 * Get both via `npx supabase status -o env`. Run via
 * `npm run test:m5:completed-session:http` — no build step needed
 * (completed-session imports no head-coach-engine dist output).
 */
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, deleteTestAthlete, insertDecision, type TestAthlete } from "../../supabase/testDb.js";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, "$1");
const LOCAL_URL = "http://127.0.0.1:54321";
const SUPABASE_URL = process.env.SUPABASE_URL ?? LOCAL_URL;
const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1/completed-session`;

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

// --- result tracking ---------------------------------------------------------

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

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  const ka = Object.keys(a as object).sort();
  const kb = Object.keys(b as object).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every((k) => deepEqual((a as never)[k], (b as never)[k]));
}

interface HttpResult {
  status: number;
  json: Record<string, any> | null;
  text: string;
  headers: Headers;
}

async function raw(method: string, headers: Record<string, string>, url: string, bodyText?: string): Promise<HttpResult> {
  const res = await fetch(url, { method, headers, body: bodyText });
  const text = await res.text();
  let json: Record<string, any> | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, text, headers: res.headers };
}

function put(token: string, body: unknown): Promise<HttpResult> {
  return raw("PUT", { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, FUNCTIONS_URL, JSON.stringify(body));
}
function get(token: string, date: string): Promise<HttpResult> {
  return raw("GET", { Authorization: `Bearer ${token}` }, `${FUNCTIONS_URL}?date=${date}`);
}

async function expectPut(name: string, token: string, body: unknown, expectedStatus: number, expectedCode?: string): Promise<HttpResult> {
  const r = await put(token, body);
  const codeOk = expectedCode === undefined || r.json?.error?.code === expectedCode;
  record(name, r.status === expectedStatus && codeOk, `status=${r.status} body=${r.text.slice(0, 260)}`);
  return r;
}

// --- server lifecycle ---------------------------------------------------------

function startFunctionsServer(): ChildProcess {
  const child = spawn("npx supabase functions serve", [], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "ignore", "ignore"],
    shell: true,
  });
  return child;
}

async function waitForFunctionsReady(timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  let consecutiveOk = 0;
  let lastStatus: number | null = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${FUNCTIONS_URL}?date=2026-01-01`, { method: "GET" });
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
  throw new Error(`completed-session function did not become ready within ${timeoutMs}ms (last status: ${lastStatus})`);
}

const cleanupErrors: { what: string; message: string }[] = [];

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
    /* docker unavailable for the verification step — not treated as a leftover */
  }
}

// --- fixtures ------------------------------------------------------------------

async function createScratchUserWithToken(admin: SupabaseClient, label: string): Promise<TestAthlete & { token: string }> {
  const athlete = await createTestAthlete(admin, `M5_003 HTTP scratch — ${label}`);
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

async function cleanupBareUser(admin: SupabaseClient, userId: string, label: string): Promise<void> {
  try {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) cleanupErrors.push({ what: `user(${label}) delete call`, message: error.message });
  } catch (e) {
    cleanupErrors.push({ what: `user(${label}) delete call`, message: e instanceof Error ? e.message : String(e) });
  }
}

// --- request body builder -------------------------------------------------------

function doneBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session_date: "2026-08-12",
    decision_id: null,
    session_type: "RECOVERY",
    completion_status: "done",
    actual_duration_min: 42,
    rpe: 7,
    post_leg_fatigue: 4,
    post_grip_fatigue: 3,
    new_pain: false,
    new_pain_note: null,
    intervention: null,
    main_content: null,
    ...overrides,
  };
}

// --- main ------------------------------------------------------------------------

async function main(): Promise<void> {
  const admin = createTestClient();

  try {
    await admin.auth.admin.listUsers({ perPage: 1 });
  } catch (e) {
    throw new Error(`Local Supabase stack unreachable at ${SUPABASE_URL} — run \`supabase start\` first. (${(e as Error).message})`);
  }

  const createdAthletes: { athlete: TestAthlete; label: string }[] = [];
  let noAthleteUserId: string | undefined;
  const server = startFunctionsServer();
  try {
    await waitForFunctionsReady();

    // ---------- seed ----------
    const userA = await createScratchUserWithToken(admin, "a");
    createdAthletes.push({ athlete: userA, label: "a" });
    const userB = await createScratchUserWithToken(admin, "b");
    createdAthletes.push({ athlete: userB, label: "b" });

    const { data: noAthleteUser, error: noAthleteErr } = await admin.auth.admin.createUser({
      email: `m5-http-noathlete-${randomUUID()}@example.invalid`,
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

    // Decisions for decision-link scenarios.
    // final_session: "RECOVERY" matches doneBody()'s default session_type —
    // this decision is used for the "own/same-date accepted" happy path,
    // not the decision/session coherence matrix (see the dedicated
    // coherence scenarios below), so it must represent a plan actually
    // done as planned.
    const decisionA_0820 = await insertDecision(admin, userA.athleteId, "2026-08-20", { final_session: "RECOVERY" });
    const decisionB_0820 = await insertDecision(admin, userB.athleteId, "2026-08-20");

    // ================= auth / method / shape =================
    {
      const r = await raw("GET", {}, `${FUNCTIONS_URL}?date=2026-08-12`);
      record("auth. GET no Authorization header -> 401", r.status === 401, `status=${r.status}`);
    }
    {
      const r = await raw("PUT", { Authorization: "Bearer not.a.valid.jwt", "Content-Type": "application/json" }, FUNCTIONS_URL, "{}");
      record("auth. PUT invalid JWT -> 401", r.status === 401, `status=${r.status}`);
    }
    await expectPut("auth. no athlete for user -> 403 no_athlete_for_user", noAthleteToken, doneBody(), 403, "no_athlete_for_user");
    {
      const r = await raw("DELETE", { Authorization: `Bearer ${userA.token}` }, FUNCTIONS_URL);
      const allow = r.headers.get("allow");
      record("method. DELETE -> 405 + Allow: GET, PUT", r.status === 405 && allow === "GET, PUT", `status=${r.status} allow=${allow}`);
    }
    {
      const r = await raw("PUT", { Authorization: `Bearer ${userA.token}`, "Content-Type": "application/json" }, FUNCTIONS_URL, "{not valid json");
      record("body. malformed JSON -> 400 invalid_body", r.status === 400 && r.json?.error?.code === "invalid_body", `status=${r.status}`);
    }
    {
      const { session_date: _drop, ...incomplete } = doneBody();
      await expectPut("body. missing canonical field -> 400 invalid_body", userA.token, incomplete, 400, "invalid_body");
    }
    await expectPut("body. unknown field -> 400 unknown_field", userA.token, doneBody({ whatever: true }), 400, "unknown_field");
    await expectPut("body. forbidden athlete_id -> 400 forbidden_field", userA.token, doneBody({ athlete_id: userB.athleteId }), 400, "forbidden_field");
    await expectPut("body. forbidden session_load -> 400 forbidden_field", userA.token, doneBody({ session_load: 99 }), 400, "forbidden_field");
    await expectPut("body. invalid enum session_type -> 400 invalid_enum", userA.token, doneBody({ session_type: "YOGA" }), 400, "invalid_enum");
    await expectPut("body. invalid numeric range rpe=11 -> 400 invalid_range", userA.token, doneBody({ rpe: 11 }), 400, "invalid_range");
    await expectPut("body. invalid session_date -> 400 invalid_date_format", userA.token, doneBody({ session_date: "2026-02-30" }), 400, "invalid_date_format");

    // ================= status matrices (each on its own date; never collides) =================
    await expectPut("matrix. done -> 200", userA.token, doneBody({ session_date: "2026-08-13" }), 200);
    await expectPut(
      "matrix. partial -> 200",
      userA.token,
      doneBody({ session_date: "2026-08-14", completion_status: "partial" }),
      200
    );
    await expectPut(
      "matrix. skipped -> 200 (duration/rpe null)",
      userA.token,
      doneBody({ session_date: "2026-08-15", completion_status: "skipped", actual_duration_min: null, rpe: null }),
      200
    );
    await expectPut(
      "matrix. replaced -> 200",
      userA.token,
      doneBody({ session_date: "2026-08-16", completion_status: "replaced" }),
      200
    );
    await expectPut(
      "matrix. skipped rejects non-null actual_duration_min -> 400 invalid_body_for_status",
      userA.token,
      doneBody({ session_date: "2026-08-15", completion_status: "skipped", actual_duration_min: 10, rpe: null }),
      400,
      "invalid_body_for_status"
    );

    // ================= REST semantics (M5_003 final review) =================
    {
      const r = await expectPut(
        "REST. done + null duration/rpe -> 200",
        userA.token,
        doneBody({ session_date: "2026-09-01", session_type: "REST", completion_status: "done", actual_duration_min: null, rpe: null }),
        200
      );
      record(
        "REST. done persisted -> session_load null",
        r.json?.completedSession?.session_load === null,
        String(r.json?.completedSession?.session_load)
      );
    }
    await expectPut(
      "REST. done + non-null duration -> 400 invalid_body_for_status",
      userA.token,
      doneBody({ session_date: "2026-09-01", session_type: "REST", completion_status: "done", actual_duration_min: 20, rpe: null }),
      400,
      "invalid_body_for_status"
    );
    await expectPut(
      "REST. replaced + null duration/rpe -> 200",
      userA.token,
      doneBody({ session_date: "2026-09-02", session_type: "REST", completion_status: "replaced", actual_duration_min: null, rpe: null }),
      200
    );
    await expectPut(
      "REST. partial -> 400 invalid_body_for_status",
      userA.token,
      doneBody({ session_date: "2026-09-03", session_type: "REST", completion_status: "partial", actual_duration_min: null, rpe: null }),
      400,
      "invalid_body_for_status"
    );

    // ================= pain shape =================
    await expectPut(
      "pain. true + null note -> 400 invalid_pain_shape",
      userA.token,
      doneBody({ session_date: "2026-08-17", new_pain: true, new_pain_note: null }),
      400,
      "invalid_pain_shape"
    );
    await expectPut(
      "pain. true + empty note -> 400 invalid_pain_shape",
      userA.token,
      doneBody({ session_date: "2026-08-17", new_pain: true, new_pain_note: "" }),
      400,
      "invalid_pain_shape"
    );
    await expectPut(
      "pain. false + non-null note -> 400 invalid_pain_shape",
      userA.token,
      doneBody({ session_date: "2026-08-17", new_pain: false, new_pain_note: "should not be here" }),
      400,
      "invalid_pain_shape"
    );
    {
      const r = await expectPut(
        "pain. true + valid note -> 200, persisted verbatim",
        userA.token,
        doneBody({ session_date: "2026-08-17", new_pain: true, new_pain_note: "Genou douloureux" }),
        200
      );
      record("pain. note round-trips exactly", r.json?.completedSession?.new_pain_note === "Genou douloureux", r.json?.completedSession?.new_pain_note);
    }

    // ================= decision linkage =================
    await expectPut("decision. null accepted -> 200", userA.token, doneBody({ session_date: "2026-08-18", decision_id: null }), 200);
    {
      const r = await expectPut(
        "decision. own/same-date accepted -> 200",
        userA.token,
        doneBody({ session_date: "2026-08-20", decision_id: decisionA_0820 }),
        200
      );
      record("decision. linked decision_id round-trips", r.json?.completedSession?.decision_id === decisionA_0820, r.json?.completedSession?.decision_id);
    }
    await expectPut(
      "decision. foreign athlete's decision -> 422 decision_link_invalid (no RPC call)",
      userA.token,
      doneBody({ session_date: "2026-08-19", decision_id: decisionB_0820 }),
      422,
      "decision_link_invalid"
    );
    await expectPut(
      "decision. wrong-date decision -> 422 decision_link_invalid",
      userA.token,
      doneBody({ session_date: "2026-08-19", decision_id: decisionA_0820 }), // decisionA_0820 is dated 2026-08-20
      422,
      "decision_link_invalid"
    );
    await expectPut(
      "decision. nonexistent decision -> 422 decision_link_invalid",
      userA.token,
      doneBody({ session_date: "2026-08-19", decision_id: randomUUID() }),
      422,
      "decision_link_invalid"
    );
    {
      // Prove the 422 preflight really never reached the RPC: no row for 08-19 exists.
      const { data } = await admin
        .from("completed_sessions")
        .select("id")
        .eq("athlete_id", userA.athleteId)
        .eq("session_date", "2026-08-19");
      record("decision. rejected decision links never wrote a row", (data ?? []).length === 0, `rows=${(data ?? []).length}`);
    }

    // ================= decision/session coherence (M5_003 final review) =================
    // A real decision with final_session = STRENGTH_A, one per scenario date
    // so accepted (200) writes never collide and rejected (422) scenarios
    // are independently verifiable as zero-write. done/partial/skipped
    // require exact coarse-type equality with the plan; replaced never
    // compares at all (see the dedicated comment further below) — so 5 of
    // these 8 scenarios are 200, only the 3 real done/partial/skipped
    // mismatches are 422.
    {
      async function coherenceScenario(
        label: string,
        date: string,
        completionStatus: string,
        sessionType: string,
        expectedStatus: 200 | 422
      ): Promise<void> {
        const decisionId = await insertDecision(admin, userA.athleteId, date, { final_session: "STRENGTH_A" });
        // skipped always requires null duration/rpe regardless of
        // session_type — independent of the REST-specific null-training-load
        // rule, but both null out the same two fields here.
        const needsNullLoad = sessionType === "REST" || completionStatus === "skipped";
        const body = doneBody({
          session_date: date,
          decision_id: decisionId,
          completion_status: completionStatus,
          session_type: sessionType,
          ...(needsNullLoad ? { actual_duration_min: null, rpe: null } : {}),
        });

        if (expectedStatus === 200) {
          await expectPut(`coherence. ${label} -> 200`, userA.token, body, 200);
        } else {
          await expectPut(`coherence. ${label} -> 422 decision_session_mismatch`, userA.token, body, 422, "decision_session_mismatch");
          const { data } = await admin.from("completed_sessions").select("id").eq("athlete_id", userA.athleteId).eq("session_date", date);
          record(`coherence. ${label} wrote zero rows`, (data ?? []).length === 0, `rows=${(data ?? []).length}`);
        }
      }

      // 2026-09-04..2026-09-11 — deliberately clear of every other date used
      // in this file (REST semantics uses 09-01..09-03; "get. absent" below
      // uses 08-30, which a previous revision of this block collided with).
      await coherenceScenario("done + STRENGTH_A (matches plan)", "2026-09-04", "done", "STRENGTH_A", 200);
      await coherenceScenario("partial + STRENGTH_A (matches plan)", "2026-09-05", "partial", "STRENGTH_A", 200);
      await coherenceScenario("skipped + STRENGTH_A (matches plan)", "2026-09-06", "skipped", "STRENGTH_A", 200);
      await coherenceScenario("done + RECOVERY (does not match plan)", "2026-09-07", "done", "RECOVERY", 422);
      await coherenceScenario("partial + RECOVERY (does not match plan)", "2026-09-08", "partial", "RECOVERY", 422);
      await coherenceScenario("skipped + RECOVERY (does not match plan)", "2026-09-09", "skipped", "RECOVERY", 422);
      // For `replaced`, NO comparison against the planned session is made
      // at all (M5_003 second final review) — both a differing and a
      // same-coarse-type replacement are legitimate, since
      // decisions.final_session/completed_sessions.session_type are both
      // coarse and multiple distinct rich interventions can coarsen to the
      // same value. `replaced + STRENGTH_A` specifically proves a
      // same-coarse-type replacement remains representable (it would have
      // been wrongly rejected by the removed "must differ" rule).
      await coherenceScenario("replaced + RECOVERY (differs from plan — still legitimate)", "2026-09-10", "replaced", "RECOVERY", 200);
      await coherenceScenario("replaced + STRENGTH_A (same coarse type as plan — still legitimate)", "2026-09-11", "replaced", "STRENGTH_A", 200);
    }

    // ================= create / update / session_load / readback =================
    let createdId: string | undefined;
    {
      const r = await expectPut("crud. create -> 200", userA.token, doneBody({ session_date: "2026-08-12" }), 200);
      createdId = r.json?.completedSession?.id;
      record("crud. response has a real id", typeof createdId === "string" && createdId.length > 0, createdId);
      record(
        "crud. session_load computed by DB trigger (42*7/10=29.4)",
        r.json?.completedSession?.session_load === 29.4,
        String(r.json?.completedSession?.session_load)
      );

      const { data: freshRow } = await admin.from("completed_sessions").select("free_notes").eq("id", createdId!).single();
      record("crud. free_notes stored null on a fresh create", freshRow?.free_notes === null, String(freshRow?.free_notes));
    }
    {
      const r = await expectPut(
        "crud. update same day (rpe changes) -> 200",
        userA.token,
        doneBody({ session_date: "2026-08-12", rpe: 5 }),
        200
      );
      record("crud. same resource id after update", r.json?.completedSession?.id === createdId, `before=${createdId} after=${r.json?.completedSession?.id}`);
      record(
        "crud. session_load recomputed for the new rpe (42*5/10=21)",
        r.json?.completedSession?.session_load === 21,
        String(r.json?.completedSession?.session_load)
      );
    }
    {
      const r = await expectPut(
        "crud. update to skipped resets session_load to null",
        userA.token,
        doneBody({ session_date: "2026-08-12", completion_status: "skipped", actual_duration_min: null, rpe: null }),
        200
      );
      record("crud. session_load null after switching to skipped", r.json?.completedSession?.session_load === null, String(r.json?.completedSession?.session_load));
    }
    {
      const r = await expectPut(
        "crud. canonical readback field set is complete",
        userA.token,
        doneBody({ session_date: "2026-08-12" }),
        200
      );
      const cs = r.json?.completedSession ?? {};
      const expectedKeys = [
        "id", "session_date", "decision_id", "session_type", "completion_status",
        "actual_duration_min", "rpe", "post_leg_fatigue", "post_grip_fatigue",
        "new_pain", "new_pain_note", "intervention", "main_content", "session_load", "updated_at",
      ];
      const actualKeys = Object.keys(cs).sort();
      record("crud. readback keys match canonical set exactly", deepEqual(actualKeys, [...expectedKeys].sort()), actualKeys.join(","));
    }

    // ================= GET =================
    {
      const r = await get(userA.token, "2026-08-12");
      record("get. existing -> 200 with row", r.status === 200 && r.json?.completedSession?.session_date === "2026-08-12", `status=${r.status}`);
    }
    {
      const r = await get(userA.token, "2026-08-30");
      record("get. absent -> 200 with null (never 404)", r.status === 200 && r.json?.completedSession === null, `status=${r.status} body=${r.text}`);
    }
    {
      const r = await get(userB.token, "2026-08-12");
      record("get. cross-athlete isolation -> B sees null for A's date", r.status === 200 && r.json?.completedSession === null, `status=${r.status}`);
    }
    {
      const r = await get(userA.token, "not-a-date");
      record("get. invalid date -> 400 invalid_date_format", r.status === 400 && r.json?.error?.code === "invalid_date_format", `status=${r.status}`);
    }
    {
      const r = await get(userA.token, "");
      record("get. missing date -> 400 missing_date", r.status === 400 && r.json?.error?.code === "missing_date", `status=${r.status} body=${r.text}`);
    }

    // ================= opaque intervention/main_content preservation =================
    {
      const richIntervention = { kind: "RECOVERY_ACTIVE", load_profile: "LIGHT", nested: { a: [1, 2, 3], b: "x" } };
      const richMainContent = { free_text: "notes", numbers: [1, 2, 3] };
      await expectPut(
        "opaque. create with rich intervention/main_content -> 200",
        userA.token,
        doneBody({ session_date: "2026-08-22", intervention: richIntervention, main_content: richMainContent }),
        200
      );
      const r = await get(userA.token, "2026-08-22");
      record("opaque. intervention round-trips verbatim via GET", deepEqual(r.json?.completedSession?.intervention, richIntervention), JSON.stringify(r.json?.completedSession?.intervention));
      record("opaque. main_content round-trips verbatim via GET", deepEqual(r.json?.completedSession?.main_content, richMainContent), JSON.stringify(r.json?.completedSession?.main_content));

      // Editing RPE only must not erase the opaque fields — full replacement
      // means the caller must resend them, which is exactly what a real
      // "edit" flow does (GET then PUT back the same values, see web/).
      await expectPut(
        "opaque. editing rpe while resending opaque fields preserves them",
        userA.token,
        doneBody({ session_date: "2026-08-22", rpe: 9, intervention: richIntervention, main_content: richMainContent }),
        200
      );
      const r2 = await get(userA.token, "2026-08-22");
      record("opaque. still intact after an edit", deepEqual(r2.json?.completedSession?.intervention, richIntervention), "");
    }

    // ================= free_notes server-side preservation (never client-controllable) =================
    {
      const FREE_NOTES_DATE = "2026-08-23";
      // Seeded directly (admin) — free_notes is not part of the M5_003 API
      // surface at all, so the only way a row can carry a non-null value is
      // a prior write from elsewhere (e.g. a future coach-facing tool).
      const { error: seedError } = await admin.from("completed_sessions").insert({
        athlete_id: userA.athleteId,
        session_date: FREE_NOTES_DATE,
        session_type: "RECOVERY",
        completion_status: "done",
        actual_duration_min: 30,
        rpe: 4,
        post_leg_fatigue: 2,
        post_grip_fatigue: 2,
        new_pain: false,
        free_notes: "preserve-me",
      });
      if (seedError) throw new Error(`free_notes seed insert failed: ${seedError.message}`);

      await expectPut(
        "free_notes. PUT changing only rpe -> 200",
        userA.token,
        doneBody({ session_date: FREE_NOTES_DATE, rpe: 8 }),
        200
      );

      const { data: rowAfter } = await admin.from("completed_sessions").select("free_notes, rpe").eq("athlete_id", userA.athleteId).eq("session_date", FREE_NOTES_DATE).single();
      record("free_notes. preserved exactly across a full-replacement edit", rowAfter?.free_notes === "preserve-me", String(rowAfter?.free_notes));
      record("free_notes. the visible field (rpe) did update", rowAfter?.rpe === 8, String(rowAfter?.rpe));
    }
  } finally {
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
    process.exit(process.exitCode ?? 0);
  });
