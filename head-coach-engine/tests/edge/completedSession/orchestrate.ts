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

// V0.3_007B — the default intervention (RECOVERY_ACTIVE, a fixed-load kind)
// is deliberately coherent with the default session_type (RECOVERY): any
// scenario below that overrides session_type/completion_status away from
// this default must also override intervention to match (or set it to null
// for skipped), or the new server-side coherence check rejects the body
// before the scenario's own intended rule is ever reached. See
// docs/11_DECISION_LOG.md V0.3_007B.
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
    intervention: { kind: "RECOVERY_ACTIVE" },
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
      doneBody({ session_date: "2026-08-15", completion_status: "skipped", actual_duration_min: null, rpe: null, intervention: null }),
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
      doneBody({ session_date: "2026-08-15", completion_status: "skipped", actual_duration_min: 10, rpe: null, intervention: null }),
      400,
      "invalid_body_for_status"
    );

    // ================= REST semantics (M5_003 final review) =================
    {
      const r = await expectPut(
        "REST. done + null duration/rpe -> 200",
        userA.token,
        doneBody({
          session_date: "2026-09-01",
          session_type: "REST",
          completion_status: "done",
          intervention: { kind: "REST" },
          actual_duration_min: null,
          rpe: null,
        }),
        200
      );
      record(
        "REST. done persisted -> session_load null",
        r.json?.completedSession?.session_load === null,
        String(r.json?.completedSession?.session_load)
      );
      // V0.3_007B final review, Issue C/§12 — full chain proof (web
      // validation -> Edge validation -> RPC -> DB), re-read preserves the
      // canonical fixed-load shape: `{kind:"REST"}`, load_profile ABSENT
      // (never fabricated as null/LIGHT/MODERATE/HEAVY).
      const getR = await get(userA.token, "2026-09-01");
      record(
        "REST. re-read preserves canonical shape ({kind:\"REST\"}, no load_profile key)",
        deepEqual(getR.json?.completedSession?.intervention, { kind: "REST" }) &&
          !Object.prototype.hasOwnProperty.call(getR.json?.completedSession?.intervention ?? {}, "load_profile"),
        JSON.stringify(getR.json?.completedSession?.intervention)
      );
    }
    await expectPut(
      "REST. done + non-null duration -> 400 invalid_body_for_status",
      userA.token,
      doneBody({
        session_date: "2026-09-01",
        session_type: "REST",
        completion_status: "done",
        intervention: { kind: "REST" },
        actual_duration_min: 20,
        rpe: null,
      }),
      400,
      "invalid_body_for_status"
    );
    await expectPut(
      "REST. replaced + null duration/rpe -> 200",
      userA.token,
      doneBody({
        session_date: "2026-09-02",
        session_type: "REST",
        completion_status: "replaced",
        intervention: { kind: "REST" },
        actual_duration_min: null,
        rpe: null,
      }),
      200
    );
    await expectPut(
      "REST. partial -> 400 invalid_body_for_status",
      userA.token,
      doneBody({
        session_date: "2026-09-03",
        session_type: "REST",
        completion_status: "partial",
        intervention: { kind: "REST" },
        actual_duration_min: null,
        rpe: null,
      }),
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
      // V0.3_007B — a performed intervention that derives to the given
      // coarse sessionType, so the new server-side coherence check (in
      // validation.ts, upstream of this scenario's own intended
      // decision_session_mismatch check) passes and the scenario actually
      // exercises what it names. skipped has no performed intervention at
      // all (null, regardless of sessionType — see completedSessionTypes.ts).
      const INTERVENTION_FOR_SESSION_TYPE: Record<string, Record<string, unknown>> = {
        STRENGTH_A: { kind: "STRENGTH_LOWER", load_profile: "HEAVY" },
        RECOVERY: { kind: "RECOVERY_ACTIVE" },
      };

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
        const intervention = completionStatus === "skipped" ? null : (INTERVENTION_FOR_SESSION_TYPE[sessionType] ?? null);
        const body = doneBody({
          session_date: date,
          decision_id: decisionId,
          completion_status: completionStatus,
          session_type: sessionType,
          intervention,
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
        doneBody({ session_date: "2026-08-12", completion_status: "skipped", actual_duration_min: null, rpe: null, intervention: null }),
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
        "technical_outcome", "change_reason", "change_reason_note",
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

    // ================= intervention (strict, V0.3_007B) / main_content (still opaque) =================
    // `intervention` is no longer opaque — it is the ONE athlete-authored
    // fact for a performed session, strictly validated against the rich
    // TrainingIntervention vocabulary (see validation.ts). `main_content`
    // remains genuinely opaque/dormant (never inspected beyond "is a plain
    // object or null" — see completedSessionTypes.ts).
    {
      const richIntervention = { kind: "STRENGTH_UPPER", load_profile: "MODERATE" }; // derives STRENGTH_B
      const richMainContent = { free_text: "notes", numbers: [1, 2, 3] };
      await expectPut(
        "intervention. create with a valid rich intervention + opaque main_content -> 200",
        userA.token,
        doneBody({ session_date: "2026-08-22", session_type: "STRENGTH_B", intervention: richIntervention, main_content: richMainContent }),
        200
      );
      const r = await get(userA.token, "2026-08-22");
      record("intervention. round-trips verbatim via GET", deepEqual(r.json?.completedSession?.intervention, richIntervention), JSON.stringify(r.json?.completedSession?.intervention));
      record("main_content. round-trips verbatim via GET (still opaque)", deepEqual(r.json?.completedSession?.main_content, richMainContent), JSON.stringify(r.json?.completedSession?.main_content));

      // Editing RPE only must not erase intervention/main_content — full
      // replacement means the caller must resend them, which is exactly
      // what a real "edit" flow does (GET then PUT back the same values,
      // see web/).
      await expectPut(
        "intervention. editing rpe while resending intervention/main_content preserves them",
        userA.token,
        doneBody({ session_date: "2026-08-22", session_type: "STRENGTH_B", rpe: 9, intervention: richIntervention, main_content: richMainContent }),
        200
      );
      const r2 = await get(userA.token, "2026-08-22");
      record("intervention. still intact after an edit", deepEqual(r2.json?.completedSession?.intervention, richIntervention), "");
    }

    // ================= intervention strict rejection (server-side coherence gate) =================
    await expectPut(
      "intervention. null rejected for done -> 400 invalid_body_for_status",
      userA.token,
      doneBody({ session_date: "2026-08-27", intervention: null }),
      400,
      "invalid_body_for_status"
    );
    await expectPut(
      "intervention. non-null rejected for skipped -> 400 invalid_body_for_status",
      userA.token,
      doneBody({
        session_date: "2026-08-28",
        completion_status: "skipped",
        actual_duration_min: null,
        rpe: null,
        intervention: { kind: "RECOVERY_ACTIVE" },
      }),
      400,
      "invalid_body_for_status"
    );
    await expectPut(
      "intervention. extra unknown field rejected -> 400 invalid_intervention",
      userA.token,
      doneBody({ session_date: "2026-08-29", intervention: { kind: "RECOVERY_ACTIVE", nested: { a: 1 } } }),
      400,
      "invalid_intervention"
    );
    await expectPut(
      "intervention. unrecognized kind rejected -> 400 invalid_intervention",
      userA.token,
      doneBody({ session_date: "2026-09-12", intervention: { kind: "YOGA" } }),
      400,
      "invalid_intervention"
    );
    await expectPut(
      "intervention. session_type mismatch rejected -> 400 session_type_mismatch",
      userA.token,
      doneBody({ session_date: "2026-09-13", session_type: "DH_TECHNICAL", intervention: { kind: "RECOVERY_ACTIVE" } }),
      400,
      "session_type_mismatch"
    );
    await expectPut(
      "intervention. RACE_ACTIVITY accepted — never a valid plan, but a valid performed reality -> 200",
      userA.token,
      doneBody({ session_date: "2026-09-14", session_type: "RACE_PREP", intervention: { kind: "RACE_ACTIVITY" } }),
      200
    );

    // ================= athlete debrief fields (V0.3_007C) =================
    {
      // Old-client compatibility: doneBody() never includes the 3 new keys
      // at all — exactly what a pre-007C client sends. Every scenario
      // above this point already proves this doesn't break; this makes it
      // explicit and checks the readback shape.
      const r = await expectPut("debrief. old-client body (no debrief keys) -> 200", userA.token, doneBody({ session_date: "2026-09-15" }), 200);
      record(
        "debrief. old-client body resolves all three fields to null",
        r.json?.completedSession?.technical_outcome === null &&
          r.json?.completedSession?.change_reason === null &&
          r.json?.completedSession?.change_reason_note === null,
        JSON.stringify({
          technical_outcome: r.json?.completedSession?.technical_outcome,
          change_reason: r.json?.completedSession?.change_reason,
          change_reason_note: r.json?.completedSession?.change_reason_note,
        })
      );

      // A decision with a REAL prescribed technical task — inserted
      // directly (admin), since insertDecision (testDb.ts) never sets
      // daily_plan. Only index.ts's DB-dependent check (hasExecutionTask)
      // can be proven against a real row like this.
      const { data: taskDecision, error: taskDecisionError } = await admin
        .from("decisions")
        .insert({
          athlete_id: userA.athleteId,
          decision_date: "2026-09-16",
          final_session: "DH_PERFORMANCE",
          reason: "test fixture",
          engine_version: "test",
          daily_plan: { dh_or_technical: { active: true, execution_task: "Regarde loin, freine avant le virage" } },
        })
        .select("id")
        .single();
      if (taskDecisionError || !taskDecision) throw new Error(`debrief task-decision insert failed: ${taskDecisionError?.message}`);
      const taskDecisionId = taskDecision.id as string;

      // Full round-trip: technical_outcome + change_reason + note all persist and re-read verbatim.
      // session_type/intervention must match the linked decision's own
      // final_session (DH_PERFORMANCE) — the decision/session coherence
      // check (M5_003 final review) still applies for `partial`.
      await expectPut(
        "debrief. full round-trip (technical_outcome + change_reason + note) -> 200",
        userA.token,
        doneBody({
          session_date: "2026-09-16",
          decision_id: taskDecisionId,
          session_type: "DH_PERFORMANCE",
          intervention: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
          completion_status: "partial",
          technical_outcome: "partial",
          change_reason: "fatigue_control",
          change_reason_note: "Jambes lourdes en fin de session",
        }),
        200
      );
      const rDebrief = await get(userA.token, "2026-09-16");
      record(
        "debrief. round-trips verbatim via GET",
        rDebrief.json?.completedSession?.technical_outcome === "partial" &&
          rDebrief.json?.completedSession?.change_reason === "fatigue_control" &&
          rDebrief.json?.completedSession?.change_reason_note === "Jambes lourdes en fin de session",
        JSON.stringify(rDebrief.json?.completedSession)
      );

      // A decision with NO prescribed task (insertDecision never sets
      // daily_plan) — technical_outcome must be rejected against it. Uses a
      // DH-family session_type/intervention (matching the decision's own
      // final_session) so every earlier stateless check (DH-family,
      // decision_session_mismatch) passes and this DB-dependent check is
      // what actually fires.
      const noTaskDecisionId = await insertDecision(admin, userA.athleteId, "2026-09-17", { final_session: "DH_PERFORMANCE" });
      await expectPut(
        "debrief. technical_outcome rejected when the linked decision has no execution_task -> 422 technical_outcome_no_task",
        userA.token,
        doneBody({
          session_date: "2026-09-17",
          decision_id: noTaskDecisionId,
          session_type: "DH_PERFORMANCE",
          intervention: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
          technical_outcome: "yes",
        }),
        422,
        "technical_outcome_no_task"
      );
      {
        const { data } = await admin.from("completed_sessions").select("id").eq("athlete_id", userA.athleteId).eq("session_date", "2026-09-17");
        record("debrief. technical_outcome_no_task rejection wrote zero rows", (data ?? []).length === 0, `rows=${(data ?? []).length}`);
      }

      // coach_criterion without a linked decision — stateless rejection (400, from validation.ts, before any DB read).
      await expectPut(
        "debrief. coach_criterion rejected without a linked decision -> 400 coach_criterion_requires_decision",
        userA.token,
        doneBody({
          session_date: "2026-09-18",
          completion_status: "partial",
          decision_id: null,
          change_reason: "coach_criterion",
        }),
        400,
        "coach_criterion_requires_decision"
      );

      // change_reason rejected outright for done.
      await expectPut(
        "debrief. change_reason rejected for done -> 400 invalid_body_for_status",
        userA.token,
        doneBody({ session_date: "2026-09-19", change_reason: "mechanical" }),
        400,
        "invalid_body_for_status"
      );

      // change_reason is NEVER server-required for a non-done status — old-client/UI-degraded compatibility.
      await expectPut(
        "debrief. change_reason = null accepted for skipped — never server-required -> 200",
        userA.token,
        doneBody({
          session_date: "2026-09-20",
          completion_status: "skipped",
          intervention: null,
          actual_duration_min: null,
          rpe: null,
          change_reason: null,
        }),
        200
      );

      // Final semantic review, Issue C — technical_outcome requires the
      // PERFORMED activity to itself be DH-family, even against a real
      // decision (taskDecisionId) that does carry a prescribed task. This
      // is the stateless half of the rule (validation.ts), so 400 not 422.
      await expectPut(
        "debrief. technical_outcome rejected for a non-DH performed activity (even with a real task-having decision) -> 400 technical_outcome_not_applicable",
        userA.token,
        doneBody({
          session_date: "2026-09-16",
          decision_id: taskDecisionId,
          session_type: "AEROBIC_BASE",
          intervention: { kind: "AEROBIC_BASE", load_profile: "MODERATE" },
          technical_outcome: "yes",
        }),
        400,
        "technical_outcome_not_applicable"
      );

      // Final semantic review, Issue #3 — change_reason='other' requires a note.
      await expectPut(
        "debrief. change_reason='other' rejected with no note -> 400 change_reason_note_required",
        userA.token,
        doneBody({ session_date: "2026-09-21", completion_status: "partial", change_reason: "other" }),
        400,
        "change_reason_note_required"
      );
      await expectPut(
        "debrief. change_reason='other' accepted with a real note -> 200",
        userA.token,
        doneBody({
          session_date: "2026-09-22",
          completion_status: "partial",
          change_reason: "other",
          change_reason_note: "Navette arrêtée à 15h",
        }),
        200
      );
    }

    // ================= rollout compatibility (V0.3_007C) — direct RPC =================
    {
      // These scenarios call persist_completed_session directly (bypassing
      // the Edge Function entirely) because the Edge Function's own
      // OPTIONAL_KEYS handling ALWAYS sends explicit values (including
      // null) for the 3 debrief keys — it can never itself produce an
      // "old-shaped" p_row. Only a client that talks to the RPC directly
      // (like the currently-deployed pre-007C Edge Function still in
      // production during the rollout window) can exercise the
      // presence/absence distinction this section proves. See
      // docs/11_DECISION_LOG.md, V0.3_007C rollout-compatibility finding.
      const oldShapedPRow = (overrides: Record<string, unknown> = {}) => ({
        session_date: "2026-09-23",
        decision_id: null,
        session_type: "RECOVERY",
        completion_status: "done",
        actual_duration_min: 42,
        rpe: 7,
        main_content: null,
        intervention: { kind: "RECOVERY_ACTIVE" },
        free_notes: null,
        post_leg_fatigue: 4,
        post_grip_fatigue: 3,
        new_pain: false,
        new_pain_note: null,
        ...overrides,
      });

      async function expectRpc(name: string, pRow: Record<string, unknown>, expectSuccess: boolean, expectedErrorSubstring?: string): Promise<void> {
        const { data, error } = await admin.rpc("persist_completed_session", { p_athlete_id: userA.athleteId, p_row: pRow });
        if (expectSuccess) {
          record(name, !error && !!data, error ? `error=${error.message}` : `data=${JSON.stringify(data)}`);
        } else {
          const matches = !!error && (expectedErrorSubstring === undefined || error.message.includes(expectedErrorSubstring));
          record(name, matches, error ? `error=${error.message}` : "no error raised");
        }
      }

      // (a) old 007B payload shape, no debrief keys at all -> accepted, fields resolve to null.
      await expectRpc("rollout. post-migration RPC + old 007B payload (no debrief keys) -> accepted", oldShapedPRow({ session_date: "2026-09-23" }), true);
      {
        const { data: row } = await admin
          .from("completed_sessions")
          .select("technical_outcome, change_reason, change_reason_note")
          .eq("athlete_id", userA.athleteId)
          .eq("session_date", "2026-09-23")
          .single();
        record(
          "rollout. old-shaped payload resolves all 3 debrief keys to null",
          row?.technical_outcome === null && row?.change_reason === null && row?.change_reason_note === null,
          JSON.stringify(row)
        );
      }

      // (b) new payload with the 3 keys explicitly null -> accepted.
      await expectRpc(
        "rollout. post-migration RPC + new payload with debrief keys explicitly null -> accepted",
        oldShapedPRow({ session_date: "2026-09-24", technical_outcome: null, change_reason: null, change_reason_note: null }),
        true
      );

      // (c) new payload with valid non-null values -> accepted, and persists verbatim.
      await expectRpc(
        "rollout. post-migration RPC + new valid debrief values -> accepted",
        oldShapedPRow({
          session_date: "2026-09-25",
          completion_status: "partial",
          technical_outcome: "yes",
          change_reason: "mechanical",
          change_reason_note: "Dérailleur cassé",
        }),
        true
      );
      {
        const { data: row } = await admin
          .from("completed_sessions")
          .select("technical_outcome, change_reason, change_reason_note")
          .eq("athlete_id", userA.athleteId)
          .eq("session_date", "2026-09-25")
          .single();
        record(
          "rollout. new valid debrief values persist verbatim",
          row?.technical_outcome === "yes" && row?.change_reason === "mechanical" && row?.change_reason_note === "Dérailleur cassé",
          JSON.stringify(row)
        );
      }

      // (d) unknown random key -> rejected (unchanged unknown-key rejection loop).
      await expectRpc(
        "rollout. post-migration RPC + unknown random key -> rejected",
        oldShapedPRow({ session_date: "2026-09-26", totally_unknown_key: "x" }),
        false
      );

      // (e) invalid technical_outcome enum value -> rejected (Postgres enum cast failure).
      await expectRpc(
        "rollout. post-migration RPC + invalid technical_outcome value -> rejected",
        oldShapedPRow({ session_date: "2026-09-27", technical_outcome: "maybe" }),
        false
      );

      // (f) invalid change_reason enum value -> rejected (Postgres enum cast failure).
      await expectRpc(
        "rollout. post-migration RPC + invalid change_reason value -> rejected",
        oldShapedPRow({ session_date: "2026-09-28", change_reason: "bad_reason" }),
        false
      );
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
